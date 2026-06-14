import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  adoptionRecords,
  companionFollowers,
  companionManagers,
  companionRelationships,
  companions,
  companionTransfers,
  companionTreats,
  notifications,
  outboxEvents,
  postCompanions,
  posts,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { getPost } from "../feed/service.js";
import { getMediaAsset } from "../media/service.js";
import {
  createCompanion,
  followCompanion,
  getCompanion,
  listManageableCompanions,
  setCompanionArchived,
  unfollowCompanion,
  updateCompanion,
} from "./service.js";

const companionParamsSchema = z.object({
  companionId: z.uuid(),
});
const userParamsSchema = z.object({ userId: z.uuid() });
const transferParamsSchema = z.object({ transferId: z.uuid() });
const relationshipParamsSchema = z.object({ relationshipId: z.uuid() });
const adoptionParamsSchema = z.object({ adoptionRecordId: z.uuid() });

async function manager(companionId: string, userId: string) {
  const [row] = await db.select().from(companionManagers).where(and(
    eq(companionManagers.companionId, companionId),
    eq(companionManagers.userId, userId),
    isNull(companionManagers.revokedAt),
  )).limit(1);
  return row ?? null;
}

async function requireAccessManager(companionId: string, userId: string) {
  const row = await manager(companionId, userId);
  if (!row?.canManageAccess) throw new AppError(403, "COMPANION_ACCESS_FORBIDDEN", "You cannot manage access for this companion.");
  return row;
}

const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const createCompanionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  species: z.string().trim().min(1).max(50),
  publicHandle: nullableText(30),
  breedPublic: nullableText(100),
  ageDisplay: nullableText(50),
  genderDisplay: nullableText(50),
  about: nullableText(500),
  mood: nullableText(100),
  profileVisibility: z
    .enum(["everyone", "circles", "only_me"])
    .default("everyone"),
  care: z
    .object({
      dateOfBirth: z.iso.datetime().transform((value) => new Date(value)).nullable().optional(),
      breedPrivate: nullableText(100),
      sex: nullableText(50),
      vaccinationStatus: nullableText(50),
      neuterStatus: nullableText(50),
      microchipStatus: nullableText(50),
      allergies: nullableText(500),
      medicalNotes: nullableText(2_000),
    })
    .optional(),
});

const updateCompanionSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(80).optional(),
    breedPublic: nullableText(100),
    ageDisplay: nullableText(50),
    genderDisplay: nullableText(50),
    about: nullableText(500),
    mood: nullableText(100),
    profileVisibility: z
      .enum(["everyone", "circles", "only_me"])
      .optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "version"), {
    message: "At least one companion field is required.",
  });

