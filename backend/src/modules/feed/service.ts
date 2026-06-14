import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  companionManagers,
  companions,
  communityMemberships,
  outboxEvents,
  pawCircles,
  circleMemberships,
  postAssets,
  postComments,
  postCompanions,
  postPlacements,
  postReactions,
  postSaves,
  posts,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { getReadyMediaReadModel, requireReadyOwnedAssets } from "../media/service.js";

type Destination = { type: "feed" | "community" | "paw_circle"; id?: string | undefined };

async function validateDestinations(userId: string, destinations: Destination[]) {
  for (const destination of destinations) {
    if (destination.type === "feed") continue;
    if (!destination.id) throw new AppError(400, "DESTINATION_ID_REQUIRED", "Destination ID is required.");

    if (destination.type === "community") {
      const [membership] = await db
        .select({ role: communityMemberships.role })
        .from(communityMemberships)
        .where(and(eq(communityMemberships.communityId, destination.id), eq(communityMemberships.userId, userId), eq(communityMemberships.state, "active")))
        .limit(1);
      if (!membership) throw new AppError(403, "COMMUNITY_MEMBERSHIP_REQUIRED", "Active community membership is required.");
    } else {
      const [membership] = await db
        .select({ id: circleMemberships.id })
        .from(circleMemberships)
        .innerJoin(pawCircles, eq(pawCircles.id, circleMemberships.circleId))
        .where(and(eq(circleMemberships.circleId, destination.id), eq(circleMemberships.userId, userId), eq(circleMemberships.status, "active"), eq(pawCircles.status, "active")))
        .limit(1);
      if (!membership) throw new AppError(403, "CIRCLE_MEMBERSHIP_REQUIRED", "Active Paw Circle membership is required.");
    }
  }
}

export async function createPost(input: {
  userId: string;
  body?: string | null | undefined;
  category?: string | null | undefined;
  visibility: "everyone" | "circles" | "only_me";
  presentationMode: "user" | "companion";
  authorCompanionId?: string | null | undefined;
  companionIds: string[];
  assetIds: string[];
  destinations: Destination[];
}) {
  if (!input.body?.trim() && input.assetIds.length === 0) {
    throw new AppError(400, "POST_CONTENT_REQUIRED", "Post text or media is required.");
  }
  if (input.destinations.length === 0) throw new AppError(400, "POST_DESTINATION_REQUIRED", "Choose at least one destination.");
  await requireReadyOwnedAssets(input.userId, input.assetIds);
  await validateDestinations(input.userId, input.destinations);

  const allCompanionIds = [...new Set([
    ...input.companionIds,
    ...(input.authorCompanionId ? [input.authorCompanionId] : []),
  ])];
  const manageable = allCompanionIds.length
    ? await db
        .select({
          id: companions.id,
          name: companions.name,
          avatarAssetId: companions.avatarAssetId,
          canAttach: companionManagers.canAttachToPosts,
          canPostAs: companionManagers.canPostAsCompanion,
        })
        .from(companionManagers)
        .innerJoin(companions, eq(companions.id, companionManagers.companionId))
        .where(and(eq(companionManagers.userId, input.userId), isNull(companionManagers.revokedAt), eq(companions.status, "active"), inArray(companions.id, allCompanionIds)))
    : [];
  if (manageable.length !== allCompanionIds.length || manageable.some((row) => !row.canAttach)) {
    throw new AppError(403, "COMPANION_NOT_MANAGEABLE", "One or more companions cannot be attached.");
  }

  if (input.presentationMode === "companion") {
    if (!input.authorCompanionId) throw new AppError(400, "COMPANION_AUTHOR_REQUIRED", "Companion author is required.");
    const author = manageable.find((row) => row.id === input.authorCompanionId);
    if (!author?.canPostAs) throw new AppError(403, "COMPANION_POST_FORBIDDEN", "You cannot post as this companion.");
    if (input.destinations.some((destination) => destination.type !== "feed")) {
      throw new AppError(400, "COMPANION_PRESENTATION_FEED_ONLY", "Companion-authored posts are limited to the main Feed.");
    }
  }

  const postId = await db.transaction(async (tx) => {
    const [post] = await tx.insert(posts).values({
      actorUserId: input.userId,
      authorUserId: input.userId,
      presentationMode: input.presentationMode,
      authorCompanionId: input.presentationMode === "companion" ? input.authorCompanionId : null,
      body: input.body?.trim() || null,
      category: input.category?.trim() || null,
      visibility: input.visibility,
    }).returning({ id: posts.id });
    if (!post) throw new AppError(500, "POST_CREATE_FAILED", "Post was not created.");

    const orderedIds = input.presentationMode === "companion"
      ? [input.authorCompanionId!, ...input.companionIds.filter((id) => id !== input.authorCompanionId)]
      : input.companionIds;
    if (orderedIds.length) {
      await tx.insert(postCompanions).values(orderedIds.map((id, position) => {
        const companion = manageable.find((row) => row.id === id)!;
        return {
          postId: post.id,
          companionId: id,
          relationshipType: id === input.authorCompanionId ? "author" : "with",
          position,
          displayNameSnapshot: companion.name,
          avatarAssetIdSnapshot: companion.avatarAssetId,
        };
      }));
    }
    if (input.assetIds.length) {
      await tx.insert(postAssets).values(input.assetIds.map((assetId, position) => ({ postId: post.id, assetId, position })));
    }
    await tx.insert(postPlacements).values(input.destinations.map((destination) => ({
      postId: post.id,
      destinationType: destination.type,
      destinationId: destination.id ?? null,
      visibility: input.visibility,
    })));
    await tx.insert(outboxEvents).values({
      aggregateType: "post",
      aggregateId: post.id,
      eventType: "post.created",
      payload: { postId: post.id, authorUserId: input.userId },
    });
    return post.id;
  });

  return getPost(postId, input.userId);
}

