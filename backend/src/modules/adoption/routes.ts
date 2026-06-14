import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, inArray, isNull, like, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  adoptionListings,
  adoptionMilestones,
  adoptionRecords,
  adoptionRequests,
  adoptionUpdates,
  conversationParticipants,
  conversations,
  domainMedia,
  messages,
  outboxEvents,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { getReadyMediaReadModel, requireReadyOwnedAssets } from "../media/service.js";
import { createNotification } from "../notifications/routes.js";

const listingParams = z.object({ listingId: z.uuid() });
const requestParams = z.object({ requestId: z.uuid() });
const recordParams = z.object({ recordId: z.uuid() });
const userParams = z.object({ userId: z.uuid() });
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

async function mediaFor(targetType: string, targetId: string) {
  const rows = await db
    .select()
    .from(domainMedia)
    .where(and(
      eq(domainMedia.targetType, targetType),
      eq(domainMedia.targetId, targetId),
      isNull(domainMedia.removedAt),
    ))
    .orderBy(domainMedia.position);
  return Promise.all(rows.map(async (row) => ({
    assetId: row.assetId,
    role: row.role,
    position: row.position,
    ...(await getReadyMediaReadModel(row.assetId)),
  })));
}

async function listingModel(listingId: string, viewerUserId: string | null) {
  const [row] = await db
    .select({
      listing: adoptionListings,
      displayName: userProfiles.displayName,
      handle: userProfiles.handle,
      avatarMediaId: userProfiles.avatarMediaId,
    })
    .from(adoptionListings)
    .innerJoin(userProfiles, eq(userProfiles.userId, adoptionListings.posterId))
    .where(eq(adoptionListings.id, listingId))
    .limit(1);
  if (!row) throw new AppError(404, "ADOPTION_LISTING_NOT_FOUND", "Adoption listing was not found.");
  const requestRows = viewerUserId === row.listing.posterId
    ? await db
        .select({
          request: adoptionRequests,
          requesterName: userProfiles.displayName,
          requesterHandle: userProfiles.handle,
          requesterAvatarMediaId: userProfiles.avatarMediaId,
        })
        .from(adoptionRequests)
        .innerJoin(userProfiles, eq(userProfiles.userId, adoptionRequests.requesterId))
        .where(eq(adoptionRequests.listingId, listingId))
        .orderBy(desc(adoptionRequests.submittedAt))
    : viewerUserId
      ? await db
          .select({
            request: adoptionRequests,
            requesterName: userProfiles.displayName,
            requesterHandle: userProfiles.handle,
            requesterAvatarMediaId: userProfiles.avatarMediaId,
          })
          .from(adoptionRequests)
          .innerJoin(userProfiles, eq(userProfiles.userId, adoptionRequests.requesterId))
          .where(and(eq(adoptionRequests.listingId, listingId), eq(adoptionRequests.requesterId, viewerUserId)))
          .orderBy(desc(adoptionRequests.submittedAt))
      : [];
  const requests = requestRows.map((item) => ({
    ...item.request,
    requester: {
      id: item.request.requesterId,
      displayName: item.requesterName,
      handle: item.requesterHandle,
      avatarMediaId: item.requesterAvatarMediaId,
    },
  }));
  return {
    ...row.listing,
    poster: {
      id: row.listing.posterId,
      displayName: row.displayName,
      handle: row.handle,
      avatarMediaId: row.avatarMediaId,
    },
    media: await mediaFor("adoption_listing", listingId),
    requests,
    viewer: {
      isPoster: row.listing.posterId === viewerUserId,
      canRequest: Boolean(
        viewerUserId
        && row.listing.posterId !== viewerUserId
        && ["available", "urgent"].includes(row.listing.status)
        && !requests.some((item) => ["submitted", "approved"].includes(item.status)),
      ),
    },
  };
}

