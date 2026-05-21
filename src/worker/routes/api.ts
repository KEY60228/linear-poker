import { Hono } from "hono";
import type { Context } from "hono";
import type { HonoEnv } from "../env";
import {
  findStoryPointIssue,
  getViewer,
  listBacklogProjects,
  listTeams,
} from "../lib/linear";
import { readAppSession } from "../lib/session";

const api = new Hono<HonoEnv>();

api.use("*", async (c, next) => {
  const session = await readAppSession(c);
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  c.set("session", { appSessionId: session.sid, linearUserId: session.linearUserId });
  c.set("accessToken", session.accessToken);
  await next();
});

function token(c: Context<HonoEnv>): string {
  const t = c.get("accessToken");
  if (!t) throw new Error("accessToken missing — middleware not applied");
  return t;
}

api.get("/me", async (c) => c.json(await getViewer(token(c))));

api.get("/teams", async (c) => c.json({ teams: await listTeams(token(c)) }));

api.get("/teams/:teamId/backlog-projects", async (c) => {
  const teamId = c.req.param("teamId");
  return c.json({ projects: await listBacklogProjects(token(c), teamId) });
});

api.get("/projects/:projectId/storypoint-issue", async (c) => {
  const projectId = c.req.param("projectId");
  const label = c.env.STORY_POINT_LABEL_NAME;
  const issue = await findStoryPointIssue(token(c), projectId, label);
  return c.json({ issue, labelName: label });
});

// Placeholder endpoints — implemented in v0.2 PR②.
api.post("/sessions", (c) => c.json({ error: "not_implemented" }, 501));
api.get("/sessions/:id", (c) => c.json({ error: "not_implemented" }, 501));
api.delete("/sessions/:id", (c) => c.json({ error: "not_implemented" }, 501));

export default api;
