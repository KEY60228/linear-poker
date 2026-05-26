import { Hono } from "hono";
import type { Context } from "hono";
import type { HonoEnv } from "../env";
import { cached, CacheTTL } from "../lib/cache";
import {
  findStoryPointIssue,
  getIssueSummary,
  getProjectSummary,
  getTeamSummary,
  getViewer,
  listBacklogProjects,
  listStoryPointIssuesByEstimate,
  listTeamMembers,
  listTeams,
  listUsersByIds,
  searchUsersInTeam,
  setProjectStatusPlanned,
  updateIssueEstimate,
} from "../lib/linear";
import { readAppSession } from "../lib/session";
import { randomId } from "../lib/crypto";
import type { CreateSessionInput } from "../do/session";
import { listSessionItems } from "../lib/db";
import type { SessionStatus } from "../lib/db";
import {
  createParticipantGroup,
  deleteParticipantGroup,
  getParticipantGroup,
  listParticipantGroups,
  updateParticipantGroup,
} from "../lib/db";

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

function viewerId(c: Context<HonoEnv>): string {
  const s = c.get("session");
  if (!s) throw new Error("session missing — middleware not applied");
  return s.linearUserId;
}

function doStub(c: Context<HonoEnv>, sessionId: string) {
  const id = c.env.SESSION_DO.idFromName(sessionId);
  return c.env.SESSION_DO.get(id);
}

// ---------- Lookup endpoints ----------

api.get("/me", async (c) => c.json(await getViewer(token(c))));

api.get("/teams", async (c) => {
  const teams = await cached(
    c.env.LINEAR_CACHE,
    `teams:${viewerId(c)}`,
    CacheTTL.viewer,
    () => listTeams(token(c)),
  );
  return c.json({ teams });
});

api.get("/teams/:teamId/backlog-projects", async (c) => {
  const teamId = c.req.param("teamId");
  return c.json({ projects: await listBacklogProjects(token(c), teamId) });
});

api.get("/teams/:teamId/members", async (c) => {
  const teamId = c.req.param("teamId");
  const q = (c.req.query("q") ?? "").trim();
  const users = await cached(
    c.env.LINEAR_CACHE,
    `team-members:${teamId}:${q}`,
    CacheTTL.team,
    () =>
      q.length > 0
        ? searchUsersInTeam(token(c), teamId, q)
        : listTeamMembers(token(c), teamId),
  );
  return c.json({ users });
});

const REFERENCE_PAGE_SIZE = 10;

api.get("/teams/:teamId/storypoint-references", async (c) => {
  const teamId = c.req.param("teamId");
  const label = c.env.STORY_POINT_LABEL_NAME;
  const accessToken = token(c);

  const result = await cached(
    c.env.LINEAR_CACHE,
    `storypoint-refs:${teamId}:initial`,
    CacheTTL.team,
    async () => {
      // Discover the team's scale options first — we paginate one estimate
      // value at a time so each card on the page can independently page
      // through its own bucket of issues.
      const team = await getTeamSummary(accessToken, teamId);
      const estimates = team.scale.options
        .map((o) => Number(o.value))
        .filter((n) => !Number.isNaN(n));

      const groups = await Promise.all(
        estimates.map(async (estimate) => {
          const page = await listStoryPointIssuesByEstimate(
            accessToken,
            teamId,
            label,
            estimate,
            null,
            REFERENCE_PAGE_SIZE,
          );
          return { estimate, ...page };
        }),
      );

      return { groups, labelName: label };
    },
  );

  return c.json(result);
});

api.get("/teams/:teamId/storypoint-references/:estimate", async (c) => {
  const teamId = c.req.param("teamId");
  const estimate = Number(c.req.param("estimate"));
  if (Number.isNaN(estimate)) {
    return c.json({ error: "invalid_estimate" }, 400);
  }
  const after = c.req.query("after") ?? "";
  const page = await cached(
    c.env.LINEAR_CACHE,
    `storypoint-refs:${teamId}:${estimate}:${after}`,
    CacheTTL.team,
    () =>
      listStoryPointIssuesByEstimate(
        token(c),
        teamId,
        c.env.STORY_POINT_LABEL_NAME,
        estimate,
        after || null,
        REFERENCE_PAGE_SIZE,
      ),
  );
  return c.json(page);
});

api.get("/projects/:projectId/storypoint-issue", async (c) => {
  const projectId = c.req.param("projectId");
  const label = c.env.STORY_POINT_LABEL_NAME;
  const issue = await findStoryPointIssue(token(c), projectId, label);
  return c.json({ issue, labelName: label });
});