function milestoneState(dueAt: Date, status: string) {
  if (["satisfied", "excused"].includes(status)) return status;
  return dueAt.getTime() <= Date.now() ? "missed" : "upcoming";
}

async function recordModel(recordId: string, viewerUserId: string | null, publicView = false) {
  const [record] = await db.select().from(adoptionRecords).where(eq(adoptionRecords.id, recordId)).limit(1);
  if (!record) throw new AppError(404, "ADOPTION_RECORD_NOT_FOUND", "Adoption record was not found.");
  const isParticipant = viewerUserId === record.posterId || viewerUserId === record.adopterId;
  if (!publicView && !isParticipant) {
    throw new AppError(403, "ADOPTION_RECORD_FORBIDDEN", "You cannot view this adoption record.");
  }
  const [milestones, updates] = await Promise.all([
    db.select().from(adoptionMilestones).where(eq(adoptionMilestones.adoptionRecordId, recordId)).orderBy(adoptionMilestones.dueAt),
    db.select().from(adoptionUpdates).where(eq(adoptionUpdates.adoptionRecordId, recordId)).orderBy(desc(adoptionUpdates.createdAt)),
  ]);
  const updateModels = await Promise.all(updates.map(async (update) => ({
    ...update,
    media: await mediaFor("adoption_update", update.id),
  })));
  const derivedMilestones = milestones.map((milestone) => ({
    ...milestone,
    derivedStatus: milestoneState(milestone.dueAt, milestone.status),
  }));
  const activeMilestone = derivedMilestones.find((milestone) => !["satisfied", "excused"].includes(milestone.status)) ?? null;
  return {
    ...record,
    milestones: derivedMilestones,
    updates: updateModels,
    derived: {
      role: viewerUserId === record.posterId ? "poster" : viewerUserId === record.adopterId ? "adopter" : "visitor",
      status: record.closedAt ? "closed" : activeMilestone?.derivedStatus === "missed" ? "update_due" : "confirmed",
      activeMilestone,
      missedMilestoneCount: derivedMilestones.filter((milestone) => milestone.derivedStatus === "missed").length,
    },
  };
}

