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

/**
 * A finalize in flight: claimed via beginFinalize before the caller's Linear
 * writes, released by commitFinalize / abortFinalize. Stored in DO storage so
 * it survives across the multiple RPCs of one finalize request. The TTL is a
 * safety valve for a Worker that died mid-finalize and never released.
 */
interface FinalizeClaim {
  byUserId: string;
  value: string;
  at: number;
}

const FINALIZE_CLAIM_KEY = "finalize_claim";
const FINALIZE_CLAIM_TTL_MS = 2 * 60 * 1000;

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
  participants: ParticipantStateDTO[];
  /** How many current-round votes are need_info. Aggregate only — it must not reveal who. */
  needInfoCount: number;
  finalEstimate: FinalEstimateDTO | null;
}

export interface ParticipantStateDTO {
  userId: string;
  displayName: string;
  email: string;
  voted: boolean;
  /** Pre-reveal this is only true for the viewer themself — who picked need_info stays hidden until reveal. */
  votedNeedInfo: boolean;
  /** Only populated when status !== "voting". null means this user didn't vote in the current round. */
  value: string | null;
}

/**
 * One Durable Object instance per planning-poker session. The DO is the sole
 * writer to D1 for its session, so concurrent votes / reveals / re-votes are
 * serialised through it.
 *
 * Serialisation is NOT automatic: the DO input gate only closes during DO
 * *storage* operations, and every method here awaits D1 binding subrequests,
 * during which other RPCs to the same instance would be delivered and
 * interleave. Each public method therefore runs inside
 * blockConcurrencyWhile(), which defers all other event delivery until the
 * method completes.
 */
