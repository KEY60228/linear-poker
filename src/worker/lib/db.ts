import type { EstimateScaleDTO } from "./linear";

export type SessionStatus = "voting" | "revealed" | "finalized";

export interface SessionMeta {
  team: { id: string; name: string; key: string; url?: string };
  project: { id: string; name: string; url: string };
  issue: {
    id: string;
    identifier: string;
    title: string;
    url: string;
    estimate: number | null;
  };
  scale: EstimateScaleDTO;
  labelName: string;
}

export interface SessionRow {
  id: string;
  team_id: string;
  project_id: string;
  issue_id: string;
  facilitator_id: string;
  status: SessionStatus;
  current_round_no: number;
  created_at: number;
  meta_json: string;
}

export interface ParticipantRow {
  session_id: string;
  user_id: string;
  display_name: string;
  email: string;
  added_at: number;
}

export interface RoundRow {
  id: string;
  session_id: string;
  round_no: number;
  revealed_at: number | null;
}

export interface VoteRow {
  round_id: string;
  user_id: string;
  value: string;
  voted_at: number;
}

export async function getSession(db: D1Database, id: string): Promise<SessionRow | null> {
  return await db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .bind(id)
    .first<SessionRow>();
}

export async function findActiveSessionForIssue(
  db: D1Database,
  issueId: string,
): Promise<SessionRow | null> {
  return await db
    .prepare(
      "SELECT * FROM sessions WHERE issue_id = ? AND status != 'finalized' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(issueId)
    .first<SessionRow>();
}

export async function listParticipants(
  db: D1Database,
  sessionId: string,
): Promise<ParticipantRow[]> {
  const res = await db
    .prepare("SELECT * FROM participants WHERE session_id = ? ORDER BY added_at ASC")
    .bind(sessionId)
    .all<ParticipantRow>();
  return res.results ?? [];
}

export async function getCurrentRound(
  db: D1Database,
  sessionId: string,
  roundNo: number,
): Promise<RoundRow | null> {
  return await db
    .prepare("SELECT * FROM rounds WHERE session_id = ? AND round_no = ?")
    .bind(sessionId, roundNo)
    .first<RoundRow>();
}

export async function listVotesForRound(
  db: D1Database,
  roundId: string,
): Promise<VoteRow[]> {
  const res = await db
    .prepare("SELECT * FROM votes WHERE round_id = ?")
    .bind(roundId)
    .all<VoteRow>();
  return res.results ?? [];
}

export interface FinalEstimateRow {
  session_id: string;
  value: string;
  finalized_by: string;
  finalized_at: number;
}

export async function getFinalEstimate(
  db: D1Database,
  sessionId: string,
): Promise<FinalEstimateRow | null> {
  return await db
    .prepare("SELECT * FROM final_estimates WHERE session_id = ?")
    .bind(sessionId)
    .first<FinalEstimateRow>();
}

// ---- list endpoint helpers -------------------------------------------

export interface SessionListFilter {
  /** If provided, restrict to sessions where viewer is facilitator or participant. */
  viewerId?: string;
  /** If provided, restrict to these statuses. */
  status?: SessionStatus[];
}

export interface SessionListItem {
  id: string;
  status: SessionStatus;
  currentRoundNo: number;
  createdAt: number;
  team: { id: string; name: string; key: string; url?: string };
  project: { id: string; name: string; url: string };
  issue: { id: string; identifier: string; title: string; url: string };
  participantCount: number;
  votedCount: number;
  needInfoCount: number;
  isParticipant: boolean;
  isFacilitator: boolean;
  /** True when the viewer is a participant and has voted in the current round. */
  viewerHasVoted: boolean;
  finalEstimate: { value: string; finalizedAt: number } | null;
}

const LIST_LIMIT = 200;
const NEED_INFO_VALUE = "need_info";

export async function listSessionItems(
  db: D1Database,
  filter: SessionListFilter,
  viewerForFlags: string,
): Promise<SessionListItem[]> {
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (filter.viewerId) {
    conds.push(
      "(facilitator_id = ? OR id IN (SELECT session_id FROM participants WHERE user_id = ?))",
    );
    binds.push(filter.viewerId, filter.viewerId);
  }
  if (filter.status && filter.status.length > 0) {
    conds.push(`status IN (${filter.status.map(() => "?").join(",")})`);
    binds.push(...filter.status);
  }
  const where = conds.length > 0 ? ` WHERE ${conds.join(" AND ")}` : "";
  const sql = `SELECT * FROM sessions${where} ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`;
  const sessionsRes = await db.prepare(sql).bind(...binds).all<SessionRow>();
  const sessions = sessionsRes.results ?? [];
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const ph = sessionIds.map(() => "?").join(",");

  const partsRes = await db
    .prepare(`SELECT session_id, user_id FROM participants WHERE session_id IN (${ph})`)
    .bind(...sessionIds)
    .all<{ session_id: string; user_id: string }>();
  const parts = partsRes.results ?? [];

  const roundsRes = await db
    .prepare(
      `SELECT r.id AS round_id, r.session_id FROM rounds r
       JOIN sessions s ON s.id = r.session_id
       WHERE r.session_id IN (${ph}) AND s.current_round_no = r.round_no`,
    )
    .bind(...sessionIds)
    .all<{ round_id: string; session_id: string }>();
  const currentRoundIdBySession = new Map(
    (roundsRes.results ?? []).map((r) => [r.session_id, r.round_id]),
  );

  let votes: { round_id: string; user_id: string; value: string }[] = [];
  const roundIds = [...currentRoundIdBySession.values()];
  if (roundIds.length > 0) {
    const vph = roundIds.map(() => "?").join(",");
    const votesRes = await db
      .prepare(`SELECT round_id, user_id, value FROM votes WHERE round_id IN (${vph})`)
      .bind(...roundIds)
      .all<{ round_id: string; user_id: string; value: string }>();
    votes = votesRes.results ?? [];
  }
  const votesByRound = new Map<string, { user_id: string; value: string }[]>();
  for (const v of votes) {
    const arr = votesByRound.get(v.round_id) ?? [];
    arr.push({ user_id: v.user_id, value: v.value });
    votesByRound.set(v.round_id, arr);
  }

  const finalizedIds = sessions
    .filter((s) => s.status === "finalized")
    .map((s) => s.id);
  let finals: { session_id: string; value: string; finalized_at: number }[] = [];
  if (finalizedIds.length > 0) {
    const fph = finalizedIds.map(() => "?").join(",");
    const finRes = await db
      .prepare(
        `SELECT session_id, value, finalized_at FROM final_estimates WHERE session_id IN (${fph})`,
      )
      .bind(...finalizedIds)
      .all<{ session_id: string; value: string; finalized_at: number }>();
    finals = finRes.results ?? [];
  }
  const finalBySession = new Map(finals.map((f) => [f.session_id, f]));

  return sessions.map((s) => {
    const sessionParts = parts.filter((p) => p.session_id === s.id);
    const roundId = currentRoundIdBySession.get(s.id);
    const sessionVotes = roundId ? votesByRound.get(roundId) ?? [] : [];
    let meta: { team: SessionListItem["team"]; project: SessionListItem["project"]; issue: SessionListItem["issue"] };
    try {
      meta = JSON.parse(s.meta_json);
    } catch {
      meta = {
        team: { id: s.team_id, name: "—", key: "—" },
        project: { id: s.project_id, name: "—", url: "" },
        issue: { id: s.issue_id, identifier: "—", title: "—", url: "" },
      };
    }
    const fin = finalBySession.get(s.id);
    const isParticipant = sessionParts.some((p) => p.user_id === viewerForFlags);
    const viewerHasVoted =
      isParticipant && sessionVotes.some((v) => v.user_id === viewerForFlags);
    return {
      id: s.id,
      status: s.status,
      currentRoundNo: s.current_round_no,
      createdAt: s.created_at,
      team: meta.team,
      project: meta.project,
      issue: meta.issue,
      participantCount: sessionParts.length,
      votedCount: sessionVotes.length,
      needInfoCount: sessionVotes.filter((v) => v.value === NEED_INFO_VALUE).length,
      isParticipant,
      isFacilitator: s.facilitator_id === viewerForFlags,
      viewerHasVoted,
      finalEstimate: fin
        ? { value: fin.value, finalizedAt: fin.finalized_at }
        : null,
    };
  });
}

// ---- Participant groups -----------------------------------------------

export interface ParticipantGroupRow {
  id: string;
  team_id: string;
  name: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface ParticipantGroupMemberRow {
  group_id: string;
  user_id: string;
  display_name: string;
  email: string;
  added_at: number;
}

export interface ParticipantGroupDTO {
  id: string;
  teamId: string;
  name: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  members: { userId: string; displayName: string; email: string }[];
}

export async function listParticipantGroups(
  db: D1Database,
  teamId: string,
): Promise<ParticipantGroupDTO[]> {
  const groupsRes = await db
    .prepare(
      "SELECT * FROM participant_groups WHERE team_id = ? ORDER BY name COLLATE NOCASE ASC",
    )
    .bind(teamId)
    .all<ParticipantGroupRow>();
  const groups = groupsRes.results ?? [];
  if (groups.length === 0) return [];

  const ids = groups.map((g) => g.id);
  const ph = ids.map(() => "?").join(",");
  const membersRes = await db
    .prepare(
      `SELECT * FROM participant_group_members WHERE group_id IN (${ph}) ORDER BY added_at ASC`,
    )
    .bind(...ids)
    .all<ParticipantGroupMemberRow>();
  const membersByGroup = new Map<string, ParticipantGroupMemberRow[]>();
  for (const m of membersRes.results ?? []) {
    const arr = membersByGroup.get(m.group_id) ?? [];
    arr.push(m);
    membersByGroup.set(m.group_id, arr);
  }

  return groups.map((g) => ({
    id: g.id,
    teamId: g.team_id,
    name: g.name,
    createdBy: g.created_by,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    members: (membersByGroup.get(g.id) ?? []).map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      email: m.email,
    })),
  }));
}