// ---------- Session lifecycle ----------

api.get("/sessions", async (c) => {
  const scope = c.req.query("scope") === "all" ? "all" : "mine";
  const statusParam = c.req.query("status");
  const allowed: SessionStatus[] = ["voting", "revealed", "finalized"];
  const status =
    statusParam && allowed.includes(statusParam as SessionStatus)
      ? [statusParam as SessionStatus]
      : undefined;

  const viewer = viewerId(c);
  const items = await listSessionItems(
    c.env.DB,
    { viewerId: scope === "mine" ? viewer : undefined, status },
    viewer,
  );
  return c.json({ sessions: items });
});

api.post("/sessions", async (c) => {
  const body = await c.req.json<{
    teamId: string;
    projectId: string;
    issueId: string;
    participantIds: string[];
  }>();
  if (!body.teamId || !body.projectId || !body.issueId) {
    return c.json({ error: "missing_fields" }, 400);
  }
  if (!Array.isArray(body.participantIds) || body.participantIds.length === 0) {
    return c.json({ error: "no_participants" }, 400);
  }

  const accessToken = token(c);
  const [team, project, issue, users] = await Promise.all([
    getTeamSummary(accessToken, body.teamId),
    getProjectSummary(accessToken, body.projectId),
    getIssueSummary(accessToken, body.issueId),
    listUsersByIds(accessToken, body.participantIds),
  ]);

  if (team.scale.type === "notUsed") {
    return c.json({ error: "estimate_scale_not_used" }, 400);
  }
  if (users.length !== body.participantIds.length) {
    return c.json({ error: "unknown_participants" }, 400);
  }

  const sessionId = randomId(16);
  const input: CreateSessionInput = {
    sessionId,
    teamId: body.teamId,
    projectId: body.projectId,
    issueId: body.issueId,
    facilitatorId: viewerId(c),
    meta: {
      team: { id: team.id, name: team.name, key: team.key, url: team.url },
      project: { id: project.id, name: project.name, url: project.url },
      issue,
      scale: team.scale,
      labelName: c.env.STORY_POINT_LABEL_NAME,
    },
    participants: users.map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      email: u.email,
    })),
  };

  try {
    await doStub(c, sessionId).createSession(input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("session_already_exists:")) {
      return c.json({ error: "session_already_exists", existingSessionId: msg.split(":")[1] }, 409);
    }
    throw e;
  }
  return c.json({ id: sessionId }, 201);
});

api.get("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const state = await doStub(c, id).getState(id, viewerId(c));
    return c.json(state);
  } catch (e) {
    if (e instanceof Error && e.message === "session_not_found") {
      return c.json({ error: "not_found" }, 404);
    }
    throw e;
  }
});

api.post("/sessions/:id/participants", async (c) => {
  const id = c.req.param("id");
  const { userId } = await c.req.json<{ userId: string }>();
  if (!userId) return c.json({ error: "missing_userId" }, 400);
  const [user] = await listUsersByIds(token(c), [userId]);
  if (!user) return c.json({ error: "unknown_user" }, 400);
  await doStub(c, id).addParticipant(id, {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
  });
  return c.json({ ok: true });
});

api.delete("/sessions/:id/participants/:userId", async (c) => {
  const id = c.req.param("id");
  const userId = c.req.param("userId");
  await doStub(c, id).removeParticipant(id, userId);
  return c.json({ ok: true });
});

