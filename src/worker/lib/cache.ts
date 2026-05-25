/**
 * Thin wrapper around a KV namespace that caches a JSON-serialisable value
 * for `ttlSec` seconds. The bumpable `CACHE_VERSION` prefix lets us invalidate
 * every entry by changing this constant, so a schema change to a cached
 * payload doesn't require manually clearing the namespace.
 */

const CACHE_VERSION = "v1";

export async function cached<T>(
  cache: KVNamespace,
  key: string,
  ttlSec: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const fullKey = `${CACHE_VERSION}:${key}`;
  const hit = await cache.get<T>(fullKey, "json");
  if (hit !== null) return hit;
  const fresh = await fetcher();
  // Fire-and-forget the write: a failure here just means we'll re-fetch next
  // time, which is acceptable.
  await cache.put(fullKey, JSON.stringify(fresh), { expirationTtl: ttlSec });
  return fresh;
}

export const CacheTTL = {
  /** Team-scoped data — members, search results. */
  team: 300,
  /** Viewer-scoped data — viewer's teams. */
  viewer: 300,
} as const;
