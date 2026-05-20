import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { HonoEnv } from "../env";
import { randomId, sign, verify } from "./crypto";

const COOKIE_NAME = "lpoker_sid";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export async function createAppSession(
  c: Context<HonoEnv>,
  linearUserId: string,
  accessToken: string,
  refreshToken: string | undefined,
  expiresAt: number,
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
  try {
    const parsed = JSON.parse(raw) as {
      linearUserId: string;
      accessToken: string;
      refreshToken?: string;
      expiresAt: number;
    };
    return { sid, linearUserId: parsed.linearUserId, accessToken: parsed.accessToken };
  } catch {
    return null;
  }
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
