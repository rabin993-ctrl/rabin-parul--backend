import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  auditEvents,
  communities,
  communityMemberships,
  communityReports,
  communityRules,
  communitySettings,
  notificationPreferences,
  outboxEvents,
  postComments,
  postPlacements,
  postSaves,
  posts,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import {
  createComment,
  createPost,
  getPost,
  listComments,
  listPosts,
  setReaction,
  setSaved,
} from "../feed/service.js";
import { createNotification } from "../notifications/routes.js";

const params = z.object({ communityId: z.uuid() });
const memberParams = z.object({ communityId: z.uuid(), userId: z.uuid() });
const requestParams = z.object({ communityId: z.uuid(), requestId: z.uuid() });
const invitationParams = z.object({ id: z.uuid() });
const postParams = z.object({ id: z.uuid() });
const commentParams = z.object({ id: z.uuid() });
const reportParams = z.object({ id: z.uuid() });
const slugify = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)}-${crypto.randomUUID().slice(0, 6)}`;

const postCreateSchema = z.object({
  body: z.string().max(10_000).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  visibility: z.enum(["everyone", "circles", "only_me"]).default("everyone"),
  companionIds: z.array(z.uuid()).max(10).default([]),
  assetIds: z.array(z.uuid()).max(10).default([]),
});

async function role(communityId: string, userId: string) {
  const [membership] = await db.select().from(communityMemberships)
    .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, userId))).limit(1);
  return membership;
}

async function requireMember(communityId: string, userId: string) {
  const membership = await role(communityId, userId);
  if (!membership || membership.state !== "active") throw new AppError(403, "COMMUNITY_MEMBERSHIP_REQUIRED", "Active community membership is required.");
  return membership;
}

async function requireManager(communityId: string, userId: string) {
  const membership = await requireMember(communityId, userId);
  if (!["owner", "admin", "moderator"].includes(membership.role ?? "")) {
    throw new AppError(403, "COMMUNITY_ADMIN_REQUIRED", "Community moderator role is required.");
  }
  return membership;
}

async function requireAdmin(communityId: string, userId: string) {
  const membership = await requireMember(communityId, userId);
  if (!["owner", "admin"].includes(membership.role ?? "")) {
    throw new AppError(403, "COMMUNITY_ADMIN_REQUIRED", "Community admin role is required.");
  }
  return membership;
}

async function readModel(communityId: string, viewerUserId: string | null) {
  const [row] = await db.select({ community: communities, settings: communitySettings }).from(communities)
    .innerJoin(communitySettings, eq(communitySettings.communityId, communities.id))
    .where(eq(communities.id, communityId)).limit(1);
  if (!row || row.community.status !== "active") throw new AppError(404, "COMMUNITY_NOT_FOUND", "Community was not found.");
  const membership = viewerUserId ? await role(communityId, viewerUserId) : null;
  if (!row.settings.discoverable && !membership) throw new AppError(404, "COMMUNITY_NOT_FOUND", "Community was not found.");
  const [members] = await db.select({ value: count() }).from(communityMemberships)
    .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.state, "active")));
  return {
    ...row.community,
    settings: row.settings,
    memberCount: members?.value ?? 0,
    relationship: membership?.state ?? "none",
    viewerRole: membership?.role ?? null,
    viewer: {
      canViewPosts: !row.settings.membersOnly || membership?.state === "active",
      canPost: membership?.state === "active",
      canManage: membership?.state === "active" && ["owner", "admin", "moderator"].includes(membership.role ?? ""),
    },
  };
}

async function communityForPost(postId: string) {
  const [placement] = await db.select().from(postPlacements).where(and(
    eq(postPlacements.postId, postId),
    eq(postPlacements.destinationType, "community"),
    isNull(postPlacements.removedAt),
  )).limit(1);
  if (!placement?.destinationId) throw new AppError(404, "COMMUNITY_POST_NOT_FOUND", "Community post was not found.");
  return placement;
}

async function createCommunityPost(communityId: string, userId: string, input: z.infer<typeof postCreateSchema>) {
  const model = await readModel(communityId, userId);
  if (!model.viewer.canPost) throw new AppError(403, "COMMUNITY_MEMBERSHIP_REQUIRED", "Membership is required to post.");
  const post = await createPost({
    userId,
    body: input.body,
    category: input.category,
    visibility: input.visibility,
    presentationMode: "user",
    companionIds: input.companionIds,
    assetIds: input.assetIds,
    destinations: [{ type: "community", id: communityId }],
  });
  if (model.settings.postApprovalRequired && !model.viewer.canManage) {
    await db.update(postPlacements).set({ moderationStatus: "pending" }).where(and(
      eq(postPlacements.postId, post.id),
      eq(postPlacements.destinationType, "community"),
      eq(postPlacements.destinationId, communityId),
    ));
  }
  return { ...post, moderationStatus: model.settings.postApprovalRequired && !model.viewer.canManage ? "pending" : "approved" };
}

async function resolveJoinRequest(communityId: string, requestId: string, reviewerId: string, approved: boolean, reason?: string) {
  await requireManager(communityId, reviewerId);
  const [updated] = await db.update(communityMemberships).set({
    state: approved ? "active" : "rejected",
    role: approved ? "member" : null,
    joinedAt: approved ? new Date() : null,
    resolvedBy: reviewerId,
    resolutionReason: reason,
    updatedAt: new Date(),
    version: sql`${communityMemberships.version} + 1`,
  }).where(and(
    eq(communityMemberships.id, requestId),
    eq(communityMemberships.communityId, communityId),
    eq(communityMemberships.state, "requested"),
  )).returning();
  if (!updated) throw new AppError(409, "JOIN_REQUEST_NOT_PENDING", "Join request is not pending.");
  await createNotification({
    userId: updated.userId,
    type: approved ? "community_join_approved" : "community_join_declined",
    title: approved ? "Community request approved" : "Community request declined",
    body: approved ? "You can now participate in the community." : "Your community request was declined.",
    targetType: "community",
    targetId: communityId,
  });
  return updated;
}

export const communityRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/communities", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      name: z.string().trim().min(3).max(80),
      about: z.string().trim().min(12).max(500),
      tint: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      joinPolicy: z.enum(["open", "request", "invite"]).default("open"),
      membersOnly: z.boolean().default(false),
      discoverable: z.boolean().default(true),
    }).parse(request.body);
    const id = await db.transaction(async (tx) => {
      const [community] = await tx.insert(communities).values({
        ownerUserId: request.auth!.userId,
        name: body.name,
        slug: slugify(body.name),
        about: body.about,
        tint: body.tint,
      }).returning({ id: communities.id });
      if (!community) throw new AppError(500, "COMMUNITY_CREATE_FAILED", "Community was not created.");
      await tx.insert(communitySettings).values({
        communityId: community.id,
        joinPolicy: body.joinPolicy,
        membersOnly: body.membersOnly,
        discoverable: body.discoverable,
        updatedBy: request.auth!.userId,
      });
      await tx.insert(communityMemberships).values({ communityId: community.id, userId: request.auth!.userId, state: "active", role: "owner", joinedAt: new Date() });
      await tx.insert(outboxEvents).values({ aggregateType: "community", aggregateId: community.id, eventType: "community.created", payload: { communityId: community.id } });
      return community.id;
    });
    return reply.code(201).send(await readModel(id, request.auth!.userId));
  });

  const discover = async (request: Parameters<FastifyPluginAsync>[0] extends never ? never : any) => {
    const query = z.object({ query: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const conditions = [eq(communities.status, "active"), eq(communitySettings.discoverable, true)];
    if (query.query) conditions.push(ilike(communities.name, `%${query.query}%`));
    const rows = await db.select({ id: communities.id }).from(communities)
      .innerJoin(communitySettings, eq(communitySettings.communityId, communities.id))
      .where(and(...conditions)).orderBy(desc(communities.createdAt)).limit(query.limit);
    return { communities: await Promise.all(rows.map((row) => readModel(row.id, request.auth?.userId ?? null))) };
  };

  app.get("/v1/communities/discover", { preHandler: app.optionalAuthenticate }, discover);
  app.get("/v1/communities/search", { preHandler: app.optionalAuthenticate }, discover);

  app.get("/v1/me/communities", { preHandler: app.authenticate }, async (request) => {
    const rows = await db.select({ id: communities.id }).from(communityMemberships)
      .innerJoin(communities, eq(communities.id, communityMemberships.communityId))
      .where(and(eq(communityMemberships.userId, request.auth!.userId), eq(communityMemberships.state, "active"), eq(communities.status, "active")))
      .orderBy(communities.name);
    return { communities: await Promise.all(rows.map((row) => readModel(row.id, request.auth!.userId))) };
  });

  app.get("/v1/communities/:communityId", { preHandler: app.optionalAuthenticate }, async (request) =>
    readModel(params.parse(request.params).communityId, request.auth?.userId ?? null));

  app.patch("/v1/communities/:communityId", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await requireAdmin(communityId, request.auth!.userId);
    const body = z.object({
      version: z.number().int().positive(),
      settingsVersion: z.number().int().positive(),
      name: z.string().trim().min(3).max(80).optional(),
      about: z.string().trim().min(12).max(500).optional(),
      tint: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
      joinPolicy: z.enum(["open", "request", "invite"]).optional(),
      membersOnly: z.boolean().optional(),
      discoverable: z.boolean().optional(),
      showLocation: z.boolean().optional(),
      allowLinks: z.boolean().optional(),
      postApprovalRequired: z.boolean().optional(),
      requirePhotoLostFound: z.boolean().optional(),
    }).parse(request.body);
    await db.transaction(async (tx) => {
      const [community] = await tx.update(communities).set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.about !== undefined && { about: body.about }),
        ...(body.tint !== undefined && { tint: body.tint }),
        version: sql`${communities.version} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(communities.id, communityId), eq(communities.version, body.version), eq(communities.status, "active"))).returning();
      if (!community) throw new AppError(409, "COMMUNITY_VERSION_CONFLICT", "Community changed on another device.");
      const [settings] = await tx.update(communitySettings).set({
        ...(body.joinPolicy !== undefined && { joinPolicy: body.joinPolicy }),
        ...(body.membersOnly !== undefined && { membersOnly: body.membersOnly }),
        ...(body.discoverable !== undefined && { discoverable: body.discoverable }),
        ...(body.showLocation !== undefined && { showLocation: body.showLocation }),
        ...(body.allowLinks !== undefined && { allowLinks: body.allowLinks }),
        ...(body.postApprovalRequired !== undefined && { postApprovalRequired: body.postApprovalRequired }),
        ...(body.requirePhotoLostFound !== undefined && { requirePhotoLostFound: body.requirePhotoLostFound }),
        version: sql`${communitySettings.version} + 1`,
        updatedBy: request.auth!.userId,
        updatedAt: new Date(),
      }).where(and(eq(communitySettings.communityId, communityId), eq(communitySettings.version, body.settingsVersion))).returning();
      if (!settings) throw new AppError(409, "COMMUNITY_SETTINGS_VERSION_CONFLICT", "Community settings changed on another device.");
    });
    return readModel(communityId, request.auth!.userId);
  });

  app.post("/v1/communities/:communityId/archive", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    const current = await requireMember(communityId, request.auth!.userId);
    if (current.role !== "owner") throw new AppError(403, "COMMUNITY_OWNER_REQUIRED", "Only the owner can archive this community.");
    await db.update(communities).set({ status: "archived", archivedAt: new Date(), updatedAt: new Date(), version: sql`${communities.version} + 1` })
      .where(eq(communities.id, communityId));
    return { archived: true };
  });

  app.delete("/v1/communities/:communityId", { preHandler: app.authenticate }, async (request, reply) => {
    const communityId = params.parse(request.params).communityId;
    const current = await requireMember(communityId, request.auth!.userId);
    if (current.role !== "owner") throw new AppError(403, "COMMUNITY_OWNER_REQUIRED", "Only the owner can delete this community.");
    await db.update(communities).set({ status: "deleted", archivedAt: new Date(), updatedAt: new Date(), version: sql`${communities.version} + 1` })
      .where(eq(communities.id, communityId));
    await db.insert(auditEvents).values({ actorUserId: request.auth!.userId, action: "community.deleted", targetType: "community", targetId: communityId });
    return reply.code(204).send();
  });

  app.get("/v1/communities/:communityId/settings", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await requireMember(communityId, request.auth!.userId);
    const [settings] = await db.select().from(communitySettings).where(eq(communitySettings.communityId, communityId)).limit(1);
    return settings;
  });

  app.patch("/v1/communities/:communityId/settings", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await requireAdmin(communityId, request.auth!.userId);
    const body = z.object({
      version: z.number().int().positive(),
      joinPolicy: z.enum(["open", "request", "invite"]).optional(),
      membersOnly: z.boolean().optional(),
      discoverable: z.boolean().optional(),
      showLocation: z.boolean().optional(),
      allowLinks: z.boolean().optional(),
      postApprovalRequired: z.boolean().optional(),
      requirePhotoLostFound: z.boolean().optional(),
    }).parse(request.body);
    const { version, ...changes } = body;
    const [updated] = await db.update(communitySettings).set({
      ...changes,
      version: sql`${communitySettings.version} + 1`,
      updatedBy: request.auth!.userId,
      updatedAt: new Date(),
    }).where(and(eq(communitySettings.communityId, communityId), eq(communitySettings.version, version))).returning();
    if (!updated) throw new AppError(409, "COMMUNITY_SETTINGS_VERSION_CONFLICT", "Community settings changed on another device.");
    return updated;
  });

  app.get("/v1/communities/:communityId/rules", { preHandler: app.optionalAuthenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await readModel(communityId, request.auth?.userId ?? null);
    return { rules: await db.select().from(communityRules).where(and(eq(communityRules.communityId, communityId), eq(communityRules.active, true))).orderBy(communityRules.position) };
  });

  app.put("/v1/communities/:communityId/rules", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await requireAdmin(communityId, request.auth!.userId);
    const body = z.object({ rules: z.array(z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(1_000) })).max(20) }).parse(request.body);
    await db.transaction(async (tx) => {
      await tx.delete(communityRules).where(eq(communityRules.communityId, communityId));
      if (body.rules.length) {
        await tx.insert(communityRules).values(body.rules.map((rule, position) => ({ communityId, title: rule.title, body: rule.body, position })));
      }
    });
    return { rules: await db.select().from(communityRules).where(eq(communityRules.communityId, communityId)).orderBy(communityRules.position) };
  });

  const join = async (communityId: string, userId: string, message?: string) => {
    const model = await readModel(communityId, userId);
    const existing = await role(communityId, userId);
    if (existing?.state === "banned") throw new AppError(403, "COMMUNITY_MEMBERSHIP_BANNED", "You cannot join this community.");
    if (model.settings.joinPolicy === "invite") throw new AppError(403, "COMMUNITY_INVITATION_REQUIRED", "An invitation is required.");
    const state = model.settings.joinPolicy === "open" ? "active" : "requested";
    await db.insert(communityMemberships).values({
      communityId,
      userId,
      state,
      role: state === "active" ? "member" : null,
      requestMessage: message,
      joinedAt: state === "active" ? new Date() : null,
    }).onConflictDoUpdate({
      target: [communityMemberships.communityId, communityMemberships.userId],
      set: { state, role: state === "active" ? "member" : null, requestMessage: message, joinedAt: state === "active" ? new Date() : null, updatedAt: new Date() },
    });
    return readModel(communityId, userId);
  };

  app.post("/v1/communities/:communityId/join", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({ message: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    return join(params.parse(request.params).communityId, request.auth!.userId, body.message);
  });

  app.post("/v1/communities/:communityId/join-requests", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({ message: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    return join(params.parse(request.params).communityId, request.auth!.userId, body.message);
  });

  app.delete("/v1/communities/:communityId/join-requests/me", { preHandler: app.authenticate }, async (request, reply) => {
    await db.update(communityMemberships).set({ state: "left", updatedAt: new Date() }).where(and(
      eq(communityMemberships.communityId, params.parse(request.params).communityId),
      eq(communityMemberships.userId, request.auth!.userId),
      eq(communityMemberships.state, "requested"),
    ));
    return reply.code(204).send();
  });

  app.delete("/v1/communities/:communityId/membership", { preHandler: app.authenticate }, async (request, reply) => {
    const communityId = params.parse(request.params).communityId;
    const current = await requireMember(communityId, request.auth!.userId);
    if (current.role === "owner") throw new AppError(409, "COMMUNITY_OWNER_CANNOT_LEAVE", "Transfer ownership before leaving this community.");
    await db.update(communityMemberships).set({ state: "left", role: null, updatedAt: new Date() })
      .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, request.auth!.userId)));
    return reply.code(204).send();
  });

  app.get("/v1/communities/:communityId/join-requests", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await requireManager(communityId, request.auth!.userId);
    return {
      requests: await db.select({
        id: communityMemberships.id,
        communityId: communityMemberships.communityId,
        userId: communityMemberships.userId,
        state: communityMemberships.state,
        role: communityMemberships.role,
        createdAt: communityMemberships.createdAt,
        displayName: userProfiles.displayName,
        handle: userProfiles.handle,
      }).from(communityMemberships)
        .innerJoin(userProfiles, eq(userProfiles.userId, communityMemberships.userId))
        .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.state, "requested"))),
    };
  });

  app.post("/v1/communities/:communityId/join-requests/:requestId/approve", { preHandler: app.authenticate }, async (request) => {
    const { communityId, requestId } = requestParams.parse(request.params);
    return resolveJoinRequest(communityId, requestId, request.auth!.userId, true);
  });

  const declineRequest = async (request: any) => {
    const { communityId, requestId } = requestParams.parse(request.params);
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    return resolveJoinRequest(communityId, requestId, request.auth!.userId, false, body.reason);
  };
  app.post("/v1/communities/:communityId/join-requests/:requestId/decline", { preHandler: app.authenticate }, declineRequest);
  app.post("/v1/communities/:communityId/join-requests/:requestId/reject", { preHandler: app.authenticate }, declineRequest);

  app.post("/v1/communities/:communityId/invitations", { preHandler: app.authenticate }, async (request, reply) => {
    const communityId = params.parse(request.params).communityId;
    await requireManager(communityId, request.auth!.userId);
    const body = z.object({ userId: z.uuid(), message: z.string().trim().max(500).optional() }).parse(request.body);
    const existing = await role(communityId, body.userId);
    if (existing?.state === "banned") throw new AppError(409, "COMMUNITY_INVITEE_BANNED", "This user is banned from the community.");
    if (existing?.state === "active") throw new AppError(409, "COMMUNITY_ALREADY_MEMBER", "This user is already a member.");
    const [invitation] = await db.insert(communityMemberships).values({
      communityId,
      userId: body.userId,
      state: "invited",
      role: "member",
      requestMessage: body.message,
      invitedBy: request.auth!.userId,
    }).onConflictDoUpdate({
      target: [communityMemberships.communityId, communityMemberships.userId],
      set: { state: "invited", role: "member", requestMessage: body.message, invitedBy: request.auth!.userId, resolvedBy: null, resolutionReason: null, updatedAt: new Date() },
    }).returning();
    await createNotification({ userId: body.userId, type: "community_invitation", title: "Community invitation", body: "You were invited to a community.", targetType: "community", targetId: communityId });
    return reply.code(201).send(invitation);
  });

  app.get("/v1/community-invitations", { preHandler: app.authenticate }, async (request) => {
    const invitations = await db.select().from(communityMemberships)
      .where(and(eq(communityMemberships.userId, request.auth!.userId), eq(communityMemberships.state, "invited")))
      .orderBy(desc(communityMemberships.updatedAt));
    return { invitations: await Promise.all(invitations.map(async (item) => ({ ...item, community: await readModel(item.communityId, request.auth!.userId) }))) };
  });

  const resolveInvitation = async (id: string, userId: string, action: "accept" | "decline" | "revoke") => {
    const conditions = [eq(communityMemberships.id, id), eq(communityMemberships.state, "invited")];
    if (action !== "revoke") conditions.push(eq(communityMemberships.userId, userId));
    const [invitation] = await db.select().from(communityMemberships).where(and(...conditions)).limit(1);
    if (!invitation) throw new AppError(404, "COMMUNITY_INVITATION_NOT_FOUND", "Invitation was not found.");
    if (action === "revoke") await requireManager(invitation.communityId, userId);
    const [updated] = await db.update(communityMemberships).set({
      state: action === "accept" ? "active" : action === "decline" ? "declined" : "revoked",
      role: action === "accept" ? "member" : null,
      joinedAt: action === "accept" ? new Date() : null,
      resolvedBy: userId,
      updatedAt: new Date(),
    }).where(eq(communityMemberships.id, id)).returning();
    return updated;
  };
  app.post("/v1/community-invitations/:id/accept", { preHandler: app.authenticate }, async (request) => resolveInvitation(invitationParams.parse(request.params).id, request.auth!.userId, "accept"));
  app.post("/v1/community-invitations/:id/decline", { preHandler: app.authenticate }, async (request) => resolveInvitation(invitationParams.parse(request.params).id, request.auth!.userId, "decline"));
  app.post("/v1/community-invitations/:id/revoke", { preHandler: app.authenticate }, async (request) => resolveInvitation(invitationParams.parse(request.params).id, request.auth!.userId, "revoke"));

  app.get("/v1/communities/:communityId/members", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await requireMember(communityId, request.auth!.userId);
    return {
      members: await db.select({
        id: communityMemberships.id,
        communityId: communityMemberships.communityId,
        userId: communityMemberships.userId,
        state: communityMemberships.state,
        role: communityMemberships.role,
        createdAt: communityMemberships.createdAt,
        displayName: userProfiles.displayName,
        handle: userProfiles.handle,
      }).from(communityMemberships)
        .innerJoin(userProfiles, eq(userProfiles.userId, communityMemberships.userId))
        .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.state, "active")))
        .orderBy(communityMemberships.joinedAt),
    };
  });

  app.patch("/v1/communities/:communityId/members/:userId/role", { preHandler: app.authenticate }, async (request) => {
    const { communityId, userId } = memberParams.parse(request.params);
    const manager = await requireAdmin(communityId, request.auth!.userId);
    const body = z.object({ role: z.enum(["admin", "moderator", "member"]) }).parse(request.body);
    const target = await requireMember(communityId, userId);
    if (target.role === "owner" || (manager.role !== "owner" && body.role === "admin")) throw new AppError(403, "COMMUNITY_ROLE_CHANGE_FORBIDDEN", "This role change is not allowed.");
    const [updated] = await db.update(communityMemberships).set({ role: body.role, updatedAt: new Date(), version: sql`${communityMemberships.version} + 1` })
      .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, userId))).returning();
    return updated;
  });

  const removeMember = async (communityId: string, userId: string, actorId: string, banned: boolean, reason?: string) => {
    await requireManager(communityId, actorId);
    const target = await role(communityId, userId);
    if (!target || target.role === "owner") throw new AppError(409, "COMMUNITY_MEMBER_NOT_REMOVABLE", "Community member cannot be removed.");
    await db.update(communityMemberships).set({
      state: banned ? "banned" : "removed",
      role: null,
      resolvedBy: actorId,
      resolutionReason: reason,
      updatedAt: new Date(),
      version: sql`${communityMemberships.version} + 1`,
    }).where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, userId)));
  };

  app.delete("/v1/communities/:communityId/members/:userId", { preHandler: app.authenticate }, async (request, reply) => {
    const { communityId, userId } = memberParams.parse(request.params);
    await removeMember(communityId, userId, request.auth!.userId, false);
    return reply.code(204).send();
  });
  app.post("/v1/communities/:communityId/members/:userId/remove", { preHandler: app.authenticate }, async (request, reply) => {
    const { communityId, userId } = memberParams.parse(request.params);
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    await removeMember(communityId, userId, request.auth!.userId, false, body.reason);
    return reply.code(204).send();
  });
  app.post("/v1/communities/:communityId/members/:userId/ban", { preHandler: app.authenticate }, async (request, reply) => {
    const { communityId, userId } = memberParams.parse(request.params);
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    await removeMember(communityId, userId, request.auth!.userId, true, body.reason);
    return reply.code(204).send();
  });
  app.post("/v1/communities/:communityId/members/:userId/unban", { preHandler: app.authenticate }, async (request, reply) => {
    const { communityId, userId } = memberParams.parse(request.params);
    await requireManager(communityId, request.auth!.userId);
    await db.update(communityMemberships).set({ state: "left", resolvedBy: request.auth!.userId, resolutionReason: null, updatedAt: new Date() })
      .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, userId), eq(communityMemberships.state, "banned")));
    return reply.code(204).send();
  });

  app.post("/v1/communities/:communityId/transfer-ownership", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    const owner = await requireMember(communityId, request.auth!.userId);
    if (owner.role !== "owner") throw new AppError(403, "COMMUNITY_OWNER_REQUIRED", "Only the owner can transfer ownership.");
    const body = z.object({ userId: z.uuid() }).parse(request.body);
    await requireMember(communityId, body.userId);
    await db.transaction(async (tx) => {
      await tx.update(communityMemberships).set({ role: "admin", updatedAt: new Date() }).where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, request.auth!.userId)));
      await tx.update(communityMemberships).set({ role: "owner", updatedAt: new Date() }).where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, body.userId)));
      await tx.update(communities).set({ ownerUserId: body.userId, updatedAt: new Date(), version: sql`${communities.version} + 1` }).where(eq(communities.id, communityId));
      await tx.insert(auditEvents).values({ actorUserId: request.auth!.userId, action: "community.ownership_transferred", targetType: "community", targetId: communityId, metadata: { toUserId: body.userId } });
    });
    return readModel(communityId, request.auth!.userId);
  });

  app.get("/v1/communities/:communityId/posts", { preHandler: app.optionalAuthenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    const model = await readModel(communityId, request.auth?.userId ?? null);
    if (!model.viewer.canViewPosts) throw new AppError(403, "COMMUNITY_MEMBERSHIP_REQUIRED", "Membership is required to view posts.");
    return { posts: await listPosts({ viewerUserId: request.auth?.userId ?? null, destinationType: "community", destinationId: communityId, limit: 30 }) };
  });

  app.get("/v1/community-feed", { preHandler: app.authenticate }, async (request) => {
    const memberships = await db.select({ communityId: communityMemberships.communityId }).from(communityMemberships)
      .where(and(eq(communityMemberships.userId, request.auth!.userId), eq(communityMemberships.state, "active")));
    if (!memberships.length) return { posts: [] };
    const rows = await db.select({ id: posts.id }).from(postPlacements)
      .innerJoin(posts, eq(posts.id, postPlacements.postId))
      .where(and(
        eq(postPlacements.destinationType, "community"),
        inArray(postPlacements.destinationId, memberships.map((item) => item.communityId)),
        eq(postPlacements.moderationStatus, "approved"),
        isNull(postPlacements.removedAt),
        eq(posts.status, "published"),
        isNull(posts.deletedAt),
      )).orderBy(desc(posts.createdAt)).limit(50);
    return { posts: await Promise.all(rows.map((row) => getPost(row.id, request.auth!.userId))) };
  });

  app.post("/v1/communities/:communityId/posts", { preHandler: app.authenticate }, async (request, reply) => {
    const post = await createCommunityPost(params.parse(request.params).communityId, request.auth!.userId, postCreateSchema.parse(request.body));
    return reply.code(201).send(post);
  });

  app.post("/v1/community-post-batches", { preHandler: app.authenticate }, async (request, reply) => {
    const body = postCreateSchema.extend({ communityIds: z.array(z.uuid()).min(1).max(20) }).parse(request.body);
    for (const communityId of body.communityIds) await requireMember(communityId, request.auth!.userId);
    const post = await createPost({
      userId: request.auth!.userId,
      body: body.body,
      category: body.category,
      visibility: body.visibility,
      presentationMode: "user",
      companionIds: body.companionIds,
      assetIds: body.assetIds,
      destinations: body.communityIds.map((id) => ({ type: "community" as const, id })),
    });
    for (const communityId of body.communityIds) {
      const [settings] = await db.select().from(communitySettings).where(eq(communitySettings.communityId, communityId)).limit(1);
      const member = await role(communityId, request.auth!.userId);
      if (settings?.postApprovalRequired && !["owner", "admin", "moderator"].includes(member?.role ?? "")) {
        await db.update(postPlacements).set({ moderationStatus: "pending" }).where(and(eq(postPlacements.postId, post.id), eq(postPlacements.destinationId, communityId)));
      }
    }
    return reply.code(201).send(post);
  });

  app.get("/v1/community-posts/search", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ query: z.string().trim().min(1).max(100), communityId: z.uuid().optional() }).parse(request.query);
    const memberships = await db.select({ communityId: communityMemberships.communityId }).from(communityMemberships)
      .where(and(eq(communityMemberships.userId, request.auth!.userId), eq(communityMemberships.state, "active")));
    const allowed = query.communityId ? memberships.filter((item) => item.communityId === query.communityId) : memberships;
    if (!allowed.length) return { posts: [] };
    const rows = await db.select({ id: posts.id }).from(postPlacements).innerJoin(posts, eq(posts.id, postPlacements.postId)).where(and(
      eq(postPlacements.destinationType, "community"),
      inArray(postPlacements.destinationId, allowed.map((item) => item.communityId)),
      eq(postPlacements.moderationStatus, "approved"),
      isNull(postPlacements.removedAt),
      ilike(posts.body, `%${query.query}%`),
      isNull(posts.deletedAt),
    )).orderBy(desc(posts.createdAt)).limit(50);
    return { posts: await Promise.all(rows.map((row) => getPost(row.id, request.auth!.userId))) };
  });

  app.get("/v1/community-saved-posts", { preHandler: app.authenticate }, async (request) => {
    const rows = await db.select({ id: posts.id }).from(postSaves)
      .innerJoin(posts, eq(posts.id, postSaves.postId))
      .innerJoin(postPlacements, eq(postPlacements.postId, posts.id))
      .where(and(
        eq(postSaves.userId, request.auth!.userId),
        eq(postPlacements.destinationType, "community"),
        eq(postPlacements.moderationStatus, "approved"),
        isNull(postPlacements.removedAt),
        isNull(posts.deletedAt),
      )).orderBy(desc(postSaves.createdAt));
    return { posts: await Promise.all(rows.map((row) => getPost(row.id, request.auth!.userId))) };
  });

  app.get("/v1/community-posts/:id", { preHandler: app.optionalAuthenticate }, async (request) => {
    const id = postParams.parse(request.params).id;
    const placement = await communityForPost(id);
    const model = await readModel(placement.destinationId!, request.auth?.userId ?? null);
    if (!model.viewer.canViewPosts) throw new AppError(403, "COMMUNITY_MEMBERSHIP_REQUIRED", "Membership is required.");
    if (placement.moderationStatus !== "approved" && !model.viewer.canManage && request.auth?.userId !== (await getPost(id, request.auth?.userId ?? null)).displayAuthor.id) {
      throw new AppError(404, "COMMUNITY_POST_NOT_FOUND", "Community post was not found.");
    }
    return getPost(id, request.auth?.userId ?? null);
  });

  app.patch("/v1/community-posts/:id", { preHandler: app.authenticate }, async (request) => {
    const id = postParams.parse(request.params).id;
    const body = z.object({ version: z.number().int().positive(), body: z.string().trim().max(10_000).nullable().optional(), category: z.string().trim().max(80).nullable().optional() }).parse(request.body);
    const [updated] = await db.update(posts).set({
      ...(body.body !== undefined && { body: body.body }),
      ...(body.category !== undefined && { category: body.category }),
      version: sql`${posts.version} + 1`,
      updatedAt: new Date(),
    }).where(and(eq(posts.id, id), eq(posts.authorUserId, request.auth!.userId), eq(posts.version, body.version), isNull(posts.deletedAt))).returning();
    if (!updated) throw new AppError(409, "POST_VERSION_CONFLICT", "Post changed or is not editable.");
    return getPost(id, request.auth!.userId);
  });

  app.delete("/v1/community-posts/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const id = postParams.parse(request.params).id;
    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post || post.deletedAt) throw new AppError(404, "COMMUNITY_POST_NOT_FOUND", "Community post was not found.");
    const placement = await communityForPost(id);
    const manager = placement.destinationId ? await role(placement.destinationId, request.auth!.userId) : null;
    if (post.authorUserId === request.auth!.userId) {
      await db.update(posts).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(eq(posts.id, id));
    } else if (manager?.state === "active" && ["owner", "admin", "moderator"].includes(manager.role ?? "")) {
      await db.update(postPlacements).set({ removedAt: new Date(), moderationStatus: "rejected" }).where(eq(postPlacements.id, placement.id));
    } else {
      throw new AppError(403, "COMMUNITY_POST_DELETE_FORBIDDEN", "You cannot delete this post.");
    }
    return reply.code(204).send();
  });

  const moderatePost = async (postId: string, userId: string, approved: boolean) => {
    const placement = await communityForPost(postId);
    await requireManager(placement.destinationId!, userId);
    const [updated] = await db.update(postPlacements).set({
      moderationStatus: approved ? "approved" : "rejected",
      removedAt: approved ? null : new Date(),
    }).where(eq(postPlacements.id, placement.id)).returning();
    return updated;
  };
  app.post("/v1/community-posts/:id/approve", { preHandler: app.authenticate }, async (request) => moderatePost(postParams.parse(request.params).id, request.auth!.userId, true));
  app.post("/v1/community-posts/:id/reject", { preHandler: app.authenticate }, async (request) => moderatePost(postParams.parse(request.params).id, request.auth!.userId, false));

  app.post("/v1/community-posts/:id/reactions/helpful", { preHandler: app.authenticate }, async (request) => setReaction(postParams.parse(request.params).id, request.auth!.userId, "helpful"));
  app.delete("/v1/community-posts/:id/reactions/helpful", { preHandler: app.authenticate }, async (request) => setReaction(postParams.parse(request.params).id, request.auth!.userId, null));
  app.post("/v1/community-posts/:id/save", { preHandler: app.authenticate }, async (request, reply) => {
    await setSaved(postParams.parse(request.params).id, request.auth!.userId, true);
    return reply.code(204).send();
  });
  app.delete("/v1/community-posts/:id/save", { preHandler: app.authenticate }, async (request, reply) => {
    await setSaved(postParams.parse(request.params).id, request.auth!.userId, false);
    return reply.code(204).send();
  });

  app.get("/v1/community-posts/:id/comments", { preHandler: app.optionalAuthenticate }, async (request) =>
    ({ comments: await listComments(postParams.parse(request.params).id, request.auth?.userId ?? null) }));
  app.post("/v1/community-posts/:id/comments", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ body: z.string().trim().min(1).max(2_000), parentCommentId: z.uuid().optional() }).parse(request.body);
    return reply.code(201).send(await createComment(postParams.parse(request.params).id, request.auth!.userId, body.body, body.parentCommentId));
  });
  app.patch("/v1/community-comments/:id", { preHandler: app.authenticate }, async (request) => {
    const id = commentParams.parse(request.params).id;
    const body = z.object({ version: z.number().int().positive(), body: z.string().trim().min(1).max(2_000) }).parse(request.body);
    const [updated] = await db.update(postComments).set({ body: body.body, version: sql`${postComments.version} + 1`, updatedAt: new Date() })
      .where(and(eq(postComments.id, id), eq(postComments.authorUserId, request.auth!.userId), eq(postComments.version, body.version), eq(postComments.state, "active"))).returning();
    if (!updated) throw new AppError(409, "COMMENT_VERSION_CONFLICT", "Comment changed or is not editable.");
    return updated;
  });
  app.delete("/v1/community-comments/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const id = commentParams.parse(request.params).id;
    const [comment] = await db.select().from(postComments).where(eq(postComments.id, id)).limit(1);
    if (!comment || comment.state !== "active") throw new AppError(404, "COMMENT_NOT_FOUND", "Comment was not found.");
    const placement = await communityForPost(comment.postId);
    const manager = await role(placement.destinationId!, request.auth!.userId);
    if (comment.authorUserId !== request.auth!.userId && !(manager?.state === "active" && ["owner", "admin", "moderator"].includes(manager.role ?? ""))) {
      throw new AppError(403, "COMMENT_DELETE_FORBIDDEN", "You cannot delete this comment.");
    }
    await db.update(postComments).set({ state: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(eq(postComments.id, id));
    return reply.code(204).send();
  });

  app.post("/v1/community-reports", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      communityId: z.uuid(),
      targetType: z.enum(["community", "post", "comment", "member"]),
      targetId: z.uuid(),
      reason: z.string().trim().min(3).max(200),
      details: z.string().trim().max(2_000).optional(),
    }).parse(request.body);
    const [report] = await db.insert(communityReports).values({ ...body, reporterUserId: request.auth!.userId }).returning();
    return reply.code(201).send(report);
  });
  app.get("/v1/communities/:communityId/reports", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await requireManager(communityId, request.auth!.userId);
    return { reports: await db.select().from(communityReports).where(eq(communityReports.communityId, communityId)).orderBy(desc(communityReports.createdAt)) };
  });
  app.post("/v1/community-reports/:id/resolve", { preHandler: app.authenticate }, async (request) => {
    const id = reportParams.parse(request.params).id;
    const [report] = await db.select().from(communityReports).where(eq(communityReports.id, id)).limit(1);
    if (!report) throw new AppError(404, "COMMUNITY_REPORT_NOT_FOUND", "Report was not found.");
    await requireManager(report.communityId, request.auth!.userId);
    const body = z.object({ resolution: z.string().trim().min(1).max(1_000) }).parse(request.body);
    const [updated] = await db.update(communityReports).set({ status: "resolved", resolution: body.resolution, resolvedByUserId: request.auth!.userId, resolvedAt: new Date() })
      .where(and(eq(communityReports.id, id), eq(communityReports.status, "open"))).returning();
    if (!updated) throw new AppError(409, "COMMUNITY_REPORT_RESOLVED", "Report is already resolved.");
    return updated;
  });

  app.get("/v1/me/community-preferences", { preHandler: app.authenticate }, async (request) => {
    const [preferences] = await db.select({ enabled: notificationPreferences.communities, version: notificationPreferences.version })
      .from(notificationPreferences).where(eq(notificationPreferences.userId, request.auth!.userId)).limit(1);
    return preferences;
  });
  app.patch("/v1/me/community-preferences", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({ version: z.number().int().positive(), enabled: z.boolean() }).parse(request.body);
    const [updated] = await db.update(notificationPreferences).set({ communities: body.enabled, version: sql`${notificationPreferences.version} + 1`, updatedAt: new Date() })
      .where(and(eq(notificationPreferences.userId, request.auth!.userId), eq(notificationPreferences.version, body.version))).returning();
    if (!updated) throw new AppError(409, "PREFERENCES_VERSION_CONFLICT", "Preferences changed on another device.");
    return { enabled: updated.communities, version: updated.version };
  });
  app.patch("/v1/communities/:communityId/my-notification-preferences", { preHandler: app.authenticate }, async (request) => {
    const communityId = params.parse(request.params).communityId;
    await requireMember(communityId, request.auth!.userId);
    const body = z.object({ notificationLevel: z.enum(["all", "important", "none"]), mutedUntil: z.coerce.date().nullable().optional() }).parse(request.body);
    const [updated] = await db.update(communityMemberships).set({
      notificationLevel: body.notificationLevel,
      ...(body.mutedUntil !== undefined && { mutedUntil: body.mutedUntil }),
      updatedAt: new Date(),
    }).where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, request.auth!.userId))).returning();
    return { notificationLevel: updated!.notificationLevel, mutedUntil: updated!.mutedUntil };
  });
};
