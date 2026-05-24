export type Team = { id: string; name: string; key: string; url: string };
export type Project = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  url: string;
};
export type StoryPointIssue = {
  id: string;
  identifier: string;
  title: string;
  estimate: number | null;
  url: string;
  duplicateCount: number;
};
export type User = {
  id: string;
  name: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
};
export type Viewer = { id: string; name: string; email: string; displayName: string };
export type AuthStatus = { authenticated: boolean; userId: string | null };

export type ScaleOption = { value: string; label: string };
export type EstimateScale = {
  type: "notUsed" | "exponential" | "fibonacci" | "linear" | "tShirt";
  allowZero: boolean;
  options: ScaleOption[];
};

export type SessionMeta = {
  team: { id: string; name: string; key: string; url?: string };
  project: { id: string; name: string; url: string };
  issue: {
    id: string;
    identifier: string;
    title: string;
    url: string;
    estimate: number | null;
  };
  scale: EstimateScale;
  labelName: string;
};

export type SessionStatus = "voting" | "revealed" | "finalized";

export type SessionListItem = {
  id: string;
  status: SessionStatus;
  currentRoundNo: number;
  createdAt: number;
  team: { id: string; name: string; key: string; url?: string };
  project: { id: string; name: string; url: string };
  issue: { id: string; identifier: string; title: string; url: string };
  participantCount: number;
  votedCount: number;
  needInfoCount: number;
  isParticipant: boolean;
  isFacilitator: boolean;
  finalEstimate: { value: string; finalizedAt: number } | null;
};

export type SessionListScope = "mine" | "all";
export type SessionListStatusFilter = SessionStatus | "all";

export type StoryPointReference = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  estimate: number;
  project: { id: string; name: string; url: string } | null;
};

export type StoryPointReferenceGroup = {
  estimate: number;
  issues: StoryPointReference[];
  endCursor: string | null;
  hasNextPage: boolean;
};

export type StoryPointReferencePage = {
  issues: StoryPointReference[];
  endCursor: string | null;
  hasNextPage: boolean;
};

export type ParticipantGroupMember = {
  userId: string;
  displayName: string;
  email: string;
};

export type ParticipantGroup = {
  id: string;
  teamId: string;
  name: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  members: ParticipantGroupMember[];
};

export type ParticipantState = {
  userId: string;
  displayName: string;
  email: string;
  voted: boolean;
  votedNeedInfo: boolean;
  value: string | null;
};

export type FinalEstimate = {
  value: string;
  finalizedBy: string;
  finalizedAt: number;
};

export type SessionState = {
  id: string;
  status: SessionStatus;
  currentRoundNo: number;
  meta: SessionMeta;
  facilitatorId: string;
  needsDiscussion: boolean;
  participants: ParticipantState[];
  finalEstimate: FinalEstimate | null;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`${status} ${statusText}`);
    this.name = "ApiError";
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function apiErrorCode(e: unknown): string | null {
  if (e instanceof ApiError && isRecord(e.body) && typeof e.body.error === "string") {
    return e.body.error;
  }
  return null;
}

export function apiErrorBody(e: unknown): Record<string, unknown> | null {
  if (e instanceof ApiError && isRecord(e.body)) return e.body;
  return null;
}

async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText, await readErrorBody(res));
  }
  return (await res.json()) as T;
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText, await readErrorBody(res));
  }
  return (await res.json()) as T;
}

async function jsonPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText, await readErrorBody(res));
  }
  return (await res.json()) as T;
}

async function jsonDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText, await readErrorBody(res));
  }
  return (await res.json()) as T;
}

export const api = {
  authStatus: () => jsonGet<AuthStatus>("/api/auth/status"),
  me: () => jsonGet<Viewer>("/api/me"),
  teams: () => jsonGet<{ teams: Team[] }>("/api/teams").then((r) => r.teams),
  backlogProjects: (teamId: string) =>
    jsonGet<{ projects: Project[] }>(
      `/api/teams/${encodeURIComponent(teamId)}/backlog-projects`,
    ).then((r) => r.projects),
  storyPointIssue: (projectId: string) =>
    jsonGet<{ issue: StoryPointIssue | null; labelName: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/storypoint-issue`,
    ),
  storyPointReferences: (teamId: string) =>
    jsonGet<{ groups: StoryPointReferenceGroup[]; labelName: string }>(
      `/api/teams/${encodeURIComponent(teamId)}/storypoint-references`,
    ),
  storyPointReferencesMore: (teamId: string, estimate: number, after: string) =>
    jsonGet<StoryPointReferencePage>(
      `/api/teams/${encodeURIComponent(teamId)}/storypoint-references/${estimate}?after=${encodeURIComponent(after)}`,
    ),
  teamMembers: (teamId: string) =>
    jsonGet<{ users: User[] }>(
      `/api/teams/${encodeURIComponent(teamId)}/members`,
    ).then((r) => r.users),
  searchUsers: (q: string) =>
    jsonGet<{ users: User[] }>(`/api/users?q=${encodeURIComponent(q)}`).then(
      (r) => r.users,
    ),
  listSessions: (scope: SessionListScope, status: SessionListStatusFilter) => {
    const params = new URLSearchParams({ scope });
    if (status !== "all") params.set("status", status);
    return jsonGet<{ sessions: SessionListItem[] }>(
      `/api/sessions?${params.toString()}`,
    ).then((r) => r.sessions);
  },
  createSession: (input: {
    teamId: string;
    projectId: string;
    issueId: string;
    participantIds: string[];
  }) => jsonPost<{ id: string }>("/api/sessions", input),
  getSession: (id: string) =>
    jsonGet<SessionState>(`/api/sessions/${encodeURIComponent(id)}`),
  addParticipant: (sessionId: string, userId: string) =>
    jsonPost<{ ok: true }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/participants`,
      { userId },
    ),
  removeParticipant: (sessionId: string, userId: string) =>
    jsonDelete<{ ok: true }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(userId)}`,
    ),
  vote: (sessionId: string, value: string) =>
    jsonPost<{ ok: true }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/votes`,
      { value },
    ),
  reveal: (sessionId: string) =>
    jsonPost<{ ok: true }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/reveal`,
      {},
    ),
  finalize: (sessionId: string, value: string) =>
    jsonPost<{ ok: true }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/finalize`,
      { value },
    ),
  revote: (sessionId: string) =>
    jsonPost<{ ok: true }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/revote`,
      {},
    ),
  unfinalize: (sessionId: string) =>
    jsonPost<{ ok: true }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/unfinalize`,
      {},
    ),
  listGroups: (teamId: string) =>
    jsonGet<{ groups: ParticipantGroup[] }>(
      `/api/teams/${encodeURIComponent(teamId)}/groups`,
    ).then((r) => r.groups),
  createGroup: (teamId: string, input: { name: string; userIds: string[] }) =>
    jsonPost<{ group: ParticipantGroup }>(
      `/api/teams/${encodeURIComponent(teamId)}/groups`,
      input,
    ).then((r) => r.group),
  updateGroup: (id: string, input: { name: string; userIds: string[] }) =>
    jsonPatch<{ group: ParticipantGroup }>(
      `/api/groups/${encodeURIComponent(id)}`,
      input,
    ).then((r) => r.group),
  deleteGroup: (id: string) =>
    jsonDelete<{ ok: true }>(`/api/groups/${encodeURIComponent(id)}`),
  logout: () =>
    fetch("/auth/logout", { method: "POST", credentials: "same-origin" }),
};

export const NEED_INFO = "need_info";
