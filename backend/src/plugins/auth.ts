import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { accounts, userSessions } from "../db/schema.js";
import { AppError } from "../shared/errors.js";
import { verifyAccessToken } from "../shared/tokens.js";

function bearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

async function resolveAuthentication(
  request: FastifyRequest,
  required: boolean,
): Promise<void> {
  const token = bearerToken(request);

  if (!token) {
    if (required) {
      throw new AppError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication is required.",
      );
    }
    return;
  }

  const claims = await verifyAccessToken(token);
  const [session] = await db
    .select({
      sessionId: userSessions.id,
      userId: userSessions.userId,
      accountStatus: accounts.status,
    })
    .from(userSessions)
    .innerJoin(accounts, eq(accounts.id, userSessions.userId))
    .where(
      and(
        eq(userSessions.id, claims.sessionId),
        eq(userSessions.userId, claims.userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session || session.accountStatus !== "active") {
    throw new AppError(
      401,
      "SESSION_REVOKED",
      "This session is no longer active.",
    );
  }

  request.auth = {
    userId: session.userId,
    sessionId: session.sessionId,
  };
}

const authPluginImplementation: FastifyPluginAsync = async (app) => {
  app.decorateRequest("auth", null);
  app.decorate("authenticate", async (request) => {
    await resolveAuthentication(request, true);
  });
  app.decorate("optionalAuthenticate", async (request) => {
    await resolveAuthentication(request, false);
  });
};

export const authPlugin = fastifyPlugin(authPluginImplementation, {
  name: "parul-auth",
});
