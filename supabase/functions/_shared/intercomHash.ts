// Intercom identity-verification hash.
//
// Intercom verifies a user is who the app claims by checking an HMAC of the
// user_id: HMAC-SHA256 of the user_id string, keyed by the workspace identity
// secret, hex-encoded. The client hands Intercom { user_id, user_hash }; a hash
// that does not match the secret is rejected, which blocks impersonation in
// support chat.
//
// This is a pure function over the Web Crypto API (globalThis.crypto.subtle),
// which is present in both Deno (the edge runtime) and Node (vitest), so it is
// testable under vitest without any Deno-only shims.

/**
 * Compute the hex-encoded HMAC-SHA256 of `userId` keyed by `secret`.
 * This is exactly Intercom's identity-verification scheme.
 */
export async function computeIntercomUserHash(
  secret: string,
  userId: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(userId),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
