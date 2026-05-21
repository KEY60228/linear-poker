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
export type Viewer = { id: string; name: string; email: string; displayName: string };
export type AuthStatus = { authenticated: boolean; userId: string | null };

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
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
  logout: () =>
    fetch("/auth/logout", { method: "POST", credentials: "same-origin" }),
};
