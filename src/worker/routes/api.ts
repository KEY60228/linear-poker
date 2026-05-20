import { Hono } from "hono";
import type { HonoEnv } from "../env";
import { clientFor } from "../lib/linear";
import { readAppSession } from "../lib/session";

const api = new Hono<HonoEnv>();

api.use("*", async (c, next) => {
  const session = await readAppSession(c);
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  c.set("session", { appSessionId: session.sid, linearUserId: session.linearUserId });
  // Carry the access token forward via header-less local lookup.
  (c.req as unknown as { _accessToken: string })._accessToken = session.accessToken;
  await next();
});

api.get("/me", async (c) => {
  const accessToken = (c.req as unknown as { _accessToken: string })._accessToken;
  const linear = clientFor(accessToken);
  const viewer = await linear.viewer;
  return c.json({
    id: viewer.id,
    name: viewer.name,
    email: viewer.email,
    displayName: viewer.displayName,
  });
});

// Placeholder endpoints — implemented in v0.2+.
api.get("/teams", (c) => c.json({ error: "not_implemented" }, 501));
api.get("/teams/:teamId/backlog-projects", (c) => c.json({ error: "not_implemented" }, 501));
api.post("/sessions", (c) => c.json({ error: "not_implemented" }, 501));
api.get("/sessions/:id", (c) => c.json({ error: "not_implemented" }, 501));
api.delete("/sessions/:id", (c) => c.json({ error: "not_implemented" }, 501));

export default api;
