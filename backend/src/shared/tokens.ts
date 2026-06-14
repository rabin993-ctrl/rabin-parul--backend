import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";
import { AppError } from "./errors.js";

const accessTokenSecret = new TextEncoder().encode(
  config.ACCESS_TOKEN_SECRET,
);

export async function createAccessToken(
  userId: string,
  sessionId: string,
): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer("parul-api")
    .setAudience("parul-app")
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessTokenSecret);
}

export async function verifyAccessToken(token: string): Promise<{
  userId: string;
  sessionId: string;
}> {
  try {
    const { payload } = await jwtVerify(token, accessTokenSecret, {
      issuer: "parul-api",
      audience: "parul-app",
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string"
    ) {
      throw new Error("Token is missing required claims");
    }

    return {
      userId: payload.sub,
      sessionId: payload.sid,
    };
  } catch {
    throw new AppError(401, "INVALID_ACCESS_TOKEN", "Access token is invalid.");
  }
}

export function createRefreshSecret(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function refreshSecretsMatch(
  providedSecret: string,
  expectedHash: string,
): boolean {
  const providedHash = hashRefreshSecret(providedSecret);
  const provided = Buffer.from(providedHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export function formatRefreshToken(
  sessionId: string,
  secret: string,
): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(token: string): {
  sessionId: string;
  secret: string;
} {
  const separator = token.indexOf(".");
  if (separator < 1 || separator === token.length - 1) {
    throw new AppError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Refresh token is invalid.",
    );
  }

  return {
    sessionId: token.slice(0, separator),
    secret: token.slice(separator + 1),
  };
}