export class SessionDO extends DurableObject<Env> {
  /** Run `fn` with the input gate held so no other RPC can interleave. */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    return this.ctx.blockConcurrencyWhile(fn);
  }

  createSession(input: CreateSessionInput): Promise<void> {
    return this.serialized(() => this.createSessionImpl(input));
  }

  addParticipant(sessionId: string, seed: ParticipantSeed): Promise<void> {
    return this.serialized(() => this.addParticipantImpl(sessionId, seed));
  }

  removeParticipant(sessionId: string, userId: string): Promise<void> {
    return this.serialized(() => this.removeParticipantImpl(sessionId, userId));
  }

  vote(sessionId: string, userId: string, value: string): Promise<void> {
    return this.serialized(() => this.voteImpl(sessionId, userId, value));
  }

  revealManually(sessionId: string): Promise<void> {
    return this.serialized(() => this.revealManuallyImpl(sessionId));
  }

  beginFinalize(sessionId: string, byUserId: string, value: string): Promise<void> {
    return this.serialized(() => this.beginFinalizeImpl(sessionId, byUserId, value));
  }

  commitFinalize(sessionId: string, byUserId: string, value: string): Promise<void> {
    return this.serialized(() => this.commitFinalizeImpl(sessionId, byUserId, value));
  }

  abortFinalize(sessionId: string): Promise<void> {
    return this.serialized(() => this.abortFinalizeImpl(sessionId));
  }

  revote(sessionId: string): Promise<void> {
    return this.serialized(() => this.revoteImpl(sessionId));
  }

  unfinalize(sessionId: string): Promise<void> {
    return this.serialized(() => this.unfinalizeImpl(sessionId));
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.serialized(() => this.deleteSessionImpl(sessionId));
  }

  getState(sessionId: string, viewerUserId: string | null = null): Promise<SessionStateDTO> {
    // Reads take the gate too so a state snapshot can't observe a mutation
    // half-applied across its multiple D1 queries.
    return this.serialized(() => this.getStateImpl(sessionId, viewerUserId));
  }

  // ---- gated implementations -------------------------------------------

  private async createSessionImpl(input: CreateSessionInput): Promise<void> {
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
    try {
      await db.batch(statements);
    } catch (e) {
      // The pre-check above races across DO instances (each create runs in a
      // DO keyed by its fresh session id). The partial unique index on
      // sessions(issue_id) WHERE status != 'finalized' is the authoritative
      // guard — translate its violation into the same error the pre-check
      // raises.
      if (isUniqueConstraintError(e)) {
        const winner = await findActiveSessionForIssue(db, input.issueId);
        throw new Error(`session_already_exists:${winner?.id ?? ""}`);
      }
      throw e;
    }
  }

  private async addParticipantImpl(
    sessionId: string,
    seed: ParticipantSeed,
  ): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "voting") throw new Error("not_voting");
    await this.env.DB
      .prepare(
        "INSERT OR REPLACE INTO participants (session_id, user_id, display_name, email, added_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(sessionId, seed.userId, seed.displayName, seed.email, Date.now())
      .run();
  }

  private async removeParticipantImpl(sessionId: string, userId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "voting") throw new Error("not_voting");

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

  private async voteImpl(sessionId: string, userId: string, value: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    // voting and needs_discussion both accept new / changed votes — they're
    // both pre-reveal states.
    if (session.status !== "voting" && session.status !== "needs_discussion") {
      throw new Error("not_voting");
    }

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

  private async revealManuallyImpl(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "voting" && session.status !== "needs_discussion") {
      return; // idempotent
    }
    await this.reveal(sessionId, session.current_round_no);
  }

  /**
   * Claim the finalize before the caller writes to Linear. The claim blocks
   * revote() for its lifetime, so the session can't slip out of "revealed"
   * between the caller's Linear writes and commitFinalize(). The DO does not
   * own the Linear writes itself because it has no access to the requester's
   * OAuth token.
   */
  private async beginFinalizeImpl(
    sessionId: string,
    byUserId: string,
    value: string,
  ): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "revealed") throw new Error("not_revealed");
    const meta = parseMeta(session.meta_json);
    if (!isFinalizableValue(value, meta)) throw new Error("invalid_finalize_value");
    if (await this.activeFinalizeClaim()) throw new Error("finalize_in_progress");
    const claim: FinalizeClaim = { byUserId, value, at: Date.now() };
    await this.ctx.storage.put(FINALIZE_CLAIM_KEY, claim);
  }

  /**
   * Persist the agreed-upon estimate and release the claim. Callers MUST
   * have written to Linear (after beginFinalize) before calling this.
   */
  private async commitFinalizeImpl(sessionId: string, byUserId: string, value: string): Promise<void> {
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
    await this.ctx.storage.delete(FINALIZE_CLAIM_KEY);
  }

  private async abortFinalizeImpl(sessionId: string): Promise<void> {
    await this.requireSession(sessionId);
    await this.ctx.storage.delete(FINALIZE_CLAIM_KEY);
  }

  private async revoteImpl(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status === "finalized") throw new Error("finalized");
    // A finalize is mid-flight (Linear writes issued after beginFinalize):
    // opening a new round now would let Linear and the local record diverge.
    if (await this.activeFinalizeClaim()) throw new Error("finalize_in_progress");

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

  /**
   * Reopen a finalized session — drops the local final_estimates row and
   * flips status back to "revealed". Does NOT touch Linear: this exists for
   * the case where Linear's side (estimate or project status) has been
   * reverted externally and our local record needs to follow suit.
   */
  private async unfinalizeImpl(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "finalized") throw new Error("not_finalized");
    const db = this.env.DB;
    try {
      await db.batch([
        db.prepare("DELETE FROM final_estimates WHERE session_id = ?").bind(sessionId),
        db.prepare("UPDATE sessions SET status = 'revealed' WHERE id = ?").bind(sessionId),
      ]);
    } catch (e) {
      // Reopening would put a second active session on this issue (one was
      // created after this one finalized) — the partial unique index rejects
      // that, and so do we.
      if (isUniqueConstraintError(e)) throw new Error("another_active_session_exists");
      throw e;
    }
  }

  /**
   * Permanently delete a session and all of its children. Used when the
   * underlying Linear project has been cancelled or otherwise no longer
   * matters. Does NOT touch Linear — just clears this app's local record.
   * Allowed in any status.
   */
  private async deleteSessionImpl(sessionId: string): Promise<void> {
    await this.requireSession(sessionId);
    const db = this.env.DB;
    // Explicit deletes (rather than relying on FK CASCADE, which D1 may not
    // have enabled) and in reverse-dependency order.
    await db.batch([
      db
        .prepare(
          "DELETE FROM votes WHERE round_id IN (SELECT id FROM rounds WHERE session_id = ?)",
        )
        .bind(sessionId),
      db.prepare("DELETE FROM rounds WHERE session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM final_estimates WHERE session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM participants WHERE session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId),
    ]);
  }

  private async getStateImpl(
    sessionId: string,
    viewerUserId: string | null,
  ): Promise<SessionStateDTO> {
    const session = await this.requireSession(sessionId);
    return await this.buildStateDTO(session, viewerUserId);
  }

  // ---- private helpers -------------------------------------------------

  private async requireSession(sessionId: string) {
    const s = await getSession(this.env.DB, sessionId);
    if (!s) throw new Error("session_not_found");
    return s;
  }

  /** The current finalize claim, or null when absent or older than its TTL. */
  private async activeFinalizeClaim(): Promise<FinalizeClaim | null> {
    const claim = await this.ctx.storage.get<FinalizeClaim>(FINALIZE_CLAIM_KEY);
    if (!claim) return null;
    if (Date.now() - claim.at > FINALIZE_CLAIM_TTL_MS) {
      await this.ctx.storage.delete(FINALIZE_CLAIM_KEY);
      return null;
    }
    return claim;
  }

  /**
   * Re-evaluate the auto-reveal transition. Runs after every vote / add /
   * remove participant on a pre-reveal session.
   *
   * - voting + all voted + no need_info  → auto reveal
   * - voting + all voted + need_info     → flip to needs_discussion
   * - needs_discussion + all voted + no need_info  → auto reveal
   * - needs_discussion + all voted + need_info     → stay (no-op)
   * - needs_discussion + not all voted   → fall back to voting (a removed
   *   non-voter or a newly-added participant invalidated the "all voted"
   *   condition)
   */
  private async maybeAutoReveal(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "voting" && session.status !== "needs_discussion") return;

    const participants = await listParticipants(this.env.DB, sessionId);
    if (participants.length === 0) {
      // No one to vote. If we somehow ended up in needs_discussion, fall back.
      if (session.status === "needs_discussion") {
        await this.setStatus(sessionId, "voting");
      }
      return;
    }

    const round = await getCurrentRound(this.env.DB, sessionId, session.current_round_no);
    if (!round) return;
    const votes = await listVotesForRound(this.env.DB, round.id);
    const voterIds = new Set(votes.map((v) => v.user_id));
    const allVoted = participants.every((p) => voterIds.has(p.user_id));

    if (!allVoted) {
      if (session.status === "needs_discussion") {
        await this.setStatus(sessionId, "voting");
      }
      return;
    }

    const hasNeedInfo = votes.some((v) => v.value === NEED_INFO_VALUE);
    if (hasNeedInfo) {
      if (session.status !== "needs_discussion") {
        await this.setStatus(sessionId, "needs_discussion");
      }
      return;
    }

    await this.reveal(sessionId, session.current_round_no);
  }

  private async setStatus(
    sessionId: string,
    status: SessionStatus,
  ): Promise<void> {
    await this.env.DB
      .prepare("UPDATE sessions SET status = ? WHERE id = ?")
      .bind(status, sessionId)
      .run();
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

  private async buildStateDTO(
    session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
    viewerUserId: string | null,
  ) {
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

    // voting and needs_discussion are both pre-reveal: other participants'
    // values stay hidden — need_info included — and only the viewer's own
    // value is returned. The status flip to "needs_discussion" only needs the
    // aggregate count, so that's all we expose before reveal.
    const isPreReveal =
      session.status === "voting" || session.status === "needs_discussion";
    const needInfoCount = votes.filter((v) => v.value === NEED_INFO_VALUE).length;
    const participantsDTO: ParticipantStateDTO[] = participants.map((p) => {
      const v = voteByUser.get(p.user_id) ?? null;
      const voted = v !== null;
      const isMe = viewerUserId !== null && p.user_id === viewerUserId;
      const votedNeedInfo = (!isPreReveal || isMe) && v === NEED_INFO_VALUE;
      const value = !isPreReveal || isMe ? v : null;
      return {
        userId: p.user_id,
        displayName: p.display_name,
        email: p.email,
        voted,
        votedNeedInfo,
        value,
      };
    });

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
      participants: participantsDTO,
      needInfoCount,
      finalEstimate,
    };
  }
}

function parseMeta(json: string): SessionMeta {
  return JSON.parse(json) as SessionMeta;
}

function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Error && e.message.includes("UNIQUE constraint failed");
}

export function isValidVoteValue(value: string, meta: SessionMeta): boolean {
  if (value === NEED_INFO_VALUE) return true;
  return meta.scale.options.some((opt) => opt.value === value);
}

export function isFinalizableValue(value: string, meta: SessionMeta): boolean {
  // need_info isn't a valid final estimate — only real scale options.
  return meta.scale.options.some((opt) => opt.value === value);
}
