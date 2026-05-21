import { LinearClient } from "@linear/sdk";

const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";

export const LINEAR_SCOPES = ["read", "write"] as const;

export interface LinearTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: (input.scopes ?? LINEAR_SCOPES).join(","),
    state: input.state,
    prompt: "consent",
  });
  return `${LINEAR_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<LinearTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code: input.code,
  });
  const res = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Linear token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as LinearTokenResponse;
}

export function clientFor(accessToken: string): LinearClient {
  return new LinearClient({ accessToken });
}

// ---- Domain DTOs returned by lib helpers --------------------------------

export interface TeamDTO {
  id: string;
  name: string;
  key: string;
}

export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  url: string;
}

export interface StoryPointIssueDTO {
  id: string;
  identifier: string;
  title: string;
  estimate: number | null;
  url: string;
  /** Number of additional issues with the same label in this project (>0 means setup is ambiguous). */
  duplicateCount: number;
}

export interface ViewerDTO {
  id: string;
  name: string;
  email: string;
  displayName: string;
}

// ---- API helpers --------------------------------------------------------

export async function getViewer(accessToken: string): Promise<ViewerDTO> {
  const viewer = await clientFor(accessToken).viewer;
  return {
    id: viewer.id,
    name: viewer.name,
    email: viewer.email,
    displayName: viewer.displayName,
  };
}

export async function listTeams(accessToken: string): Promise<TeamDTO[]> {
  const conn = await clientFor(accessToken).teams({ first: 100 });
  return conn.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key }));
}

export async function listBacklogProjects(
  accessToken: string,
  teamId: string,
): Promise<ProjectDTO[]> {
  const conn = await clientFor(accessToken).projects({
    first: 100,
    filter: {
      status: { type: { eq: "backlog" } },
      accessibleTeams: { some: { id: { eq: teamId } } },
    },
  });
  return conn.nodes.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    color: p.color ?? null,
    url: p.url,
  }));
}

export async function findStoryPointIssue(
  accessToken: string,
  projectId: string,
  labelName: string,
): Promise<StoryPointIssueDTO | null> {
  const conn = await clientFor(accessToken).issues({
    first: 5,
    filter: {
      project: { id: { eq: projectId } },
      labels: { some: { name: { eq: labelName } } },
    },
  });
  const [first] = conn.nodes;
  if (!first) return null;
  return {
    id: first.id,
    identifier: first.identifier,
    title: first.title,
    estimate: first.estimate ?? null,
    url: first.url,
    duplicateCount: Math.max(conn.nodes.length - 1, 0),
  };
}
