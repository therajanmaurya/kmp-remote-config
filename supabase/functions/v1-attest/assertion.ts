/** 15 minutes. Long enough for a session's writes, short enough that a stolen one expires. */
export const TTL_MS = 15 * 60_000;
/** Client clocks drift; tolerate a minute of past-skew rather than reject honest callers. */
export const SKEW_MS = 60_000;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function unb64url(s: string): Uint8Array {
  const b = s.replaceAll("-", "+").replaceAll("_", "/");
  const pad = b.length % 4 ? "=".repeat(4 - (b.length % 4)) : "";
  return Uint8Array.from(atob(b + pad), (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/**
 * `<b64url(payload)>.<b64url(hmac)>` — a bearer assertion the client presents on writes.
 *
 * Deliberately not a JWT: there is exactly one issuer and one verifier (this function and
 * /v1/events), so a JWT library would add parsing surface for no interoperability gain.
 */
export async function mintAssertion(
  appId: string,
  keyId: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ a: appId, k: keyId, iat: nowMs })));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function verifyAssertion(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<{ appId: string; keyId: string } | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = b64url(await hmac(secret, payload));
  // Length-then-XOR compare: avoids the early return that makes a naive === leak where
  // two signatures first differ.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const { a, k, iat } = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (typeof a !== "string" || typeof k !== "string" || typeof iat !== "number") return null;
    // Issued in the future beyond tolerated skew — a forged or badly-clocked token.
    if (nowMs < iat - SKEW_MS) return null;
    // EXPIRED is rejected, never treated as absent: for a `preferred` key, "absent" would
    // silently pass, so a replayed stale token must fail explicitly.
    if (nowMs - iat > TTL_MS) return null;
    return { appId: a, keyId: k };
  } catch {
    return null;
  }
}
