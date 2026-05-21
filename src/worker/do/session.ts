import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import type { SessionMeta, SessionStatus } from "../lib/db";
import {
  findActiveSessionForIssue,
  getCurrentRound,
  getFinalEstimate,
  getSession,
  listParticipants,
  listVotesForRound,
} from "../lib/db";

export const NEED_INFO_VALUE = "need_info";

export interface ParticipantSeed {
  userId: string;
  displayName: string;
  email: string;
}

export interface CreateSessionInput {
  sessionId: string;
  teamId: string;
  projectId: string;
  issueId: string;
  facilitatorId: string;
  meta: SessionMeta;
  participants: ParticipantSeed[];
}

export interface FinalEstimateDTO {
  value: string;
  finalizedBy: string;
  finalizedAt: number;
}

export interface SessionStateDTO {
  id: string;
  status: SessionStatus;
  currentRoundNo: number;
  meta: SessionMeta;
  facilitatorId: string;
  needsDiscussion: boolean;
  participants: ParticipantStateDTO[];
  finalEstimate: FinalEstimateDTO | null;
}

export interface ParticipantStateDTO {
  userId: string;
  displayName: string;
  email: string;
  voted: boolean;
  votedNeedInfo: boolean;
  /** Only populated when status !== "voting". null means this user didn't vote in the current round. */
  value: string | null;
}

/**
 * One Durable Object instance per planning-poker session. The DO is the sole
 * writer to D1 for its session, so concurrent votes / reveals / re-votes are
 * serialised through it.
 */
export class SessionDO extends DurableObject<Env> {
  async createSession(input: CreateSessionInput): Promise<void> {
    const db = this.env.DB;
    const existing = await findActiveSessionForIssue(db, input.issueId);
    if (existing) {
      throw new Error(`session_already_exists:${existing.id}`);
    }
    const now = Date.now();
    const roundId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];
    statements.push(
      db
        .prepare(
          "INSERT INTO sessions (id, team_id, project_id, issue_id, facilitator_id, status, current_round_no, created_at, meta_json) VALUES (?, ?, ?, ?, ?, 'voting', 1, ?, ?)",
        )
        .bind(
          input.sessionId,
          input.teamId,
          input.projectId,
          input.issueId,
          input.facilitatorId,
          now,
          JSON.stringify(input.meta),
        ),
    );
    statements.push(
      db
        .prepare("INSERT INTO rounds (id, session_id, round_no) VALUES (?, ?, 1)")
        .bind(roundId, input.sessionId),
    );
    for (const p of input.participants) {
      statements.push(
        db
          .prepare(
            "INSERT INTO participants (session_id, user_id, display_name, email, added_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(input.sessionId, p.userId, p.displayName, p.email, now),
      );
    }
    await db.batch(statements);
  }

