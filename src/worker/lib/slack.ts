import type { Env } from "../env";

/**
 * Slack notifications fire only on session start and the daily reminder cron.
 * Reveal and finalize stay in-app — by design. See CLAUDE.md.
 *
 * We post to a single Incoming Webhook URL (`SLACK_WEBHOOK_URL`). No bot
 * token, no Linear↔Slack user mapping. Participant names are embedded as
 * plain text — no @-mentions.
 */

export function slackEnabled(env: Env): boolean {
  return typeof env.SLACK_WEBHOOK_URL === "string" && env.SLACK_WEBHOOK_URL.length > 0;
}

function appSessionUrl(env: Env, sessionId: string): string | null {
  const base = env.APP_BASE_URL?.replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/#/sessions/${sessionId}`;
}

// Slack mrkdwn escape — `<`, `>`, `&` are the only characters that need it
// inside link labels and message bodies.
function escMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sessionRef(
  env: Env,
  params: { sessionId: string; projectName: string; issueIdentifier: string },
): string {
  const label = `${escMrkdwn(params.projectName)} · ${escMrkdwn(params.issueIdentifier)}`;
  const url = appSessionUrl(env, params.sessionId);
  return url ? `<${url}|${label}>` : label;
}

async function postWebhook(env: Env, text: string): Promise<void> {
  const url = env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Slack webhook ${res.status}: ${body.slice(0, 500)}`);
    }
  } catch (e) {
    console.error("Slack webhook fetch failed:", e);
  }
}

export async function notifySessionStarted(
  env: Env,
  params: { sessionId: string; projectName: string; issueIdentifier: string },
): Promise<void> {
  if (!slackEnabled(env)) return;
  await postWebhook(env, `:bar_chart: Planning poker session started — ${sessionRef(env, params)}`);
}

export interface ReminderItem {
  sessionId: string;
  projectName: string;
  issueIdentifier: string;
  /** Pending voters' Linear `displayName`, plain text, no @-mention. */
  pending: string[];
}

export async function notifyDailyDigest(
  env: Env,
  items: ReminderItem[],
): Promise<void> {
  if (!slackEnabled(env)) return;
  if (items.length === 0) return;
  const lines = items.map((it) => {
    const who = it.pending.map(escMrkdwn).join(", ");
    return `• ${sessionRef(env, it)} — ${who}`;
  });
  const header = `:bar_chart: Planning poker reminder — ${items.length} session(s) awaiting votes`;
  await postWebhook(env, `${header}\n${lines.join("\n")}`);
}
