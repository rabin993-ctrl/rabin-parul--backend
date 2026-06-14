import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listSessions,
  login,
  reactivateAccount,
  registerAccount,
  revokeOtherSessions,
  revokeSession,
  rotateRefreshToken,
} from "./service.js";

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(10).max(128),
  displayName: z.string().trim().min(1).max(80),
  deviceName: z.string().trim().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
  deviceName: z.string().trim().min(1).max(100).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const sessionParamsSchema = z.object({
  sessionId: z.uuid(),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = registerSchema.parse(request.body);
      const result = await registerAccount({
        email: body.email,
        password: body.password,
        displayName: body.displayName,
        requestId: request.id,
        session: {
          deviceName: body.deviceName,
          userAgent: request.headers["user-agent"],
          ipAddress: request.ip,
        },
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const body = loginSchema.parse(request.body);
      return login({
        email: body.email,
        password: body.password,
        session: {
          deviceName: body.deviceName,
          userAgent: request.headers["user-agent"],
          ipAddress: request.ip,
        },
      });
    },
  );

  app.post(
    "/v1/auth/reactivate",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request) => {
      const body = loginSchema.parse(request.body);
      return reactivateAccount({
        email: body.email,
        password: body.password,
        requestId: request.id,
        session: {
          deviceName: body.deviceName,
          userAgent: request.headers["user-agent"],
          ipAddress: request.ip,
        },
      });
    },
  );

  app.post(
    "/v1/auth/refresh",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const body = refreshSchema.parse(request.body);
      return { tokens: await rotateRefreshToken(body.refreshToken) };
    },
  );

  app.post(
    "/v1/auth/logout",
    { preHandler: app.authenticate },
    async (request, reply) => {
      await revokeSession(request.auth!.userId, request.auth!.sessionId);
      return reply.code(204).send();
    },
  );

  app.get(
    "/v1/me/sessions",
    { preHandler: app.authenticate },
    async (request) => {
      const sessions = await listSessions(request.auth!.userId);
      return {
        sessions: sessions.map((session) => ({
          ...session,
          current: session.id === request.auth!.sessionId,
        })),
      };
    },
  );

  app.delete(
    "/v1/me/sessions/:sessionId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = sessionParamsSchema.parse(request.params);
      await revokeSession(request.auth!.userId, params.sessionId);
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/me/sessions/revoke-others",
    { preHandler: app.authenticate },
    async (request) => ({
      revokedCount: await revokeOtherSessions(
        request.auth!.userId,
        request.auth!.sessionId,
      ),
    }),
  );
};
