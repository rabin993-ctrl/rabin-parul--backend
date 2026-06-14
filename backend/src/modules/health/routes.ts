import type { FastifyPluginAsync } from "fastify";
import { pool } from "../../db/client.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health/live", async () => ({
    status: "ok",
    service: "parul-api",
  }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await pool.query("select 1");
      return { status: "ready", database: "up" };
    } catch {
      return reply.code(503).send({
        status: "not_ready",
        database: "down",
      });
    }
  });
};
