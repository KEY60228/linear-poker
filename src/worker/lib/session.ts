import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { HonoEnv } from "../env";
import { randomId, sign, verify } from "./crypto";
import { refreshAccessToken } from "./linear";

const COOKIE_NAME = "lpoker_sid";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days
const REFRESH_MARGIN_MS = 5 * 60_000; // refresh 5 minutes before expiry

export async function createAppSession(
  c: Context<HonoEnv>,
  linearUserId: string,
  accessToken: string,
  refreshToken: string | undefined,
  expiresAt: number | null,
): Promise<string> {
  const sid = randomId();
  await c.env.TOKENS.put(
    kvKey(sid),
    JSON.stringify({ linearUserId, accessToken, refreshToken, expiresAt }),
    { expirationTtl: COOKIE_MAX_AGE_SEC },
  );

  const signed = await sign(sid, c.env.SESSION_SECRET);
  setCookie(c, COOKIE_NAME, signed, {
    httpOnly: true,
    secure: new URL(c.env.APP_BASE_URL).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });
  return sid;
}

export async function readAppSession(
  c: Context<HonoEnv>,
): Promise<{ sid: string; linearUserId: string; accessToken: string } | null> {
  const signed = getCookie(c, COOKIE_NAME);
  if (!signed) return null;
  const sid = await verify(signed, c.env.SESSION_SECRET);
  if (!sid) return null;
  const raw = await c.env.TOKENS.get(kvKey(sid));
  if (!raw) return null;
  let parsed: {
    linearUserId: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number | null;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }

  // Refresh the Linear access token shortly before it expires. Old KV records
  // may carry a non-finite expiresAt (e.g. NaN serialized to null) or none at
  // all — treat that as "no expiry info" and never refresh (previous behavior).
  const expiresAt = parsed.expiresAt;
  if (
    typeof expiresAt === "number" &&
    Number.isFinite(expiresAt) &&
    parsed.refreshToken &&
    Date.now() > expiresAt - REFRESH_MARGIN_MS
  ) {
    // Concurrent requests may race this refresh. That's tolerated: with Linear's
    // refresh-token rotation, the loser's refresh may fail, but its token is not
    // yet expired at that point so it falls through to the existing accessToken
    // and a later request retries against the KV record the winner wrote.
    try {
      const token = await refreshAccessToken({
        clientId: c.env.LINEAR_OAUTH_CLIENT_ID,
        clientSecret: c.env.LINEAR_OAUTH_CLIENT_SECRET,
        refreshToken: parsed.refreshToken,
      });
      parsed = {
        linearUserId: parsed.linearUserId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? parsed.refreshToken,
        expiresAt: typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : null,
      };
      await c.env.TOKENS.put(kvKey(sid), JSON.stringify(parsed), {
        expirationTtl: COOKIE_MAX_AGE_SEC,
      });
    } catch (e) {
      if (Date.now() > expiresAt) {
        // Access token already lapsed and we couldn't refresh: force re-login.
        return null;
      }
      console.error("Linear token refresh failed; falling back to current access token", e);
    }
  }

  return { sid, linearUserId: parsed.linearUserId, accessToken: parsed.accessToken };
}

export async function destroyAppSession(c: Context<HonoEnv>): Promise<void> {
  const signed = getCookie(c, COOKIE_NAME);
  if (signed) {
    const sid = await verify(signed, c.env.SESSION_SECRET);
    if (sid) await c.env.TOKENS.delete(kvKey(sid));
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

function kvKey(sid: string): string {
  return `session:${sid}`;
}
