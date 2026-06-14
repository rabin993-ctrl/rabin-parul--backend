import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { completeUpload, createUploadSession, deleteMediaAsset, getMediaAsset } from "./service.js";

const createSchema = z.object({
  purpose: z.string().min(1).max(80),
  mimeType: z.string().min(3).max(100),
  byteSize: z.number().int().positive(),
  originalFilename: z.string().max(255).optional(),
  checksum: z.string().max(128).optional(),
});
const paramsSchema = z.object({ assetId: z.uuid() });

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/media/upload-sessions", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    return reply.code(201).send(await createUploadSession({ userId: request.auth!.userId, ...body }));
  });
  app.post("/v1/media/:assetId/complete", { preHandler: app.authenticate }, async (request) => {
    const { assetId } = paramsSchema.parse(request.params);
    return completeUpload(request.auth!.userId, assetId);
  });
  app.get("/v1/media/:assetId/status", { preHandler: app.authenticate }, async (request) => {
    const { assetId } = paramsSchema.parse(request.params);
    return getMediaAsset(request.auth!.userId, assetId);
  });
  app.delete("/v1/media/:assetId", { preHandler: app.authenticate }, async (request) => {
    const { assetId } = paramsSchema.parse(request.params);
    return deleteMediaAsset(request.auth!.userId, assetId);
  });
};
