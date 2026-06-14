import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  auditEvents,
  conversationParticipants,
  messages,
  userPrivacySettings,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { createOrGetDirectConversation, getConversation, listConversations, listMessages, markConversationRead, sendMessage } from "./service.js";

const params = z.object({ conversationId: z.uuid() });
const messageParams = z.object({ messageId: z.uuid() });

export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/conversations", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ type: z.string().max(30).optional() }).parse(request.query);
    return { conversations: await listConversations(request.auth!.userId, query.type) };
  });
  app.post("/v1/conversations/direct", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ recipientUserId: z.uuid() }).parse(request.body);
    return reply.code(201).send(await createOrGetDirectConversation(request.auth!.userId, body.recipientUserId));
  });
  app.get("/v1/conversations/:conversationId", { preHandler: app.authenticate }, async (request) => getConversation(params.parse(request.params).conversationId, request.auth!.userId));
  app.post("/v1/conversations/:conversationId/accept", { preHandler: app.authenticate }, async (request) => {
    const conversationId = params.parse(request.params).conversationId;
    const [updated] = await db.update(conversationParticipants).set({
      requestState: "accepted",
      state: "active",
      hiddenAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, request.auth!.userId),
    )).returning();
    if (!updated) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    return getConversation(conversationId, request.auth!.userId);
  });
  app.post("/v1/conversations/:conversationId/decline", { preHandler: app.authenticate }, async (request, reply) => {
    const conversationId = params.parse(request.params).conversationId;
    const [updated] = await db.update(conversationParticipants).set({
      requestState: "declined",
      state: "hidden",
      hiddenAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, request.auth!.userId),
    )).returning();
    if (!updated) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    return reply.code(204).send();
  });
  app.post("/v1/conversations/:conversationId/archive", { preHandler: app.authenticate }, async (request, reply) => {
    const conversationId = params.parse(request.params).conversationId;
    const [updated] = await db.update(conversationParticipants).set({
      archivedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, request.auth!.userId),
      eq(conversationParticipants.state, "active"),
    )).returning();
    if (!updated) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    return reply.code(204).send();
  });
  app.delete("/v1/conversations/:conversationId/me", { preHandler: app.authenticate }, async (request, reply) => {
    const conversationId = params.parse(request.params).conversationId;
    const [updated] = await db.update(conversationParticipants).set({
      state: "left",
      hiddenAt: new Date(),
      archivedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, request.auth!.userId),
    )).returning();
    if (!updated) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    return reply.code(204).send();
  });
  app.get("/v1/conversations/:conversationId/messages", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    return { messages: await listMessages(params.parse(request.params).conversationId, request.auth!.userId, query.limit) };
  });
  app.post("/v1/conversations/:conversationId/messages", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      type: z.enum(["text", "image", "video", "file"]).default("text"),
      text: z.string().max(4_000).nullable().optional(),
      assetIds: z.array(z.uuid()).max(10).default([]),
      clientIdempotencyKey: z.string().min(8).max(100),
    }).parse(request.body);
    return reply.code(201).send(await sendMessage({ conversationId: params.parse(request.params).conversationId, senderUserId: request.auth!.userId, ...body }));
  });
  app.post("/v1/conversations/:conversationId/read", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ messageId: z.uuid().optional() }).parse(request.body ?? {});
    await markConversationRead(params.parse(request.params).conversationId, request.auth!.userId, body.messageId);
    return reply.code(204).send();
  });
  app.post("/v1/conversations/:conversationId/typing", { preHandler: app.authenticate }, async (request, reply) => {
    const conversationId = params.parse(request.params).conversationId;
    await getConversation(conversationId, request.auth!.userId);
    z.object({ typing: z.boolean() }).parse(request.body);
    return reply.code(204).send();
  });
  app.patch("/v1/conversations/:conversationId/preferences", { preHandler: app.authenticate }, async (request) => {
    const conversationId = params.parse(request.params).conversationId;
    const body = z.object({
      mutedUntil: z.iso.datetime().nullable().optional(),
      archived: z.boolean().optional(),
    }).refine((value) => value.mutedUntil !== undefined || value.archived !== undefined, {
      message: "At least one preference is required.",
    }).parse(request.body);
    const [updated] = await db.update(conversationParticipants).set({
      ...(body.mutedUntil !== undefined && {
        mutedUntil: body.mutedUntil ? new Date(body.mutedUntil) : null,
      }),
      ...(body.archived !== undefined && {
        archivedAt: body.archived ? new Date() : null,
      }),
      updatedAt: new Date(),
    }).where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, request.auth!.userId),
      eq(conversationParticipants.state, "active"),
    )).returning();
    if (!updated) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    return updated;
  });
  app.patch("/v1/messages/:messageId", { preHandler: app.authenticate }, async (request) => {
    const messageId = messageParams.parse(request.params).messageId;
    const body = z.object({
      text: z.string().trim().min(1).max(4_000),
      version: z.number().int().positive(),
    }).parse(request.body);
    const [updated] = await db.update(messages).set({
      text: body.text,
      editedAt: new Date(),
      version: body.version + 1,
    }).where(and(
      eq(messages.id, messageId),
      eq(messages.senderUserId, request.auth!.userId),
      eq(messages.version, body.version),
      eq(messages.state, "active"),
      isNull(messages.removedAt),
    )).returning();
    if (!updated) throw new AppError(409, "MESSAGE_NOT_EDITABLE", "Message could not be edited.");
    return updated;
  });
  app.delete("/v1/messages/:messageId", { preHandler: app.authenticate }, async (request, reply) => {
    const messageId = messageParams.parse(request.params).messageId;
    const [updated] = await db.update(messages).set({
      state: "removed",
      text: null,
      removedAt: new Date(),
      version: sql`${messages.version} + 1`,
    }).where(and(
      eq(messages.id, messageId),
      eq(messages.senderUserId, request.auth!.userId),
      eq(messages.state, "active"),
    )).returning();
    if (!updated) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
    return reply.code(204).send();
  });
  app.get("/v1/me/message-preferences", { preHandler: app.authenticate }, async (request) => {
    const [settings] = await db.select({
      messagePolicy: userPrivacySettings.messagePolicy,
      version: userPrivacySettings.version,
    }).from(userPrivacySettings).where(eq(userPrivacySettings.userId, request.auth!.userId)).limit(1);
    return settings;
  });
  app.patch("/v1/me/message-preferences", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({
      messagePolicy: z.enum(["everyone", "circles", "none"]),
      version: z.number().int().positive(),
    }).parse(request.body);
    const [updated] = await db.update(userPrivacySettings).set({
      messagePolicy: body.messagePolicy,
      version: body.version + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(userPrivacySettings.userId, request.auth!.userId),
      eq(userPrivacySettings.version, body.version),
    )).returning({
      messagePolicy: userPrivacySettings.messagePolicy,
      version: userPrivacySettings.version,
    });
    if (!updated) throw new AppError(409, "VERSION_CONFLICT", "Message preferences changed. Refresh and try again.");
    return updated;
  });
  app.post("/v1/message-reports", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      messageId: z.uuid().optional(),
      conversationId: z.uuid(),
      reason: z.string().trim().min(3).max(100),
      details: z.string().trim().max(2_000).optional(),
    }).parse(request.body);
    await getConversation(body.conversationId, request.auth!.userId);
    if (body.messageId) {
      const [message] = await db.select({ id: messages.id }).from(messages).where(and(
        eq(messages.id, body.messageId),
        eq(messages.conversationId, body.conversationId),
      )).limit(1);
      if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
    }
    const [report] = await db.insert(auditEvents).values({
      actorUserId: request.auth!.userId,
      action: "message.reported",
      targetType: body.messageId ? "message" : "conversation",
      targetId: body.messageId ?? body.conversationId,
      requestId: request.id,
      metadata: { reason: body.reason, details: body.details, conversationId: body.conversationId },
    }).returning({ id: auditEvents.id, createdAt: auditEvents.createdAt });
    return reply.code(201).send(report);
  });
};
