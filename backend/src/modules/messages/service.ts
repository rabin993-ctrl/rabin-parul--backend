import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  accounts,
  conversationParticipants,
  conversations,
  directConversationPairs,
  messageAttachments,
  messages,
  userBlocks,
  userPrivacySettings,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { getReadyMediaReadModel, requireReadyOwnedAssets } from "../media/service.js";
import { createNotification } from "../notifications/routes.js";

async function blocked(a: string, b: string) {
  const [row] = await db.select({ blocker: userBlocks.blockerUserId }).from(userBlocks).where(and(
    isNull(userBlocks.removedAt),
    or(
      and(eq(userBlocks.blockerUserId, a), eq(userBlocks.blockedUserId, b)),
      and(eq(userBlocks.blockerUserId, b), eq(userBlocks.blockedUserId, a)),
    ),
  )).limit(1);
  return Boolean(row);
}

async function messageModel(messageId: string) {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
  const attachments = await db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .orderBy(messageAttachments.position);
  return {
    ...message,
    attachments: await Promise.all(attachments.map(async (attachment) => ({
      ...attachment,
      ...(await getReadyMediaReadModel(attachment.assetId)),
    }))),
  };
}

export async function createOrGetDirectConversation(senderUserId: string, recipientUserId: string) {
  if (senderUserId === recipientUserId) throw new AppError(400, "INVALID_RECIPIENT", "You cannot message yourself.");
  const [recipient] = await db
    .select({ status: accounts.status, messagePolicy: userPrivacySettings.messagePolicy })
    .from(accounts).innerJoin(userPrivacySettings, eq(userPrivacySettings.userId, accounts.id))
    .where(eq(accounts.id, recipientUserId)).limit(1);
  if (!recipient || recipient.status !== "active") throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
  if (await blocked(senderUserId, recipientUserId)) throw new AppError(403, "MESSAGE_NOT_ALLOWED", "Messaging is not allowed.");
  if (recipient.messagePolicy !== "everyone") throw new AppError(403, "MESSAGE_NOT_ALLOWED", "Recipient does not accept new messages.");

  const [lowerUserId, higherUserId] = [senderUserId, recipientUserId].sort();
  const [existing] = await db.select({ id: conversations.id }).from(directConversationPairs)
    .innerJoin(conversations, eq(conversations.id, directConversationPairs.conversationId))
    .where(and(eq(directConversationPairs.lowerUserId, lowerUserId!), eq(directConversationPairs.higherUserId, higherUserId!))).limit(1);
  if (existing) return getConversation(existing.id, senderUserId);

  const conversationId = await db.transaction(async (tx) => {
    const [conversation] = await tx.insert(conversations).values({ type: "direct", createdByUserId: senderUserId }).returning({ id: conversations.id });
    if (!conversation) throw new AppError(500, "CONVERSATION_CREATE_FAILED", "Conversation was not created.");
    await tx.insert(directConversationPairs).values({ conversationId: conversation.id, lowerUserId: lowerUserId!, higherUserId: higherUserId! });
    await tx.insert(conversationParticipants).values([
      { conversationId: conversation.id, userId: senderUserId, requestState: "accepted" },
      { conversationId: conversation.id, userId: recipientUserId, requestState: "accepted" },
    ]);
    return conversation.id;
  });
  return getConversation(conversationId, senderUserId);
}

export async function createDomainConversation(input: {
  type: string;
  domainType: string;
  domainId: string;
  creatorUserId: string;
  participantUserIds: string[];
}) {
  const [existing] = await db.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.type, input.type), eq(conversations.domainType, input.domainType), eq(conversations.domainId, input.domainId))).limit(1);
  if (existing) return existing.id;
  return db.transaction(async (tx) => {
    const [conversation] = await tx.insert(conversations).values({
      type: input.type,
      domainType: input.domainType,
      domainId: input.domainId,
      createdByUserId: input.creatorUserId,
    }).returning({ id: conversations.id });
    if (!conversation) throw new AppError(500, "CONVERSATION_CREATE_FAILED", "Conversation was not created.");
    await tx.insert(conversationParticipants).values([...new Set(input.participantUserIds)].map((userId) => ({ conversationId: conversation.id, userId })));
    return conversation.id;
  });
}

