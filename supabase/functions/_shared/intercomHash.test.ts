import { describe, it, expect } from "vitest";
import { computeIntercomUserHash } from "./intercomHash";

describe("computeIntercomUserHash", () => {
  it("matches a known HMAC-SHA256 vector (hex output)", async () => {
    // Independently computed with Node:
    //   crypto.createHmac("sha256", "test_secret").update("user-123").digest("hex")
    // Intercom's identity-verification scheme is HMAC-SHA256 of the user_id,
    // keyed by the identity secret, hex-encoded.
    const expected =
      "8f8fb4646206c4023ae3c183cd720f9a58650decb95c6f28aacdd69f482fff97";
    expect(await computeIntercomUserHash("test_secret", "user-123")).toBe(
      expected,
    );
  });

  it("returns 64 lowercase hex characters", async () => {
    const hash = await computeIntercomUserHash("some_secret", "abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different user ids", async () => {
    const a = await computeIntercomUserHash("test_secret", "user-123");
    const b = await computeIntercomUserHash("test_secret", "user-456");
    expect(a).not.toBe(b);
  });
});
