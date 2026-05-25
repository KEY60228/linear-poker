import type { SessionDO } from "./do/session";

export interface Env {
  DB: D1Database;
  TOKENS: KVNamespace;
  LINEAR_CACHE: KVNamespace;
  ASSETS: Fetcher;
  SESSION_DO: DurableObjectNamespace<SessionDO>;

  LINEAR_OAUTH_CLIENT_ID: string;
  LINEAR_OAUTH_CLIENT_SECRET: string;
  LINEAR_OAUTH_REDIRECT_URI: string;
  SLACK_WEBHOOK_URL?: string;
  STORY_POINT_LABEL_NAME: string;
  SESSION_SECRET: string;
  APP_BASE_URL: string;
}

export type AppSessionContext = {
  appSessionId: string;
  linearUserId: string;
};

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    session?: AppSessionContext;
    accessToken?: string;
  };
};
