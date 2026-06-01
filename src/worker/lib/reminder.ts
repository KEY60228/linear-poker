import type { Env } from "../env";
import type { SessionMeta } from "./db";
import { notifyDailyDigest, slackEnabled, type ReminderItem } from "./slack";

// `voting` sessions only (NOT `needs_discussion`). Skip participants who
// already voted, including `need_info` — a `need_info` vote IS a vote and
// has a row in `votes`, so the "didn't vote yet" filter excludes them
// naturally. If no participants are pending across all voting sessions,
// no message is posted at all.
export async function runDailyReminder(env: Env): Promise<void> {
  if (!slackEnabled(env)) return;

  const sessionsRes = await env.DB.prepare(
    "SELECT id, meta_json FROM sessions WHERE status = 'voting'",
  ).all<{ id: string; meta_json: string }>();
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
  const items: ReminderItem[] = [];
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
    items.push({
      sessionId: s.id,
      projectName: meta.project.name,
      issueIdentifier: meta.issue.identifier,
      pending: pending.map((p) => p.display_name),
    });
  }

  await notifyDailyDigest(env, items);
}
