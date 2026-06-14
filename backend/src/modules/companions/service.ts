import { and, count, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  accounts,
  auditEvents,
  companionCareProfiles,
  companionFollowers,
  companionManagers,
  companionTreats,
  companions,
  outboxEvents,
  postCompanions,
  posts,
  userBlocks,
  userPrivacySettings,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import { validateHandle } from "../../shared/handles.js";
import { getReadyMediaReadModel } from "../media/service.js";

type CareInput = {
  dateOfBirth?: Date | null | undefined;
  breedPrivate?: string | null | undefined;
  sex?: string | null | undefined;
  vaccinationStatus?: string | null | undefined;
  neuterStatus?: string | null | undefined;
  microchipStatus?: string | null | undefined;
  allergies?: string | null | undefined;
  medicalNotes?: string | null | undefined;
};

async function requireCompletedAccount(userId: string): Promise<void> {
  const [account] = await db
    .select({
      status: accounts.status,
      onboardingStatus: accounts.onboardingStatus,
    })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .limit(1);

  if (!account || account.status !== "active") {
    throw new AppError(
      403,
      "ACCOUNT_NOT_ACTIVE",
      "An active account is required.",
    );
  }

  if (account.onboardingStatus !== "complete") {
    throw new AppError(
      403,
      "ONBOARDING_INCOMPLETE",
      "Choose a username before creating companions.",
      { nextStep: "username_required" },
    );
  }
}

async function companionSummary(
  companion: typeof companions.$inferSelect,
  viewer: {
    isManager: boolean;
    canEditProfile: boolean;
    canManageAvatar: boolean;
    canAttachToPosts: boolean;
    canPostAsCompanion: boolean;
  },
  followerCount: number,
  isFollowing: boolean,
  showTreats: boolean,
) {
  const [treatRows, postRows] = await Promise.all([
    db.select({ value: count() }).from(companionTreats).where(eq(companionTreats.companionId, companion.id)),
    db.select({ value: count() }).from(postCompanions)
      .innerJoin(posts, eq(posts.id, postCompanions.postId))
      .where(and(eq(postCompanions.companionId, companion.id), eq(posts.status, "published"), isNull(posts.deletedAt))),
  ]);
  let avatar: { mediaAssetId: string; url?: string } | null = null;
  if (companion.avatarAssetId) {
    try {
      avatar = { mediaAssetId: companion.avatarAssetId, ...(await getReadyMediaReadModel(companion.avatarAssetId)) };
    } catch {
      avatar = { mediaAssetId: companion.avatarAssetId };
    }
  }
  return {
    id: companion.id,
    ownerId: companion.primaryOwnerUserId,
    name: companion.name,
    handle: companion.publicHandle,
    species: companion.species,
    breed: companion.breedPublic,
    ageDisplay: companion.ageDisplay,
    genderDisplay: companion.genderDisplay,
    about: companion.about,
    mood: companion.mood,
    avatar,
    profileVisibility: companion.profileVisibility,
    status: companion.status,
    sourceType: companion.sourceType,
    verification: { status: companion.verifiedStatus },
    stats: {
      followers: followerCount,
      pawprints: 0,
      treats: showTreats ? treatRows[0]?.value ?? 0 : null,
      posts: postRows[0]?.value ?? 0,
    },
    version: companion.profileVersion,
    createdAt: companion.createdAt,
    updatedAt: companion.updatedAt,
    viewer: {
      ...viewer,
      isFollowing,
      canFollow: !viewer.isManager && companion.status === "active",
      canTreat: !viewer.isManager && companion.status === "active",
    },
  };
}

export async function listManageableCompanions(userId: string) {
  const rows = await db
    .select({
      companion: companions,
      canEditProfile: companionManagers.canEditProfile,
      canManageAvatar: companionManagers.canManageAvatar,
      canAttachToPosts: companionManagers.canAttachToPosts,
      canPostAsCompanion: companionManagers.canPostAsCompanion,
    })
    .from(companionManagers)
    .innerJoin(companions, eq(companions.id, companionManagers.companionId))
    .where(
      and(
        eq(companionManagers.userId, userId),
        isNull(companionManagers.revokedAt),
      ),
    );

  return Promise.all(
    rows.map(async (row) => {
      const [followers] = await db
        .select({ value: count() })
        .from(companionFollowers)
        .where(eq(companionFollowers.companionId, row.companion.id));

      return companionSummary(
        row.companion,
        {
          isManager: true,
          canEditProfile: row.canEditProfile,
          canManageAvatar: row.canManageAvatar,
          canAttachToPosts: row.canAttachToPosts,
          canPostAsCompanion: row.canPostAsCompanion,
        },
        followers?.value ?? 0,
        false,
        true,
      );
    }),
  );
}

export async function createCompanion(input: {
  actorUserId: string;
  name: string;
  species: string;
  publicHandle?: string | null | undefined;
  breedPublic?: string | null | undefined;
  ageDisplay?: string | null | undefined;
  genderDisplay?: string | null | undefined;
  about?: string | null | undefined;
  mood?: string | null | undefined;
  profileVisibility: "everyone" | "circles" | "only_me";
  care?: CareInput | undefined;
  requestId: string;
}) {
  await requireCompletedAccount(input.actorUserId);

  const handleValidation = input.publicHandle
    ? validateHandle(input.publicHandle)
    : null;
  if (handleValidation && !handleValidation.valid) {
    throw new AppError(
      400,
      "COMPANION_HANDLE_INVALID",
      "Companion handle is not allowed.",
      { field: "publicHandle", reason: handleValidation.reason },
    );
  }

  const companionId = await db.transaction(async (tx) => {
    const [companion] = await tx
      .insert(companions)
      .values({
        primaryOwnerUserId: input.actorUserId,
        name: input.name.trim(),
        species: input.species.trim().toLowerCase(),
        publicHandle: handleValidation?.normalized ?? null,
        normalizedPublicHandle: handleValidation?.normalized ?? null,
        breedPublic: input.breedPublic?.trim() || null,
        ageDisplay: input.ageDisplay?.trim() || null,
        genderDisplay: input.genderDisplay?.trim() || null,
        about: input.about?.trim() || null,
        mood: input.mood?.trim() || null,
        profileVisibility: input.profileVisibility,
      })
      .returning({ id: companions.id });

    if (!companion) {
      throw new AppError(
        500,
        "COMPANION_CREATE_FAILED",
        "Companion was not created.",
      );
    }

    await tx.insert(companionManagers).values({
      companionId: companion.id,
      userId: input.actorUserId,
      role: "owner",
      canEditProfile: true,
      canManageAvatar: true,
      canAttachToPosts: true,
      canPostAsCompanion: true,
      canViewCareRecord: true,
      canUseVetServices: true,
      canManageAccess: true,
    });

    await tx.insert(companionCareProfiles).values({
      companionId: companion.id,
      dateOfBirth: input.care?.dateOfBirth,
      breedPrivate: input.care?.breedPrivate?.trim() || null,
      sex: input.care?.sex?.trim() || null,
      vaccinationStatus: input.care?.vaccinationStatus?.trim() || null,
      neuterStatus: input.care?.neuterStatus?.trim() || null,
      microchipStatus: input.care?.microchipStatus?.trim() || null,
      allergies: input.care?.allergies?.trim() || null,
      medicalNotes: input.care?.medicalNotes?.trim() || null,
    });

    await tx.insert(auditEvents).values({
      actorUserId: input.actorUserId,
      action: "companion.created",
      targetType: "companion",
      targetId: companion.id,
      requestId: input.requestId,
    });
    await tx.insert(outboxEvents).values({
      aggregateType: "companion",
      aggregateId: companion.id,
      eventType: "companion.created",
      payload: {
        companionId: companion.id,
        primaryOwnerUserId: input.actorUserId,
      },
    });

    return companion.id;
  });

  return getCompanion(companionId, input.actorUserId);
}

async function managerPermissions(companionId: string, userId: string | null) {
  if (!userId) {
    return null;
  }

  const [manager] = await db
    .select({
      canEditProfile: companionManagers.canEditProfile,
      canManageAvatar: companionManagers.canManageAvatar,
      canAttachToPosts: companionManagers.canAttachToPosts,
      canPostAsCompanion: companionManagers.canPostAsCompanion,
    })
    .from(companionManagers)
    .where(
      and(
        eq(companionManagers.companionId, companionId),
        eq(companionManagers.userId, userId),
        isNull(companionManagers.revokedAt),
      ),
    )
    .limit(1);

  return manager ?? null;
}

async function blocked(
  viewerUserId: string,
  ownerUserId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ blockerUserId: userBlocks.blockerUserId })
    .from(userBlocks)
    .where(
      and(
        isNull(userBlocks.removedAt),
        or(
          and(
            eq(userBlocks.blockerUserId, viewerUserId),
            eq(userBlocks.blockedUserId, ownerUserId),
          ),
          and(
            eq(userBlocks.blockerUserId, ownerUserId),
            eq(userBlocks.blockedUserId, viewerUserId),
          ),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getCompanion(
  companionId: string,
  viewerUserId: string | null,
) {
  const [companion] = await db
    .select()
    .from(companions)
    .where(eq(companions.id, companionId))
    .limit(1);

  if (!companion) {
    throw new AppError(
      404,
      "COMPANION_NOT_FOUND",
      "Companion was not found.",
    );
  }

  const manager = await managerPermissions(companionId, viewerUserId);
  let showTreats = true;
  if (
    viewerUserId &&
    !manager &&
    (await blocked(viewerUserId, companion.primaryOwnerUserId))
  ) {
    throw new AppError(
      404,
      "COMPANION_NOT_FOUND",
      "Companion was not found.",
    );
  }

  if (!manager) {
    const [ownerPrivacy] = await db
      .select({
        profileVisibility: userPrivacySettings.profileVisibility,
        showCompanions: userPrivacySettings.showCompanions,
        showTreatsOnProfile: userPrivacySettings.showTreatsOnProfile,
      })
      .from(userPrivacySettings)
      .where(eq(userPrivacySettings.userId, companion.primaryOwnerUserId))
      .limit(1);

    if (
      companion.status !== "active" ||
      companion.profileVisibility !== "everyone" ||
      ownerPrivacy?.profileVisibility !== "everyone" ||
      !ownerPrivacy.showCompanions
    ) {
      throw new AppError(
        404,
        "COMPANION_NOT_VISIBLE",
        "Companion is not visible.",
      );
    }
    showTreats = ownerPrivacy?.showTreatsOnProfile ?? true;
  }

  const [[followers], [follow]] = await Promise.all([
    db
      .select({ value: count() })
      .from(companionFollowers)
      .where(eq(companionFollowers.companionId, companionId)),
    viewerUserId
      ? db
          .select({ userId: companionFollowers.userId })
          .from(companionFollowers)
          .where(
            and(
              eq(companionFollowers.companionId, companionId),
              eq(companionFollowers.userId, viewerUserId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  return companionSummary(
    companion,
    {
      isManager: Boolean(manager),
      canEditProfile: manager?.canEditProfile ?? false,
      canManageAvatar: manager?.canManageAvatar ?? false,
      canAttachToPosts: manager?.canAttachToPosts ?? false,
      canPostAsCompanion: manager?.canPostAsCompanion ?? false,
    },
    followers?.value ?? 0,
    Boolean(follow),
    showTreats,
  );
}

export async function updateCompanion(input: {
  actorUserId: string;
  companionId: string;
  version: number;
  name?: string | undefined;
  breedPublic?: string | null | undefined;
  ageDisplay?: string | null | undefined;
  genderDisplay?: string | null | undefined;
  about?: string | null | undefined;
  mood?: string | null | undefined;
  profileVisibility?: "everyone" | "circles" | "only_me" | undefined;
  requestId: string;
}) {
  const manager = await managerPermissions(
    input.companionId,
    input.actorUserId,
  );
  if (!manager?.canEditProfile) {
    throw new AppError(
      403,
      "COMPANION_EDIT_FORBIDDEN",
      "You cannot edit this companion.",
    );
  }

  const changes: Partial<typeof companions.$inferInsert> = {
    profileVersion: sql`${companions.profileVersion} + 1` as never,
    updatedAt: new Date(),
  };
  const textFields = [
    "name",
    "breedPublic",
    "ageDisplay",
    "genderDisplay",
    "about",
    "mood",
  ] as const;

  for (const key of textFields) {
    if (input[key] !== undefined) {
      Object.assign(changes, {
        [key]: input[key]?.trim() || (key === "name" ? "" : null),
      });
    }
  }
  if (input.profileVisibility !== undefined) {
    changes.profileVisibility = input.profileVisibility;
  }

  const [updated] = await db
    .update(companions)
    .set(changes)
    .where(
      and(
        eq(companions.id, input.companionId),
        eq(companions.profileVersion, input.version),
      ),
    )
    .returning({ id: companions.id });

  if (!updated) {
    throw new AppError(
      409,
      "PROFILE_VERSION_CONFLICT",
      "Companion changed on another device.",
    );
  }

  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId,
    action: "companion.updated",
    targetType: "companion",
    targetId: input.companionId,
    requestId: input.requestId,
  });

  return getCompanion(input.companionId, input.actorUserId);
}

export async function setCompanionArchived(input: {
  actorUserId: string;
  companionId: string;
  archived: boolean;
  requestId: string;
}) {
  const [manager] = await db
    .select({
      role: companionManagers.role,
      canManageAccess: companionManagers.canManageAccess,
    })
    .from(companionManagers)
    .where(
      and(
        eq(companionManagers.companionId, input.companionId),
        eq(companionManagers.userId, input.actorUserId),
        isNull(companionManagers.revokedAt),
      ),
    )
    .limit(1);

  if (!manager?.canManageAccess || manager.role !== "owner") {
    throw new AppError(
      403,
      "COMPANION_EDIT_FORBIDDEN",
      "Only the owner can archive or restore this companion.",
    );
  }

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(companions)
      .set({
        status: input.archived ? "archived" : "active",
        archivedAt: input.archived ? new Date() : null,
        updatedAt: new Date(),
        profileVersion: sql`${companions.profileVersion} + 1`,
      })
      .where(eq(companions.id, input.companionId))
      .returning({ id: companions.id });

    if (!updated) {
      throw new AppError(
        404,
        "COMPANION_NOT_FOUND",
        "Companion was not found.",
      );
    }

    const eventType = input.archived
      ? "companion.archived"
      : "companion.restored";
    await tx.insert(auditEvents).values({
      actorUserId: input.actorUserId,
      action: eventType,
      targetType: "companion",
      targetId: input.companionId,
      requestId: input.requestId,
    });
    await tx.insert(outboxEvents).values({
      aggregateType: "companion",
      aggregateId: input.companionId,
      eventType,
      payload: {
        companionId: input.companionId,
        actorUserId: input.actorUserId,
      },
    });
  });

  return getCompanion(input.companionId, input.actorUserId);
}

export async function followCompanion(
  companionId: string,
  userId: string,
): Promise<void> {
  const companion = await getCompanion(companionId, userId);
  if (companion.viewer.isManager) {
    throw new AppError(
      400,
      "CANNOT_FOLLOW_OWN_COMPANION",
      "Managers cannot follow their own companion.",
    );
  }

  await db
    .insert(companionFollowers)
    .values({ companionId, userId })
    .onConflictDoNothing();
}

export async function unfollowCompanion(
  companionId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(companionFollowers)
    .where(
      and(
        eq(companionFollowers.companionId, companionId),
        eq(companionFollowers.userId, userId),
      ),
    );
}