export const adoptionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/adoption-listings", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      animalName: z.string().trim().min(1).max(80),
      species: z.string().trim().min(1).max(50),
      breed: z.string().trim().max(100).optional(),
      ageDisplay: z.string().trim().max(50).optional(),
      genderDisplay: z.string().trim().max(50).optional(),
      vaccinationStatus: z.string().trim().max(50).optional(),
      neutered: z.boolean().default(false),
      personality: z.string().trim().max(500).optional(),
      requirements: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
      healthNotes: z.string().trim().max(1_000).optional(),
      description: z.string().trim().min(12).max(5_000),
      locationLabel: z.string().trim().max(120).optional(),
      urgent: z.boolean().default(false),
      assetIds: z.array(z.uuid()).min(1).max(10),
    }).parse(request.body);
    await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    const listingId = await db.transaction(async (tx) => {
      const [created] = await tx.insert(adoptionListings).values({
        posterId: request.auth!.userId,
        animalName: body.animalName,
        species: body.species,
        breed: body.breed,
        ageDisplay: body.ageDisplay,
        genderDisplay: body.genderDisplay,
        vaccinationStatus: body.vaccinationStatus,
        neutered: body.neutered,
        personality: body.personality,
        requirements: body.requirements,
        healthNotes: body.healthNotes,
        description: body.description,
        locationLabel: body.locationLabel,
        urgent: body.urgent,
        status: body.urgent ? "urgent" : "available",
      }).returning();
      if (!created) throw new AppError(500, "ADOPTION_LISTING_CREATE_FAILED", "Listing was not created.");
      await tx.insert(domainMedia).values(body.assetIds.map((assetId, position) => ({ targetType: "adoption_listing", targetId: created.id, assetId, role: position === 0 ? "cover" : "gallery", position })));
      await tx.insert(outboxEvents).values({ aggregateType: "adoption_listing", aggregateId: created.id, eventType: "adoption.listing_created", payload: { listingId: created.id } });
      return created.id;
    });
    return reply.code(201).send(await listingModel(listingId, request.auth!.userId));
  });
  app.get("/v1/adoption-listings", { preHandler: app.optionalAuthenticate }, async (request) => {
    const query = z.object({
      status: z.enum(["available", "urgent", "adopted"]).optional(),
      posterId: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);
    const conditions = [
      query.status
        ? eq(adoptionListings.status, query.status)
        : inArray(adoptionListings.status, ["available", "urgent"]),
    ];
    if (query.posterId) conditions.push(eq(adoptionListings.posterId, query.posterId));
    const rows = await db
      .select({ id: adoptionListings.id })
      .from(adoptionListings)
      .where(and(...conditions))
      .orderBy(desc(adoptionListings.publishedAt))
      .limit(query.limit);
    return {
      listings: await Promise.all(rows.map((row) => listingModel(row.id, request.auth?.userId ?? null))),
    };
  });
  app.get("/v1/adoption-listings/:listingId", { preHandler: app.optionalAuthenticate }, async (request) => listingModel(listingParams.parse(request.params).listingId, request.auth?.userId ?? null));
  app.patch("/v1/adoption-listings/:listingId", { preHandler: app.authenticate }, async (request) => {
    const listingId = listingParams.parse(request.params).listingId;
    const body = z.object({
      version: z.number().int().positive(),
      animalName: z.string().trim().min(1).max(80).optional(),
      species: z.string().trim().min(1).max(50).optional(),
      breed: z.string().trim().max(100).nullable().optional(),
      ageDisplay: z.string().trim().max(50).nullable().optional(),
      genderDisplay: z.string().trim().max(50).nullable().optional(),
      vaccinationStatus: z.string().trim().max(50).nullable().optional(),
      neutered: z.boolean().optional(),
      personality: z.string().trim().max(500).nullable().optional(),
      requirements: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
      healthNotes: z.string().trim().max(1_000).nullable().optional(),
      description: z.string().trim().min(12).max(5_000).optional(),
      locationLabel: z.string().trim().max(120).nullable().optional(),
      urgent: z.boolean().optional(),
      assetIds: z.array(z.uuid()).min(1).max(10).optional(),
    }).parse(request.body);
    if (body.assetIds) await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(adoptionListings).where(eq(adoptionListings.id, listingId)).limit(1);
      if (!current) throw new AppError(404, "ADOPTION_LISTING_NOT_FOUND", "Adoption listing was not found.");
      if (current.posterId !== request.auth!.userId) throw new AppError(403, "ADOPTION_LISTING_FORBIDDEN", "You cannot edit this listing.");
      if (current.version !== body.version) throw new AppError(409, "VERSION_CONFLICT", "The listing changed. Refresh and try again.");
      if (current.status === "adopted") throw new AppError(409, "ADOPTION_LISTING_LOCKED", "An adopted listing cannot be edited.");
      const { assetIds, version: _version, ...patch } = body;
      const urgent = patch.urgent ?? current.urgent;
      const [updated] = await tx.update(adoptionListings).set({
        ...patch,
        urgent,
        status: urgent ? "urgent" : "available",
        version: current.version + 1,
        updatedAt: new Date(),
      }).where(and(eq(adoptionListings.id, listingId), eq(adoptionListings.version, body.version))).returning({ id: adoptionListings.id });
      if (!updated) throw new AppError(409, "VERSION_CONFLICT", "The listing changed. Refresh and try again.");
      if (assetIds) {
        await tx.delete(domainMedia).where(and(eq(domainMedia.targetType, "adoption_listing"), eq(domainMedia.targetId, listingId)));
        await tx.insert(domainMedia).values(assetIds.map((assetId, position) => ({
          targetType: "adoption_listing",
          targetId: listingId,
          assetId,
          role: position === 0 ? "cover" : "gallery",
          position,
        })));
      }
    });
    return listingModel(listingId, request.auth!.userId);
  });
  app.get("/v1/adoption-listings/:listingId/requests", { preHandler: app.authenticate }, async (request) => {
    const listingId = listingParams.parse(request.params).listingId;
    const [listing] = await db.select({ posterId: adoptionListings.posterId }).from(adoptionListings).where(eq(adoptionListings.id, listingId)).limit(1);
    if (!listing) throw new AppError(404, "ADOPTION_LISTING_NOT_FOUND", "Adoption listing was not found.");
    if (listing.posterId !== request.auth!.userId) throw new AppError(403, "ADOPTION_REQUESTS_FORBIDDEN", "Only the poster can view these requests.");
    return {
      requests: await db
        .select({
          request: adoptionRequests,
          requesterName: userProfiles.displayName,
          requesterHandle: userProfiles.handle,
          requesterAvatarMediaId: userProfiles.avatarMediaId,
        })
        .from(adoptionRequests)
        .innerJoin(userProfiles, eq(userProfiles.userId, adoptionRequests.requesterId))
        .where(eq(adoptionRequests.listingId, listingId))
        .orderBy(desc(adoptionRequests.submittedAt)),
    };
  });
  app.post("/v1/adoption-listings/:listingId/requests", { preHandler: app.authenticate }, async (request, reply) => {
    const listingId = listingParams.parse(request.params).listingId;
    const body = z.object({ message: z.string().trim().min(10).max(2_000) }).parse(request.body);
    const [listing] = await db.select().from(adoptionListings).where(eq(adoptionListings.id, listingId)).limit(1);
    if (!listing || !["available", "urgent"].includes(listing.status)) throw new AppError(409, "ADOPTION_LISTING_NOT_AVAILABLE", "Listing is not available.");
    if (listing.posterId === request.auth!.userId) throw new AppError(400, "CANNOT_REQUEST_OWN_LISTING", "You cannot request your own listing.");
    const created = await db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({ type: "adoption", domainType: "adoption_request_pending", domainId: listingId, createdByUserId: request.auth!.userId }).returning({ id: conversations.id });
      if (!conversation) throw new AppError(500, "CONVERSATION_CREATE_FAILED", "Conversation was not created.");
      await tx.insert(conversationParticipants).values([{ conversationId: conversation.id, userId: listing.posterId }, { conversationId: conversation.id, userId: request.auth!.userId }]);
      const [adoptionRequest] = await tx.insert(adoptionRequests).values({ listingId, posterId: listing.posterId, requesterId: request.auth!.userId, message: body.message, threadId: conversation.id }).returning();
      if (!adoptionRequest) throw new AppError(500, "ADOPTION_REQUEST_CREATE_FAILED", "Request was not created.");
      await tx.update(conversations).set({ domainType: "adoption_request", domainId: adoptionRequest.id }).where(eq(conversations.id, conversation.id));
      await tx.insert(messages).values({ conversationId: conversation.id, senderUserId: request.auth!.userId, type: "text", text: body.message });
      return adoptionRequest;
    });
    await createNotification({ userId: listing.posterId, type: "adoption_request", title: `New request for ${listing.animalName}`, body: body.message.slice(0, 120), actorUserId: request.auth!.userId, targetType: "adoption_request", targetId: created.id });
    return reply.code(201).send(created);
  });
  app.post("/v1/adoption-requests/:requestId/approve", { preHandler: app.authenticate }, async (request) => {
    const requestId = requestParams.parse(request.params).requestId;
    const [row] = await db.update(adoptionRequests).set({ status: "approved", approvedAt: new Date() }).where(and(eq(adoptionRequests.id, requestId), eq(adoptionRequests.posterId, request.auth!.userId), eq(adoptionRequests.status, "submitted"))).returning();
    if (!row) throw new AppError(409, "ADOPTION_REQUEST_NOT_APPROVABLE", "Request cannot be approved.");
    await createNotification({ userId: row.requesterId, type: "adoption_request_approved", title: "Adoption request approved", body: "The poster is ready to chat.", targetType: "adoption_request", targetId: row.id });
    return row;
  });
  app.post("/v1/adoption-requests/:requestId/reject", { preHandler: app.authenticate }, async (request) => {
    const requestId = requestParams.parse(request.params).requestId;
    const [row] = await db.update(adoptionRequests).set({ status: "rejected", rejectedAt: new Date() }).where(and(eq(adoptionRequests.id, requestId), eq(adoptionRequests.posterId, request.auth!.userId), inArray(adoptionRequests.status, ["submitted", "approved"]))).returning();
    if (!row) throw new AppError(409, "ADOPTION_REQUEST_NOT_REJECTABLE", "Request cannot be rejected.");
    return row;
  });
  app.post("/v1/adoption-requests/:requestId/cancel", { preHandler: app.authenticate }, async (request) => {
    const requestId = requestParams.parse(request.params).requestId;
    const now = new Date();
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(adoptionRequests).set({ status: "cancelled", cancelledAt: now }).where(and(
        eq(adoptionRequests.id, requestId),
        eq(adoptionRequests.requesterId, request.auth!.userId),
        inArray(adoptionRequests.status, ["submitted", "approved"]),
      )).returning();
      if (!updated) throw new AppError(409, "ADOPTION_REQUEST_NOT_CANCELLABLE", "Request cannot be cancelled.");
      if (updated.threadId) {
        await tx.update(conversationParticipants).set({ archivedAt: now }).where(and(
          eq(conversationParticipants.conversationId, updated.threadId),
          eq(conversationParticipants.userId, request.auth!.userId),
        ));
      }
      return updated;
    });
    return row;
  });
  app.post("/v1/adoption-requests/:requestId/mark-adopted", { preHandler: app.authenticate }, async (request) => {
    const requestId = requestParams.parse(request.params).requestId;
    const body = z.object({ note: z.string().trim().max(2_000).optional() }).parse(request.body ?? {});
    const now = new Date();
    const record = await db.transaction(async (tx) => {
      const [adoptionRequest] = await tx.select().from(adoptionRequests).where(eq(adoptionRequests.id, requestId)).limit(1);
      if (!adoptionRequest || adoptionRequest.posterId !== request.auth!.userId || adoptionRequest.status !== "approved") throw new AppError(409, "ADOPTION_REQUEST_NOT_CONFIRMABLE", "Request cannot be marked adopted.");
      const [listing] = await tx.select().from(adoptionListings).where(eq(adoptionListings.id, adoptionRequest.listingId)).limit(1);
      if (!listing || listing.status === "adopted") throw new AppError(409, "ADOPTION_ALREADY_CONFIRMED", "Listing is already adopted.");
      const [created] = await tx.insert(adoptionRecords).values({
        listingId: listing.id, selectedRequestId: adoptionRequest.id, posterId: listing.posterId, adopterId: adoptionRequest.requesterId,
        animalName: listing.animalName, species: listing.species, breed: listing.breed, chatThreadId: adoptionRequest.threadId,
      }).returning();
      if (!created) throw new AppError(500, "ADOPTION_CONFIRM_FAILED", "Adoption was not confirmed.");
      await tx.update(adoptionListings).set({ status: "adopted", urgent: false, selectedRequestId: adoptionRequest.id, activeAdoptionRecordId: created.id, adoptedAt: now, adoptedNote: body.note, updatedAt: now }).where(eq(adoptionListings.id, listing.id));
      await tx.update(adoptionRequests).set({ status: "rejected", rejectedAt: now }).where(and(eq(adoptionRequests.listingId, listing.id), ne(adoptionRequests.id, adoptionRequest.id), inArray(adoptionRequests.status, ["submitted", "approved"])));
      await tx.update(adoptionRequests).set({ status: "adopted", adoptedAt: now }).where(eq(adoptionRequests.id, adoptionRequest.id));
      await tx.insert(adoptionMilestones).values([
        { adoptionRecordId: created.id, milestoneId: "week_1", dueAt: addDays(now, 7) },
        { adoptionRecordId: created.id, milestoneId: "month_1", dueAt: addDays(now, 30) },
        { adoptionRecordId: created.id, milestoneId: "month_3", dueAt: addDays(now, 90) },
        { adoptionRecordId: created.id, milestoneId: "month_6", dueAt: addDays(now, 180) },
      ]);
      if (adoptionRequest.threadId) await tx.insert(messages).values({ conversationId: adoptionRequest.threadId, type: "system", text: `${listing.animalName} marked as adopted`, metadata: { eventType: "adoption.confirmed", adoptionRecordId: created.id } });
      await tx.insert(outboxEvents).values({ aggregateType: "adoption_record", aggregateId: created.id, eventType: "adoption.confirmed", payload: { adoptionRecordId: created.id } });
      return created;
    });
    await createNotification({ userId: record.adopterId, type: "adoption_confirmed", title: `${record.animalName} is adopted`, body: "Share a 1-week home update soon.", targetType: "adoption_record", targetId: record.id });
    return record;
  });
  app.get("/v1/adoption-chats", { preHandler: app.authenticate }, async (request) => {
    const rows = await db
      .select({ conversation: conversations })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
      .where(and(
        eq(conversationParticipants.userId, request.auth!.userId),
        eq(conversationParticipants.state, "active"),
        isNull(conversationParticipants.archivedAt),
        like(conversations.domainType, "adoption%"),
      ))
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.createdAt));
    return { conversations: rows.map((row) => row.conversation) };
  });
  app.get("/v1/users/:userId/rehomed-records", { preHandler: app.optionalAuthenticate }, async (request) => {
    const userId = userParams.parse(request.params).userId;
    const rows = await db.select({ id: adoptionRecords.id }).from(adoptionRecords).where(eq(adoptionRecords.posterId, userId)).orderBy(desc(adoptionRecords.confirmedAt));
    return { records: await Promise.all(rows.map((row) => recordModel(row.id, request.auth?.userId ?? null, true))) };
  });
  app.get("/v1/users/:userId/adopted-records", { preHandler: app.optionalAuthenticate }, async (request) => {
    const userId = userParams.parse(request.params).userId;
    const rows = await db.select({ id: adoptionRecords.id }).from(adoptionRecords).where(eq(adoptionRecords.adopterId, userId)).orderBy(desc(adoptionRecords.confirmedAt));
    return { records: await Promise.all(rows.map((row) => recordModel(row.id, request.auth?.userId ?? null, true))) };
  });
  app.get("/v1/users/:userId/adoption-summary", { preHandler: app.optionalAuthenticate }, async (request) => {
    const userId = userParams.parse(request.params).userId;
    const [rehomedRows, adoptedRows, activeRows] = await Promise.all([
      db.select({ value: count() }).from(adoptionRecords).where(eq(adoptionRecords.posterId, userId)),
      db.select({ value: count() }).from(adoptionRecords).where(eq(adoptionRecords.adopterId, userId)),
      db.select({ id: adoptionRecords.id }).from(adoptionRecords).where(and(eq(adoptionRecords.adopterId, userId), isNull(adoptionRecords.closedAt))),
    ]);
    const activeModels = await Promise.all(activeRows.map((row) => recordModel(row.id, request.auth?.userId ?? null, true)));
    return {
      rehomed: rehomedRows[0]?.value ?? 0,
      adopted: adoptedRows[0]?.value ?? 0,
      overdueMilestones: activeModels.reduce((total, record) => total + record.derived.missedMilestoneCount, 0),
      hasOverdueUpdate: activeModels.some((record) => record.derived.status === "update_due"),
    };
  });
  app.get("/v1/adoption-records/:recordId", { preHandler: app.authenticate }, async (request) =>
    recordModel(recordParams.parse(request.params).recordId, request.auth!.userId));
  app.post("/v1/adoption-records/:recordId/home-updates", { preHandler: app.authenticate }, async (request, reply) => {
    const recordId = recordParams.parse(request.params).recordId;
    const body = z.object({ text: z.string().trim().max(2_000).nullable().optional(), assetIds: z.array(z.uuid()).min(1).max(4) }).parse(request.body);
    const assets = await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    const imageCount = assets.filter((asset) => asset.mediaType === "image").length;
    const videoCount = assets.filter((asset) => asset.mediaType === "video").length;
    if (imageCount < 1 || imageCount > 3 || videoCount > 1 || imageCount + videoCount !== assets.length) {
      throw new AppError(400, "ADOPTION_UPDATE_MEDIA_INVALID", "Use one to three photos and at most one video.");
    }
    const [record] = await db.select().from(adoptionRecords).where(and(eq(adoptionRecords.id, recordId), eq(adoptionRecords.adopterId, request.auth!.userId), isNull(adoptionRecords.closedAt))).limit(1);
    if (!record) throw new AppError(403, "ADOPTION_UPDATE_FORBIDDEN", "You cannot post this update.");
    const update = await db.transaction(async (tx) => {
      const [milestone] = await tx.select().from(adoptionMilestones).where(and(eq(adoptionMilestones.adoptionRecordId, recordId), inArray(adoptionMilestones.status, ["upcoming", "due", "missed"]))).orderBy(adoptionMilestones.dueAt).limit(1);
      const [created] = await tx.insert(adoptionUpdates).values({ adoptionRecordId: recordId, type: "adopter_home", authorId: request.auth!.userId, milestoneId: milestone?.milestoneId, text: body.text }).returning();
      if (!created) throw new AppError(500, "ADOPTION_UPDATE_CREATE_FAILED", "Home update was not created.");
      await tx.insert(domainMedia).values(body.assetIds.map((assetId, position) => ({ targetType: "adoption_update", targetId: created.id, assetId, role: "evidence", position })));
      if (milestone) await tx.update(adoptionMilestones).set({ status: "satisfied", satisfiedByUpdateId: created.id }).where(and(eq(adoptionMilestones.adoptionRecordId, recordId), eq(adoptionMilestones.milestoneId, milestone.milestoneId)));
      if (record.chatThreadId) await tx.insert(messages).values({ conversationId: record.chatThreadId, type: "system", text: `Home update posted for ${record.animalName}`, metadata: { eventType: "adoption.home_update_posted", updateId: created.id } });
      await tx.insert(outboxEvents).values({ aggregateType: "adoption_record", aggregateId: recordId, eventType: "adoption.home_update_posted", payload: { adoptionRecordId: recordId, updateId: created.id } });
      return created;
    });
    return reply.code(201).send({
      ...update,
      media: await mediaFor("adoption_update", update.id),
    });
  });
  app.post("/v1/adoption-records/:recordId/placement-notes", { preHandler: app.authenticate }, async (request, reply) => {
    const recordId = recordParams.parse(request.params).recordId;
    const body = z.object({ text: z.string().trim().min(1).max(2_000) }).parse(request.body);
    const [record] = await db.select().from(adoptionRecords).where(and(
      eq(adoptionRecords.id, recordId),
      eq(adoptionRecords.posterId, request.auth!.userId),
      isNull(adoptionRecords.closedAt),
    )).limit(1);
    if (!record) throw new AppError(403, "ADOPTION_NOTE_FORBIDDEN", "You cannot add a placement note.");
    const [created] = await db.insert(adoptionUpdates).values({
      adoptionRecordId: recordId,
      type: "poster_placement",
      authorId: request.auth!.userId,
      text: body.text,
    }).returning();
    return reply.code(201).send(created);
  });
  app.post("/v1/adoption-records/:recordId/recommendations", { preHandler: app.authenticate }, async (request, reply) => {
    const recordId = recordParams.parse(request.params).recordId;
    const body = z.object({
      recommendation: z.enum(["recommended", "not_recommended"]),
      text: z.string().trim().max(2_000).optional(),
    }).parse(request.body);
    const [record] = await db.select().from(adoptionRecords).where(and(
      eq(adoptionRecords.id, recordId),
      eq(adoptionRecords.posterId, request.auth!.userId),
    )).limit(1);
    if (!record) throw new AppError(403, "ADOPTION_RECOMMENDATION_FORBIDDEN", "You cannot recommend this adopter.");
    const [created] = await db.insert(adoptionUpdates).values({
      adoptionRecordId: recordId,
      type: "poster_endorsement",
      authorId: request.auth!.userId,
      recommendation: body.recommendation,
      text: body.text,
    }).returning();
    await createNotification({
      userId: record.adopterId,
      type: "adoption_recommendation",
      title: `New adoption feedback for ${record.animalName}`,
      body: body.recommendation === "recommended" ? "The previous owner recommends you as an adopter." : "The previous owner left adoption feedback.",
      actorUserId: request.auth!.userId,
      targetType: "adoption_record",
      targetId: recordId,
    });
    return reply.code(201).send(created);
  });
  app.post("/v1/adoption-records/:recordId/adopter-responses", { preHandler: app.authenticate }, async (request, reply) => {
    const recordId = recordParams.parse(request.params).recordId;
    const body = z.object({ text: z.string().trim().min(1).max(2_000) }).parse(request.body);
    const [record] = await db.select().from(adoptionRecords).where(and(
      eq(adoptionRecords.id, recordId),
      eq(adoptionRecords.adopterId, request.auth!.userId),
    )).limit(1);
    if (!record) throw new AppError(403, "ADOPTION_RESPONSE_FORBIDDEN", "You cannot respond to this record.");
    const [negative] = await db.select({ id: adoptionUpdates.id }).from(adoptionUpdates).where(and(
      eq(adoptionUpdates.adoptionRecordId, recordId),
      eq(adoptionUpdates.type, "poster_endorsement"),
      eq(adoptionUpdates.recommendation, "not_recommended"),
    )).limit(1);
    if (!negative) throw new AppError(409, "ADOPTION_RESPONSE_NOT_AVAILABLE", "A response is only available for negative feedback.");
    const [created] = await db.insert(adoptionUpdates).values({
      adoptionRecordId: recordId,
      type: "adopter_response",
      authorId: request.auth!.userId,
      text: body.text,
    }).returning();
    return reply.code(201).send(created);
  });
  app.post("/v1/adoption-records/:recordId/relist", { preHandler: app.authenticate }, async (request) => {
    const recordId = recordParams.parse(request.params).recordId;
    const result = await db.transaction(async (tx) => {
      const [record] = await tx.select().from(adoptionRecords).where(and(eq(adoptionRecords.id, recordId), eq(adoptionRecords.posterId, request.auth!.userId), isNull(adoptionRecords.closedAt))).limit(1);
      if (!record) throw new AppError(409, "ADOPTION_RELIST_FORBIDDEN", "Adoption cannot be re-listed.");
      await tx.update(adoptionRecords).set({ status: "closed", closedAt: new Date(), closedReason: "relisted" }).where(eq(adoptionRecords.id, recordId));
      await tx.update(adoptionListings).set({ status: "available", selectedRequestId: null, activeAdoptionRecordId: null, adoptedAt: null, adoptedNote: null, publishedAt: new Date(), updatedAt: new Date() }).where(eq(adoptionListings.id, record.listingId));
      if (record.chatThreadId) await tx.update(conversationParticipants).set({ archivedAt: new Date() }).where(eq(conversationParticipants.conversationId, record.chatThreadId));
      return { relisted: true, listingId: record.listingId };
    });
    return result;
  });
};
