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
  url: string;
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

export interface UserDTO {
  id: string;
  name: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

export type EstimateScaleType = "notUsed" | "exponential" | "fibonacci" | "linear" | "tShirt";

export interface EstimateScaleDTO {
  type: EstimateScaleType;
  allowZero: boolean;
  /** Allowed vote values, stored as strings. Labels are display-only. */
  options: { value: string; label: string }[];
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
  const client = clientFor(accessToken);
  const [viewer, organization] = await Promise.all([client.viewer, client.organization]);
  const conn = await viewer.teams({ first: 100 });
  const urlSlug = organization.urlKey;
  return conn.nodes.map((t) => ({
    id: t.id,
    name: t.name,
    key: t.key,
    url: `https://linear.app/${urlSlug}/team/${t.key}`,
  }));
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

export async function listTeamMembers(
  accessToken: string,
  teamId: string,
): Promise<UserDTO[]> {
  const team = await clientFor(accessToken).team(teamId);
  const conn = await team.members({ first: 100 });
  return conn.nodes.map(toUserDTO);
}

export async function listUsersByIds(
  accessToken: string,
  ids: string[],
): Promise<UserDTO[]> {
  if (ids.length === 0) return [];
  const conn = await clientFor(accessToken).users({
    first: Math.min(100, ids.length),
    filter: { id: { in: ids } },
  });
  return conn.nodes.map(toUserDTO);
}

export async function searchUsers(
  accessToken: string,
  query: string,
): Promise<UserDTO[]> {
  const conn = await clientFor(accessToken).users({
    first: 25,
    filter: {
      or: [
        { displayName: { containsIgnoreCase: query } },
        { name: { containsIgnoreCase: query } },
        { email: { containsIgnoreCase: query } },
      ],
    },
  });
  return conn.nodes.map(toUserDTO);
}

function toUserDTO(u: {
  id: string;
  name: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
}): UserDTO {
  return {
    id: u.id,
    name: u.name,
    displayName: u.displayName,
    email: u.email,
    avatarUrl: u.avatarUrl ?? null,
  };
}

export async function getTeamSummary(
  accessToken: string,
  teamId: string,
): Promise<{ id: string; name: string; key: string; url: string; scale: EstimateScaleDTO }> {
  const client = clientFor(accessToken);
  const [team, organization] = await Promise.all([client.team(teamId), client.organization]);
  const type = (team.issueEstimationType ?? "notUsed") as EstimateScaleType;
  const allowZero = team.issueEstimationAllowZero ?? false;
  const extended = team.issueEstimationExtended ?? false;
  return {
    id: team.id,
    name: team.name,
    key: team.key,
    url: `https://linear.app/${organization.urlKey}/team/${team.key}`,
    scale: { type, allowZero, options: buildScaleOptions(type, allowZero, extended) },
  };
}

export async function getProjectSummary(
  accessToken: string,
  projectId: string,
): Promise<{ id: string; name: string; url: string }> {
  const p = await clientFor(accessToken).project(projectId);
  return { id: p.id, name: p.name, url: p.url };
}

export async function getIssueSummary(
  accessToken: string,
  issueId: string,
): Promise<{
  id: string;
  identifier: string;
  title: string;
  url: string;
  estimate: number | null;
}> {
  const i = await clientFor(accessToken).issue(issueId);
  return {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    url: i.url,
    estimate: i.estimate ?? null,
  };
}

export async function updateIssueEstimate(
  accessToken: string,
  issueId: string,
  estimate: number,
): Promise<void> {
  await clientFor(accessToken).updateIssue(issueId, { estimate });
}

export async function setProjectStatusPlanned(
  accessToken: string,
  projectId: string,
): Promise<void> {
  const client = clientFor(accessToken);
  const statuses = await client.projectStatuses({ first: 100 });
  const planned = statuses.nodes.find((s) => s.type === "planned");
  if (!planned) {
    throw new Error("no_planned_status_in_workspace");
  }
  await client.updateProject(projectId, { statusId: planned.id });
}

export async function getTeamEstimateScale(
  accessToken: string,
  teamId: string,
): Promise<EstimateScaleDTO> {
  const team = await clientFor(accessToken).team(teamId);
  const type = (team.issueEstimationType ?? "notUsed") as EstimateScaleType;
  const allowZero = team.issueEstimationAllowZero ?? false;
  const extended = team.issueEstimationExtended ?? false;
  return { type, allowZero, options: buildScaleOptions(type, allowZero, extended) };
}

function buildScaleOptions(
  type: EstimateScaleType,
  allowZero: boolean,
  extended: boolean,
): { value: string; label: string }[] {
  if (type === "notUsed") return [];
  const numeric =
    type === "exponential"
      ? extended
        ? [0, 1, 2, 4, 8, 16, 32, 64]
        : [0, 1, 2, 4, 8, 16]
      : type === "fibonacci"
        ? extended
          ? [0, 1, 2, 3, 5, 8, 13, 21]
          : [0, 1, 2, 3, 5, 8]
        : type === "linear"
          ? extended
            ? [0, 1, 2, 3, 4, 5, 6, 7]
            : [0, 1, 2, 3, 4, 5]
          : [0, 1, 2, 3, 5]; // tShirt internal numeric values
  const filtered = allowZero ? numeric : numeric.filter((n) => n !== 0);
  if (type === "tShirt") {
    const tShirtLabels: Record<number, string> = {
      0: "—",
      1: "XS",
      2: "S",
      3: "M",
      5: "L",
      8: "XL",
    };
    return filtered.map((n) => ({ value: String(n), label: tShirtLabels[n] ?? String(n) }));
  }
  return filtered.map((n) => ({ value: String(n), label: String(n) }));
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
