import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, gt, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  auditEvents,
  circleBans,
  circleInvitations,
  circleJoinRequests,
  circleMemberships,
  circleMessagePins,
  circleMessages,
  circleOwnershipTransfers,
  domainMedia,
  outboxEvents,
  pawCircles,
  pawCircleUserStates,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { getPost } from "../feed/service.js";
import { getReadyMediaReadModel, requireReadyOwnedAssets } from "../media/service.js";
import { createNotification } from "../notifications/routes.js";

const circleParams = z.object({ circleId: z.uuid() });
const requestParams = z.object({ requestId: z.uuid() });
const invitationParams = z.object({ invitationId: z.uuid() });
const transferParams = z.object({ transferId: z.uuid() });
const messageParams = z.object({ messageId: z.uuid() });
const circleUserParams = z.object({ circleId: z.uuid(), userId: z.uuid() });
const slugify = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)}-${crypto.randomUUID().slice(0, 6)}`;

async function membership(circleId: string, userId: string) {
  const [row] = await db.select().from(circleMemberships)
    .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, userId))).limit(1);
  return row;
}

async function requireActiveMember(circleId: string, userId: string) {
  const row = await membership(circleId, userId);
  if (!row || row.status !== "active") throw new AppError(403, "CIRCLE_MEMBERSHIP_REQUIRED", "Active circle membership is required.");
  return row;
}

async function requireCircleManager(circleId: string, userId: string) {
  const row = await requireActiveMember(circleId, userId);
  if (!["owner", "admin"].includes(row.role)) throw new AppError(403, "CIRCLE_ADMIN_REQUIRED", "Circle admin role is required.");
  return row;
}

async function circleModel(circleId: string, viewerUserId: string | null) {
  const [circle] = await db.select().from(pawCircles)
    .where(and(eq(pawCircles.id, circleId), eq(pawCircles.status, "active"))).limit(1);
  if (!circle) throw new AppError(404, "CIRCLE_NOT_FOUND", "Paw Circle was not found.");
  const relation = viewerUserId ? await membership(circleId, viewerUserId) : null;
  if (circle.visibility === "hidden" && !relation) throw new AppError(404, "CIRCLE_NOT_FOUND", "Paw Circle was not found.");
  const [members] = await db.select({ value: count() }).from(circleMemberships)
    .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.status, "active")));
  return {
    ...circle,
    icon: circle.iconAssetId ? await getReadyMediaReadModel(circle.iconAssetId).catch(() => null) : null,
    memberCount: members?.value ?? 0,
    relationship: relation?.status ?? "none",
    viewerRole: relation?.role ?? null,
  };
}

async function submitJoinRequest(circleId: string, userId: string, note?: string) {
  const [ban] = await db.select().from(circleBans)
    .where(and(eq(circleBans.circleId, circleId), eq(circleBans.userId, userId), isNull(circleBans.removedAt))).limit(1);
  if (ban) throw new AppError(403, "CIRCLE_MEMBERSHIP_BANNED", "You cannot join this Paw Circle.");
  const model = await circleModel(circleId, userId);
  if (model.privacy === "open") {
    await db.insert(circleMemberships).values({ circleId, userId }).onConflictDoUpdate({
      target: [circleMemberships.circleId, circleMemberships.userId],
      set: { status: "active", role: "member", joinedAt: new Date(), leftAt: null },
    });
  } else {
    await db.insert(circleJoinRequests).values({ circleId, requesterUserId: userId, note }).onConflictDoUpdate({
      target: [circleJoinRequests.circleId, circleJoinRequests.requesterUserId],
      set: { status: "pending", note, reviewedAt: null, reviewedByUserId: null, updatedAt: new Date() },
    });
  }
  return circleModel(circleId, userId);
}

async function resolveJoinRequest(requestId: string, reviewerUserId: string, approved: boolean) {
  const [joinRequest] = await db.select().from(circleJoinRequests).where(eq(circleJoinRequests.id, requestId)).limit(1);
  if (!joinRequest) throw new AppError(404, "JOIN_REQUEST_NOT_FOUND", "Join request was not found.");
  await requireCircleManager(joinRequest.circleId, reviewerUserId);
  const [updated] = await db.update(circleJoinRequests).set({
    status: approved ? "approved" : "declined",
    reviewedByUserId: reviewerUserId,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(circleJoinRequests.id, requestId), eq(circleJoinRequests.status, "pending"))).returning();
  if (!updated) throw new AppError(409, "JOIN_REQUEST_NOT_PENDING", "Join request is no longer pending.");
  if (approved) {
    await db.transaction(async (tx) => {
      await tx.insert(circleMemberships).values({ circleId: joinRequest.circleId, userId: joinRequest.requesterUserId })
        .onConflictDoUpdate({
          target: [circleMemberships.circleId, circleMemberships.userId],
          set: { status: "active", role: "member", joinedAt: new Date(), leftAt: null },
        });
      await tx.insert(circleMessages).values({
        circleId: joinRequest.circleId,
        type: "system",
        text: "A new member joined.",
        metadata: { eventType: "circle.join_request_approved", targetUserId: joinRequest.requesterUserId },
      });
    });
  }
  await createNotification({
    userId: joinRequest.requesterUserId,
    type: approved ? "circle_join_approved" : "circle_join_declined",
    title: approved ? "Paw Circle request approved" : "Paw Circle request declined",
    body: approved ? "You can now join the circle chat." : "Your request was not approved.",
    targetType: "paw_circle",
    targetId: joinRequest.circleId,
  });
  return { approved };
}

async function messageModel(messageId: string) {
  const [message] = await db.select({
    message: circleMessages,
    senderDisplayName: userProfiles.displayName,
    senderHandle: userProfiles.handle,
  }).from(circleMessages)
    .leftJoin(userProfiles, eq(userProfiles.userId, circleMessages.senderUserId))
    .where(eq(circleMessages.id, messageId)).limit(1);
  if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
  const mediaRows = await db.select().from(domainMedia)
    .where(and(eq(domainMedia.targetType, "circle_message"), eq(domainMedia.targetId, messageId), isNull(domainMedia.removedAt)))
    .orderBy(domainMedia.position);
  return {
    ...message.message,
    senderDisplayName: message.senderDisplayName,
    senderHandle: message.senderHandle,
    media: await Promise.all(mediaRows.map(async (row) => ({
      assetId: row.assetId,
      role: row.role,
      position: row.position,
      ...(await getReadyMediaReadModel(row.assetId)),
    }))),
  };
}

export const circleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/paw-circles/onboarding", { preHandler: app.authenticate }, async (request) => {
    const [state] = await db.select().from(pawCircleUserStates)
      .where(eq(pawCircleUserStates.userId, request.auth!.userId)).limit(1);
    return { completed: Boolean(state?.onboardingCompletedAt), completedAt: state?.onboardingCompletedAt ?? null };
  });

  app.post("/v1/paw-circles/onboarding/complete", { preHandler: app.authenticate }, async (request) => {
    const now = new Date();
    const [state] = await db.insert(pawCircleUserStates).values({
      userId: request.auth!.userId,
      onboardingCompletedAt: now,
    }).onConflictDoUpdate({
      target: pawCircleUserStates.userId,
      set: { onboardingCompletedAt: now, updatedAt: now },
    }).returning();
    return { completed: true, completedAt: state!.onboardingCompletedAt };
  });

  app.get("/v1/paw-circles/summary", { preHandler: app.authenticate }, async (request) => {
    const userId = request.auth!.userId;
    const [circleCount, pendingRequests, pendingInvitations, unread] = await Promise.all([
      db.select({ value: count() }).from(circleMemberships).where(and(eq(circleMemberships.userId, userId), eq(circleMemberships.status, "active"))),
      db.select({ value: count() }).from(circleJoinRequests)
        .innerJoin(circleMemberships, eq(circleMemberships.circleId, circleJoinRequests.circleId))
        .where(and(eq(circleMemberships.userId, userId), inArray(circleMemberships.role, ["owner", "admin"]), eq(circleJoinRequests.status, "pending"))),
      db.select({ value: count() }).from(circleInvitations)
        .where(and(eq(circleInvitations.invitedUserId, userId), eq(circleInvitations.status, "pending"), gt(circleInvitations.expiresAt, new Date()))),
      db.select({ value: count() }).from(circleMessages)
        .innerJoin(circleMemberships, eq(circleMemberships.circleId, circleMessages.circleId))
        .where(and(eq(circleMemberships.userId, userId), eq(circleMemberships.status, "active"), isNull(circleMessages.deletedAt), sql`${circleMessages.createdAt} > coalesce(${circleMemberships.lastReadAt}, to_timestamp(0))`)),
    ]);
    return {
      circleCount: circleCount[0]?.value ?? 0,
      pendingJoinRequests: pendingRequests[0]?.value ?? 0,
      pendingInvitations: pendingInvitations[0]?.value ?? 0,
      unreadMessages: unread[0]?.value ?? 0,
    };
  });

  app.post("/v1/paw-circles", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      name: z.string().trim().min(3).max(80),
      bio: z.string().trim().max(500).optional(),
      locationLabel: z.string().trim().max(120).optional(),
      privacy: z.enum(["open", "request"]).default("open"),
      visibility: z.enum(["discoverable", "hidden"]).default("discoverable"),
      themeTint: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      iconAssetId: z.uuid().optional(),
    }).parse(request.body);
    if (body.iconAssetId) await requireReadyOwnedAssets(request.auth!.userId, [body.iconAssetId]);
    const id = await db.transaction(async (tx) => {
      const [circle] = await tx.insert(pawCircles).values({
        ownerUserId: request.auth!.userId,
        name: body.name,
        slug: slugify(body.name),
        bio: body.bio,
        locationLabel: body.locationLabel,
        privacy: body.privacy,
        visibility: body.visibility,
        themeTint: body.themeTint,
        iconAssetId: body.iconAssetId,
      }).returning({ id: pawCircles.id });
      if (!circle) throw new AppError(500, "CIRCLE_CREATE_FAILED", "Paw Circle was not created.");
      await tx.insert(circleMemberships).values({ circleId: circle.id, userId: request.auth!.userId, role: "owner" });
      await tx.insert(circleMessages).values({ circleId: circle.id, type: "system", text: `${body.name} was created.`, metadata: { eventType: "circle.created" } });
      await tx.insert(outboxEvents).values({ aggregateType: "paw_circle", aggregateId: circle.id, eventType: "circle.created", payload: { circleId: circle.id } });
      return circle.id;
    });
    return reply.code(201).send(await circleModel(id, request.auth!.userId));
  });

  app.get("/v1/paw-circles", { preHandler: app.authenticate }, async (request) => {
    const rows = await db.select({ id: pawCircles.id }).from(circleMemberships)
      .innerJoin(pawCircles, eq(pawCircles.id, circleMemberships.circleId))
      .where(and(eq(circleMemberships.userId, request.auth!.userId), eq(circleMemberships.status, "active"), eq(pawCircles.status, "active")))
      .orderBy(pawCircles.name);
    return { circles: await Promise.all(rows.map((row) => circleModel(row.id, request.auth!.userId))) };
  });

  app.get("/v1/paw-circles/explore", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ query: z.string().max(100).optional() }).parse(request.query);
    const conditions = [eq(pawCircles.status, "active"), eq(pawCircles.visibility, "discoverable")];
    if (query.query) conditions.push(ilike(pawCircles.name, `%${query.query}%`));
    const rows = await db.select({ id: pawCircles.id }).from(pawCircles).where(and(...conditions)).limit(50);
    return { circles: await Promise.all(rows.map((row) => circleModel(row.id, request.auth!.userId))) };
  });

  app.get("/v1/paw-circles/:circleId", { preHandler: app.optionalAuthenticate }, async (request) =>
    circleModel(circleParams.parse(request.params).circleId, request.auth?.userId ?? null));

  app.patch("/v1/paw-circles/:circleId", { preHandler: app.authenticate }, async (request) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireCircleManager(circleId, request.auth!.userId);
    const body = z.object({
      version: z.number().int().positive(),
      name: z.string().trim().min(3).max(80).optional(),
      bio: z.string().trim().max(500).nullable().optional(),
      locationLabel: z.string().trim().max(120).nullable().optional(),
      privacy: z.enum(["open", "request"]).optional(),
      visibility: z.enum(["discoverable", "hidden"]).optional(),
      themeTint: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
      iconAssetId: z.uuid().nullable().optional(),
    }).refine((value) => Object.keys(value).some((key) => key !== "version"), { message: "At least one circle field is required." }).parse(request.body);
    if (body.iconAssetId) await requireReadyOwnedAssets(request.auth!.userId, [body.iconAssetId]);
    const [updated] = await db.update(pawCircles).set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.bio !== undefined && { bio: body.bio || null }),
      ...(body.locationLabel !== undefined && { locationLabel: body.locationLabel || null }),
      ...(body.privacy !== undefined && { privacy: body.privacy }),
      ...(body.visibility !== undefined && { visibility: body.visibility }),
      ...(body.themeTint !== undefined && { themeTint: body.themeTint }),
      ...(body.iconAssetId !== undefined && { iconAssetId: body.iconAssetId }),
      version: sql`${pawCircles.version} + 1`,
      updatedAt: new Date(),
    }).where(and(eq(pawCircles.id, circleId), eq(pawCircles.version, body.version), eq(pawCircles.status, "active"))).returning();
    if (!updated) throw new AppError(409, "CIRCLE_VERSION_CONFLICT", "Circle settings changed on another device.");
    return circleModel(circleId, request.auth!.userId);
  });

  app.delete("/v1/paw-circles/:circleId", { preHandler: app.authenticate }, async (request, reply) => {
    const circleId = circleParams.parse(request.params).circleId;
    const current = await requireActiveMember(circleId, request.auth!.userId);
    if (current.role !== "owner") throw new AppError(403, "CIRCLE_OWNER_REQUIRED", "Only the owner can delete this Paw Circle.");
    await db.update(pawCircles).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(pawCircles.id, circleId));
    await db.insert(auditEvents).values({ actorUserId: request.auth!.userId, action: "circle.deleted", targetType: "paw_circle", targetId: circleId });
    return reply.code(204).send();
  });

  app.post("/v1/paw-circles/:circleId/join", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    return submitJoinRequest(circleParams.parse(request.params).circleId, request.auth!.userId, body.note);
  });

  app.post("/v1/paw-circles/:circleId/join-requests", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    return submitJoinRequest(circleParams.parse(request.params).circleId, request.auth!.userId, body.note);
  });

  const leaveCircle = async (circleId: string, userId: string) => {
    const current = await requireActiveMember(circleId, userId);
    if (current.role === "owner") throw new AppError(409, "CIRCLE_OWNER_CANNOT_LEAVE", "Transfer ownership before leaving this circle.");
    await db.update(circleMemberships).set({ status: "left", leftAt: new Date() })
      .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, userId)));
  };

  app.post("/v1/paw-circles/:circleId/leave", { preHandler: app.authenticate }, async (request, reply) => {
    await leaveCircle(circleParams.parse(request.params).circleId, request.auth!.userId);
    return reply.code(204).send();
  });

  app.delete("/v1/paw-circles/:circleId/membership", { preHandler: app.authenticate }, async (request, reply) => {
    await leaveCircle(circleParams.parse(request.params).circleId, request.auth!.userId);
    return reply.code(204).send();
  });

  app.delete("/v1/paw-circles/:circleId/join-requests/me", { preHandler: app.authenticate }, async (request, reply) => {
    await db.update(circleJoinRequests).set({ status: "cancelled", updatedAt: new Date() }).where(and(
      eq(circleJoinRequests.circleId, circleParams.parse(request.params).circleId),
      eq(circleJoinRequests.requesterUserId, request.auth!.userId),
      eq(circleJoinRequests.status, "pending"),
    ));
    return reply.code(204).send();
  });

  app.get("/v1/paw-circles/:circleId/join-requests", { preHandler: app.authenticate }, async (request) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireCircleManager(circleId, request.auth!.userId);
    return {
      requests: await db.select({
        request: circleJoinRequests,
        displayName: userProfiles.displayName,
        handle: userProfiles.handle,
      }).from(circleJoinRequests)
        .innerJoin(userProfiles, eq(userProfiles.userId, circleJoinRequests.requesterUserId))
        .where(and(eq(circleJoinRequests.circleId, circleId), eq(circleJoinRequests.status, "pending"))),
    };
  });

  app.post("/v1/paw-circle-join-requests/:requestId/approve", { preHandler: app.authenticate }, async (request) =>
    resolveJoinRequest(requestParams.parse(request.params).requestId, request.auth!.userId, true));
  app.post("/v1/paw-circle-join-requests/:requestId/decline", { preHandler: app.authenticate }, async (request) =>
    resolveJoinRequest(requestParams.parse(request.params).requestId, request.auth!.userId, false));

  app.post("/v1/paw-circles/:circleId/join-requests/approve-batch", { preHandler: app.authenticate }, async (request) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireCircleManager(circleId, request.auth!.userId);
    const body = z.object({ requestIds: z.array(z.uuid()).min(1).max(100) }).parse(request.body);
    const requests = await db.select({ id: circleJoinRequests.id }).from(circleJoinRequests)
      .where(and(eq(circleJoinRequests.circleId, circleId), eq(circleJoinRequests.status, "pending"), inArray(circleJoinRequests.id, body.requestIds)));
    for (const item of requests) await resolveJoinRequest(item.id, request.auth!.userId, true);
    return { approvedCount: requests.length };
  });

  app.get("/v1/paw-circles/:circleId/members", { preHandler: app.authenticate }, async (request) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireActiveMember(circleId, request.auth!.userId);
    return {
      members: await db.select({
        userId: circleMemberships.userId,
        role: circleMemberships.role,
        joinedAt: circleMemberships.joinedAt,
        displayName: userProfiles.displayName,
        handle: userProfiles.handle,
      }).from(circleMemberships)
        .innerJoin(userProfiles, eq(userProfiles.userId, circleMemberships.userId))
        .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.status, "active")))
        .orderBy(circleMemberships.joinedAt),
    };
  });

  app.patch("/v1/paw-circles/:circleId/members/:userId", { preHandler: app.authenticate }, async (request) => {
    const { circleId, userId } = circleUserParams.parse(request.params);
    const manager = await requireCircleManager(circleId, request.auth!.userId);
    const body = z.object({ role: z.enum(["admin", "member"]) }).parse(request.body);
    const target = await requireActiveMember(circleId, userId);
    if (target.role === "owner" || (manager.role !== "owner" && body.role === "admin")) {
      throw new AppError(403, "CIRCLE_ROLE_CHANGE_FORBIDDEN", "This role change is not allowed.");
    }
    const [updated] = await db.update(circleMemberships).set({ role: body.role })
      .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, userId))).returning();
    return updated;
  });

  app.delete("/v1/paw-circles/:circleId/members/:userId", { preHandler: app.authenticate }, async (request, reply) => {
    const { circleId, userId } = circleUserParams.parse(request.params);
    await requireCircleManager(circleId, request.auth!.userId);
    const target = await requireActiveMember(circleId, userId);
    if (target.role === "owner") throw new AppError(409, "CIRCLE_OWNER_NOT_REMOVABLE", "The owner cannot be removed.");
    await db.update(circleMemberships).set({ status: "removed", leftAt: new Date() })
      .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, userId)));
    return reply.code(204).send();
  });

  app.post("/v1/paw-circles/:circleId/members/:userId/ban", { preHandler: app.authenticate }, async (request, reply) => {
    const { circleId, userId } = circleUserParams.parse(request.params);
    await requireCircleManager(circleId, request.auth!.userId);
    const target = await membership(circleId, userId);
    if (target?.role === "owner") throw new AppError(409, "CIRCLE_OWNER_NOT_BANNABLE", "The owner cannot be banned.");
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    await db.transaction(async (tx) => {
      await tx.insert(circleBans).values({ circleId, userId, bannedByUserId: request.auth!.userId, reason: body.reason })
        .onConflictDoUpdate({ target: [circleBans.circleId, circleBans.userId], set: { bannedByUserId: request.auth!.userId, reason: body.reason, bannedAt: new Date(), removedAt: null } });
      await tx.update(circleMemberships).set({ status: "banned", leftAt: new Date() })
        .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, userId)));
    });
    return reply.code(204).send();
  });

  app.delete("/v1/paw-circles/:circleId/bans/:userId", { preHandler: app.authenticate }, async (request, reply) => {
    const { circleId, userId } = circleUserParams.parse(request.params);
    await requireCircleManager(circleId, request.auth!.userId);
    await db.update(circleBans).set({ removedAt: new Date() })
      .where(and(eq(circleBans.circleId, circleId), eq(circleBans.userId, userId), isNull(circleBans.removedAt)));
    await db.update(circleMemberships).set({ status: "left" })
      .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, userId), eq(circleMemberships.status, "banned")));
    return reply.code(204).send();
  });

  app.post("/v1/paw-circles/:circleId/invitations", { preHandler: app.authenticate }, async (request, reply) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireCircleManager(circleId, request.auth!.userId);
    const body = z.object({ userId: z.uuid(), message: z.string().trim().max(500).optional() }).parse(request.body);
    const [ban] = await db.select().from(circleBans)
      .where(and(eq(circleBans.circleId, circleId), eq(circleBans.userId, body.userId), isNull(circleBans.removedAt))).limit(1);
    if (ban) throw new AppError(409, "CIRCLE_INVITEE_BANNED", "This user is banned from the circle.");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const [invitation] = await db.insert(circleInvitations).values({
      circleId,
      invitedUserId: body.userId,
      invitedByUserId: request.auth!.userId,
      message: body.message,
      expiresAt,
    }).onConflictDoUpdate({
      target: [circleInvitations.circleId, circleInvitations.invitedUserId],
      set: { invitedByUserId: request.auth!.userId, message: body.message, status: "pending", expiresAt, resolvedAt: null, updatedAt: new Date() },
    }).returning();
    await createNotification({ userId: body.userId, type: "circle_invitation", title: "Paw Circle invitation", body: "You were invited to a Paw Circle.", targetType: "paw_circle", targetId: circleId });
    return reply.code(201).send(invitation);
  });

  app.get("/v1/paw-circle-invitations", { preHandler: app.authenticate }, async (request) => {
    const rows = await db.select().from(circleInvitations)
      .where(and(eq(circleInvitations.invitedUserId, request.auth!.userId), eq(circleInvitations.status, "pending"), gt(circleInvitations.expiresAt, new Date())))
      .orderBy(desc(circleInvitations.createdAt));
    return { invitations: await Promise.all(rows.map(async (item) => ({ ...item, circle: await circleModel(item.circleId, request.auth!.userId) }))) };
  });

  const resolveInvitation = async (invitationId: string, userId: string, accepted: boolean) => {
    const [invitation] = await db.select().from(circleInvitations).where(and(
      eq(circleInvitations.id, invitationId),
      eq(circleInvitations.invitedUserId, userId),
      eq(circleInvitations.status, "pending"),
      gt(circleInvitations.expiresAt, new Date()),
    )).limit(1);
    if (!invitation) throw new AppError(404, "CIRCLE_INVITATION_NOT_FOUND", "Active invitation was not found.");
    await db.transaction(async (tx) => {
      await tx.update(circleInvitations).set({ status: accepted ? "accepted" : "declined", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(circleInvitations.id, invitationId));
      if (accepted) {
        await tx.insert(circleMemberships).values({ circleId: invitation.circleId, userId })
          .onConflictDoUpdate({ target: [circleMemberships.circleId, circleMemberships.userId], set: { status: "active", role: "member", joinedAt: new Date(), leftAt: null } });
      }
    });
    return { accepted };
  };

  app.post("/v1/paw-circle-invitations/:invitationId/accept", { preHandler: app.authenticate }, async (request) =>
    resolveInvitation(invitationParams.parse(request.params).invitationId, request.auth!.userId, true));
  app.post("/v1/paw-circle-invitations/:invitationId/decline", { preHandler: app.authenticate }, async (request) =>
    resolveInvitation(invitationParams.parse(request.params).invitationId, request.auth!.userId, false));

  app.post("/v1/paw-circles/:circleId/ownership-transfers", { preHandler: app.authenticate }, async (request, reply) => {
    const circleId = circleParams.parse(request.params).circleId;
    const current = await requireActiveMember(circleId, request.auth!.userId);
    if (current.role !== "owner") throw new AppError(403, "CIRCLE_OWNER_REQUIRED", "Only the owner can transfer ownership.");
    const body = z.object({ userId: z.uuid() }).parse(request.body);
    await requireActiveMember(circleId, body.userId);
    const [transfer] = await db.insert(circleOwnershipTransfers).values({
      circleId,
      fromUserId: request.auth!.userId,
      toUserId: body.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).returning();
    await createNotification({ userId: body.userId, type: "circle_ownership_transfer", title: "Paw Circle ownership", body: "You were asked to become the circle owner.", targetType: "paw_circle", targetId: circleId });
    return reply.code(201).send(transfer);
  });

  app.post("/v1/paw-circle-ownership-transfers/:transferId/accept", { preHandler: app.authenticate }, async (request) => {
    const transferId = transferParams.parse(request.params).transferId;
    const [transfer] = await db.select().from(circleOwnershipTransfers).where(and(
      eq(circleOwnershipTransfers.id, transferId),
      eq(circleOwnershipTransfers.toUserId, request.auth!.userId),
      eq(circleOwnershipTransfers.status, "pending"),
      gt(circleOwnershipTransfers.expiresAt, new Date()),
    )).limit(1);
    if (!transfer) throw new AppError(404, "CIRCLE_TRANSFER_NOT_FOUND", "Active ownership transfer was not found.");
    await db.transaction(async (tx) => {
      await tx.update(circleMemberships).set({ role: "admin" }).where(and(eq(circleMemberships.circleId, transfer.circleId), eq(circleMemberships.userId, transfer.fromUserId)));
      await tx.update(circleMemberships).set({ role: "owner" }).where(and(eq(circleMemberships.circleId, transfer.circleId), eq(circleMemberships.userId, transfer.toUserId)));
      await tx.update(pawCircles).set({ ownerUserId: transfer.toUserId, updatedAt: new Date(), version: sql`${pawCircles.version} + 1` }).where(eq(pawCircles.id, transfer.circleId));
      await tx.update(circleOwnershipTransfers).set({ status: "accepted", resolvedAt: new Date(), updatedAt: new Date() }).where(eq(circleOwnershipTransfers.id, transferId));
    });
    return { accepted: true };
  });

  app.post("/v1/paw-circle-ownership-transfers/:transferId/cancel", { preHandler: app.authenticate }, async (request) => {
    const transferId = transferParams.parse(request.params).transferId;
    const [updated] = await db.update(circleOwnershipTransfers).set({ status: "cancelled", resolvedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(circleOwnershipTransfers.id, transferId),
      eq(circleOwnershipTransfers.fromUserId, request.auth!.userId),
      eq(circleOwnershipTransfers.status, "pending"),
    )).returning();
    if (!updated) throw new AppError(404, "CIRCLE_TRANSFER_NOT_FOUND", "Active ownership transfer was not found.");
    return { cancelled: true };
  });

  app.get("/v1/paw-circles/:circleId/messages", { preHandler: app.authenticate }, async (request) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireActiveMember(circleId, request.auth!.userId);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100) }).parse(request.query);
    const rows = await db.select({ id: circleMessages.id }).from(circleMessages)
      .where(and(eq(circleMessages.circleId, circleId), isNull(circleMessages.deletedAt)))
      .orderBy(desc(circleMessages.createdAt)).limit(query.limit);
    return { messages: await Promise.all(rows.map((row) => messageModel(row.id))) };
  });

  app.post("/v1/paw-circles/:circleId/messages", { preHandler: app.authenticate }, async (request, reply) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireActiveMember(circleId, request.auth!.userId);
    const body = z.object({
      text: z.string().trim().max(2_000).optional(),
      assetIds: z.array(z.uuid()).max(10).default([]),
      replyToMessageId: z.uuid().optional(),
      clientIdempotencyKey: z.string().min(8).max(100),
    }).refine((value) => Boolean(value.text) || value.assetIds.length > 0, { message: "Message text or media is required." }).parse(request.body);
    await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    const [message] = await db.insert(circleMessages).values({
      circleId,
      senderUserId: request.auth!.userId,
      text: body.text,
      type: body.assetIds.length ? "media" : "text",
      replyToMessageId: body.replyToMessageId,
      clientIdempotencyKey: body.clientIdempotencyKey,
    }).onConflictDoNothing().returning();
    if (!message) {
      const [existing] = await db.select({ id: circleMessages.id }).from(circleMessages).where(and(
        eq(circleMessages.circleId, circleId),
        eq(circleMessages.senderUserId, request.auth!.userId),
        eq(circleMessages.clientIdempotencyKey, body.clientIdempotencyKey),
      )).limit(1);
      return messageModel(existing!.id);
    }
    if (body.assetIds.length) {
      await db.insert(domainMedia).values(body.assetIds.map((assetId, position) => ({
        targetType: "circle_message",
        targetId: message.id,
        assetId,
        role: "attachment",
        position,
      })));
    }
    return reply.code(201).send(await messageModel(message.id));
  });

  app.patch("/v1/paw-circle-messages/:messageId", { preHandler: app.authenticate }, async (request) => {
    const messageId = messageParams.parse(request.params).messageId;
    const [message] = await db.select().from(circleMessages).where(eq(circleMessages.id, messageId)).limit(1);
    if (!message || message.deletedAt) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
    if (message.senderUserId !== request.auth!.userId) throw new AppError(403, "MESSAGE_AUTHOR_REQUIRED", "Only the sender can edit this message.");
    const body = z.object({ text: z.string().trim().min(1).max(2_000) }).parse(request.body);
    await db.update(circleMessages).set({ text: body.text, editedAt: new Date() }).where(eq(circleMessages.id, messageId));
    return messageModel(messageId);
  });

  app.delete("/v1/paw-circle-messages/:messageId", { preHandler: app.authenticate }, async (request, reply) => {
    const messageId = messageParams.parse(request.params).messageId;
    const [message] = await db.select().from(circleMessages).where(eq(circleMessages.id, messageId)).limit(1);
    if (!message || message.deletedAt) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
    const current = await requireActiveMember(message.circleId, request.auth!.userId);
    if (message.senderUserId !== request.auth!.userId && !["owner", "admin"].includes(current.role)) {
      throw new AppError(403, "MESSAGE_DELETE_FORBIDDEN", "You cannot delete this message.");
    }
    await db.update(circleMessages).set({ status: "deleted", deletedAt: new Date(), text: null }).where(eq(circleMessages.id, messageId));
    await db.update(domainMedia).set({ removedAt: new Date() })
      .where(and(eq(domainMedia.targetType, "circle_message"), eq(domainMedia.targetId, messageId), isNull(domainMedia.removedAt)));
    return reply.code(204).send();
  });

  app.post("/v1/paw-circles/:circleId/read", { preHandler: app.authenticate }, async (request, reply) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireActiveMember(circleId, request.auth!.userId);
    const body = z.object({ messageId: z.uuid() }).parse(request.body);
    const [message] = await db.select().from(circleMessages).where(and(eq(circleMessages.id, body.messageId), eq(circleMessages.circleId, circleId))).limit(1);
    if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
    await db.update(circleMemberships).set({ lastReadMessageId: body.messageId, lastReadAt: new Date() })
      .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, request.auth!.userId)));
    return reply.code(204).send();
  });

  app.post("/v1/paw-circle-messages/:messageId/pin", { preHandler: app.authenticate }, async (request, reply) => {
    const messageId = messageParams.parse(request.params).messageId;
    const [message] = await db.select().from(circleMessages).where(eq(circleMessages.id, messageId)).limit(1);
    if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
    await requireCircleManager(message.circleId, request.auth!.userId);
    await db.insert(circleMessagePins).values({ circleId: message.circleId, messageId, pinnedByUserId: request.auth!.userId })
      .onConflictDoUpdate({ target: [circleMessagePins.circleId, circleMessagePins.messageId], set: { removedAt: null, pinnedAt: new Date(), pinnedByUserId: request.auth!.userId } });
    return reply.code(204).send();
  });

  app.delete("/v1/paw-circle-messages/:messageId/pin", { preHandler: app.authenticate }, async (request, reply) => {
    const messageId = messageParams.parse(request.params).messageId;
    const [message] = await db.select().from(circleMessages).where(eq(circleMessages.id, messageId)).limit(1);
    if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
    await requireCircleManager(message.circleId, request.auth!.userId);
    await db.update(circleMessagePins).set({ removedAt: new Date() })
      .where(and(eq(circleMessagePins.circleId, message.circleId), eq(circleMessagePins.messageId, messageId), isNull(circleMessagePins.removedAt)));
    return reply.code(204).send();
  });

  app.get("/v1/paw-circles/:circleId/pins", { preHandler: app.authenticate }, async (request) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireActiveMember(circleId, request.auth!.userId);
    const pins = await db.select().from(circleMessagePins)
      .where(and(eq(circleMessagePins.circleId, circleId), isNull(circleMessagePins.removedAt))).orderBy(desc(circleMessagePins.pinnedAt));
    return { pins: await Promise.all(pins.map(async (pin) => ({ ...pin, message: await messageModel(pin.messageId) }))) };
  });

  app.get("/v1/paw-circles/:circleId/media", { preHandler: app.authenticate }, async (request) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireActiveMember(circleId, request.auth!.userId);
    const rows = await db.select({ messageId: circleMessages.id, media: domainMedia }).from(circleMessages)
      .innerJoin(domainMedia, and(eq(domainMedia.targetType, "circle_message"), eq(domainMedia.targetId, circleMessages.id)))
      .where(and(eq(circleMessages.circleId, circleId), isNull(circleMessages.deletedAt), isNull(domainMedia.removedAt)))
      .orderBy(desc(circleMessages.createdAt));
    return { media: await Promise.all(rows.map(async (row) => ({ messageId: row.messageId, ...row.media, ...(await getReadyMediaReadModel(row.media.assetId)) }))) };
  });

  app.post("/v1/paw-circles/:circleId/share-post", { preHandler: app.authenticate }, async (request, reply) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireActiveMember(circleId, request.auth!.userId);
    const body = z.object({ postId: z.uuid(), text: z.string().trim().max(1_000).optional(), clientIdempotencyKey: z.string().min(8).max(100) }).parse(request.body);
    await getPost(body.postId, request.auth!.userId);
    const [message] = await db.insert(circleMessages).values({
      circleId,
      senderUserId: request.auth!.userId,
      type: "shared_post",
      text: body.text,
      sourcePostId: body.postId,
      clientIdempotencyKey: body.clientIdempotencyKey,
    }).onConflictDoNothing().returning();
    if (!message) {
      const [existing] = await db.select({ id: circleMessages.id }).from(circleMessages).where(and(
        eq(circleMessages.circleId, circleId),
        eq(circleMessages.senderUserId, request.auth!.userId),
        eq(circleMessages.clientIdempotencyKey, body.clientIdempotencyKey),
      )).limit(1);
      return messageModel(existing!.id);
    }
    return reply.code(201).send(await messageModel(message.id));
  });

  app.get("/v1/paw-circles/:circleId/notification-preferences", { preHandler: app.authenticate }, async (request) => {
    const member = await requireActiveMember(circleParams.parse(request.params).circleId, request.auth!.userId);
    return { mutedUntil: member.mutedUntil };
  });

  app.patch("/v1/paw-circles/:circleId/notification-preferences", { preHandler: app.authenticate }, async (request) => {
    const circleId = circleParams.parse(request.params).circleId;
    await requireActiveMember(circleId, request.auth!.userId);
    const body = z.object({ mutedUntil: z.coerce.date().nullable() }).parse(request.body);
    const [updated] = await db.update(circleMemberships).set({ mutedUntil: body.mutedUntil })
      .where(and(eq(circleMemberships.circleId, circleId), eq(circleMemberships.userId, request.auth!.userId))).returning();
    return { mutedUntil: updated!.mutedUntil };
  });

  app.post("/v1/paw-circles/:circleId/reports", { preHandler: app.authenticate }, async (request, reply) => {
    const circleId = circleParams.parse(request.params).circleId;
    const body = z.object({ reason: z.string().trim().min(3).max(500), details: z.string().trim().max(2_000).optional() }).parse(request.body);
    const [report] = await db.insert(auditEvents).values({
      actorUserId: request.auth!.userId,
      action: "circle.reported",
      targetType: "paw_circle",
      targetId: circleId,
      metadata: body,
    }).returning();
    return reply.code(201).send(report);
  });

  app.post("/v1/paw-circle-messages/:messageId/reports", { preHandler: app.authenticate }, async (request, reply) => {
    const messageId = messageParams.parse(request.params).messageId;
    const [message] = await db.select().from(circleMessages).where(eq(circleMessages.id, messageId)).limit(1);
    if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
    await requireActiveMember(message.circleId, request.auth!.userId);
    const body = z.object({ reason: z.string().trim().min(3).max(500), details: z.string().trim().max(2_000).optional() }).parse(request.body);
    const [report] = await db.insert(auditEvents).values({
      actorUserId: request.auth!.userId,
      action: "circle_message.reported",
      targetType: "circle_message",
      targetId: messageId,
      metadata: body,
    }).returning();
    return reply.code(201).send(report);
  });
};
