import type { Env } from "../env";
import type { SessionMeta } from "./db";
import {
  notifyDailyDigest,
  slackEnabled,
  type ReminderSessionRef,
  type ReminderUserBucket,
} from "./slack";

// `voting` sessions only (NOT `needs_discussion`). Skip participants who
// already voted, including `need_info` — a `need_info` vote IS a vote and
// has a row in `votes`, so the "didn't vote yet" filter excludes them
// naturally. If nobody is pending across all voting sessions, no message
// is posted at all.
//
// The digest is grouped per person, not per session: each user gets one
// block listing the sessions they still need to vote on. Users are sorted
// by displayName; each user's sessions are sorted by session.created_at
// ascending so the oldest backlog floats to the top.
export async function runDailyReminder(env: Env): Promise<void> {
  if (!slackEnabled(env)) return;

  const sessionsRes = await env.DB.prepare(
    "SELECT id, meta_json, created_at FROM sessions WHERE status = 'voting'",
  ).all<{ id: string; meta_json: string; created_at: number }>();
  const sessions = sessionsRes.results ?? [];
  if (sessions.length === 0) return;

  const sessionIds = sessions.map((s) => s.id);
  const ph = sessionIds.map(() => "?").join(",");

  const partsRes = await env.DB.prepare(
    `SELECT session_id, user_id, display_name FROM participants WHERE session_id IN (${ph}) ORDER BY added_at ASC`,
  )
    .bind(...sessionIds)
    .all<{ session_id: string; user_id: string; display_name: string }>();

  const roundsRes = await env.DB.prepare(
    `SELECT r.id AS round_id, r.session_id FROM rounds r
     JOIN sessions s ON s.id = r.session_id
     WHERE r.session_id IN (${ph}) AND s.current_round_no = r.round_no`,
  )
    .bind(...sessionIds)
    .all<{ round_id: string; session_id: string }>();

  const currentRoundIdBySession = new Map(
    (roundsRes.results ?? []).map((r) => [r.session_id, r.round_id]),
  );

  const roundIds = [...currentRoundIdBySession.values()];
  const votedBySession = new Map<string, Set<string>>();
  if (roundIds.length > 0) {
    const vph = roundIds.map(() => "?").join(",");
    const votesRes = await env.DB.prepare(
      `SELECT round_id, user_id FROM votes WHERE round_id IN (${vph})`,
    )
      .bind(...roundIds)
      .all<{ round_id: string; user_id: string }>();
    const roundIdToSession = new Map(
      [...currentRoundIdBySession.entries()].map(([sid, rid]) => [rid, sid]),
    );
    for (const v of votesRes.results ?? []) {
      const sid = roundIdToSession.get(v.round_id);
      if (!sid) continue;
      const set = votedBySession.get(sid) ?? new Set<string>();
      set.add(v.user_id);
      votedBySession.set(sid, set);
    }
  }

  // userId → bucket. Sessions inside the bucket carry created_at for
  // stable per-user sorting; we strip it before handing off to slack.ts.
  const userBuckets = new Map<
    string,
    { displayName: string; sessions: (ReminderSessionRef & { createdAt: number })[] }
  >();

  for (const s of sessions) {
    const sessionParts = (partsRes.results ?? []).filter((p) => p.session_id === s.id);
    if (sessionParts.length === 0) continue;
    const voted = votedBySession.get(s.id) ?? new Set<string>();
    const pending = sessionParts.filter((p) => !voted.has(p.user_id));
    if (pending.length === 0) continue;

    let meta: SessionMeta;
    try {
      meta = JSON.parse(s.meta_json) as SessionMeta;
    } catch {
      continue;
    }
    const ref = {
      sessionId: s.id,
      projectName: meta.project.name,
      issueIdentifier: meta.issue.identifier,
      createdAt: s.created_at,
    };
    for (const p of pending) {
      const bucket = userBuckets.get(p.user_id) ?? {
        displayName: p.display_name,
        sessions: [],
      };
      bucket.sessions.push(ref);
      userBuckets.set(p.user_id, bucket);
    }
  }

  const buckets: ReminderUserBucket[] = [...userBuckets.values()]
    .map((b) => ({
      displayName: b.displayName,
      sessions: [...b.sessions]
        .sort((a, c) => a.createdAt - c.createdAt)
        .map(({ createdAt: _createdAt, ...rest }) => rest),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  await notifyDailyDigest(env, buckets);
}
