import type { FastifyPluginAsync } from "fastify";
import { and, avg, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  accountDeletionRequests,
  accounts,
  adoptionRecords,
  auditEvents,
  postComments,
  postSaves,
  posts,
  profileReviews,
  rescueCases,
  userProfiles,
  userSessions,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { getPost } from "../feed/service.js";
import { getMediaAsset } from "../media/service.js";
import {
  assignInitialUsername,
  blockUser,
  changeUsername,
  getOwnerProfile,
  getPrivacySettings,
  getPublicProfile,
  listBlockedUsers,
  unblockUser,
  updatePrivacySettings,
  updateProfile,
  usernameAvailability,
} from "./service.js";

const usernameParamsSchema = z.object({
  candidate: z.string().min(1).max(100),
});

const assignUsernameSchema = z.object({
  username: z.string().min(1).max(100),
});

const reviewParamsSchema = z.object({ reviewId: z.uuid() });

const updateProfileSchema = z
  .object({
    version: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(80).optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    publicLocationLabel: z.string().trim().max(120).nullable().optional(),
    websiteUrl: z.url().max(500).nullable().optional(),
  })
  .refine(
    (body) =>
      body.displayName !== undefined ||
      body.bio !== undefined ||
      body.publicLocationLabel !== undefined ||
      body.websiteUrl !== undefined,
    { message: "At least one profile field is required." },
  );

const userParamsSchema = z.object({
  userId: z.uuid(),
});

const privacySchema = z
  .object({
    version: z.number().int().positive(),
    profileVisibility: z
      .enum(["everyone", "circles", "only_me"])
      .optional(),
    discoverable: z.boolean().optional(),
    showOnline: z.boolean().optional(),
    defaultPostVisibility: z
      .enum(["everyone", "circles", "only_me"])
      .optional(),
    showLocation: z.boolean().optional(),
    showCompanions: z.boolean().optional(),
    showTreatsOnProfile: z.boolean().optional(),
    messagePolicy: z.enum(["everyone", "circles", "none"]).optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "version"), {
    message: "At least one privacy field is required.",
  });

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/users/search", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({
      query: z.string().trim().min(1).max(100),
      limit: z.coerce.number().int().min(1).max(25).default(10),
    }).parse(request.query);
    const rows = await db.select({
      id: userProfiles.userId,
      displayName: userProfiles.displayName,
      handle: userProfiles.handle,
      avatarMediaId: userProfiles.avatarMediaId,
    }).from(userProfiles).innerJoin(accounts, eq(accounts.id, userProfiles.userId)).where(and(
      eq(accounts.status, "active"),
      or(
        ilike(userProfiles.displayName, `%${query.query}%`),
        ilike(userProfiles.handle, `%${query.query}%`),
      ),
    )).orderBy(userProfiles.displayName).limit(query.limit);
    return { users: rows };
  });

  app.get("/v1/usernames/:candidate/availability", async (request) => {
    const params = usernameParamsSchema.parse(request.params);
    return usernameAvailability(params.candidate);
  });

  app.put(
    "/v1/me/username",
    { preHandler: app.authenticate },
    async (request) => {
      const body = assignUsernameSchema.parse(request.body);
      return assignInitialUsername({
        userId: request.auth!.userId,
        candidate: body.username,
        requestId: request.id,
      });
    },
  );

  app.post(
    "/v1/me/username-change",
    { preHandler: app.authenticate },
    async (request) => {
      const body = assignUsernameSchema.parse(request.body);
      return changeUsername({
        userId: request.auth!.userId,
        candidate: body.username,
        requestId: request.id,
      });
    },
  );

  app.get(
    "/v1/me/profile",
    { preHandler: app.authenticate },
    async (request) => getOwnerProfile(request.auth!.userId),
  );

  app.patch(
    "/v1/me/profile",
    { preHandler: app.authenticate },
    async (request) => {
      const body = updateProfileSchema.parse(request.body);
      return updateProfile({
        userId: request.auth!.userId,
        requestId: request.id,
        ...body,
      });
    },
  );

  app.put("/v1/me/profile/avatar", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({
      mediaAssetId: z.uuid(),
      version: z.number().int().positive(),
    }).parse(request.body);
    const asset = await getMediaAsset(request.auth!.userId, body.mediaAssetId);
    if (asset.status !== "ready" || asset.purpose !== "profile_avatar" || asset.mediaType !== "image") {
      throw new AppError(409, "PROFILE_AVATAR_INVALID", "Avatar media is not ready or has the wrong purpose.");
    }
    const [updated] = await db.update(userProfiles).set({
      avatarMediaId: body.mediaAssetId,
      profileVersion: body.version + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(userProfiles.userId, request.auth!.userId),
      eq(userProfiles.profileVersion, body.version),
    )).returning();
    if (!updated) throw new AppError(409, "PROFILE_VERSION_CONFLICT", "Profile changed on another device.");
    return getOwnerProfile(request.auth!.userId);
  });

  app.delete("/v1/me/profile/avatar", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ version: z.number().int().positive() }).parse(request.body);
    const [updated] = await db.update(userProfiles).set({
      avatarMediaId: null,
      profileVersion: body.version + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(userProfiles.userId, request.auth!.userId),
      eq(userProfiles.profileVersion, body.version),
    )).returning();
    if (!updated) throw new AppError(409, "PROFILE_VERSION_CONFLICT", "Profile changed on another device.");
    return reply.code(204).send();
  });

  app.get(
    "/v1/users/:userId/profile",
    { preHandler: app.optionalAuthenticate },
    async (request) => {
      const params = userParamsSchema.parse(request.params);
      return getPublicProfile(params.userId, request.auth?.userId ?? null);
    },
  );

  app.get("/v1/users/:userId/profile-content", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { userId } = userParamsSchema.parse(request.params);
    const query = z.object({
      type: z.enum(["posts", "rescues", "rehomed", "adopted"]),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(request.query);
    await getPublicProfile(userId, request.auth?.userId ?? null);
    if (query.type === "posts") {
      const rows = await db.select({ id: posts.id }).from(posts).where(and(
        eq(posts.authorUserId, userId),
        eq(posts.status, "published"),
        isNull(posts.deletedAt),
      )).orderBy(desc(posts.createdAt)).limit(query.limit);
      return { type: query.type, items: await Promise.all(rows.map((row) => getPost(row.id, request.auth?.userId ?? null))) };
    }
    if (query.type === "rescues") {
      return {
        type: query.type,
        items: await db.select().from(rescueCases).where(and(
          eq(rescueCases.ownerUserId, userId),
          isNull(rescueCases.archivedAt),
        )).orderBy(desc(rescueCases.createdAt)).limit(query.limit),
      };
    }
    return {
      type: query.type,
      items: await db.select().from(adoptionRecords).where(
        query.type === "rehomed"
          ? eq(adoptionRecords.posterId, userId)
          : eq(adoptionRecords.adopterId, userId),
      ).orderBy(desc(adoptionRecords.confirmedAt)).limit(query.limit),
    };
  });

  app.get("/v1/users/:userId/profile-summary", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { userId } = userParamsSchema.parse(request.params);
    const profile = await getPublicProfile(userId, request.auth?.userId ?? null);
    const [postRows, reviewRows] = await Promise.all([
      db.select({ value: count() }).from(posts).where(and(eq(posts.authorUserId, userId), eq(posts.status, "published"), isNull(posts.deletedAt))),
      db.select({ average: avg(profileReviews.rating), value: count() }).from(profileReviews).where(and(eq(profileReviews.subjectUserId, userId), eq(profileReviews.status, "published"))),
    ]);
    return {
      profile: profile.profile,
      impact: profile.impact,
      counts: {
        posts: postRows[0]?.value ?? 0,
        reviews: reviewRows[0]?.value ?? 0,
      },
      rating: reviewRows[0]?.average ? Number(reviewRows[0].average) : null,
    };
  });

  app.get(
    "/v1/me/privacy-settings",
    { preHandler: app.authenticate },
    async (request) => getPrivacySettings(request.auth!.userId),
  );

  app.patch(
    "/v1/me/privacy-settings",
    { preHandler: app.authenticate },
    async (request) => {
      const body = privacySchema.parse(request.body);
      return updatePrivacySettings({
        userId: request.auth!.userId,
        requestId: request.id,
        ...body,
      });
    },
  );

  app.get(
    "/v1/me/blocked-users",
    { preHandler: app.authenticate },
    async (request) => ({
      users: await listBlockedUsers(request.auth!.userId),
    }),
  );

  app.put(
    "/v1/me/blocked-users/:userId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = userParamsSchema.parse(request.params);
      await blockUser(request.auth!.userId, params.userId, request.id);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/v1/me/blocked-users/:userId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = userParamsSchema.parse(request.params);
      await unblockUser(request.auth!.userId, params.userId, request.id);
      return reply.code(204).send();
    },
  );

  app.get("/v1/me/saved-posts", { preHandler: app.authenticate }, async (request) => {
    const rows = await db.select({ postId: postSaves.postId }).from(postSaves).where(eq(postSaves.userId, request.auth!.userId)).orderBy(desc(postSaves.createdAt));
    return { posts: await Promise.all(rows.map((row) => getPost(row.postId, request.auth!.userId))) };
  });
  app.put("/v1/me/saved-posts/:postId", { preHandler: app.authenticate }, async (request, reply) => {
    const postId = z.object({ postId: z.uuid() }).parse(request.params).postId;
    await getPost(postId, request.auth!.userId);
    await db.insert(postSaves).values({ userId: request.auth!.userId, postId }).onConflictDoNothing();
    return reply.code(204).send();
  });
  app.delete("/v1/me/saved-posts/:postId", { preHandler: app.authenticate }, async (request, reply) => {
    const postId = z.object({ postId: z.uuid() }).parse(request.params).postId;
    await db.delete(postSaves).where(and(eq(postSaves.userId, request.auth!.userId), eq(postSaves.postId, postId)));
    return reply.code(204).send();
  });
  app.get("/v1/me/activity/comments", { preHandler: app.authenticate }, async (request) => ({
    comments: await db.select({
      comment: postComments,
      postBody: posts.body,
    }).from(postComments).innerJoin(posts, eq(posts.id, postComments.postId)).where(and(
      eq(postComments.authorUserId, request.auth!.userId),
      eq(postComments.state, "active"),
    )).orderBy(desc(postComments.createdAt)).limit(100),
  }));

  app.get("/v1/users/:userId/reviews", { preHandler: app.optionalAuthenticate }, async (request) => {
    const { userId } = userParamsSchema.parse(request.params);
    await getPublicProfile(userId, request.auth?.userId ?? null);
    return {
      reviews: await db.select({
        review: profileReviews,
        reviewerName: userProfiles.displayName,
        reviewerHandle: userProfiles.handle,
      }).from(profileReviews).innerJoin(userProfiles, eq(userProfiles.userId, profileReviews.reviewerUserId)).where(and(
        eq(profileReviews.subjectUserId, userId),
        eq(profileReviews.status, "published"),
      )).orderBy(desc(profileReviews.createdAt)),
    };
  });
  app.post("/v1/reviews", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      subjectUserId: z.uuid(),
      rating: z.number().int().min(1).max(5),
      text: z.string().trim().max(2_000).optional(),
    }).parse(request.body);
    if (body.subjectUserId === request.auth!.userId) throw new AppError(400, "REVIEW_SELF_FORBIDDEN", "You cannot review yourself.");
    await getPublicProfile(body.subjectUserId, request.auth!.userId);
    const [review] = await db.insert(profileReviews).values({
      reviewerUserId: request.auth!.userId,
      ...body,
    }).onConflictDoUpdate({
      target: [profileReviews.reviewerUserId, profileReviews.subjectUserId],
      set: { rating: body.rating, text: body.text, status: "published", updatedAt: new Date() },
    }).returning();
    return reply.code(201).send(review);
  });
  app.post("/v1/reviews/:reviewId/report", { preHandler: app.authenticate }, async (request, reply) => {
    const { reviewId } = reviewParamsSchema.parse(request.params);
    const body = z.object({ reason: z.string().trim().min(3).max(100), details: z.string().trim().max(2_000).optional() }).parse(request.body);
    const [review] = await db.select({ id: profileReviews.id }).from(profileReviews).where(eq(profileReviews.id, reviewId)).limit(1);
    if (!review) throw new AppError(404, "REVIEW_NOT_FOUND", "Review was not found.");
    const [report] = await db.insert(auditEvents).values({
      actorUserId: request.auth!.userId,
      action: "profile_review.reported",
      targetType: "profile_review",
      targetId: reviewId,
      requestId: request.id,
      metadata: body,
    }).returning({ id: auditEvents.id, createdAt: auditEvents.createdAt });
    return reply.code(201).send(report);
  });

  app.post("/v1/me/deactivate", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({ reason: z.string().trim().max(1_000).optional() }).parse(request.body ?? {});
    await db.transaction(async (tx) => {
      await tx.update(accounts).set({ status: "deactivated", updatedAt: new Date() }).where(eq(accounts.id, request.auth!.userId));
      await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(
        eq(userSessions.userId, request.auth!.userId),
        isNull(userSessions.revokedAt),
      ));
      await tx.insert(auditEvents).values({
        actorUserId: request.auth!.userId,
        action: "account.deactivated",
        targetType: "account",
        targetId: request.auth!.userId,
        requestId: request.id,
        metadata: body,
      });
    });
    return { deactivated: true };
  });
  app.post("/v1/me/reactivate", { preHandler: app.authenticate }, async (request) => {
    await db.update(accounts).set({ status: "active", updatedAt: new Date() }).where(eq(accounts.id, request.auth!.userId));
    return { reactivated: true };
  });
  app.post("/v1/me/deletion-requests", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ reason: z.string().trim().max(1_000).optional() }).parse(request.body ?? {});
    const executeAfter = new Date(Date.now() + 30 * 86_400_000);
    const [created] = await db.insert(accountDeletionRequests).values({
      userId: request.auth!.userId,
      reason: body.reason,
      executeAfter,
    }).onConflictDoUpdate({
      target: accountDeletionRequests.userId,
      targetWhere: eq(accountDeletionRequests.status, "pending"),
      set: { reason: body.reason, requestedAt: new Date(), executeAfter, cancelledAt: null },
    }).returning();
    return reply.code(201).send(created);
  });
  app.delete("/v1/me/deletion-requests/current", { preHandler: app.authenticate }, async (request, reply) => {
    const [updated] = await db.update(accountDeletionRequests).set({
      status: "cancelled",
      cancelledAt: new Date(),
    }).where(and(
      eq(accountDeletionRequests.userId, request.auth!.userId),
      eq(accountDeletionRequests.status, "pending"),
    )).returning();
    if (!updated) throw new AppError(404, "DELETION_REQUEST_NOT_FOUND", "No pending deletion request was found.");
    return reply.code(204).send();
  });
};
