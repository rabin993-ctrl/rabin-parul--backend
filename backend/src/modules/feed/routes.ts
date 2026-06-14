import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createComment, createPost, getPost, listComments, listPosts, setReaction, setSaved } from "./service.js";

const postParams = z.object({ postId: z.uuid() });
const createSchema = z.object({
  body: z.string().max(10_000).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  visibility: z.enum(["everyone", "circles", "only_me"]).default("everyone"),
  presentationMode: z.enum(["user", "companion"]).default("user"),
  authorCompanionId: z.uuid().nullable().optional(),
  companionIds: z.array(z.uuid()).max(10).default([]),
  assetIds: z.array(z.uuid()).max(10).default([]),
  destinations: z.array(z.object({ type: z.enum(["feed", "community", "paw_circle"]), id: z.uuid().optional() })).min(1),
});

export const feedRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/posts", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    return reply.code(201).send(await createPost({ userId: request.auth!.userId, ...body }));
  });
  app.get("/v1/feed", { preHandler: app.optionalAuthenticate }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    return { posts: await listPosts({ viewerUserId: request.auth?.userId ?? null, destinationType: "feed", limit: query.limit }) };
  });
  app.get("/v1/posts/:postId", { preHandler: app.optionalAuthenticate }, async (request) => getPost(postParams.parse(request.params).postId, request.auth?.userId ?? null));
  app.put("/v1/posts/:postId/reaction", { preHandler: app.authenticate }, async (request) => {
    const { postId } = postParams.parse(request.params);
    const body = z.object({ type: z.string().min(1).max(30) }).parse(request.body);
    return setReaction(postId, request.auth!.userId, body.type);
  });
  app.delete("/v1/posts/:postId/reaction", { preHandler: app.authenticate }, async (request) => setReaction(postParams.parse(request.params).postId, request.auth!.userId, null));
  app.put("/v1/posts/:postId/save", { preHandler: app.authenticate }, async (request, reply) => {
    await setSaved(postParams.parse(request.params).postId, request.auth!.userId, true);
    return reply.code(204).send();
  });
  app.delete("/v1/posts/:postId/save", { preHandler: app.authenticate }, async (request, reply) => {
    await setSaved(postParams.parse(request.params).postId, request.auth!.userId, false);
    return reply.code(204).send();
  });
  app.get("/v1/posts/:postId/comments", { preHandler: app.optionalAuthenticate }, async (request) => ({ comments: await listComments(postParams.parse(request.params).postId, request.auth?.userId ?? null) }));
  app.post("/v1/posts/:postId/comments", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ body: z.string().trim().min(1).max(2_000), parentCommentId: z.uuid().optional() }).parse(request.body);
    return reply.code(201).send(await createComment(postParams.parse(request.params).postId, request.auth!.userId, body.body, body.parentCommentId));
  });
};
