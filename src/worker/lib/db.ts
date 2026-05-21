import type { EstimateScaleDTO } from "./linear";

export type SessionStatus = "voting" | "revealed" | "finalized";

export interface SessionMeta {
  team: { id: string; name: string; key: string };
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
