import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  auditEvents,
  companionManagers,
  companions,
  conversationParticipants,
  conversations,
  domainMedia,
  lostFoundAlerts,
  lostFoundClaims,
  lostFoundLocations,
  lostFoundMatches,
  lostFoundSightings,
  lostFoundSubjects,
  lostFoundUpdates,
  outboxEvents,
  savedLostFoundAlerts,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { getReadyMediaReadModel, requireReadyOwnedAssets } from "../media/service.js";
import { createNotification } from "../notifications/routes.js";

const alertParams = z.object({ alertId: z.uuid() });
const claimParams = z.object({ claimId: z.uuid() });
const matchParams = z.object({ matchId: z.uuid() });

async function mediaFor(alertId: string) {
  const rows = await db.select().from(domainMedia).where(and(
    eq(domainMedia.targetType, "lost_found_alert"),
    eq(domainMedia.targetId, alertId),
    isNull(domainMedia.removedAt),
  )).orderBy(domainMedia.position);
  return Promise.all(rows.map(async (row) => ({
    assetId: row.assetId,
    role: row.role,
    position: row.position,
    ...(await getReadyMediaReadModel(row.assetId)),
  })));
}

async function alertModel(alertId: string, viewerUserId: string | null) {
  const [row] = await db.select({
    alert: lostFoundAlerts,
    location: lostFoundLocations,
    subject: lostFoundSubjects,
    reporterName: userProfiles.displayName,
    reporterHandle: userProfiles.handle,
    reporterAvatarMediaId: userProfiles.avatarMediaId,
  })
    .from(lostFoundAlerts).innerJoin(lostFoundLocations, eq(lostFoundLocations.alertId, lostFoundAlerts.id))
    .leftJoin(lostFoundSubjects, eq(lostFoundSubjects.id, lostFoundAlerts.temporarySubjectId))
    .innerJoin(userProfiles, eq(userProfiles.userId, lostFoundAlerts.reporterUserId))
    .where(eq(lostFoundAlerts.id, alertId)).limit(1);
  if (!row) throw new AppError(404, "LOST_FOUND_ALERT_NOT_FOUND", "Alert was not found.");
  const [saved] = viewerUserId ? await db.select().from(savedLostFoundAlerts).where(and(eq(savedLostFoundAlerts.alertId, alertId), eq(savedLostFoundAlerts.userId, viewerUserId))).limit(1) : [];
  return {
    ...row.alert,
    subject: row.subject,
    reporter: {
      id: row.alert.reporterUserId,
      displayName: row.reporterName,
      handle: row.reporterHandle,
      avatarMediaId: row.reporterAvatarMediaId,
    },
    media: await mediaFor(alertId),
    location: {
      label: row.location.locationLabel,
      publicPrecision: row.location.publicPrecision,
      latitude: row.alert.reporterUserId === viewerUserId ? row.location.latitude : null,
      longitude: row.alert.reporterUserId === viewerUserId ? row.location.longitude : null,
    },
    viewer: { isReporter: row.alert.reporterUserId === viewerUserId, saved: Boolean(saved), canSight: Boolean(viewerUserId && row.alert.status === "active"), canClaim: Boolean(viewerUserId && row.alert.kind === "found" && row.alert.reporterUserId !== viewerUserId && row.alert.status === "active") },
  };
}

