import { Hono } from "hono";
import type { HonoEnv } from "./env";
import authRoutes from "./routes/auth";
import apiRoutes from "./routes/api";
import { readAppSession } from "./lib/session";

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

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, _env: HonoEnv["Bindings"], _ctx: ExecutionContext) {
    // Daily reminder cron — wired in v0.4.
  },
} satisfies ExportedHandler<HonoEnv["Bindings"]>;