export async function getParticipantGroup(
  db: D1Database,
  id: string,
): Promise<ParticipantGroupDTO | null> {
  const row = await db
    .prepare("SELECT * FROM participant_groups WHERE id = ?")
    .bind(id)
    .first<ParticipantGroupRow>();
  if (!row) return null;
  const membersRes = await db
    .prepare(
      "SELECT * FROM participant_group_members WHERE group_id = ? ORDER BY added_at ASC",
    )
    .bind(id)
    .all<ParticipantGroupMemberRow>();
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members: (membersRes.results ?? []).map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      email: m.email,
    })),
  };
}

export async function createParticipantGroup(
  db: D1Database,
  input: {
    id: string;
    teamId: string;
    name: string;
    createdBy: string;
    members: { userId: string; displayName: string; email: string }[];
  },
): Promise<void> {
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO participant_groups (id, team_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(input.id, input.teamId, input.name, input.createdBy, now, now),
  ];
  for (const m of input.members) {
    statements.push(
      db
        .prepare(
          "INSERT INTO participant_group_members (group_id, user_id, display_name, email, added_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(input.id, m.userId, m.displayName, m.email, now),
    );
  }
  await db.batch(statements);
}

export async function updateParticipantGroup(
  db: D1Database,
  id: string,
  input: {
    name: string;
    members: { userId: string; displayName: string; email: string }[];
  },
): Promise<void> {
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare("UPDATE participant_groups SET name = ?, updated_at = ? WHERE id = ?")
      .bind(input.name, now, id),
    db.prepare("DELETE FROM participant_group_members WHERE group_id = ?").bind(id),
  ];
  for (const m of input.members) {
    statements.push(
      db
        .prepare(
          "INSERT INTO participant_group_members (group_id, user_id, display_name, email, added_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id, m.userId, m.displayName, m.email, now),
    );
  }
  await db.batch(statements);
}

export async function deleteParticipantGroup(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM participant_groups WHERE id = ?")
    .bind(id)
    .run();
}
