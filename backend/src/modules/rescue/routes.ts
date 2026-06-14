import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  auditEvents,
  conversationParticipants,
  conversations,
  domainMedia,
  outboxEvents,
  postAssets,
  posts,
  rescueCaseFollowers,
  rescueCaseUpdates,
  rescueCases,
  rescueHelpOffers,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { getReadyMediaReadModel, requireReadyOwnedAssets } from "../media/service.js";
import { createNotification } from "../notifications/routes.js";

const caseParams = z.object({ caseId: z.uuid() });
const offerParams = z.object({ offerId: z.uuid() });
const updateParams = z.object({ updateId: z.uuid() });
const userParams = z.object({ userId: z.uuid() });
const postParams = z.object({ postId: z.uuid() });
const publicNumber = () => `RC-${new Date().getUTCFullYear()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;

async function mediaFor(targetType: string, targetId: string) {
  const rows = await db.select().from(domainMedia).where(and(
    eq(domainMedia.targetType, targetType),
    eq(domainMedia.targetId, targetId),
    isNull(domainMedia.removedAt),
  )).orderBy(domainMedia.position);
  return Promise.all(rows.map(async (row) => ({
    assetId: row.assetId,
    role: row.role,
    position: row.position,
    ...(await getReadyMediaReadModel(row.assetId)),
  })));
}

async function updateModel(updateId: string) {
  const [update] = await db.select().from(rescueCaseUpdates).where(eq(rescueCaseUpdates.id, updateId)).limit(1);
  if (!update || update.deletedAt) throw new AppError(404, "RESCUE_UPDATE_NOT_FOUND", "Rescue update was not found.");
  return { ...update, media: await mediaFor("rescue_update", updateId) };
}

async function caseModel(caseId: string, viewerUserId: string | null) {
  const [row] = await db.select({
    rescueCase: rescueCases,
    ownerName: userProfiles.displayName,
    ownerHandle: userProfiles.handle,
    ownerAvatarMediaId: userProfiles.avatarMediaId,
  }).from(rescueCases)
    .innerJoin(userProfiles, eq(userProfiles.userId, rescueCases.ownerUserId))
    .where(eq(rescueCases.id, caseId))
    .limit(1);
  const rescueCase = row?.rescueCase;
  if (!rescueCase || (rescueCase.archivedAt && rescueCase.ownerUserId !== viewerUserId) || (rescueCase.visibility === "only_me" && rescueCase.ownerUserId !== viewerUserId)) throw new AppError(404, "RESCUE_CASE_NOT_FOUND", "Rescue case was not found.");
  const [[followers], [updates], [follow]] = await Promise.all([
    db.select({ value: count() }).from(rescueCaseFollowers).where(and(eq(rescueCaseFollowers.caseId, caseId), isNull(rescueCaseFollowers.unfollowedAt))),
    db.select({ value: count() }).from(rescueCaseUpdates).where(and(eq(rescueCaseUpdates.caseId, caseId), isNull(rescueCaseUpdates.deletedAt))),
    viewerUserId ? db.select().from(rescueCaseFollowers).where(and(eq(rescueCaseFollowers.caseId, caseId), eq(rescueCaseFollowers.userId, viewerUserId), isNull(rescueCaseFollowers.unfollowedAt))).limit(1) : Promise.resolve([]),
  ]);
  return {
    ...rescueCase,
    owner: {
      id: rescueCase.ownerUserId,
      displayName: row!.ownerName,
      handle: row!.ownerHandle,
      avatarMediaId: row!.ownerAvatarMediaId,
    },
    media: await mediaFor("rescue_case", caseId),
    counters: { followers: followers?.value ?? 0, updates: updates?.value ?? 0 },
    viewer: {
      isOwner: rescueCase.ownerUserId === viewerUserId,
      isFollowing: Boolean(follow),
      canHelp: Boolean(viewerUserId && rescueCase.ownerUserId !== viewerUserId && rescueCase.status !== "resolved"),
      canUpdate: rescueCase.ownerUserId === viewerUserId && !rescueCase.archivedAt,
    },
  };
}

export const rescueRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/rescue-cases", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      animalName: z.string().trim().min(1).max(80), species: z.enum(["dog", "cat", "other"]),
      headline: z.string().trim().min(5).max(140), originalStory: z.string().trim().min(12).max(5_000),
      status: z.enum(["needs_help", "under_treatment"]).default("needs_help"),
      publicLocationLabel: z.string().trim().min(1).max(120), visibility: z.enum(["everyone", "circles", "only_me"]).default("everyone"),
      latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
      assetIds: z.array(z.uuid()).min(1).max(3),
    }).parse(request.body);
    await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    const id = await db.transaction(async (tx) => {
      const [created] = await tx.insert(rescueCases).values({ publicCaseNumber: publicNumber(), ownerUserId: request.auth!.userId, animalName: body.animalName, species: body.species, headline: body.headline, originalStory: body.originalStory, status: body.status, publicLocationLabel: body.publicLocationLabel, visibility: body.visibility, privateLatitude: body.latitude, privateLongitude: body.longitude, locationPrecision: body.latitude == null ? "area" : "exact_private" }).returning({ id: rescueCases.id });
      if (!created) throw new AppError(500, "RESCUE_CASE_CREATE_FAILED", "Rescue case was not created.");
      await tx.insert(rescueCaseUpdates).values({ caseId: created.id, authorUserId: request.auth!.userId, text: body.originalStory, statusAfter: body.status });
      await tx.insert(domainMedia).values(body.assetIds.map((assetId, position) => ({ targetType: "rescue_case", targetId: created.id, assetId, role: position === 0 ? "cover" : "evidence", position })));
      await tx.insert(outboxEvents).values({ aggregateType: "rescue_case", aggregateId: created.id, eventType: "rescue.case_created", payload: { caseId: created.id } });
      return created.id;
    });
    return reply.code(201).send(await caseModel(id, request.auth!.userId));
  });
  app.get("/v1/rescue-cases", { preHandler: app.optionalAuthenticate }, async (request) => {
    const query = z.object({ view: z.enum(["browse", "following", "mine"]).default("browse"), status: z.string().optional(), query: z.string().max(100).optional() }).parse(request.query);
    if (query.view !== "browse" && !request.auth) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
    let rows;
    if (query.view === "mine") rows = await db.select({ id: rescueCases.id }).from(rescueCases).where(eq(rescueCases.ownerUserId, request.auth!.userId)).orderBy(desc(rescueCases.createdAt));
    else if (query.view === "following") rows = await db.select({ id: rescueCases.id }).from(rescueCaseFollowers).innerJoin(rescueCases, eq(rescueCases.id, rescueCaseFollowers.caseId)).where(and(eq(rescueCaseFollowers.userId, request.auth!.userId), isNull(rescueCaseFollowers.unfollowedAt))).orderBy(desc(rescueCases.createdAt));
    else {
      const conditions = [isNull(rescueCases.archivedAt)];
      if (query.status) conditions.push(eq(rescueCases.status, query.status));
      else conditions.push(inArray(rescueCases.status, ["needs_help", "under_treatment"]));
      if (query.query) conditions.push(ilike(rescueCases.headline, `%${query.query}%`));
      rows = await db.select({ id: rescueCases.id }).from(rescueCases).where(and(...conditions)).orderBy(desc(rescueCases.createdAt)).limit(100);
    }
    return { cases: await Promise.all(rows.map((row) => caseModel(row.id, request.auth?.userId ?? null))) };
  });
  app.get("/v1/rescue-cases/:caseId", { preHandler: app.optionalAuthenticate }, async (request) => caseModel(caseParams.parse(request.params).caseId, request.auth?.userId ?? null));
  app.patch("/v1/rescue-cases/:caseId", { preHandler: app.authenticate }, async (request) => {
    const caseId = caseParams.parse(request.params).caseId;
    const body = z.object({
      version: z.number().int().positive(),
      animalName: z.string().trim().min(1).max(80).optional(),
      species: z.enum(["dog", "cat", "other"]).optional(),
      headline: z.string().trim().min(5).max(140).optional(),
      originalStory: z.string().trim().min(12).max(5_000).optional(),
      publicLocationLabel: z.string().trim().min(1).max(120).optional(),
      visibility: z.enum(["everyone", "circles", "only_me"]).optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      assetIds: z.array(z.uuid()).min(1).max(3).optional(),
    }).refine((value) => Object.keys(value).some((key) => key !== "version"), {
      message: "At least one field is required.",
    }).parse(request.body);
    if (body.assetIds) await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(rescueCases).where(eq(rescueCases.id, caseId)).limit(1);
      if (!current) throw new AppError(404, "RESCUE_CASE_NOT_FOUND", "Rescue case was not found.");
      if (current.ownerUserId !== request.auth!.userId) throw new AppError(403, "RESCUE_CASE_FORBIDDEN", "You cannot edit this case.");
      if (current.version !== body.version) throw new AppError(409, "VERSION_CONFLICT", "The case changed. Refresh and try again.");
      const { version: _version, assetIds, latitude, longitude, ...patch } = body;
      const [updated] = await tx.update(rescueCases).set({
        ...patch,
        ...(latitude !== undefined && { privateLatitude: latitude }),
        ...(longitude !== undefined && { privateLongitude: longitude }),
        ...(latitude !== undefined && { locationPrecision: latitude == null ? "area" : "exact_private" }),
        version: current.version + 1,
        updatedAt: new Date(),
      }).where(and(eq(rescueCases.id, caseId), eq(rescueCases.version, body.version))).returning({ id: rescueCases.id });
      if (!updated) throw new AppError(409, "VERSION_CONFLICT", "The case changed. Refresh and try again.");
      if (assetIds) {
        await tx.delete(domainMedia).where(and(eq(domainMedia.targetType, "rescue_case"), eq(domainMedia.targetId, caseId)));
        await tx.insert(domainMedia).values(assetIds.map((assetId, position) => ({
          targetType: "rescue_case",
          targetId: caseId,
          assetId,
          role: position === 0 ? "cover" : "evidence",
          position,
        })));
      }
    });
    return caseModel(caseId, request.auth!.userId);
  });
  app.post("/v1/rescue-cases/:caseId/archive", { preHandler: app.authenticate }, async (request) => {
    const caseId = caseParams.parse(request.params).caseId;
    const [updated] = await db.update(rescueCases).set({
      archivedAt: new Date(),
      updatedAt: new Date(),
      version: sql`${rescueCases.version} + 1`,
    }).where(and(
      eq(rescueCases.id, caseId),
      eq(rescueCases.ownerUserId, request.auth!.userId),
      isNull(rescueCases.archivedAt),
    )).returning({ id: rescueCases.id });
    if (!updated) throw new AppError(409, "RESCUE_ARCHIVE_FORBIDDEN", "Case cannot be archived.");
    return { archived: true };
  });
  app.delete("/v1/rescue-cases/:caseId", { preHandler: app.authenticate }, async (request, reply) => {
    const caseId = caseParams.parse(request.params).caseId;
    const [current] = await db.select().from(rescueCases).where(eq(rescueCases.id, caseId)).limit(1);
    if (!current || current.ownerUserId !== request.auth!.userId) throw new AppError(404, "RESCUE_CASE_NOT_FOUND", "Rescue case was not found.");
    if (current.status === "resolved" || current.linkedAnnouncementPostId) {
      throw new AppError(409, "RESCUE_CASE_RETAINED", "Resolved or published cases must be archived, not deleted.");
    }
    await db.delete(rescueCases).where(eq(rescueCases.id, caseId));
    return reply.code(204).send();
  });
  app.get("/v1/rescue-cases/search", { preHandler: app.optionalAuthenticate }, async (request) => {
    const query = z.object({
      query: z.string().trim().min(1).max(100),
      species: z.enum(["dog", "cat", "other"]).optional(),
      status: z.enum(["needs_help", "under_treatment", "resolved"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);
    const conditions = [
      isNull(rescueCases.archivedAt),
      or(
        ilike(rescueCases.animalName, `%${query.query}%`),
        ilike(rescueCases.headline, `%${query.query}%`),
        ilike(rescueCases.publicCaseNumber, `%${query.query}%`),
        ilike(rescueCases.publicLocationLabel, `%${query.query}%`),
      )!,
    ];
    if (query.species) conditions.push(eq(rescueCases.species, query.species));
    if (query.status) conditions.push(eq(rescueCases.status, query.status));
    const rows = await db.select({ id: rescueCases.id }).from(rescueCases).where(and(...conditions)).orderBy(desc(rescueCases.createdAt)).limit(query.limit);
    return { cases: await Promise.all(rows.map((row) => caseModel(row.id, request.auth?.userId ?? null))) };
  });
  app.get("/v1/users/:userId/rescue-cases", { preHandler: app.optionalAuthenticate }, async (request) => {
    const userId = userParams.parse(request.params).userId;
    const rows = await db.select({ id: rescueCases.id }).from(rescueCases).where(and(
      eq(rescueCases.ownerUserId, userId),
      isNull(rescueCases.archivedAt),
    )).orderBy(desc(rescueCases.createdAt));
    return { cases: await Promise.all(rows.map((row) => caseModel(row.id, request.auth?.userId ?? null))) };
  });
  app.get("/v1/users/:userId/rescue-summary", { preHandler: app.optionalAuthenticate }, async (request) => {
    const userId = userParams.parse(request.params).userId;
    const rows = await db.select({ status: rescueCases.status, value: count() }).from(rescueCases).where(eq(rescueCases.ownerUserId, userId)).groupBy(rescueCases.status);
    const counts = Object.fromEntries(rows.map((row) => [row.status, row.value]));
    return {
      total: rows.reduce((total, row) => total + row.value, 0),
      active: (counts.needs_help ?? 0) + (counts.under_treatment ?? 0),
      needsHelp: counts.needs_help ?? 0,
      underTreatment: counts.under_treatment ?? 0,
      resolved: counts.resolved ?? 0,
    };
  });
  app.put("/v1/rescue-cases/:caseId/follow", { preHandler: app.authenticate }, async (request, reply) => {
    const caseId = caseParams.parse(request.params).caseId;
    const model = await caseModel(caseId, request.auth!.userId);
    if (model.viewer.isOwner) throw new AppError(400, "CANNOT_FOLLOW_OWN_CASE", "Owners cannot follow their own case.");
    await db.insert(rescueCaseFollowers).values({ caseId, userId: request.auth!.userId }).onConflictDoUpdate({ target: [rescueCaseFollowers.caseId, rescueCaseFollowers.userId], set: { unfollowedAt: null, followedAt: new Date() } });
    return reply.code(204).send();
  });
  app.delete("/v1/rescue-cases/:caseId/follow", { preHandler: app.authenticate }, async (request, reply) => {
    await db.update(rescueCaseFollowers).set({ unfollowedAt: new Date() }).where(and(eq(rescueCaseFollowers.caseId, caseParams.parse(request.params).caseId), eq(rescueCaseFollowers.userId, request.auth!.userId)));
    return reply.code(204).send();
  });
  app.patch("/v1/rescue-cases/:caseId/follow-preferences", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({ notificationMode: z.enum(["all_updates", "major_only", "none"]) }).parse(request.body);
    const [updated] = await db.update(rescueCaseFollowers).set({
      notificationMode: body.notificationMode,
    }).where(and(
      eq(rescueCaseFollowers.caseId, caseParams.parse(request.params).caseId),
      eq(rescueCaseFollowers.userId, request.auth!.userId),
      isNull(rescueCaseFollowers.unfollowedAt),
    )).returning();
    if (!updated) throw new AppError(404, "RESCUE_FOLLOW_NOT_FOUND", "You are not following this case.");
    return updated;
  });
  app.get("/v1/rescue-cases/:caseId/updates", { preHandler: app.optionalAuthenticate }, async (request) => {
    const caseId = caseParams.parse(request.params).caseId; await caseModel(caseId, request.auth?.userId ?? null);
    const rows = await db.select({ id: rescueCaseUpdates.id }).from(rescueCaseUpdates).where(and(eq(rescueCaseUpdates.caseId, caseId), isNull(rescueCaseUpdates.deletedAt))).orderBy(desc(rescueCaseUpdates.createdAt));
    return { updates: await Promise.all(rows.map((row) => updateModel(row.id))) };
  });
  app.post("/v1/rescue-cases/:caseId/updates", { preHandler: app.authenticate }, async (request, reply) => {
    const caseId = caseParams.parse(request.params).caseId;
    const body = z.object({ text: z.string().trim().max(2_000).nullable().optional(), status: z.enum(["needs_help", "under_treatment", "resolved"]).optional(), resolutionOutcome: z.string().max(80).optional(), assetIds: z.array(z.uuid()).min(1).max(4), clientIdempotencyKey: z.string().min(8).max(100) }).parse(request.body);
    const assets = await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    const current = await caseModel(caseId, request.auth!.userId);
    if (!current.viewer.isOwner) throw new AppError(403, "RESCUE_UPDATE_FORBIDDEN", "Only the owner can post an update.");
    if (current.status === "resolved") throw new AppError(409, "RESCUE_CASE_NOT_ACTIVE", "Resolved cases must be reopened first.");
    if (body.status === "resolved" && !body.resolutionOutcome) throw new AppError(400, "RESCUE_RESOLUTION_REQUIRED", "Resolution outcome is required.");
    const update = await db.transaction(async (tx) => {
      const [created] = await tx.insert(rescueCaseUpdates).values({ caseId, authorUserId: request.auth!.userId, text: body.text, statusBefore: current.status, statusAfter: body.status ?? current.status, resolutionOutcome: body.resolutionOutcome, clientIdempotencyKey: body.clientIdempotencyKey }).onConflictDoNothing().returning();
      if (!created) {
        const [existing] = await tx.select().from(rescueCaseUpdates).where(and(eq(rescueCaseUpdates.caseId, caseId), eq(rescueCaseUpdates.authorUserId, request.auth!.userId), eq(rescueCaseUpdates.clientIdempotencyKey, body.clientIdempotencyKey))).limit(1);
        return existing!;
      }
      await tx.insert(domainMedia).values(body.assetIds.map((assetId, position) => ({
        targetType: "rescue_update",
        targetId: created.id,
        assetId,
        role: assets[position]?.mediaType === "video" ? "video" : "photo",
        position,
      })));
      if (body.status) await tx.update(rescueCases).set({ status: body.status, resolutionOutcome: body.resolutionOutcome, resolvedAt: body.status === "resolved" ? new Date() : null, updatedAt: new Date() }).where(eq(rescueCases.id, caseId));
      await tx.insert(outboxEvents).values({ aggregateType: "rescue_case", aggregateId: caseId, eventType: body.status === "resolved" ? "rescue.case_resolved" : "rescue.update_posted", payload: { caseId, updateId: created.id } });
      return created;
    });
    const followers = await db.select({ userId: rescueCaseFollowers.userId }).from(rescueCaseFollowers).where(and(eq(rescueCaseFollowers.caseId, caseId), isNull(rescueCaseFollowers.unfollowedAt)));
    await Promise.all(followers.map((follower) => createNotification({ userId: follower.userId, type: "rescue_update", title: current.headline, body: body.text?.slice(0, 120) || "A new rescue update was posted.", targetType: "rescue_case", targetId: caseId, deduplicationKey: `rescue-update:${update.id}:${follower.userId}` })));
    return reply.code(201).send(await updateModel(update.id));
  });
  app.patch("/v1/rescue-case-updates/:updateId", { preHandler: app.authenticate }, async (request) => {
    const updateId = updateParams.parse(request.params).updateId;
    const body = z.object({ text: z.string().trim().min(1).max(2_000) }).parse(request.body);
    const [updated] = await db.update(rescueCaseUpdates).set({
      text: body.text,
      editedAt: new Date(),
    }).where(and(
      eq(rescueCaseUpdates.id, updateId),
      eq(rescueCaseUpdates.authorUserId, request.auth!.userId),
      isNull(rescueCaseUpdates.deletedAt),
    )).returning();
    if (!updated) throw new AppError(404, "RESCUE_UPDATE_NOT_FOUND", "Rescue update was not found.");
    return updateModel(updateId);
  });
  app.delete("/v1/rescue-case-updates/:updateId", { preHandler: app.authenticate }, async (request, reply) => {
    const updateId = updateParams.parse(request.params).updateId;
    const [updated] = await db.update(rescueCaseUpdates).set({
      deletedAt: new Date(),
    }).where(and(
      eq(rescueCaseUpdates.id, updateId),
      eq(rescueCaseUpdates.authorUserId, request.auth!.userId),
      isNull(rescueCaseUpdates.deletedAt),
    )).returning();
    if (!updated) throw new AppError(404, "RESCUE_UPDATE_NOT_FOUND", "Rescue update was not found.");
    await db.update(domainMedia).set({ removedAt: new Date() }).where(and(
      eq(domainMedia.targetType, "rescue_update"),
      eq(domainMedia.targetId, updateId),
      isNull(domainMedia.removedAt),
    ));
    return reply.code(204).send();
  });
  app.post("/v1/rescue-cases/:caseId/status", { preHandler: app.authenticate }, async (request) => {
    const caseId = caseParams.parse(request.params).caseId;
    const body = z.object({
      status: z.enum(["needs_help", "under_treatment", "resolved"]),
      resolutionOutcome: z.string().trim().max(80).optional(),
      resolutionNote: z.string().trim().max(2_000).optional(),
    }).parse(request.body);
    if (body.status === "resolved" && !body.resolutionOutcome) {
      throw new AppError(400, "RESCUE_RESOLUTION_REQUIRED", "Resolution outcome is required.");
    }
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(rescueCases).where(and(
        eq(rescueCases.id, caseId),
        eq(rescueCases.ownerUserId, request.auth!.userId),
        isNull(rescueCases.archivedAt),
      )).limit(1);
      if (!current) throw new AppError(404, "RESCUE_CASE_NOT_FOUND", "Rescue case was not found.");
      await tx.update(rescueCases).set({
        status: body.status,
        resolutionOutcome: body.status === "resolved" ? body.resolutionOutcome : null,
        resolutionNote: body.status === "resolved" ? body.resolutionNote : null,
        resolvedAt: body.status === "resolved" ? now : null,
        updatedAt: now,
        version: current.version + 1,
      }).where(eq(rescueCases.id, caseId));
      await tx.insert(rescueCaseUpdates).values({
        caseId,
        authorUserId: request.auth!.userId,
        text: body.resolutionNote ?? `Case status changed to ${body.status.replaceAll("_", " ")}.`,
        statusBefore: current.status,
        statusAfter: body.status,
        resolutionOutcome: body.resolutionOutcome,
      });
      return body.status;
    });
    await db.insert(outboxEvents).values({
      aggregateType: "rescue_case",
      aggregateId: caseId,
      eventType: result === "resolved" ? "rescue.case_resolved" : "rescue.status_changed",
      payload: { caseId, status: result },
    });
    return caseModel(caseId, request.auth!.userId);
  });
  app.post("/v1/rescue-cases/:caseId/reopen", { preHandler: app.authenticate }, async (request) => {
    const caseId = caseParams.parse(request.params).caseId;
    const body = z.object({ status: z.enum(["needs_help", "under_treatment"]), reason: z.string().trim().min(5).max(1_000) }).parse(request.body);
    const [updated] = await db.update(rescueCases).set({ status: body.status, resolutionOutcome: null, resolutionNote: null, resolvedAt: null, updatedAt: new Date() }).where(and(eq(rescueCases.id, caseId), eq(rescueCases.ownerUserId, request.auth!.userId), eq(rescueCases.status, "resolved"))).returning();
    if (!updated) throw new AppError(409, "RESCUE_REOPEN_FORBIDDEN", "Case cannot be reopened.");
    await db.insert(rescueCaseUpdates).values({ caseId, authorUserId: request.auth!.userId, text: body.reason, statusBefore: "resolved", statusAfter: body.status });
    return caseModel(caseId, request.auth!.userId);
  });
  app.post("/v1/rescue-cases/:caseId/help-offers", { preHandler: app.authenticate }, async (request, reply) => {
    const caseId = caseParams.parse(request.params).caseId;
    const body = z.object({ type: z.enum(["foster", "transport", "vet", "supplies", "search", "temporary_shelter", "other"]), message: z.string().trim().max(2_000).optional(), availability: z.string().trim().max(500).optional(), privateContactMethod: z.string().trim().max(500).optional() }).parse(request.body);
    const model = await caseModel(caseId, request.auth!.userId);
    if (!model.viewer.canHelp) throw new AppError(403, "RESCUE_HELP_FORBIDDEN", "You cannot offer help on this case.");
    const [offer] = await db.insert(rescueHelpOffers).values({ caseId, helperUserId: request.auth!.userId, ...body }).onConflictDoUpdate({ target: [rescueHelpOffers.caseId, rescueHelpOffers.helperUserId, rescueHelpOffers.type], set: { status: "offered", message: body.message, availability: body.availability, privateContactMethod: body.privateContactMethod, updatedAt: new Date() } }).returning();
    await createNotification({ userId: model.ownerUserId, type: "rescue_help_offer", title: "Someone can help", body: body.message?.slice(0, 120) || body.type, actorUserId: request.auth!.userId, targetType: "rescue_help_offer", targetId: offer!.id });
    return reply.code(201).send(offer);
  });
  app.get("/v1/rescue-cases/:caseId/help-offers", { preHandler: app.authenticate }, async (request) => {
    const caseId = caseParams.parse(request.params).caseId;
    const [rescueCase] = await db.select({ ownerUserId: rescueCases.ownerUserId }).from(rescueCases).where(eq(rescueCases.id, caseId)).limit(1);
    if (!rescueCase) throw new AppError(404, "RESCUE_CASE_NOT_FOUND", "Rescue case was not found.");
    const conditions = [eq(rescueHelpOffers.caseId, caseId)];
    if (rescueCase.ownerUserId !== request.auth!.userId) {
      conditions.push(eq(rescueHelpOffers.helperUserId, request.auth!.userId));
    }
    return {
      offers: await db.select().from(rescueHelpOffers).where(and(...conditions)).orderBy(desc(rescueHelpOffers.createdAt)),
    };
  });
  app.post("/v1/rescue-help-offers/:offerId/accept", { preHandler: app.authenticate }, async (request) => {
    const offerId = offerParams.parse(request.params).offerId;
    const [offer] = await db.select({ offer: rescueHelpOffers, ownerUserId: rescueCases.ownerUserId }).from(rescueHelpOffers).innerJoin(rescueCases, eq(rescueCases.id, rescueHelpOffers.caseId)).where(eq(rescueHelpOffers.id, offerId)).limit(1);
    if (!offer || offer.ownerUserId !== request.auth!.userId || offer.offer.status !== "offered") throw new AppError(409, "RESCUE_HELP_OFFER_NOT_ACCEPTABLE", "Help offer cannot be accepted.");
    const conversationId = await db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({ type: "direct", domainType: "rescue_help_offer", domainId: offerId, createdByUserId: request.auth!.userId }).returning({ id: conversations.id });
      if (!conversation) throw new AppError(500, "CONVERSATION_CREATE_FAILED", "Conversation was not created.");
      await tx.insert(conversationParticipants).values([{ conversationId: conversation.id, userId: request.auth!.userId }, { conversationId: conversation.id, userId: offer.offer.helperUserId }]);
      await tx.update(rescueHelpOffers).set({ status: "accepted", reviewedByUserId: request.auth!.userId, reviewedAt: new Date(), conversationId: conversation.id, updatedAt: new Date() }).where(eq(rescueHelpOffers.id, offerId));
      return conversation.id;
    });
    return { accepted: true, conversationId };
  });
  app.post("/v1/rescue-help-offers/:offerId/decline", { preHandler: app.authenticate }, async (request) => {
    const offerId = offerParams.parse(request.params).offerId;
    const [updated] = await db.update(rescueHelpOffers).set({
      status: "declined",
      reviewedByUserId: request.auth!.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).from(rescueCases).where(and(
      eq(rescueHelpOffers.id, offerId),
      eq(rescueHelpOffers.caseId, rescueCases.id),
      eq(rescueCases.ownerUserId, request.auth!.userId),
      eq(rescueHelpOffers.status, "offered"),
    )).returning({ offer: rescueHelpOffers });
    if (!updated) throw new AppError(409, "RESCUE_HELP_OFFER_NOT_DECLINABLE", "Help offer cannot be declined.");
    return updated.offer;
  });
  app.post("/v1/rescue-help-offers/:offerId/withdraw", { preHandler: app.authenticate }, async (request) => {
    const offerId = offerParams.parse(request.params).offerId;
    const [updated] = await db.update(rescueHelpOffers).set({
      status: "withdrawn",
      updatedAt: new Date(),
    }).where(and(
      eq(rescueHelpOffers.id, offerId),
      eq(rescueHelpOffers.helperUserId, request.auth!.userId),
      inArray(rescueHelpOffers.status, ["offered", "accepted"]),
    )).returning();
    if (!updated) throw new AppError(409, "RESCUE_HELP_OFFER_NOT_WITHDRAWABLE", "Help offer cannot be withdrawn.");
    return updated;
  });
  app.post("/v1/rescue-help-offers/:offerId/complete", { preHandler: app.authenticate }, async (request) => {
    const offerId = offerParams.parse(request.params).offerId;
    const [row] = await db.select({
      offer: rescueHelpOffers,
      ownerUserId: rescueCases.ownerUserId,
    }).from(rescueHelpOffers).innerJoin(rescueCases, eq(rescueCases.id, rescueHelpOffers.caseId)).where(eq(rescueHelpOffers.id, offerId)).limit(1);
    if (!row || ![row.ownerUserId, row.offer.helperUserId].includes(request.auth!.userId) || row.offer.status !== "accepted") {
      throw new AppError(409, "RESCUE_HELP_OFFER_NOT_COMPLETABLE", "Help offer cannot be completed.");
    }
    const [updated] = await db.update(rescueHelpOffers).set({
      status: "completed",
      updatedAt: new Date(),
    }).where(eq(rescueHelpOffers.id, offerId)).returning();
    return updated;
  });
  app.post("/v1/rescue-help-offers/:offerId/conversation", { preHandler: app.authenticate }, async (request) => {
    const offerId = offerParams.parse(request.params).offerId;
    const [row] = await db.select({
      offer: rescueHelpOffers,
      ownerUserId: rescueCases.ownerUserId,
    }).from(rescueHelpOffers).innerJoin(rescueCases, eq(rescueCases.id, rescueHelpOffers.caseId)).where(eq(rescueHelpOffers.id, offerId)).limit(1);
    if (!row || ![row.ownerUserId, row.offer.helperUserId].includes(request.auth!.userId) || !["accepted", "completed"].includes(row.offer.status)) {
      throw new AppError(403, "RESCUE_HELP_CONVERSATION_FORBIDDEN", "Conversation is not available.");
    }
    if (row.offer.conversationId) return { conversationId: row.offer.conversationId };
    const conversationId = await db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({
        type: "direct",
        domainType: "rescue_help_offer",
        domainId: offerId,
        createdByUserId: request.auth!.userId,
      }).returning({ id: conversations.id });
      if (!conversation) throw new AppError(500, "CONVERSATION_CREATE_FAILED", "Conversation was not created.");
      await tx.insert(conversationParticipants).values([
        { conversationId: conversation.id, userId: row.ownerUserId },
        { conversationId: conversation.id, userId: row.offer.helperUserId },
      ]);
      await tx.update(rescueHelpOffers).set({ conversationId: conversation.id, updatedAt: new Date() }).where(eq(rescueHelpOffers.id, offerId));
      return conversation.id;
    });
    return { conversationId };
  });
  app.post("/v1/rescue-cases/:caseId/link-post", { preHandler: app.authenticate }, async (request) => {
    const caseId = caseParams.parse(request.params).caseId;
    const body = z.object({ postId: z.uuid() }).parse(request.body);
    const [post] = await db.select({ id: posts.id }).from(posts).where(and(
      eq(posts.id, body.postId),
      eq(posts.authorUserId, request.auth!.userId),
      eq(posts.status, "published"),
      isNull(posts.deletedAt),
    )).limit(1);
    if (!post) throw new AppError(404, "POST_NOT_FOUND", "Post was not found.");
    const [updated] = await db.update(rescueCases).set({
      linkedAnnouncementPostId: body.postId,
      updatedAt: new Date(),
    }).where(and(
      eq(rescueCases.id, caseId),
      eq(rescueCases.ownerUserId, request.auth!.userId),
    )).returning();
    if (!updated) throw new AppError(404, "RESCUE_CASE_NOT_FOUND", "Rescue case was not found.");
    return caseModel(caseId, request.auth!.userId);
  });
  app.delete("/v1/rescue-cases/:caseId/post-links/:postId", { preHandler: app.authenticate }, async (request, reply) => {
    const caseId = caseParams.parse(request.params).caseId;
    const postId = postParams.parse(request.params).postId;
    const [updated] = await db.update(rescueCases).set({
      linkedAnnouncementPostId: null,
      updatedAt: new Date(),
    }).where(and(
      eq(rescueCases.id, caseId),
      eq(rescueCases.ownerUserId, request.auth!.userId),
      eq(rescueCases.linkedAnnouncementPostId, postId),
    )).returning();
    if (!updated) throw new AppError(404, "RESCUE_POST_LINK_NOT_FOUND", "Linked post was not found.");
    return reply.code(204).send();
  });
  app.post("/v1/feed-posts/:postId/convert-to-rescue-case", { preHandler: app.authenticate }, async (request, reply) => {
    const postId = postParams.parse(request.params).postId;
    const body = z.object({
      animalName: z.string().trim().min(1).max(80),
      species: z.enum(["dog", "cat", "other"]),
      headline: z.string().trim().min(5).max(140),
      publicLocationLabel: z.string().trim().min(1).max(120),
      status: z.enum(["needs_help", "under_treatment"]).default("needs_help"),
      visibility: z.enum(["everyone", "circles", "only_me"]).default("everyone"),
    }).parse(request.body);
    const [post] = await db.select().from(posts).where(and(
      eq(posts.id, postId),
      eq(posts.authorUserId, request.auth!.userId),
      eq(posts.status, "published"),
      isNull(posts.deletedAt),
    )).limit(1);
    if (!post) throw new AppError(404, "POST_NOT_FOUND", "Post was not found.");
    const assets = await db.select().from(postAssets).where(eq(postAssets.postId, postId)).orderBy(postAssets.position);
    if (!assets.length) throw new AppError(400, "RESCUE_MEDIA_REQUIRED", "A rescue case requires at least one photo.");
    const caseId = await db.transaction(async (tx) => {
      const [created] = await tx.insert(rescueCases).values({
        publicCaseNumber: publicNumber(),
        ownerUserId: request.auth!.userId,
        animalName: body.animalName,
        species: body.species,
        headline: body.headline,
        originalStory: post.body?.trim() || body.headline,
        publicLocationLabel: body.publicLocationLabel,
        status: body.status,
        visibility: body.visibility,
        linkedAnnouncementPostId: postId,
      }).returning({ id: rescueCases.id });
      if (!created) throw new AppError(500, "RESCUE_CASE_CREATE_FAILED", "Rescue case was not created.");
      await tx.insert(domainMedia).values(assets.slice(0, 3).map((asset, position) => ({
        targetType: "rescue_case",
        targetId: created.id,
        assetId: asset.assetId,
        role: position === 0 ? "cover" : "evidence",
        position,
      })));
      return created.id;
    });
    return reply.code(201).send(await caseModel(caseId, request.auth!.userId));
  });
  app.post("/v1/rescue-cases/:caseId/reports", { preHandler: app.authenticate }, async (request, reply) => {
    const caseId = caseParams.parse(request.params).caseId;
    await caseModel(caseId, request.auth!.userId);
    const body = z.object({ reason: z.string().trim().min(3).max(100), details: z.string().trim().max(2_000).optional() }).parse(request.body);
    const [report] = await db.insert(auditEvents).values({
      actorUserId: request.auth!.userId,
      action: "rescue_case.reported",
      targetType: "rescue_case",
      targetId: caseId,
      requestId: request.id,
      metadata: body,
    }).returning({ id: auditEvents.id, createdAt: auditEvents.createdAt });
    return reply.code(201).send(report);
  });
  app.post("/v1/rescue-case-updates/:updateId/reports", { preHandler: app.authenticate }, async (request, reply) => {
    const updateId = updateParams.parse(request.params).updateId;
    await updateModel(updateId);
    const body = z.object({ reason: z.string().trim().min(3).max(100), details: z.string().trim().max(2_000).optional() }).parse(request.body);
    const [report] = await db.insert(auditEvents).values({
      actorUserId: request.auth!.userId,
      action: "rescue_update.reported",
      targetType: "rescue_update",
      targetId: updateId,
      requestId: request.id,
      metadata: body,
    }).returning({ id: auditEvents.id, createdAt: auditEvents.createdAt });
    return reply.code(201).send(report);
  });
};
