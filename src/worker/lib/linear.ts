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
