import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  accounts,
  adoptionRecords,
  auditEvents,
  companions,
  outboxEvents,
  profileHandleHistory,
  rescueCases,
  userBlocks,
  userPrivacySettings,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { validateHandle } from "../../shared/handles.js";
import { getReadyMediaReadModel } from "../media/service.js";

async function avatarModel(assetId: string | null) {
  if (!assetId) return null;
  try {
    return { mediaAssetId: assetId, ...(await getReadyMediaReadModel(assetId)) };
  } catch {
    return { mediaAssetId: assetId };
  }
}

async function impactFor(userId: string) {
  const [rescueRows, rehomedRows, adoptedRows] = await Promise.all([
    db.select({ value: count() }).from(rescueCases).where(eq(rescueCases.ownerUserId, userId)),
    db.select({ value: count() }).from(adoptionRecords).where(eq(adoptionRecords.posterId, userId)),
    db.select({ value: count() }).from(adoptionRecords).where(eq(adoptionRecords.adopterId, userId)),
  ]);
  return {
    rescues: rescueRows[0]?.value ?? 0,
    rehomed: rehomedRows[0]?.value ?? 0,
    adopted: adoptedRows[0]?.value ?? 0,
  };
}

export async function usernameAvailability(candidate: string): Promise<{
  candidate: string;
  normalized: string;
  available: boolean;
  reason?: string;
}> {
  const validation = validateHandle(candidate);
  if (!validation.valid) {
    return {
      candidate,
      normalized: validation.normalized,
      available: false,
      reason: validation.reason ?? "format",
    };
  }

  const [existing] = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(eq(userProfiles.normalizedHandle, validation.normalized))
    .limit(1);

  return {
    candidate,
    normalized: validation.normalized,
    available: !existing,
    ...(existing ? { reason: "taken" } : {}),
  };
}

