import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { notificationPreferences, notifications } from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";

const params = z.object({ notificationId: z.uuid() });

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/notifications", { preHandler: app.authenticate }, async (request) => ({
    notifications: await db.select().from(notifications)
      .where(and(eq(notifications.userId, request.auth!.userId), isNull(notifications.dismissedAt)))
      .orderBy(desc(notifications.createdAt)).limit(100),
  }));
  app.post("/v1/notifications/read-all", { preHandler: app.authenticate }, async (request, reply) => {
    await db.update(notifications).set({ readAt: new Date() }).where(and(
      eq(notifications.userId, request.auth!.userId),
      isNull(notifications.readAt),
      isNull(notifications.dismissedAt),
    ));
    return reply.code(204).send();
  });
  app.post("/v1/notifications/:notificationId/read", { preHandler: app.authenticate }, async (request) => {
    const { notificationId } = params.parse(request.params);
    const [updated] = await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, request.auth!.userId))).returning();
    if (!updated) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found.");
    return updated;
  });
  app.post("/v1/notifications/:notificationId/dismiss", { preHandler: app.authenticate }, async (request, reply) => {
    const { notificationId } = params.parse(request.params);
    await db.update(notifications).set({ dismissedAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, request.auth!.userId)));
    return reply.code(204).send();
  });
  app.get("/v1/me/notification-preferences", { preHandler: app.authenticate }, async (request) => {
    const [preferences] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, request.auth!.userId)).limit(1);
    return preferences;
  });
  app.patch("/v1/me/notification-preferences", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({
      version: z.number().int().positive(),
      pushEnabled: z.boolean().optional(),
      postActivity: z.boolean().optional(),
      messages: z.boolean().optional(),
      communities: z.boolean().optional(),
      pawCircles: z.boolean().optional(),
      adoptionUpdates: z.boolean().optional(),
      rescueUpdates: z.boolean().optional(),
      lostFoundNearby: z.boolean().optional(),
    }).parse(request.body);
    const { version, ...changes } = body;
    const [updated] = await db.update(notificationPreferences).set({ ...changes, version: version + 1, updatedAt: new Date() })
      .where(and(eq(notificationPreferences.userId, request.auth!.userId), eq(notificationPreferences.version, version))).returning();
    if (!updated) throw new AppError(409, "PREFERENCES_VERSION_CONFLICT", "Notification preferences changed on another device.");
    return updated;
  });
};

export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  body: string;
  actorUserId?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  deduplicationKey?: string | undefined;
  data?: Record<string, unknown> | undefined;
}) {
  await db.insert(notifications).values(input).onConflictDoNothing();
}