export const lostFoundRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/lost-found/alerts", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      kind: z.enum(["lost", "found"]),
      companionId: z.uuid().optional(),
      subject: z.object({ species: z.string().min(1).max(50), breedDescription: z.string().max(100).optional(), ageDescription: z.string().max(100).optional(), sexDescription: z.string().max(50).optional(), appearance: z.string().trim().min(5).max(2_000), collarDescription: z.string().max(500).optional(), temperament: z.string().max(500).optional(), secured: z.boolean().optional(), publicNotes: z.string().max(2_000).optional() }).optional(),
      occurredAt: z.iso.datetime().transform((value) => new Date(value)),
      location: z.object({ label: z.string().trim().min(1).max(120), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), publicPrecision: z.enum(["area", "approximate"]).default("area") }),
      alertRadiusKm: z.number().int().min(1).max(100).default(10),
      contactMode: z.enum(["message", "public_contact", "both"]).default("message"),
      publicContact: z.string().max(500).optional(),
      assetIds: z.array(z.uuid()).min(1).max(5),
    }).parse(request.body);
    if (body.kind === "lost" && !body.companionId && !body.subject) throw new AppError(400, "LOST_FOUND_SUBJECT_REQUIRED", "Lost alert requires a companion or subject.");
    if (body.kind === "found" && !body.subject) throw new AppError(400, "LOST_FOUND_SUBJECT_REQUIRED", "Found alert requires subject details.");
    if (body.companionId) {
      const [manager] = await db.select().from(companionManagers).innerJoin(companions, eq(companions.id, companionManagers.companionId)).where(and(eq(companionManagers.companionId, body.companionId), eq(companionManagers.userId, request.auth!.userId), eq(companionManagers.canEditProfile, true))).limit(1);
      if (!manager) throw new AppError(403, "LOST_FOUND_COMPANION_FORBIDDEN", "You cannot create an alert for this companion.");
    }
    await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    const id = await db.transaction(async (tx) => {
      let temporarySubjectId: string | null = null;
      if (body.subject) {
        const [subject] = await tx.insert(lostFoundSubjects).values(body.subject).returning({ id: lostFoundSubjects.id });
        temporarySubjectId = subject!.id;
      }
      const [alert] = await tx.insert(lostFoundAlerts).values({
        kind: body.kind, reporterUserId: request.auth!.userId, subjectCompanionId: body.companionId, temporarySubjectId,
        occurredAt: body.occurredAt, expiresAt: new Date(Date.now() + 30 * 86_400_000), alertRadiusKm: body.alertRadiusKm,
        contactMode: body.contactMode, publicContactEncrypted: body.publicContact,
      }).returning({ id: lostFoundAlerts.id });
      if (!alert) throw new AppError(500, "LOST_FOUND_CREATE_FAILED", "Alert was not created.");
      await tx.insert(lostFoundLocations).values({ alertId: alert.id, locationLabel: body.location.label, latitude: body.location.latitude, longitude: body.location.longitude, publicPrecision: body.location.publicPrecision });
      await tx.insert(domainMedia).values(body.assetIds.map((assetId, position) => ({ targetType: "lost_found_alert", targetId: alert.id, assetId, role: position === 0 ? "cover" : "evidence", position })));
      await tx.insert(outboxEvents).values({ aggregateType: "lost_found_alert", aggregateId: alert.id, eventType: "lost_found.alert_created", payload: { alertId: alert.id, kind: body.kind } });
      return alert.id;
    });
    return reply.code(201).send(await alertModel(id, request.auth!.userId));
  });
  app.get("/v1/lost-found/alerts", { preHandler: app.optionalAuthenticate }, async (request) => {
    const query = z.object({ kind: z.enum(["lost", "found"]).optional(), status: z.string().optional(), query: z.string().max(100).optional() }).parse(request.query);
    const conditions = [inArray(lostFoundAlerts.status, query.status ? [query.status] : ["active"])];
    if (query.kind) conditions.push(eq(lostFoundAlerts.kind, query.kind));
    if (query.query) conditions.push(ilike(lostFoundSubjects.appearance, `%${query.query}%`));
    const rows = await db.select({ id: lostFoundAlerts.id }).from(lostFoundAlerts).leftJoin(lostFoundSubjects, eq(lostFoundSubjects.id, lostFoundAlerts.temporarySubjectId)).where(and(...conditions)).orderBy(desc(lostFoundAlerts.createdAt)).limit(100);
    return { alerts: await Promise.all(rows.map((row) => alertModel(row.id, request.auth?.userId ?? null))) };
  });
  app.get("/v1/lost-found/alerts/:alertId", { preHandler: app.optionalAuthenticate }, async (request) => alertModel(alertParams.parse(request.params).alertId, request.auth?.userId ?? null));
  app.patch("/v1/lost-found/alerts/:alertId", { preHandler: app.authenticate }, async (request) => {
    const alertId = alertParams.parse(request.params).alertId;
    const body = z.object({
      version: z.number().int().positive(),
      subject: z.object({
        species: z.string().min(1).max(50).optional(),
        breedDescription: z.string().max(100).nullable().optional(),
        ageDescription: z.string().max(100).nullable().optional(),
        sexDescription: z.string().max(50).nullable().optional(),
        appearance: z.string().trim().min(5).max(2_000).optional(),
        collarDescription: z.string().max(500).nullable().optional(),
        temperament: z.string().max(500).nullable().optional(),
        secured: z.boolean().nullable().optional(),
        publicNotes: z.string().max(2_000).nullable().optional(),
      }).optional(),
      occurredAt: z.iso.datetime().transform((value) => new Date(value)).optional(),
      location: z.object({
        label: z.string().trim().min(1).max(120),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        publicPrecision: z.enum(["area", "approximate"]).optional(),
      }).optional(),
      alertRadiusKm: z.number().int().min(1).max(100).optional(),
      contactMode: z.enum(["message", "public_contact", "both"]).optional(),
      publicContact: z.string().max(500).nullable().optional(),
      assetIds: z.array(z.uuid()).min(1).max(5).optional(),
    }).refine((value) => Object.keys(value).some((key) => key !== "version"), {
      message: "At least one field is required.",
    }).parse(request.body);
    if (body.assetIds) await requireReadyOwnedAssets(request.auth!.userId, body.assetIds);
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(lostFoundAlerts).where(eq(lostFoundAlerts.id, alertId)).limit(1);
      if (!current || current.reporterUserId !== request.auth!.userId) throw new AppError(404, "LOST_FOUND_ALERT_NOT_FOUND", "Alert was not found.");
      if (current.status !== "active") throw new AppError(409, "LOST_FOUND_ALERT_NOT_ACTIVE", "Only active alerts can be edited.");
      if (current.version !== body.version) throw new AppError(409, "VERSION_CONFLICT", "The alert changed. Refresh and try again.");
      const [updated] = await tx.update(lostFoundAlerts).set({
        ...(body.occurredAt && { occurredAt: body.occurredAt }),
        ...(body.alertRadiusKm !== undefined && { alertRadiusKm: body.alertRadiusKm }),
        ...(body.contactMode && { contactMode: body.contactMode }),
        ...(body.publicContact !== undefined && { publicContactEncrypted: body.publicContact }),
        version: current.version + 1,
        updatedAt: new Date(),
      }).where(and(eq(lostFoundAlerts.id, alertId), eq(lostFoundAlerts.version, body.version))).returning();
      if (!updated) throw new AppError(409, "VERSION_CONFLICT", "The alert changed. Refresh and try again.");
      if (body.subject) {
        if (!current.temporarySubjectId) throw new AppError(409, "LOST_FOUND_SUBJECT_LOCKED", "Companion-backed subject details must be edited on the companion profile.");
        await tx.update(lostFoundSubjects).set(body.subject).where(eq(lostFoundSubjects.id, current.temporarySubjectId));
      }
      if (body.location) {
        await tx.update(lostFoundLocations).set({
          locationLabel: body.location.label,
          ...(body.location.latitude !== undefined && { latitude: body.location.latitude }),
          ...(body.location.longitude !== undefined && { longitude: body.location.longitude }),
          ...(body.location.publicPrecision && { publicPrecision: body.location.publicPrecision }),
        }).where(eq(lostFoundLocations.alertId, alertId));
      }
      if (body.assetIds) {
        await tx.delete(domainMedia).where(and(eq(domainMedia.targetType, "lost_found_alert"), eq(domainMedia.targetId, alertId)));
        await tx.insert(domainMedia).values(body.assetIds.map((assetId, position) => ({
          targetType: "lost_found_alert",
          targetId: alertId,
          assetId,
          role: position === 0 ? "cover" : "evidence",
          position,
        })));
      }
    });
    return alertModel(alertId, request.auth!.userId);
  });
  app.post("/v1/lost-found/alerts/:alertId/withdraw", { preHandler: app.authenticate }, async (request) => {
    const alertId = alertParams.parse(request.params).alertId;
    const body = z.object({ reason: z.string().trim().min(3).max(1_000).optional() }).parse(request.body ?? {});
    const [updated] = await db.update(lostFoundAlerts).set({
      status: "withdrawn",
      resolutionOutcome: "withdrawn",
      resolutionNote: body.reason,
      resolvedAt: new Date(),
      resolvedByUserId: request.auth!.userId,
      updatedAt: new Date(),
    }).where(and(
      eq(lostFoundAlerts.id, alertId),
      eq(lostFoundAlerts.reporterUserId, request.auth!.userId),
      eq(lostFoundAlerts.status, "active"),
    )).returning();
    if (!updated) throw new AppError(409, "LOST_FOUND_WITHDRAW_FORBIDDEN", "Alert cannot be withdrawn.");
    return alertModel(alertId, request.auth!.userId);
  });
  app.get("/v1/lost-found/search", { preHandler: app.optionalAuthenticate }, async (request) => {
    const query = z.object({
      query: z.string().trim().min(1).max(100),
      kind: z.enum(["lost", "found"]).optional(),
      status: z.string().default("active"),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);
    const conditions = [
      eq(lostFoundAlerts.status, query.status),
      or(
        ilike(lostFoundSubjects.appearance, `%${query.query}%`),
        ilike(lostFoundSubjects.breedDescription, `%${query.query}%`),
        ilike(lostFoundLocations.locationLabel, `%${query.query}%`),
      )!,
    ];
    if (query.kind) conditions.push(eq(lostFoundAlerts.kind, query.kind));
    const rows = await db.select({ id: lostFoundAlerts.id }).from(lostFoundAlerts)
      .innerJoin(lostFoundLocations, eq(lostFoundLocations.alertId, lostFoundAlerts.id))
      .leftJoin(lostFoundSubjects, eq(lostFoundSubjects.id, lostFoundAlerts.temporarySubjectId))
      .where(and(...conditions)).orderBy(desc(lostFoundAlerts.createdAt)).limit(query.limit);
    return { alerts: await Promise.all(rows.map((row) => alertModel(row.id, request.auth?.userId ?? null))) };
  });
  app.get("/v1/me/lost-found/alerts", { preHandler: app.authenticate }, async (request) => {
    const rows = await db.select({ id: lostFoundAlerts.id }).from(lostFoundAlerts).where(eq(lostFoundAlerts.reporterUserId, request.auth!.userId)).orderBy(desc(lostFoundAlerts.createdAt));
    return { alerts: await Promise.all(rows.map((row) => alertModel(row.id, request.auth!.userId))) };
  });
  app.post("/v1/lost-found/alerts/:alertId/updates", { preHandler: app.authenticate }, async (request, reply) => {
    const alertId = alertParams.parse(request.params).alertId;
    const body = z.object({ text: z.string().trim().min(1).max(2_000) }).parse(request.body);
    const [alert] = await db.select().from(lostFoundAlerts).where(and(eq(lostFoundAlerts.id, alertId), eq(lostFoundAlerts.reporterUserId, request.auth!.userId), eq(lostFoundAlerts.status, "active"))).limit(1);
    if (!alert) throw new AppError(403, "LOST_FOUND_UPDATE_FORBIDDEN", "You cannot update this alert.");
    const [update] = await db.insert(lostFoundUpdates).values({ alertId, authorUserId: request.auth!.userId, text: body.text }).returning();
    return reply.code(201).send(update);
  });
  app.get("/v1/lost-found/alerts/:alertId/updates", { preHandler: app.optionalAuthenticate }, async (request) => ({ updates: await db.select().from(lostFoundUpdates).where(eq(lostFoundUpdates.alertId, alertParams.parse(request.params).alertId)).orderBy(desc(lostFoundUpdates.createdAt)) }));
  app.post("/v1/lost-found/alerts/:alertId/sightings", { preHandler: app.authenticate }, async (request, reply) => {
    const alertId = alertParams.parse(request.params).alertId;
    const body = z.object({ occurredAt: z.iso.datetime().transform((value) => new Date(value)), locationLabel: z.string().trim().min(1).max(120), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), publicPrecision: z.enum(["area", "approximate"]).default("area"), stillPresent: z.boolean().optional(), note: z.string().max(2_000).optional() }).parse(request.body);
    const model = await alertModel(alertId, request.auth!.userId);
    if (!model.viewer.canSight) throw new AppError(403, "LOST_FOUND_SIGHTING_FORBIDDEN", "Sighting cannot be submitted.");
    const [sighting] = await db.insert(lostFoundSightings).values({ alertId, reporterUserId: request.auth!.userId, ...body }).returning();
    await createNotification({ userId: model.reporterUserId, type: "lost_found_sighting", title: "New sighting reported", body: body.locationLabel, actorUserId: request.auth!.userId, targetType: "lost_found_alert", targetId: alertId });
    return reply.code(201).send(sighting);
  });
  app.get("/v1/lost-found/alerts/:alertId/sightings", { preHandler: app.optionalAuthenticate }, async (request) => {
    const alertId = alertParams.parse(request.params).alertId;
    const model = await alertModel(alertId, request.auth?.userId ?? null);
    const isReporter = model.reporterUserId === request.auth?.userId;
    const sightings = await db.select().from(lostFoundSightings).where(and(
      eq(lostFoundSightings.alertId, alertId),
      eq(lostFoundSightings.moderationStatus, "approved"),
    )).orderBy(desc(lostFoundSightings.occurredAt));
    return {
      sightings: sightings.map((sighting) => ({
        ...sighting,
        latitude: isReporter ? sighting.latitude : null,
        longitude: isReporter ? sighting.longitude : null,
      })),
    };
  });
  app.post("/v1/lost-found/alerts/:alertId/claims", { preHandler: app.authenticate }, async (request, reply) => {
    const alertId = alertParams.parse(request.params).alertId;
    const body = z.object({ evidence: z.record(z.string(), z.unknown()) }).parse(request.body);
    const model = await alertModel(alertId, request.auth!.userId);
    if (!model.viewer.canClaim) throw new AppError(403, "LOST_FOUND_CLAIM_FORBIDDEN", "Claim cannot be submitted.");
    const [claim] = await db.insert(lostFoundClaims).values({ foundAlertId: alertId, claimantUserId: request.auth!.userId, evidence: body.evidence }).onConflictDoUpdate({ target: [lostFoundClaims.foundAlertId, lostFoundClaims.claimantUserId], set: { status: "submitted", evidence: body.evidence, updatedAt: new Date() } }).returning();
    await createNotification({ userId: model.reporterUserId, type: "lost_found_claim", title: "Ownership claim submitted", body: "Review the private evidence before arranging handoff.", actorUserId: request.auth!.userId, targetType: "lost_found_claim", targetId: claim!.id });
    return reply.code(201).send(claim);
  });
  app.get("/v1/lost-found/alerts/:alertId/claims", { preHandler: app.authenticate }, async (request) => {
    const alertId = alertParams.parse(request.params).alertId;
    const [alert] = await db.select().from(lostFoundAlerts).where(eq(lostFoundAlerts.id, alertId)).limit(1);
    if (!alert) throw new AppError(404, "LOST_FOUND_ALERT_NOT_FOUND", "Alert was not found.");
    const conditions = [eq(lostFoundClaims.foundAlertId, alertId)];
    if (alert.reporterUserId !== request.auth!.userId) {
      conditions.push(eq(lostFoundClaims.claimantUserId, request.auth!.userId));
    }
    return { claims: await db.select().from(lostFoundClaims).where(and(...conditions)).orderBy(desc(lostFoundClaims.createdAt)) };
  });
  app.patch("/v1/lost-found/claims/:claimId", { preHandler: app.authenticate }, async (request) => {
    const claimId = claimParams.parse(request.params).claimId;
    const body = z.object({ status: z.enum(["accepted", "rejected"]) }).parse(request.body);
    const [row] = await db.select({ claim: lostFoundClaims, reporterUserId: lostFoundAlerts.reporterUserId }).from(lostFoundClaims).innerJoin(lostFoundAlerts, eq(lostFoundAlerts.id, lostFoundClaims.foundAlertId)).where(eq(lostFoundClaims.id, claimId)).limit(1);
    if (!row || row.reporterUserId !== request.auth!.userId) throw new AppError(403, "LOST_FOUND_CLAIM_FORBIDDEN", "You cannot review this claim.");
    const [updated] = await db.update(lostFoundClaims).set({ status: body.status, reviewerUserId: request.auth!.userId, acceptedAt: body.status === "accepted" ? new Date() : null, rejectedAt: body.status === "rejected" ? new Date() : null, updatedAt: new Date() }).where(eq(lostFoundClaims.id, claimId)).returning();
    return updated;
  });
  app.post("/v1/lost-found/alerts/:alertId/resolve", { preHandler: app.authenticate }, async (request) => {
    const alertId = alertParams.parse(request.params).alertId;
    const body = z.object({ outcome: z.string().trim().min(1).max(80), note: z.string().trim().max(2_000).optional() }).parse(request.body);
    const [updated] = await db.update(lostFoundAlerts).set({ status: "resolved", resolutionOutcome: body.outcome, resolutionNote: body.note, resolvedAt: new Date(), resolvedByUserId: request.auth!.userId, updatedAt: new Date() }).where(and(eq(lostFoundAlerts.id, alertId), eq(lostFoundAlerts.reporterUserId, request.auth!.userId), eq(lostFoundAlerts.status, "active"))).returning();
    if (!updated) throw new AppError(409, "LOST_FOUND_ALREADY_RESOLVED", "Alert cannot be resolved.");
    return alertModel(alertId, request.auth!.userId);
  });
  app.post("/v1/lost-found/alerts/:alertId/reopen", { preHandler: app.authenticate }, async (request) => {
    const alertId = alertParams.parse(request.params).alertId;
    const [updated] = await db.update(lostFoundAlerts).set({ status: "active", resolutionOutcome: null, resolutionNote: null, resolvedAt: null, resolvedByUserId: null, updatedAt: new Date() }).where(and(eq(lostFoundAlerts.id, alertId), eq(lostFoundAlerts.reporterUserId, request.auth!.userId), eq(lostFoundAlerts.status, "resolved"))).returning();
    if (!updated) throw new AppError(409, "LOST_FOUND_REOPEN_FORBIDDEN", "Alert cannot be reopened.");
    return alertModel(alertId, request.auth!.userId);
  });
  app.get("/v1/lost-found/alerts/:alertId/matches", { preHandler: app.authenticate }, async (request) => {
    const alertId = alertParams.parse(request.params).alertId;
    const [current] = await db.select().from(lostFoundAlerts).where(eq(lostFoundAlerts.id, alertId)).limit(1);
    if (!current) throw new AppError(404, "LOST_FOUND_ALERT_NOT_FOUND", "Alert was not found.");
    if (current.reporterUserId !== request.auth!.userId) throw new AppError(403, "LOST_FOUND_MATCHES_FORBIDDEN", "Only the reporter can view matches.");
    const candidates = await db.select({ id: lostFoundAlerts.id }).from(lostFoundAlerts).where(and(
      eq(lostFoundAlerts.kind, current.kind === "lost" ? "found" : "lost"),
      eq(lostFoundAlerts.status, "active"),
      ne(lostFoundAlerts.reporterUserId, request.auth!.userId),
    )).orderBy(desc(lostFoundAlerts.createdAt)).limit(50);
    for (const candidate of candidates) {
      const lostAlertId = current.kind === "lost" ? current.id : candidate.id;
      const foundAlertId = current.kind === "found" ? current.id : candidate.id;
      await db.insert(lostFoundMatches).values({
        lostAlertId,
        foundAlertId,
        score: 50,
      }).onConflictDoNothing();
    }
    const rows = await db.select().from(lostFoundMatches).where(and(
      or(eq(lostFoundMatches.lostAlertId, alertId), eq(lostFoundMatches.foundAlertId, alertId)),
      inArray(lostFoundMatches.status, ["suggested", "confirmed"]),
    )).orderBy(desc(lostFoundMatches.score), desc(lostFoundMatches.createdAt));
    return {
      matches: await Promise.all(rows.map(async (match) => ({
        ...match,
        counterpart: await alertModel(
          match.lostAlertId === alertId ? match.foundAlertId : match.lostAlertId,
          request.auth!.userId,
        ),
      }))),
    };
  });
  app.post("/v1/lost-found/matches/:matchId/confirm", { preHandler: app.authenticate }, async (request) => {
    const matchId = matchParams.parse(request.params).matchId;
    const [row] = await db.select({
      match: lostFoundMatches,
      lostReporterId: lostFoundAlerts.reporterUserId,
    }).from(lostFoundMatches)
      .innerJoin(lostFoundAlerts, eq(lostFoundAlerts.id, lostFoundMatches.lostAlertId))
      .where(eq(lostFoundMatches.id, matchId))
      .limit(1);
    if (!row) throw new AppError(404, "LOST_FOUND_MATCH_NOT_FOUND", "Match was not found.");
    const [found] = await db.select({ reporterUserId: lostFoundAlerts.reporterUserId }).from(lostFoundAlerts).where(eq(lostFoundAlerts.id, row.match.foundAlertId)).limit(1);
    if (![row.lostReporterId, found?.reporterUserId].includes(request.auth!.userId)) throw new AppError(403, "LOST_FOUND_MATCH_FORBIDDEN", "You cannot confirm this match.");
    const [updated] = await db.update(lostFoundMatches).set({
      status: "confirmed",
      reviewedByUserId: request.auth!.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(lostFoundMatches.id, matchId), eq(lostFoundMatches.status, "suggested"))).returning();
    if (!updated) throw new AppError(409, "LOST_FOUND_MATCH_NOT_CONFIRMABLE", "Match cannot be confirmed.");
    const recipientId = request.auth!.userId === row.lostReporterId ? found?.reporterUserId : row.lostReporterId;
    if (recipientId) {
      await createNotification({
        userId: recipientId,
        type: "lost_found_match",
        title: "A possible match was confirmed",
        body: "Open the alert to coordinate next steps.",
        actorUserId: request.auth!.userId,
        targetType: "lost_found_match",
        targetId: matchId,
      });
    }
    return updated;
  });
  app.post("/v1/lost-found/matches/:matchId/dismiss", { preHandler: app.authenticate }, async (request) => {
    const matchId = matchParams.parse(request.params).matchId;
    const [match] = await db.select().from(lostFoundMatches).where(eq(lostFoundMatches.id, matchId)).limit(1);
    if (!match) throw new AppError(404, "LOST_FOUND_MATCH_NOT_FOUND", "Match was not found.");
    const reporters = await db.select({ reporterUserId: lostFoundAlerts.reporterUserId }).from(lostFoundAlerts).where(inArray(lostFoundAlerts.id, [match.lostAlertId, match.foundAlertId]));
    if (!reporters.some((item) => item.reporterUserId === request.auth!.userId)) throw new AppError(403, "LOST_FOUND_MATCH_FORBIDDEN", "You cannot dismiss this match.");
    const [updated] = await db.update(lostFoundMatches).set({
      status: "dismissed",
      reviewedByUserId: request.auth!.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(lostFoundMatches.id, matchId)).returning();
    return updated;
  });
  app.post("/v1/lost-found/alerts/:alertId/conversation", { preHandler: app.authenticate }, async (request) => {
    const alertId = alertParams.parse(request.params).alertId;
    const [alert] = await db.select().from(lostFoundAlerts).where(eq(lostFoundAlerts.id, alertId)).limit(1);
    if (!alert || alert.status !== "active") throw new AppError(404, "LOST_FOUND_ALERT_NOT_FOUND", "Active alert was not found.");
    if (alert.reporterUserId === request.auth!.userId) throw new AppError(400, "LOST_FOUND_SELF_CONVERSATION", "You cannot start a conversation with yourself.");
    const [existing] = await db.select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.domainType, "lost_found_alert"),
      eq(conversations.domainId, alertId),
      eq(conversations.createdByUserId, request.auth!.userId),
    )).limit(1);
    if (existing) return { conversationId: existing.id };
    const conversationId = await db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({
        type: "direct",
        domainType: "lost_found_alert",
        domainId: alertId,
        createdByUserId: request.auth!.userId,
      }).returning({ id: conversations.id });
      if (!conversation) throw new AppError(500, "CONVERSATION_CREATE_FAILED", "Conversation was not created.");
      await tx.insert(conversationParticipants).values([
        { conversationId: conversation.id, userId: request.auth!.userId },
        { conversationId: conversation.id, userId: alert.reporterUserId },
      ]);
      return conversation.id;
    });
    return { conversationId };
  });
  app.post("/v1/lost-found/alerts/:alertId/report", { preHandler: app.authenticate }, async (request, reply) => {
    const alertId = alertParams.parse(request.params).alertId;
    await alertModel(alertId, request.auth!.userId);
    const body = z.object({ reason: z.string().trim().min(3).max(100), details: z.string().trim().max(2_000).optional() }).parse(request.body);
    const [report] = await db.insert(auditEvents).values({
      actorUserId: request.auth!.userId,
      action: "lost_found_alert.reported",
      targetType: "lost_found_alert",
      targetId: alertId,
      requestId: request.id,
      metadata: body,
    }).returning({ id: auditEvents.id, createdAt: auditEvents.createdAt });
    return reply.code(201).send(report);
  });
  app.put("/v1/me/saved-lost-found-alerts/:alertId", { preHandler: app.authenticate }, async (request, reply) => {
    await db.insert(savedLostFoundAlerts).values({ userId: request.auth!.userId, alertId: alertParams.parse(request.params).alertId }).onConflictDoNothing();
    return reply.code(204).send();
  });
  app.delete("/v1/me/saved-lost-found-alerts/:alertId", { preHandler: app.authenticate }, async (request, reply) => {
    await db.delete(savedLostFoundAlerts).where(and(eq(savedLostFoundAlerts.userId, request.auth!.userId), eq(savedLostFoundAlerts.alertId, alertParams.parse(request.params).alertId)));
    return reply.code(204).send();
  });
  app.get("/v1/me/saved-lost-found-alerts", { preHandler: app.authenticate }, async (request) => ({ alerts: await db.select({ alert: lostFoundAlerts }).from(savedLostFoundAlerts).innerJoin(lostFoundAlerts, eq(lostFoundAlerts.id, savedLostFoundAlerts.alertId)).where(eq(savedLostFoundAlerts.userId, request.auth!.userId)) }));
};
