import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

/**
 * One Durable Object instance per planning-poker session. Ensures strong
 * consistency for concurrent votes, all-voted detection, and reveal locking.
 *
 * State machine: voting -> revealed (auto) -> finalized (manual).
 * Re-vote moves revealed/voting -> voting with a new round_no.
 *
 * This is the v0.1 skeleton — real behavior arrives in v0.2.
 */
export class SessionDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    return new Response(
      JSON.stringify({ ok: true, path: url.pathname, note: "SessionDO skeleton" }),
      { headers: { "content-type": "application/json" } },
    );
  }
}