export async function getPost(postId: string, viewerUserId: string | null) {
  const [row] = await db
    .select({ post: posts, displayName: userProfiles.displayName, handle: userProfiles.handle, avatarMediaId: userProfiles.avatarMediaId })
    .from(posts)
    .innerJoin(userProfiles, eq(userProfiles.userId, posts.authorUserId))
    .where(and(eq(posts.id, postId), eq(posts.status, "published"), isNull(posts.deletedAt)))
    .limit(1);
  if (!row || (row.post.visibility === "only_me" && row.post.authorUserId !== viewerUserId)) {
    throw new AppError(404, "POST_NOT_FOUND", "Post was not found.");
  }

  const [companionRows, assetRows, reactionCountRows, commentCountRows, saveRows] = await Promise.all([
    db.select().from(postCompanions).where(eq(postCompanions.postId, postId)).orderBy(postCompanions.position),
    db.select().from(postAssets).where(eq(postAssets.postId, postId)).orderBy(postAssets.position),
    db.select({ value: count() }).from(postReactions).where(eq(postReactions.postId, postId)),
    db.select({ value: count() }).from(postComments).where(and(eq(postComments.postId, postId), eq(postComments.state, "active"))),
    viewerUserId ? db.select({ userId: postSaves.userId }).from(postSaves).where(and(eq(postSaves.postId, postId), eq(postSaves.userId, viewerUserId))).limit(1) : Promise.resolve([]),
  ]);
  const reaction = viewerUserId
    ? await db.select({ type: postReactions.reactionType }).from(postReactions).where(and(eq(postReactions.postId, postId), eq(postReactions.userId, viewerUserId))).limit(1)
    : [];

  const authorCompanion = row.post.authorCompanionId
    ? companionRows.find((item) => item.companionId === row.post.authorCompanionId)
    : null;
  return {
    id: row.post.id,
    body: row.post.body,
    category: row.post.category,
    visibility: row.post.visibility,
    presentationMode: row.post.presentationMode,
    displayAuthor: authorCompanion
      ? { type: "companion", id: authorCompanion.companionId, name: authorCompanion.displayNameSnapshot, avatarMediaId: authorCompanion.avatarAssetIdSnapshot }
      : { type: "user", id: row.post.authorUserId, name: row.displayName, handle: row.handle, avatarMediaId: row.avatarMediaId },
    companions: companionRows.map((item) => ({ id: item.companionId, name: item.displayNameSnapshot, avatarMediaId: item.avatarAssetIdSnapshot, relationship: item.relationshipType })),
    media: await Promise.all(assetRows.map(async (item) => ({
      assetId: item.assetId,
      position: item.position,
      altText: item.altText,
      ...(await getReadyMediaReadModel(item.assetId)),
    }))),
    counts: { reactions: reactionCountRows[0]?.value ?? 0, comments: commentCountRows[0]?.value ?? 0 },
    viewer: {
      reaction: reaction[0]?.type ?? null,
      saved: saveRows.length > 0,
      canEdit: row.post.authorUserId === viewerUserId,
      canDelete: row.post.authorUserId === viewerUserId,
    },
    createdAt: row.post.createdAt,
    updatedAt: row.post.updatedAt,
    version: row.post.version,
  };
}

export async function listPosts(input: { viewerUserId: string | null; destinationType: string; destinationId?: string | undefined; limit: number }) {
  const conditions = [
    eq(postPlacements.destinationType, input.destinationType),
    isNull(postPlacements.removedAt),
    eq(postPlacements.moderationStatus, "approved"),
    eq(posts.status, "published"),
    isNull(posts.deletedAt),
  ];
  if (input.destinationId) conditions.push(eq(postPlacements.destinationId, input.destinationId));
  else conditions.push(isNull(postPlacements.destinationId));

  const rows = await db.select({ id: posts.id }).from(postPlacements).innerJoin(posts, eq(posts.id, postPlacements.postId)).where(and(...conditions)).orderBy(desc(posts.createdAt)).limit(input.limit);
  return Promise.all(rows.map((row) => getPost(row.id, input.viewerUserId)));
}

export async function setReaction(postId: string, userId: string, reactionType: string | null) {
  await getPost(postId, userId);
  if (!reactionType) {
    await db.delete(postReactions).where(and(eq(postReactions.postId, postId), eq(postReactions.userId, userId)));
  } else {
    await db.insert(postReactions).values({ postId, userId, reactionType }).onConflictDoUpdate({
      target: [postReactions.postId, postReactions.userId],
      set: { reactionType, createdAt: new Date() },
    });
  }
  return getPost(postId, userId);
}

export async function setSaved(postId: string, userId: string, saved: boolean) {
  await getPost(postId, userId);
  if (saved) await db.insert(postSaves).values({ postId, userId }).onConflictDoNothing();
  else await db.delete(postSaves).where(and(eq(postSaves.postId, postId), eq(postSaves.userId, userId)));
}

export async function createComment(postId: string, userId: string, body: string, parentCommentId?: string | undefined) {
  await getPost(postId, userId);
  const [comment] = await db.insert(postComments).values({ postId, authorUserId: userId, body: body.trim(), parentCommentId }).returning();
  return comment!;
}

export async function listComments(postId: string, viewerUserId: string | null) {
  await getPost(postId, viewerUserId);
  return db
    .select({ comment: postComments, displayName: userProfiles.displayName, handle: userProfiles.handle })
    .from(postComments)
    .innerJoin(userProfiles, eq(userProfiles.userId, postComments.authorUserId))
    .where(and(eq(postComments.postId, postId), eq(postComments.state, "active")))
    .orderBy(postComments.createdAt);
}
