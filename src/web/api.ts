export type Team = { id: string; name: string; key: string };
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
  team: { id: string; name: string; key: string };
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
  team: { id: string; name: string; key: string };
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

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
    const text = await res.text();
    throw new Error(`${res.status} ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function jsonDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
  logout: () =>
    fetch("/auth/logout", { method: "POST", credentials: "same-origin" }),
};

export const NEED_INFO = "need_info";
