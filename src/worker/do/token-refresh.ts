import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { refreshAccessToken } from "../lib/linear";

export interface RefreshedToken {
  accessToken: string;
  refreshToken: string;
  /** null when Linear didn't return expires_in ("no expiry info, never refresh"). */
  expiresAt: number | null;
}

/** The last refresh this instance performed, kept so racing callers can reuse it. */
interface LastRefresh {
  usedRefreshToken: string;
  result: RefreshedToken;
}

const LAST_REFRESH_KEY = "last_refresh";

/**
 * How long a refresh result stays reusable. Must outlast KV propagation lag
 * (up to ~60s), during which other requests can still read the pre-refresh
 * record and present the already-rotated refresh token.
 */
const LAST_REFRESH_TTL_MS = 10 * 60_000;

/**
 * One instance per app session (keyed by sid). Coalesces Linear token
 * refreshes for that session: Linear rotates the refresh token on use, so
 * two requests refreshing independently would leave the loser holding a dead
 * refresh token. Here the first caller performs the refresh and every caller
 * presenting the same refresh token afterwards gets that same result back.
 *
 * The DO does not touch the TOKENS KV; persisting the result stays in
 * lib/session.ts.
 */
export class TokenRefreshDO extends DurableObject<Env> {
  refresh(refreshToken: string): Promise<RefreshedToken> {
    // Hold the input gate across the Linear fetch so concurrent callers wait
    // for this refresh instead of starting their own.
    return this.ctx.blockConcurrencyWhile(() => this.refreshImpl(refreshToken));
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  private async refreshImpl(refreshToken: string): Promise<RefreshedToken> {
    const last = await this.ctx.storage.get<LastRefresh>(LAST_REFRESH_KEY);
    if (
      last &&
      last.usedRefreshToken === refreshToken &&
      (last.result.expiresAt === null || last.result.expiresAt > Date.now())
    ) {
      return last.result;
    }

    const token = await refreshAccessToken({
      clientId: this.env.LINEAR_OAUTH_CLIENT_ID,
      clientSecret: this.env.LINEAR_OAUTH_CLIENT_SECRET,
      refreshToken,
    });
    const result: RefreshedToken = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt:
        typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : null,
    };
    await this.ctx.storage.put<LastRefresh>(LAST_REFRESH_KEY, {
      usedRefreshToken: refreshToken,
      result,
    });
    // Drop the stored tokens once no racing caller can still need them.
    await this.ctx.storage.setAlarm(Date.now() + LAST_REFRESH_TTL_MS);
    return result;
  }
}
