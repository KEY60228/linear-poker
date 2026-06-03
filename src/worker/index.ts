import { Hono } from "hono";
import type { HonoEnv } from "./env";
import authRoutes from "./routes/auth";
import apiRoutes from "./routes/api";
import { readAppSession, destroyAppSession } from "./lib/session";
import { runDailyReminder } from "./lib/reminder";
import { isLinearAuthError } from "./lib/linear";

export { SessionDO } from "./do/session";

const app = new Hono<HonoEnv>();

app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/api/auth/status", async (c) => {
  const session = await readAppSession(c);
  return c.json({ authenticated: !!session, userId: session?.linearUserId ?? null });
});

app.route("/auth", authRoutes);
app.route("/api", apiRoutes);

// Anything else falls through to the static SPA via the Assets binding.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// Centralized error boundary. A dead Linear access token (the app cookie is
// still valid, but Linear rejected the token) surfaces as a thrown
// LinearError deep inside a route. Without this it would bubble up as a
// generic 500 and strand the user — they'd have to manually log out and back
// in. Instead we clear our own session and return 401 so the SPA's
// unauthenticated handler bounces them straight to a fresh login.
app.onError(async (err, c) => {
  if (isLinearAuthError(err)) {
    await destroyAppSession(c);
    return c.json({ error: "linear_auth_expired" }, 401);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: HonoEnv["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(runDailyReminder(env));
  },
} satisfies ExportedHandler<HonoEnv["Bindings"]>;
