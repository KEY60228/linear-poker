import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { HonoEnv } from "../env";
import { buildAuthorizeUrl, clientFor, exchangeCodeForToken } from "../lib/linear";
import { createAppSession, destroyAppSession } from "../lib/session";
import { randomId, sign, verify } from "../lib/crypto";

const STATE_COOKIE = "lpoker_oauth_state";
const STATE_TTL_SEC = 60 * 10;

const auth = new Hono<HonoEnv>();

auth.get("/linear", async (c) => {
  const state = randomId(16);
  const signed = await sign(state, c.env.SESSION_SECRET);
  setCookie(c, STATE_COOKIE, signed, {
    httpOnly: true,
    secure: new URL(c.env.APP_BASE_URL).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: STATE_TTL_SEC,
  });

  const url = buildAuthorizeUrl({
    clientId: c.env.LINEAR_OAUTH_CLIENT_ID,
    redirectUri: c.env.LINEAR_OAUTH_REDIRECT_URI,
    state,
  });
  return c.redirect(url, 302);
});

auth.get("/linear/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  if (error) return c.text(`OAuth error: ${error}`, 400);
  if (!code || !state) return c.text("Missing code or state", 400);

  const cookieState = getCookie(c, STATE_COOKIE);
  if (!cookieState) return c.text("Missing state cookie", 400);
  const verified = await verify(cookieState, c.env.SESSION_SECRET);
  if (verified !== state) return c.text("Invalid state", 400);
  deleteCookie(c, STATE_COOKIE, { path: "/" });

  const token = await exchangeCodeForToken({
    clientId: c.env.LINEAR_OAUTH_CLIENT_ID,
    clientSecret: c.env.LINEAR_OAUTH_CLIENT_SECRET,
    redirectUri: c.env.LINEAR_OAUTH_REDIRECT_URI,
    code,
  });

  const linear = clientFor(token.access_token);
  const viewer = await linear.viewer;

  await createAppSession(
    c,
    viewer.id,
    token.access_token,
    token.refresh_token,
    Date.now() + token.expires_in * 1000,
  );

  return c.redirect("/", 302);
});

auth.post("/logout", async (c) => {
  await destroyAppSession(c);
  return c.json({ ok: true });
});

export default auth;