export const companionRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/v1/me/companions",
    { preHandler: app.authenticate },
    async (request) => ({
      companions: await listManageableCompanions(request.auth!.userId),
    }),
  );

  app.post(
    "/v1/companions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createCompanionSchema.parse(request.body);
      const companion = await createCompanion({
        actorUserId: request.auth!.userId,
        requestId: request.id,
        ...body,
      });
      return reply.code(201).send(companion);
    },
  );

  app.get(
    "/v1/companions/:companionId",
    { preHandler: app.optionalAuthenticate },
    async (request) => {
      const params = companionParamsSchema.parse(request.params);
      return getCompanion(params.companionId, request.auth?.userId ?? null);
    },
  );
  app.get("/v1/companions/:companionId/summary", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    return getCompanion(companionId, request.auth?.userId ?? null);
  });

  app.patch(
    "/v1/companions/:companionId",
    { preHandler: app.authenticate },
    async (request) => {
      const params = companionParamsSchema.parse(request.params);
      const body = updateCompanionSchema.parse(request.body);
      return updateCompanion({
        actorUserId: request.auth!.userId,
        companionId: params.companionId,
        requestId: request.id,
        ...body,
      });
    },
  );

  app.put("/v1/companions/:companionId/avatar", { preHandler: app.authenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const body = z.object({ mediaAssetId: z.uuid(), version: z.number().int().positive() }).parse(request.body);
    const permissions = await manager(companionId, request.auth!.userId);
    if (!permissions?.canManageAvatar) throw new AppError(403, "COMPANION_AVATAR_FORBIDDEN", "You cannot manage this avatar.");
    const asset = await getMediaAsset(request.auth!.userId, body.mediaAssetId);
    if (asset.status !== "ready" || asset.purpose !== "companion_avatar" || asset.mediaType !== "image") {
      throw new AppError(409, "COMPANION_AVATAR_INVALID", "Avatar media is not ready or has the wrong purpose.");
    }
    const [updated] = await db.update(companions).set({
      avatarAssetId: body.mediaAssetId,
      profileVersion: body.version + 1,
      updatedAt: new Date(),
    }).where(and(eq(companions.id, companionId), eq(companions.profileVersion, body.version))).returning();
    if (!updated) throw new AppError(409, "COMPANION_VERSION_CONFLICT", "Companion changed on another device.");
    return getCompanion(companionId, request.auth!.userId);
  });
  app.delete("/v1/companions/:companionId/avatar", { preHandler: app.authenticate }, async (request, reply) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).parse(request.body);
    const permissions = await manager(companionId, request.auth!.userId);
    if (!permissions?.canManageAvatar) throw new AppError(403, "COMPANION_AVATAR_FORBIDDEN", "You cannot manage this avatar.");
    const [updated] = await db.update(companions).set({
      avatarAssetId: null,
      profileVersion: body.version + 1,
      updatedAt: new Date(),
    }).where(and(eq(companions.id, companionId), eq(companions.profileVersion, body.version))).returning();
    if (!updated) throw new AppError(409, "COMPANION_VERSION_CONFLICT", "Companion changed on another device.");
    return reply.code(204).send();
  });
  app.patch("/v1/companions/:companionId/mood", { preHandler: app.authenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const body = z.object({ mood: z.string().trim().max(100).nullable(), version: z.number().int().positive() }).parse(request.body);
    return updateCompanion({
      actorUserId: request.auth!.userId,
      companionId,
      mood: body.mood,
      version: body.version,
      requestId: request.id,
    });
  });

  app.post(
    "/v1/companions/:companionId/archive",
    { preHandler: app.authenticate },
    async (request) => {
      const params = companionParamsSchema.parse(request.params);
      return setCompanionArchived({
        actorUserId: request.auth!.userId,
        companionId: params.companionId,
        archived: true,
        requestId: request.id,
      });
    },
  );

  app.post(
    "/v1/companions/:companionId/restore",
    { preHandler: app.authenticate },
    async (request) => {
      const params = companionParamsSchema.parse(request.params);
      return setCompanionArchived({
        actorUserId: request.auth!.userId,
        companionId: params.companionId,
        archived: false,
        requestId: request.id,
      });
    },
  );

  app.post("/v1/companions/:companionId/transfers", { preHandler: app.authenticate }, async (request, reply) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const body = z.object({ toUserId: z.uuid(), message: z.string().trim().max(1_000).optional() }).parse(request.body);
    await requireAccessManager(companionId, request.auth!.userId);
    if (body.toUserId === request.auth!.userId) throw new AppError(400, "COMPANION_TRANSFER_SELF", "Choose a different recipient.");
    const [recipient] = await db.select({ id: userProfiles.userId }).from(userProfiles).where(eq(userProfiles.userId, body.toUserId)).limit(1);
    if (!recipient) throw new AppError(404, "USER_NOT_FOUND", "Recipient was not found.");
    const [transfer] = await db.insert(companionTransfers).values({
      companionId,
      fromOwnerUserId: request.auth!.userId,
      toUserId: body.toUserId,
      message: body.message,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    }).returning();
    return reply.code(201).send(transfer);
  });
  app.post("/v1/companion-transfers/:transferId/accept", { preHandler: app.authenticate }, async (request) => {
    const { transferId } = transferParamsSchema.parse(request.params);
    const now = new Date();
    const companionId = await db.transaction(async (tx) => {
      const [transfer] = await tx.select().from(companionTransfers).where(eq(companionTransfers.id, transferId)).limit(1);
      if (!transfer || transfer.toUserId !== request.auth!.userId || transfer.status !== "pending" || transfer.expiresAt < now) {
        throw new AppError(409, "COMPANION_TRANSFER_NOT_ACCEPTABLE", "Transfer cannot be accepted.");
      }
      await tx.update(companionTransfers).set({ status: "accepted", acceptedAt: now, updatedAt: now }).where(eq(companionTransfers.id, transferId));
      await tx.update(companions).set({
        primaryOwnerUserId: transfer.toUserId,
        sourceType: "transfer",
        profileVersion: sql`${companions.profileVersion} + 1`,
        updatedAt: now,
      }).where(eq(companions.id, transfer.companionId));
      await tx.update(companionManagers).set({ revokedAt: now }).where(and(
        eq(companionManagers.companionId, transfer.companionId),
        eq(companionManagers.userId, transfer.fromOwnerUserId),
        isNull(companionManagers.revokedAt),
      ));
      await tx.insert(companionManagers).values({
        companionId: transfer.companionId,
        userId: transfer.toUserId,
        role: "owner",
        canEditProfile: true,
        canManageAvatar: true,
        canAttachToPosts: true,
        canPostAsCompanion: true,
        canViewCareRecord: true,
        canUseVetServices: true,
        canManageAccess: true,
      }).onConflictDoUpdate({
        target: [companionManagers.companionId, companionManagers.userId],
        set: {
          role: "owner",
          canEditProfile: true,
          canManageAvatar: true,
          canAttachToPosts: true,
          canPostAsCompanion: true,
          canViewCareRecord: true,
          canUseVetServices: true,
          canManageAccess: true,
          revokedAt: null,
        },
      });
      return transfer.companionId;
    });
    return getCompanion(companionId, request.auth!.userId);
  });

  app.get("/v1/companions/:companionId/managers", { preHandler: app.authenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    await requireAccessManager(companionId, request.auth!.userId);
    return {
      managers: await db.select({
        manager: companionManagers,
        displayName: userProfiles.displayName,
        handle: userProfiles.handle,
      }).from(companionManagers).innerJoin(userProfiles, eq(userProfiles.userId, companionManagers.userId)).where(and(
        eq(companionManagers.companionId, companionId),
        isNull(companionManagers.revokedAt),
      )),
    };
  });
  app.post("/v1/companions/:companionId/managers", { preHandler: app.authenticate }, async (request, reply) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    await requireAccessManager(companionId, request.auth!.userId);
    const body = z.object({
      userId: z.uuid(),
      role: z.enum(["co_owner", "caregiver", "editor", "viewer"]),
      canEditProfile: z.boolean().default(false),
      canManageAvatar: z.boolean().default(false),
      canAttachToPosts: z.boolean().default(false),
      canPostAsCompanion: z.boolean().default(false),
      canViewCareRecord: z.boolean().default(false),
      canUseVetServices: z.boolean().default(false),
      canManageAccess: z.boolean().default(false),
    }).parse(request.body);
    const [created] = await db.insert(companionManagers).values({
      companionId,
      ...body,
    }).onConflictDoUpdate({
      target: [companionManagers.companionId, companionManagers.userId],
      set: { ...body, revokedAt: null },
    }).returning();
    return reply.code(201).send(created);
  });
  app.patch("/v1/companions/:companionId/managers/:userId", { preHandler: app.authenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const { userId } = userParamsSchema.parse(request.params);
    await requireAccessManager(companionId, request.auth!.userId);
    const body = z.object({
      role: z.enum(["co_owner", "caregiver", "editor", "viewer"]).optional(),
      canEditProfile: z.boolean().optional(),
      canManageAvatar: z.boolean().optional(),
      canAttachToPosts: z.boolean().optional(),
      canPostAsCompanion: z.boolean().optional(),
      canViewCareRecord: z.boolean().optional(),
      canUseVetServices: z.boolean().optional(),
      canManageAccess: z.boolean().optional(),
    }).parse(request.body);
    const [updated] = await db.update(companionManagers).set(body).where(and(
      eq(companionManagers.companionId, companionId),
      eq(companionManagers.userId, userId),
      ne(companionManagers.role, "owner"),
      isNull(companionManagers.revokedAt),
    )).returning();
    if (!updated) throw new AppError(404, "COMPANION_MANAGER_NOT_FOUND", "Manager was not found.");
    return updated;
  });
  app.delete("/v1/companions/:companionId/managers/:userId", { preHandler: app.authenticate }, async (request, reply) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const { userId } = userParamsSchema.parse(request.params);
    await requireAccessManager(companionId, request.auth!.userId);
    const [updated] = await db.update(companionManagers).set({ revokedAt: new Date() }).where(and(
      eq(companionManagers.companionId, companionId),
      eq(companionManagers.userId, userId),
      ne(companionManagers.role, "owner"),
      isNull(companionManagers.revokedAt),
    )).returning();
    if (!updated) throw new AppError(404, "COMPANION_MANAGER_NOT_FOUND", "Manager was not found.");
    return reply.code(204).send();
  });

  app.get("/v1/companions/:companionId/relationships", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    await getCompanion(companionId, request.auth?.userId ?? null);
    return {
      relationships: await db.select({
        relationship: companionRelationships,
        companion: companions,
      }).from(companionRelationships).innerJoin(companions, eq(companions.id, companionRelationships.relatedCompanionId)).where(eq(companionRelationships.companionId, companionId)),
    };
  });
  app.post("/v1/companions/:companionId/relationships", { preHandler: app.authenticate }, async (request, reply) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    await requireAccessManager(companionId, request.auth!.userId);
    const body = z.object({ relatedCompanionId: z.uuid(), type: z.string().trim().min(1).max(50) }).parse(request.body);
    if (body.relatedCompanionId === companionId) throw new AppError(400, "COMPANION_RELATIONSHIP_SELF", "A companion cannot be related to itself.");
    const [created] = await db.insert(companionRelationships).values({
      companionId,
      relatedCompanionId: body.relatedCompanionId,
      type: body.type,
      createdByUserId: request.auth!.userId,
    }).onConflictDoNothing().returning();
    if (!created) throw new AppError(409, "COMPANION_RELATIONSHIP_EXISTS", "Relationship already exists.");
    return reply.code(201).send(created);
  });
  app.delete("/v1/companions/:companionId/relationships/:relationshipId", { preHandler: app.authenticate }, async (request, reply) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const { relationshipId } = relationshipParamsSchema.parse(request.params);
    await requireAccessManager(companionId, request.auth!.userId);
    const deleted = await db.delete(companionRelationships).where(and(
      eq(companionRelationships.id, relationshipId),
      eq(companionRelationships.companionId, companionId),
    )).returning({ id: companionRelationships.id });
    if (!deleted.length) throw new AppError(404, "COMPANION_RELATIONSHIP_NOT_FOUND", "Relationship was not found.");
    return reply.code(204).send();
  });

  app.put(
    "/v1/companions/:companionId/followers/me",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = companionParamsSchema.parse(request.params);
      await followCompanion(params.companionId, request.auth!.userId);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/v1/companions/:companionId/followers/me",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = companionParamsSchema.parse(request.params);
      await unfollowCompanion(params.companionId, request.auth!.userId);
      return reply.code(204).send();
    },
  );

  app.get("/v1/companions/:companionId/followers", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    await getCompanion(companionId, request.auth?.userId ?? null);
    return {
      followers: await db.select({
        userId: companionFollowers.userId,
        followedAt: companionFollowers.createdAt,
        displayName: userProfiles.displayName,
        handle: userProfiles.handle,
      }).from(companionFollowers).innerJoin(userProfiles, eq(userProfiles.userId, companionFollowers.userId)).where(eq(companionFollowers.companionId, companionId)).orderBy(desc(companionFollowers.createdAt)),
    };
  });
  app.get("/v1/me/treat-wallet", { preHandler: app.authenticate }, async (request) => {
    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);
    const [used] = await db.select({ value: count() }).from(companionTreats).where(and(
      eq(companionTreats.giverUserId, request.auth!.userId),
      gte(companionTreats.createdAt, periodStart),
    ));
    const monthlyAllowance = 100;
    return {
      monthlyAllowance,
      used: used?.value ?? 0,
      remaining: Math.max(0, monthlyAllowance - (used?.value ?? 0)),
      resetsAt: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)),
    };
  });
  app.post("/v1/companions/:companionId/treats", { preHandler: app.authenticate }, async (request, reply) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const model = await getCompanion(companionId, request.auth!.userId);
    if (!model.viewer.canTreat) throw new AppError(403, "COMPANION_TREAT_FORBIDDEN", "You cannot give this companion a treat.");
    const idempotencyKey = z.string().trim().min(8).max(200).parse(request.headers["idempotency-key"]);
    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${request.auth!.userId}))`);
      const [existing] = await tx.select().from(companionTreats).where(and(
        eq(companionTreats.giverUserId, request.auth!.userId),
        eq(companionTreats.idempotencyKey, idempotencyKey),
      )).limit(1);
      const [used] = await tx.select({ value: count() }).from(companionTreats).where(and(
        eq(companionTreats.giverUserId, request.auth!.userId),
        gte(companionTreats.createdAt, periodStart),
      ));
      if (existing) {
        const [total] = await tx.select({ value: count() }).from(companionTreats).where(eq(companionTreats.companionId, existing.companionId));
        return {
          treat: existing,
          remaining: Math.max(0, 100 - (used?.value ?? 0)),
          companionTreatCount: total?.value ?? 0,
          repeated: true,
        };
      }
      if ((used?.value ?? 0) >= 100) throw new AppError(409, "TREAT_WALLET_EMPTY", "No treats remain this month.");
      const [created] = await tx.insert(companionTreats).values({
        companionId,
        giverUserId: request.auth!.userId,
        idempotencyKey,
      }).returning();
      if (model.ownerId !== request.auth!.userId) {
        await tx.insert(notifications).values({
          userId: model.ownerId,
          type: "companion.treat_received",
          title: `${model.name} received a treat`,
          body: "A community member sent your companion a treat.",
          actorUserId: request.auth!.userId,
          targetType: "companion",
          targetId: companionId,
          deduplicationKey: `companion-treat:${created!.id}`,
          data: { companionId, treatId: created!.id },
        });
      }
      await tx.insert(outboxEvents).values({
        aggregateType: "companion",
        aggregateId: companionId,
        eventType: "companion.treat_received",
        payload: {
          companionId,
          ownerUserId: model.ownerId,
          giverUserId: request.auth!.userId,
          treatId: created!.id,
        },
      });
      const [total] = await tx.select({ value: count() }).from(companionTreats).where(eq(companionTreats.companionId, companionId));
      return {
        treat: created!,
        remaining: 99 - (used?.value ?? 0),
        companionTreatCount: total?.value ?? 0,
        repeated: false,
      };
    });
    return reply.code(result.repeated ? 200 : 201).send({
      treat: result.treat,
      remaining: result.remaining,
      companionTreatCount: result.companionTreatCount,
      ownerId: model.ownerId,
    });
  });
  app.get("/v1/companions/:companionId/treats/summary", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const model = await getCompanion(companionId, request.auth?.userId ?? null);
    return {
      total: model.stats.treats,
      visibility: model.stats.treats === null ? "hidden" : "visible",
    };
  });
  app.get("/v1/companions/:companionId/treats/recent", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    const model = await getCompanion(companionId, request.auth?.userId ?? null);
    if (model.stats.treats === null) return { treats: [], visibility: "hidden" };
    return {
      visibility: "visible",
      treats: await db.select({
        id: companionTreats.id,
        createdAt: companionTreats.createdAt,
        giverUserId: companionTreats.giverUserId,
        giverName: userProfiles.displayName,
        giverHandle: userProfiles.handle,
      }).from(companionTreats).innerJoin(userProfiles, eq(userProfiles.userId, companionTreats.giverUserId)).where(eq(companionTreats.companionId, companionId)).orderBy(desc(companionTreats.createdAt)).limit(50),
    };
  });
  app.get("/v1/me/companions/treats/summary", { preHandler: app.authenticate }, async (request) => {
    const owned = await db.select({
      id: companions.id,
      name: companions.name,
    }).from(companions).where(eq(companions.primaryOwnerUserId, request.auth!.userId));
    const ids = owned.map((item) => item.id);
    if (ids.length === 0) return { total: 0, companions: [], recent: [] };
    const summaries = await Promise.all(owned.map(async (companion) => {
      const [total] = await db.select({ value: count() }).from(companionTreats).where(eq(companionTreats.companionId, companion.id));
      return { companionId: companion.id, companionName: companion.name, total: total?.value ?? 0 };
    }));
    const recent = await db.select({
      id: companionTreats.id,
      companionId: companionTreats.companionId,
      createdAt: companionTreats.createdAt,
      giverUserId: companionTreats.giverUserId,
      giverName: userProfiles.displayName,
      giverHandle: userProfiles.handle,
    }).from(companionTreats)
      .innerJoin(userProfiles, eq(userProfiles.userId, companionTreats.giverUserId))
      .innerJoin(companions, eq(companions.id, companionTreats.companionId))
      .where(eq(companions.primaryOwnerUserId, request.auth!.userId))
      .orderBy(desc(companionTreats.createdAt))
      .limit(50);
    return {
      total: summaries.reduce((sum, item) => sum + item.total, 0),
      companions: summaries,
      recent,
    };
  });
  app.get("/v1/companions/:companionId/feed-posts", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { companionId } = companionParamsSchema.parse(request.params);
    await getCompanion(companionId, request.auth?.userId ?? null);
    const rows = await db.select({ postId: postCompanions.postId }).from(postCompanions).innerJoin(posts, eq(posts.id, postCompanions.postId)).where(and(
      eq(postCompanions.companionId, companionId),
      eq(posts.status, "published"),
      isNull(posts.deletedAt),
    )).orderBy(desc(posts.createdAt)).limit(100);
    return { posts: await Promise.all(rows.map((row) => getPost(row.postId, request.auth?.userId ?? null))) };
  });
  app.get("/v1/me/adoptions/eligible-companions", { preHandler: app.authenticate }, async (request) => ({
    records: await db.select().from(adoptionRecords).where(and(
      eq(adoptionRecords.adopterId, request.auth!.userId),
      isNull(adoptionRecords.companionId),
      isNull(adoptionRecords.closedAt),
    )).orderBy(desc(adoptionRecords.confirmedAt)),
  }));
  app.post("/v1/adoptions/:adoptionRecordId/companion", { preHandler: app.authenticate }, async (request, reply) => {
    const { adoptionRecordId } = adoptionParamsSchema.parse(request.params);
    const body = z.object({
      publicHandle: nullableText(30),
      about: nullableText(500),
      mood: nullableText(100),
      profileVisibility: z.enum(["everyone", "circles", "only_me"]).default("everyone"),
    }).parse(request.body ?? {});
    const [record] = await db.select().from(adoptionRecords).where(and(
      eq(adoptionRecords.id, adoptionRecordId),
      eq(adoptionRecords.adopterId, request.auth!.userId),
      isNull(adoptionRecords.companionId),
      isNull(adoptionRecords.closedAt),
    )).limit(1);
    if (!record) throw new AppError(409, "ADOPTION_COMPANION_NOT_ELIGIBLE", "Adoption record is not eligible.");
    const created = await createCompanion({
      actorUserId: request.auth!.userId,
      name: record.animalName,
      species: record.species,
      breedPublic: record.breed,
      publicHandle: body.publicHandle,
      about: body.about,
      mood: body.mood,
      profileVisibility: body.profileVisibility,
      requestId: request.id,
    });
    await db.transaction(async (tx) => {
      await tx.update(companions).set({
        sourceType: "adoption",
        sourceAdoptionRecordId: adoptionRecordId,
        updatedAt: new Date(),
      }).where(eq(companions.id, created.id));
      await tx.update(adoptionRecords).set({ companionId: created.id }).where(and(
        eq(adoptionRecords.id, adoptionRecordId),
        isNull(adoptionRecords.companionId),
      ));
    });
    return reply.code(201).send(await getCompanion(created.id, request.auth!.userId));
  });
};