export async function assignInitialUsername(input: {
  userId: string;
  candidate: string;
  requestId: string;
}): Promise<{ handle: string; version: number }> {
  const validation = validateHandle(input.candidate);
  if (!validation.valid) {
    throw new AppError(400, "USERNAME_INVALID", "Username is not allowed.", {
      field: "username",
      reason: validation.reason,
    });
  }

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({
        handle: userProfiles.handle,
        version: userProfiles.profileVersion,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, input.userId))
      .limit(1);

    if (!profile) {
      throw new AppError(404, "PROFILE_NOT_FOUND", "Profile was not found.");
    }

    if (profile.handle) {
      if (profile.handle === validation.normalized) {
        return { handle: profile.handle, version: profile.version };
      }
      throw new AppError(
        409,
        "USERNAME_ALREADY_SET",
        "Initial username has already been assigned.",
      );
    }

    const [updated] = await tx
      .update(userProfiles)
      .set({
        handle: validation.normalized,
        normalizedHandle: validation.normalized,
        handleSetAt: new Date(),
        profileVersion: sql`${userProfiles.profileVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userProfiles.userId, input.userId),
          isNull(userProfiles.handle),
        ),
      )
      .returning({
        handle: userProfiles.handle,
        version: userProfiles.profileVersion,
      });

    if (!updated?.handle) {
      throw new AppError(
        409,
        "USERNAME_ASSIGNMENT_CONFLICT",
        "Username could not be assigned.",
      );
    }

    await tx
      .update(accounts)
      .set({ onboardingStatus: "complete", updatedAt: new Date() })
      .where(eq(accounts.id, input.userId));
    await tx.insert(profileHandleHistory).values({
      userId: input.userId,
      newNormalizedHandle: validation.normalized,
      changeType: "initial_assignment",
    });
    await tx.insert(auditEvents).values({
      actorUserId: input.userId,
      action: "profile.username_assigned",
      targetType: "user_profile",
      targetId: input.userId,
      requestId: input.requestId,
      metadata: { normalizedHandle: validation.normalized },
    });
    await tx.insert(outboxEvents).values({
      aggregateType: "user_profile",
      aggregateId: input.userId,
      eventType: "profile.username_assigned",
      payload: {
        userId: input.userId,
        normalizedHandle: validation.normalized,
      },
    });

    return { handle: updated.handle, version: updated.version };
  });
}

export async function changeUsername(input: {
  userId: string;
  candidate: string;
  requestId: string;
}) {
  const validation = validateHandle(input.candidate);
  if (!validation.valid) {
    throw new AppError(400, "USERNAME_INVALID", "Username is not allowed.", {
      field: "username",
      reason: validation.reason,
    });
  }
  const [lastChange] = await db.select({ changedAt: profileHandleHistory.changedAt })
    .from(profileHandleHistory)
    .where(eq(profileHandleHistory.userId, input.userId))
    .orderBy(desc(profileHandleHistory.changedAt))
    .limit(1);
  const cooldownEndsAt = lastChange
    ? new Date(lastChange.changedAt.getTime() + 30 * 86_400_000)
    : null;
  if (cooldownEndsAt && cooldownEndsAt.getTime() > Date.now()) {
    throw new AppError(409, "USERNAME_CHANGE_COOLDOWN", "Username can be changed once every 30 days.", {
      availableAt: cooldownEndsAt,
    });
  }
  return db.transaction(async (tx) => {
    const [current] = await tx.select({
      handle: userProfiles.handle,
      version: userProfiles.profileVersion,
    }).from(userProfiles).where(eq(userProfiles.userId, input.userId)).limit(1);
    if (!current?.handle) throw new AppError(409, "USERNAME_NOT_ASSIGNED", "Assign an initial username first.");
    if (current.handle === validation.normalized) return { handle: current.handle, version: current.version };
    const [updated] = await tx.update(userProfiles).set({
      handle: validation.normalized,
      normalizedHandle: validation.normalized,
      handleSetAt: new Date(),
      profileVersion: sql`${userProfiles.profileVersion} + 1`,
      updatedAt: new Date(),
    }).where(eq(userProfiles.userId, input.userId)).returning({
      handle: userProfiles.handle,
      version: userProfiles.profileVersion,
    });
    if (!updated?.handle) throw new AppError(409, "USERNAME_CHANGE_CONFLICT", "Username could not be changed.");
    await tx.insert(profileHandleHistory).values({
      userId: input.userId,
      oldNormalizedHandle: current.handle,
      newNormalizedHandle: validation.normalized,
      changeType: "user_change",
      protectedUntil: new Date(Date.now() + 30 * 86_400_000),
    });
    await tx.insert(auditEvents).values({
      actorUserId: input.userId,
      action: "profile.username_changed",
      targetType: "user_profile",
      targetId: input.userId,
      requestId: input.requestId,
      metadata: { oldHandle: current.handle, newHandle: validation.normalized },
    });
    return updated;
  });
}

export async function getOwnerProfile(userId: string) {
  const [row] = await db
    .select({
      userId: userProfiles.userId,
      displayName: userProfiles.displayName,
      handle: userProfiles.handle,
      bio: userProfiles.bio,
      avatarMediaId: userProfiles.avatarMediaId,
      publicLocationLabel: userProfiles.publicLocationLabel,
      websiteUrl: userProfiles.websiteUrl,
      verificationStatus: userProfiles.verificationStatus,
      profileVersion: userProfiles.profileVersion,
      joinedAt: accounts.createdAt,
      onboardingStatus: accounts.onboardingStatus,
    })
    .from(userProfiles)
    .innerJoin(accounts, eq(accounts.id, userProfiles.userId))
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (!row) {
    throw new AppError(404, "PROFILE_NOT_FOUND", "Profile was not found.");
  }

  return {
    profile: {
      id: row.userId,
      displayName: row.displayName,
      handle: row.handle,
      bio: row.bio,
      avatar: await avatarModel(row.avatarMediaId),
      publicLocationLabel: row.publicLocationLabel,
      websiteUrl: row.websiteUrl,
      verification: { status: row.verificationStatus },
      joinedAt: row.joinedAt,
      version: row.profileVersion,
    },
    onboarding: {
      status: row.onboardingStatus,
      nextStep:
        row.onboardingStatus === "complete" ? "app" : "username_required",
    },
    impact: await impactFor(userId),
    privateAlerts: {
      adoptionMissedUpdates: 0,
      adoptionDueSoon: 0,
    },
    viewer: {
      isOwner: true,
      canEditProfile: true,
      canManageCompanions: true,
      canManageSettings: true,
    },
  };
}

export async function updateProfile(input: {
  userId: string;
  version: number;
  displayName?: string | null | undefined;
  bio?: string | null | undefined;
  publicLocationLabel?: string | null | undefined;
  websiteUrl?: string | null | undefined;
  requestId: string;
}) {
  const changes: Partial<typeof userProfiles.$inferInsert> = {
    profileVersion: sql`${userProfiles.profileVersion} + 1` as never,
    updatedAt: new Date(),
  };

  if (input.displayName !== undefined) {
    changes.displayName = input.displayName?.trim() ?? "";
  }
  if (input.bio !== undefined) {
    changes.bio = input.bio?.trim() || null;
  }
  if (input.publicLocationLabel !== undefined) {
    changes.publicLocationLabel = input.publicLocationLabel?.trim() || null;
  }
  if (input.websiteUrl !== undefined) {
    changes.websiteUrl = input.websiteUrl?.trim() || null;
  }

  const [updated] = await db
    .update(userProfiles)
    .set(changes)
    .where(
      and(
        eq(userProfiles.userId, input.userId),
        eq(userProfiles.profileVersion, input.version),
      ),
    )
    .returning({ version: userProfiles.profileVersion });

  if (!updated) {
    throw new AppError(
      409,
      "PROFILE_VERSION_CONFLICT",
      "Profile changed on another device. Reload before saving again.",
    );
  }

  await db.insert(auditEvents).values({
    actorUserId: input.userId,
    action: "profile.updated",
    targetType: "user_profile",
    targetId: input.userId,
    requestId: input.requestId,
    metadata: { fields: Object.keys(changes).filter((key) => key !== "updatedAt") },
  });

  return getOwnerProfile(input.userId);
}

async function usersAreBlocked(
  viewerUserId: string,
  profileUserId: string,
): Promise<boolean> {
  const [block] = await db
    .select({ blockerUserId: userBlocks.blockerUserId })
    .from(userBlocks)
    .where(
      and(
        isNull(userBlocks.removedAt),
        or(
          and(
            eq(userBlocks.blockerUserId, viewerUserId),
            eq(userBlocks.blockedUserId, profileUserId),
          ),
          and(
            eq(userBlocks.blockerUserId, profileUserId),
            eq(userBlocks.blockedUserId, viewerUserId),
          ),
        ),
      ),
    )
    .limit(1);

  return Boolean(block);
}

export async function getPublicProfile(
  profileUserId: string,
  viewerUserId: string | null,
) {
  if (viewerUserId === profileUserId) {
    return getOwnerProfile(profileUserId);
  }

  if (viewerUserId && (await usersAreBlocked(viewerUserId, profileUserId))) {
    throw new AppError(404, "PROFILE_NOT_FOUND", "Profile was not found.");
  }

  const [row] = await db
    .select({
      userId: userProfiles.userId,
      displayName: userProfiles.displayName,
      handle: userProfiles.handle,
      bio: userProfiles.bio,
      avatarMediaId: userProfiles.avatarMediaId,
      publicLocationLabel: userProfiles.publicLocationLabel,
      verificationStatus: userProfiles.verificationStatus,
      joinedAt: accounts.createdAt,
      accountStatus: accounts.status,
      onboardingStatus: accounts.onboardingStatus,
      profileVisibility: userPrivacySettings.profileVisibility,
      showLocation: userPrivacySettings.showLocation,
      showCompanions: userPrivacySettings.showCompanions,
      messagePolicy: userPrivacySettings.messagePolicy,
    })
    .from(userProfiles)
    .innerJoin(accounts, eq(accounts.id, userProfiles.userId))
    .innerJoin(
      userPrivacySettings,
      eq(userPrivacySettings.userId, userProfiles.userId),
    )
    .where(eq(userProfiles.userId, profileUserId))
    .limit(1);

  if (
    !row ||
    row.accountStatus !== "active" ||
    row.onboardingStatus !== "complete" ||
    row.profileVisibility !== "everyone"
  ) {
    throw new AppError(404, "PROFILE_NOT_FOUND", "Profile was not found.");
  }

  const publicCompanions = row.showCompanions
    ? await db
        .select({
          id: companions.id,
          name: companions.name,
          species: companions.species,
          avatarAssetId: companions.avatarAssetId,
          status: companions.status,
        })
        .from(companions)
        .where(
          and(
            eq(companions.primaryOwnerUserId, profileUserId),
            eq(companions.status, "active"),
            eq(companions.profileVisibility, "everyone"),
          ),
        )
    : [];

  return {
    profile: {
      id: row.userId,
      displayName: row.displayName,
      handle: row.handle,
      bio: row.bio,
      avatar: await avatarModel(row.avatarMediaId),
      publicLocationLabel: row.showLocation
        ? row.publicLocationLabel
        : null,
      verification: { status: row.verificationStatus },
      joinedAt: row.joinedAt,
    },
    impact: await impactFor(profileUserId),
    companions: publicCompanions,
    viewer: {
      isOwner: false,
      canViewProfile: true,
      canViewPosts: true,
      canViewCompanions: row.showCompanions,
      canMessage: Boolean(
        viewerUserId && row.messagePolicy === "everyone",
      ),
      messageDeniedReason:
        row.messagePolicy === "everyone" ? null : row.messagePolicy,
      canInviteToCircle: Boolean(viewerUserId),
      canReport: Boolean(viewerUserId),
      canBlock: Boolean(viewerUserId),
    },
  };
}

export async function getPrivacySettings(userId: string) {
  const [settings] = await db
    .select()
    .from(userPrivacySettings)
    .where(eq(userPrivacySettings.userId, userId))
    .limit(1);

  if (!settings) {
    throw new AppError(
      404,
      "PRIVACY_SETTINGS_NOT_FOUND",
      "Privacy settings were not found.",
    );
  }

  return settings;
}

export async function updatePrivacySettings(input: {
  userId: string;
  version: number;
  profileVisibility?: "everyone" | "circles" | "only_me" | undefined;
  discoverable?: boolean | undefined;
  showOnline?: boolean | undefined;
  defaultPostVisibility?: "everyone" | "circles" | "only_me" | undefined;
  showLocation?: boolean | undefined;
  showCompanions?: boolean | undefined;
  showTreatsOnProfile?: boolean | undefined;
  messagePolicy?: "everyone" | "circles" | "none" | undefined;
  requestId: string;
}) {
  const changes: Partial<typeof userPrivacySettings.$inferInsert> = {
    version: sql`${userPrivacySettings.version} + 1` as never,
    updatedAt: new Date(),
  };

  const keys = [
    "profileVisibility",
    "discoverable",
    "showOnline",
    "defaultPostVisibility",
    "showLocation",
    "showCompanions",
    "showTreatsOnProfile",
    "messagePolicy",
  ] as const;

  for (const key of keys) {
    if (input[key] !== undefined) {
      Object.assign(changes, { [key]: input[key] });
    }
  }

  const [updated] = await db
    .update(userPrivacySettings)
    .set(changes)
    .where(
      and(
        eq(userPrivacySettings.userId, input.userId),
        eq(userPrivacySettings.version, input.version),
      ),
    )
    .returning();

  if (!updated) {
    throw new AppError(
      409,
      "PRIVACY_VERSION_CONFLICT",
      "Privacy settings changed on another device.",
    );
  }

  await db.insert(auditEvents).values({
    actorUserId: input.userId,
    action: "profile.privacy_updated",
    targetType: "user_privacy_settings",
    targetId: input.userId,
    requestId: input.requestId,
  });

  return updated;
}

export async function blockUser(
  blockerUserId: string,
  blockedUserId: string,
  requestId: string,
): Promise<void> {
  if (blockerUserId === blockedUserId) {
    throw new AppError(400, "CANNOT_BLOCK_SELF", "You cannot block yourself.");
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(userBlocks)
      .values({ blockerUserId, blockedUserId })
      .onConflictDoUpdate({
        target: [userBlocks.blockerUserId, userBlocks.blockedUserId],
        set: { removedAt: null, createdAt: new Date() },
      });
    await tx.insert(auditEvents).values({
      actorUserId: blockerUserId,
      action: "user.blocked",
      targetType: "user",
      targetId: blockedUserId,
      requestId,
    });
    await tx.insert(outboxEvents).values({
      aggregateType: "user",
      aggregateId: blockerUserId,
      eventType: "user.blocked",
      payload: { blockerUserId, blockedUserId },
    });
  });
}

export async function unblockUser(
  blockerUserId: string,
  blockedUserId: string,
  requestId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(userBlocks)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(userBlocks.blockerUserId, blockerUserId),
          eq(userBlocks.blockedUserId, blockedUserId),
          isNull(userBlocks.removedAt),
        ),
      );
    await tx.insert(auditEvents).values({
      actorUserId: blockerUserId,
      action: "user.unblocked",
      targetType: "user",
      targetId: blockedUserId,
      requestId,
    });
  });
}

export async function listBlockedUsers(userId: string) {
  return db
    .select({
      id: userProfiles.userId,
      displayName: userProfiles.displayName,
      handle: userProfiles.handle,
      blockedAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .innerJoin(userProfiles, eq(userProfiles.userId, userBlocks.blockedUserId))
    .where(
      and(
        eq(userBlocks.blockerUserId, userId),
        isNull(userBlocks.removedAt),
      ),
    );
}
