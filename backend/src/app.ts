import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { config } from "./config.js";
import { pool } from "./db/client.js";
import { authRoutes } from "./modules/auth/routes.js";
import { adoptionRoutes } from "./modules/adoption/routes.js";
import { companionRoutes } from "./modules/companions/routes.js";
import { communityRoutes } from "./modules/communities/routes.js";
import { circleRoutes } from "./modules/circles/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { feedRoutes } from "./modules/feed/routes.js";
import { mediaRoutes } from "./modules/media/routes.js";
import { messageRoutes } from "./modules/messages/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { rescueRoutes } from "./modules/rescue/routes.js";
import { lostFoundRoutes } from "./modules/lostFound/routes.js";
import { profileRoutes } from "./modules/profiles/routes.js";
import { authPlugin } from "./plugins/auth.js";
import { registerErrorHandler } from "./shared/errors.js";

export async function buildApp() {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: [
              "req.headers.authorization",
              "body.password",
              "body.refreshToken",
            ],
          },
    trustProxy: true,
    requestIdHeader: "x-request-id",
  });

  await app.register(helmet);
  await app.register(cors, {
    origin:
      config.corsOrigins.length > 0
        ? config.corsOrigins
        : config.NODE_ENV === "production"
          ? false
          : true,
    credentials: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
  });
  await app.register(authPlugin);

  registerErrorHandler(app);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(profileRoutes);
  await app.register(companionRoutes);
  await app.register(mediaRoutes);
  await app.register(feedRoutes);
  await app.register(messageRoutes);
  await app.register(notificationRoutes);
  await app.register(communityRoutes);
  await app.register(circleRoutes);
  await app.register(adoptionRoutes);
  await app.register(rescueRoutes);
  await app.register(lostFoundRoutes);

  app.get("/", async () => ({
    service: "parul-api",
    version: "0.1.0",
    docs: "/health/live",
  }));

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Route was not found.",
        requestId: request.id,
      },
    }),
  );

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