export async function requireParticipant(conversationId: string, userId: string) {
  const [participant] = await db.select().from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId), eq(conversationParticipants.state, "active"))).limit(1);
  if (!participant) throw new AppError(403, "CONVERSATION_ACCESS_FORBIDDEN", "You cannot access this conversation.");
  return participant;
}

export async function getConversation(conversationId: string, userId: string) {
  await requireParticipant(conversationId, userId);
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
  const participants = await db.select({
    userId: conversationParticipants.userId,
    state: conversationParticipants.state,
    requestState: conversationParticipants.requestState,
    displayName: userProfiles.displayName,
    handle: userProfiles.handle,
  }).from(conversationParticipants).innerJoin(userProfiles, eq(userProfiles.userId, conversationParticipants.userId))
    .where(eq(conversationParticipants.conversationId, conversationId));
  return { ...conversation, participants, viewer: participants.find((item) => item.userId === userId) };
}

export async function listConversations(userId: string, type?: string | undefined) {
  const conditions = [eq(conversationParticipants.userId, userId), eq(conversationParticipants.state, "active"), isNull(conversationParticipants.archivedAt)];
  if (type) conditions.push(eq(conversations.type, type));
  const rows = await db.select({ id: conversations.id }).from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(and(...conditions)).orderBy(desc(conversations.lastActivityAt)).limit(100);
  return Promise.all(rows.map((row) => getConversation(row.id, userId)));
}

export async function sendMessage(input: {
  conversationId: string;
  senderUserId: string;
  type: "text" | "image" | "video" | "file";
  text?: string | null | undefined;
  assetIds: string[];
  clientIdempotencyKey: string;
}) {
  await requireParticipant(input.conversationId, input.senderUserId);
  if (!input.text?.trim() && input.assetIds.length === 0) throw new AppError(400, "MESSAGE_CONTENT_REQUIRED", "Message text or attachment is required.");
  await requireReadyOwnedAssets(input.senderUserId, input.assetIds);

  const [existing] = await db.select().from(messages).where(and(
    eq(messages.conversationId, input.conversationId),
    eq(messages.senderUserId, input.senderUserId),
    eq(messages.clientIdempotencyKey, input.clientIdempotencyKey),
  )).limit(1);
  if (existing) return messageModel(existing.id);

  const message = await db.transaction(async (tx) => {
    const [created] = await tx.insert(messages).values({
      conversationId: input.conversationId,
      senderUserId: input.senderUserId,
      type: input.type,
      text: input.text?.trim() || null,
      clientIdempotencyKey: input.clientIdempotencyKey,
    }).returning();
    if (!created) throw new AppError(500, "MESSAGE_CREATE_FAILED", "Message was not created.");
    if (input.assetIds.length) {
      await tx.insert(messageAttachments).values(input.assetIds.map((assetId, position) => ({ messageId: created.id, assetId, attachmentType: input.type, position })));
    }
    await tx.update(conversations).set({ lastMessageId: created.id, lastActivityAt: created.createdAt, updatedAt: created.createdAt }).where(eq(conversations.id, input.conversationId));
    return created;
  });

  const recipients = await db.select({ userId: conversationParticipants.userId }).from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, input.conversationId), eq(conversationParticipants.state, "active")));
  await Promise.all(recipients.filter((item) => item.userId !== input.senderUserId).map((item) => createNotification({
    userId: item.userId,
    type: "message",
    title: "New message",
    body: input.text?.trim().slice(0, 120) || "Sent an attachment",
    actorUserId: input.senderUserId,
    targetType: "conversation",
    targetId: input.conversationId,
    deduplicationKey: `message:${message.id}:${item.userId}`,
  })));
  return messageModel(message.id);
}

export async function listMessages(conversationId: string, userId: string, limit: number) {
  await requireParticipant(conversationId, userId);
  const rows = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conversationId), isNull(messages.removedAt)))
    .orderBy(desc(messages.createdAt)).limit(limit);
  return Promise.all(rows.map((row) => messageModel(row.id)));
}

export async function markConversationRead(conversationId: string, userId: string, messageId?: string | undefined) {
  await requireParticipant(conversationId, userId);
  const [latest] = messageId
    ? await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId))).limit(1)
    : await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.createdAt)).limit(1);
  await db.update(conversationParticipants).set({ lastReadMessageId: latest?.id ?? null, lastReadAt: new Date(), updatedAt: new Date() })
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)));
}