api.post("/sessions/:id/votes", async (c) => {
  const id = c.req.param("id");
  const { value } = await c.req.json<{ value: string }>();
  if (typeof value !== "string" || value.length === 0) {
    return c.json({ error: "missing_value" }, 400);
  }
  try {
    await doStub(c, id).vote(id, viewerId(c), value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_a_participant") return c.json({ error: msg }, 403);
    if (msg === "invalid_vote_value") return c.json({ error: msg }, 400);
    if (msg === "not_voting") return c.json({ error: msg }, 409);
    throw e;
  }
  return c.json({ ok: true });
});

api.post("/sessions/:id/reveal", async (c) => {
  const id = c.req.param("id");
  await doStub(c, id).revealManually(id);
  return c.json({ ok: true });
});

api.post("/sessions/:id/finalize", async (c) => {
  const id = c.req.param("id");
  const { value } = await c.req.json<{ value: string }>();
  if (typeof value !== "string" || value.length === 0) {
    return c.json({ error: "missing_value" }, 400);
  }

  // Read current state to validate the value against the cached scale and
  // to grab the Linear issue id without an extra Linear call.
  let state;
  try {
    state = await doStub(c, id).getState(id, viewerId(c));
  } catch (e) {
    if (e instanceof Error && e.message === "session_not_found") {
      return c.json({ error: "not_found" }, 404);
    }
    throw e;
  }
  if (state.status !== "revealed") {
    return c.json({ error: "not_revealed" }, 409);
  }
  if (!state.meta.scale.options.some((o) => o.value === value)) {
    return c.json({ error: "invalid_finalize_value" }, 400);
  }

  // Linear writes first — if any of them fails we leave the session as
  // "revealed" so the user can retry. Both Linear ops are idempotent, so a
  // retry after a partial success (estimate written, project status pending)
  // is safe.
  try {
    await updateIssueEstimate(token(c), state.meta.issue.id, Number(value));
  } catch (e) {
    return c.json(
      { error: "linear_writeback_failed", detail: e instanceof Error ? e.message : String(e) },
      502,
    );
  }
  try {
    await setProjectStatusPlanned(token(c), state.meta.project.id);
  } catch (e) {
    return c.json(
      {
        error: "linear_project_status_update_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      502,
    );
  }
  try {
    await doStub(c, id).finalize(id, viewerId(c), value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_revealed") return c.json({ error: msg }, 409);
    if (msg === "invalid_finalize_value") return c.json({ error: msg }, 400);
    throw e;
  }
  return c.json({ ok: true });
});

api.post("/sessions/:id/unfinalize", async (c) => {
  const id = c.req.param("id");
  try {
    await doStub(c, id).unfinalize(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_finalized") return c.json({ error: msg }, 409);
    if (msg === "session_not_found") return c.json({ error: "not_found" }, 404);
    throw e;
  }
  return c.json({ ok: true });
});

api.post("/sessions/:id/revote", async (c) => {
  const id = c.req.param("id");
  try {
    await doStub(c, id).revote(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "finalized") return c.json({ error: msg }, 409);
    if (msg === "session_not_found") return c.json({ error: "not_found" }, 404);
    throw e;
  }
  return c.json({ ok: true });
});

// ---------- Participant groups ----------

api.get("/teams/:teamId/groups", async (c) => {
  const teamId = c.req.param("teamId");
  const groups = await listParticipantGroups(c.env.DB, teamId);
  return c.json({ groups });
});

api.post("/teams/:teamId/groups", async (c) => {
  const teamId = c.req.param("teamId");
  const body = await c.req.json<{ name: string; userIds: string[] }>();
  const name = (body.name ?? "").trim();
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];
  if (!name) return c.json({ error: "missing_name" }, 400);
  if (userIds.length === 0) return c.json({ error: "no_members" }, 400);

  const users = await listUsersByIds(token(c), userIds);
  if (users.length !== userIds.length) {
    return c.json({ error: "unknown_members" }, 400);
  }

  const id = randomId(16);
  await createParticipantGroup(c.env.DB, {
    id,
    teamId,
    name,
    createdBy: viewerId(c),
    members: users.map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      email: u.email,
    })),
  });
  const created = await getParticipantGroup(c.env.DB, id);
  return c.json({ group: created }, 201);
});

api.get("/groups/:id", async (c) => {
  const group = await getParticipantGroup(c.env.DB, c.req.param("id"));
  if (!group) return c.json({ error: "not_found" }, 404);
  return c.json({ group });
});

api.patch("/groups/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ name: string; userIds: string[] }>();
  const name = (body.name ?? "").trim();
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];
  if (!name) return c.json({ error: "missing_name" }, 400);
  if (userIds.length === 0) return c.json({ error: "no_members" }, 400);

  const existing = await getParticipantGroup(c.env.DB, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const users = await listUsersByIds(token(c), userIds);
  if (users.length !== userIds.length) {
    return c.json({ error: "unknown_members" }, 400);
  }
  await updateParticipantGroup(c.env.DB, id, {
    name,
    members: users.map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      email: u.email,
    })),
  });
  const updated = await getParticipantGroup(c.env.DB, id);
  return c.json({ group: updated });
});

api.delete("/groups/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await getParticipantGroup(c.env.DB, id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  await deleteParticipantGroup(c.env.DB, id);
  return c.json({ ok: true });
});

export default api;