  async addParticipant(
    sessionId: string,
    seed: ParticipantSeed,
  ): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status === "finalized") throw new Error("session_finalized");
    await this.env.DB
      .prepare(
        "INSERT OR REPLACE INTO participants (session_id, user_id, display_name, email, added_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(sessionId, seed.userId, seed.displayName, seed.email, Date.now())
      .run();
  }

  async removeParticipant(sessionId: string, userId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status === "finalized") throw new Error("session_finalized");

    const db = this.env.DB;
    const round = await getCurrentRound(db, sessionId, session.current_round_no);
    const statements: D1PreparedStatement[] = [
      db
        .prepare("DELETE FROM participants WHERE session_id = ? AND user_id = ?")
        .bind(sessionId, userId),
    ];
    if (round) {
      statements.push(
        db
          .prepare("DELETE FROM votes WHERE round_id = ? AND user_id = ?")
          .bind(round.id, userId),
      );
    }
    await db.batch(statements);
    // Removing a participant may unblock auto-reveal.
    await this.maybeAutoReveal(sessionId);
  }

  async vote(sessionId: string, userId: string, value: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "voting") throw new Error("not_voting");

    const meta = parseMeta(session.meta_json);
    if (!isValidVoteValue(value, meta)) throw new Error("invalid_vote_value");

    const participants = await listParticipants(this.env.DB, sessionId);
    if (!participants.some((p) => p.user_id === userId)) {
      throw new Error("not_a_participant");
    }

    const round = await getCurrentRound(this.env.DB, sessionId, session.current_round_no);
    if (!round) throw new Error("round_missing");

    await this.env.DB
      .prepare(
        "INSERT INTO votes (round_id, user_id, value, voted_at) VALUES (?, ?, ?, ?) ON CONFLICT(round_id, user_id) DO UPDATE SET value = excluded.value, voted_at = excluded.voted_at",
      )
      .bind(round.id, userId, value, Date.now())
      .run();

    await this.maybeAutoReveal(sessionId);
  }

  async revealManually(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "voting") return; // idempotent
    await this.reveal(sessionId, session.current_round_no);
  }

  /**
   * Persist the agreed-upon estimate. Callers MUST write to Linear before
   * calling this — the DO does not own the Linear write because it has no
   * access to the requester's OAuth token.
   */
  async finalize(sessionId: string, byUserId: string, value: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "revealed") throw new Error("not_revealed");
    const meta = parseMeta(session.meta_json);
    if (!isFinalizableValue(value, meta)) throw new Error("invalid_finalize_value");

    const now = Date.now();
    const db = this.env.DB;
    await db.batch([
      db
        .prepare(
          "INSERT INTO final_estimates (session_id, value, finalized_by, finalized_at) VALUES (?, ?, ?, ?)",
        )
        .bind(sessionId, value, byUserId, now),
      db.prepare("UPDATE sessions SET status = 'finalized' WHERE id = ?").bind(sessionId),
    ]);
  }

  async revote(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status === "finalized") throw new Error("finalized");

    const newRoundNo = session.current_round_no + 1;
    const newRoundId = crypto.randomUUID();
    const db = this.env.DB;
    await db.batch([
      db
        .prepare("INSERT INTO rounds (id, session_id, round_no) VALUES (?, ?, ?)")
        .bind(newRoundId, sessionId, newRoundNo),
      db
        .prepare(
          "UPDATE sessions SET status = 'voting', current_round_no = ? WHERE id = ?",
        )
        .bind(newRoundNo, sessionId),
    ]);
  }

  async getState(sessionId: string): Promise<SessionStateDTO> {
    const session = await this.requireSession(sessionId);
    return await this.buildStateDTO(session);
  }

  // ---- private helpers -------------------------------------------------

  private async requireSession(sessionId: string) {
    const s = await getSession(this.env.DB, sessionId);
    if (!s) throw new Error("session_not_found");
    return s;
  }

  private async maybeAutoReveal(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "voting") return;

    const participants = await listParticipants(this.env.DB, sessionId);
    if (participants.length === 0) return;

    const round = await getCurrentRound(this.env.DB, sessionId, session.current_round_no);
    if (!round) return;
    const votes = await listVotesForRound(this.env.DB, round.id);
    const voterIds = new Set(votes.map((v) => v.user_id));
    const allVoted = participants.every((p) => voterIds.has(p.user_id));
    if (!allVoted) return;

    const hasNeedInfo = votes.some((v) => v.value === NEED_INFO_VALUE);
    if (hasNeedInfo) return; // stays in voting with the "needs discussion" badge

    await this.reveal(sessionId, session.current_round_no);
  }

  private async reveal(sessionId: string, roundNo: number): Promise<void> {
    const now = Date.now();
    const db = this.env.DB;
    await db.batch([
      db
        .prepare("UPDATE rounds SET revealed_at = ? WHERE session_id = ? AND round_no = ?")
        .bind(now, sessionId, roundNo),
      db
        .prepare("UPDATE sessions SET status = 'revealed' WHERE id = ?")
        .bind(sessionId),
    ]);
  }

  private async buildStateDTO(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
    const meta = parseMeta(session.meta_json);
    const participants = await listParticipants(this.env.DB, session.id);
    const round = await getCurrentRound(
      this.env.DB,
      session.id,
      session.current_round_no,
    );
    const votes = round
      ? await listVotesForRound(this.env.DB, round.id)
      : [];
    const voteByUser = new Map(votes.map((v) => [v.user_id, v.value]));

    const isVoting = session.status === "voting";
    const participantsDTO: ParticipantStateDTO[] = participants.map((p) => {
      const v = voteByUser.get(p.user_id) ?? null;
      const voted = v !== null;
      const votedNeedInfo = v === NEED_INFO_VALUE;
      return {
        userId: p.user_id,
        displayName: p.display_name,
        email: p.email,
        voted,
        votedNeedInfo,
        // During voting we hide values; need_info is visible as a flag only.
        value: isVoting ? null : v,
      };
    });

    const needsDiscussion = isVoting && participantsDTO.some((p) => p.votedNeedInfo);

    const finalRow =
      session.status === "finalized"
        ? await getFinalEstimate(this.env.DB, session.id)
        : null;
    const finalEstimate: FinalEstimateDTO | null = finalRow
      ? {
          value: finalRow.value,
          finalizedBy: finalRow.finalized_by,
          finalizedAt: finalRow.finalized_at,
        }
      : null;

    return {
      id: session.id,
      status: session.status,
      currentRoundNo: session.current_round_no,
      meta,
      facilitatorId: session.facilitator_id,
      needsDiscussion,
      participants: participantsDTO,
      finalEstimate,
    };
  }
}

function parseMeta(json: string): SessionMeta {
  return JSON.parse(json) as SessionMeta;
}

export function isValidVoteValue(value: string, meta: SessionMeta): boolean {
  if (value === NEED_INFO_VALUE) return true;
  return meta.scale.options.some((opt) => opt.value === value);
}

export function isFinalizableValue(value: string, meta: SessionMeta): boolean {
  // need_info isn't a valid final estimate — only real scale options.
  return meta.scale.options.some((opt) => opt.value === value);
}
