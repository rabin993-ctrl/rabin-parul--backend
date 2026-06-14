import { describe, expect, it } from "vitest";
import {
  createAccessToken,
  createRefreshSecret,
  formatRefreshToken,
  hashRefreshSecret,
  parseRefreshToken,
  refreshSecretsMatch,
  verifyAccessToken,
} from "../src/shared/tokens.js";

describe("session tokens", () => {
  it("round trips an access token", async () => {
    const token = await createAccessToken("user-id", "session-id");
    await expect(verifyAccessToken(token)).resolves.toEqual({
      userId: "user-id",
      sessionId: "session-id",
    });
  });

  it("formats and verifies an opaque refresh token", () => {
    const secret = createRefreshSecret();
    const token = formatRefreshToken(
      "2b9e9dd4-af8e-4772-a21c-e8dc018791ab",
      secret,
    );
    const parsed = parseRefreshToken(token);

    expect(parsed.sessionId).toBe("2b9e9dd4-af8e-4772-a21c-e8dc018791ab");
    expect(refreshSecretsMatch(parsed.secret, hashRefreshSecret(secret))).toBe(
      true,
    );
    expect(refreshSecretsMatch("wrong", hashRefreshSecret(secret))).toBe(false);
  });
});
