import type { preHandlerHookHandler } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    auth: {
      userId: string;
      sessionId: string;
    } | null;
  }

  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    optionalAuthenticate: preHandlerHookHandler;
  }
}
