const enc = new TextEncoder();

function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    str += String.fromCharCode(bytes[i]!);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): ArrayBuffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

export async function verify(signed: string, secret: string): Promise<string | null> {
  // Cookies in the wild can be malformed (truncated, mangled, signed by an
  // older secret). Catch any decoding/crypto error and treat it as "no
  // session" instead of bubbling a 500.
  try {
    const idx = signed.lastIndexOf(".");
    if (idx < 0) return null;
    const payload = signed.slice(0, idx);
    const sig = signed.slice(idx + 1);
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, fromBase64Url(sig), enc.encode(payload));
    return ok ? payload : null;
  } catch {
    return null;
  }
}

export function randomId(byteLength = 24): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return toBase64Url(buf);
}
