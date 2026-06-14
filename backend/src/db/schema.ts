import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "deactivated",
  "deletion_pending",
  "suspended",
]);

export const onboardingStatusEnum = pgEnum("onboarding_status", [
  "username_required",
  "complete",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "unverified",
  "pending",
  "verified",
]);

export const visibilityEnum = pgEnum("visibility", [
  "everyone",
  "circles",
  "only_me",
]);

export const messagePolicyEnum = pgEnum("message_policy", [
  "everyone",
  "circles",
  "none",
]);

export const companionStatusEnum = pgEnum("companion_status", [
  "active",
  "archived",
  "transferred",
  "memorialized",
]);

export const companionSourceEnum = pgEnum("companion_source", [
  "manual",
  "adoption",
  "transfer",
]);

export const companionManagerRoleEnum = pgEnum("companion_manager_role", [
  "owner",
  "co_owner",
  "caregiver",
  "editor",
  "viewer",
]);

export const mediaStatusEnum = pgEnum("media_status", [
  "pending",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleted",
]);

export const mediaTypeEnum = pgEnum("media_type", [
  "image",
  "video",
  "file",
]);

export const moderationStatusEnum = pgEnum("moderation_status", [
  "pending",
  "approved",
  "rejected",
]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: accountStatusEnum("status").notNull().default("active"),
    onboardingStatus: onboardingStatusEnum("onboarding_status")
      .notNull()
      .default("username_required"),
    contactVerifiedAt: timestamp("contact_verified_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_normalized_email_uidx").on(table.normalizedEmail),
    index("accounts_status_idx").on(table.status),
  ],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => accounts.id),
    purpose: text("purpose").notNull(),
    status: mediaStatusEnum("status").notNull().default("pending"),
    mediaType: mediaTypeEnum("media_type").notNull(),
    storageKey: text("storage_key"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    checksum: text("checksum"),
    thumbnailStorageKey: text("thumbnail_storage_key"),
    moderationStatus: moderationStatusEnum("moderation_status")
      .notNull()
      .default("pending"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("media_assets_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    handle: text("handle"),
    normalizedHandle: text("normalized_handle"),
    handleSetAt: timestamp("handle_set_at", { withTimezone: true }),
    bio: text("bio"),
    avatarMediaId: uuid("avatar_media_id").references(() => mediaAssets.id),
    publicLocationLabel: text("public_location_label"),
    locationAreaId: uuid("location_area_id"),
    websiteUrl: text("website_url"),
    verificationStatus: verificationStatusEnum("verification_status")
      .notNull()
      .default("unverified"),
    profileVersion: integer("profile_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_profiles_normalized_handle_uidx")
      .on(table.normalizedHandle)
      .where(sql`${table.normalizedHandle} is not null`),
    index("user_profiles_display_name_idx").on(table.displayName),
  ],
);

export const profileHandleHistory = pgTable(
  "profile_handle_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    oldNormalizedHandle: text("old_normalized_handle"),
    newNormalizedHandle: text("new_normalized_handle").notNull(),
    changeType: text("change_type").notNull(),
    protectedUntil: timestamp("protected_until", { withTimezone: true }),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("profile_handle_history_user_idx").on(table.userId)],
);

export const profileReviews = pgTable(
  "profile_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewerUserId: uuid("reviewer_user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    subjectUserId: uuid("subject_user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    text: text("text"),
    status: text("status").notNull().default("published"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("profile_reviews_reviewer_subject_uidx").on(table.reviewerUserId, table.subjectUserId),
    index("profile_reviews_subject_idx").on(table.subjectUserId, table.createdAt),
  ],
);

export const accountDeletionRequests = pgTable(
  "account_deletion_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    executeAfter: timestamp("execute_after", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("account_deletion_requests_active_uidx")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const userPrivacySettings = pgTable("user_privacy_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  profileVisibility: visibilityEnum("profile_visibility")
    .notNull()
    .default("everyone"),
  discoverable: boolean("discoverable").notNull().default(true),
  showOnline: boolean("show_online").notNull().default(true),
  defaultPostVisibility: visibilityEnum("default_post_visibility")
    .notNull()
    .default("everyone"),
  showLocation: boolean("show_location").notNull().default(true),
  showCompanions: boolean("show_companions").notNull().default(true),
  showTreatsOnProfile: boolean("show_treats_on_profile").notNull().default(true),
  messagePolicy: messagePolicyEnum("message_policy")
    .notNull()
    .default("everyone"),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    postActivity: boolean("post_activity").notNull().default(true),
    messages: boolean("messages").notNull().default(true),
    communities: boolean("communities").notNull().default(true),
    pawCircles: boolean("paw_circles").notNull().default(true),
    adoptionUpdates: boolean("adoption_updates").notNull().default(true),
    rescueUpdates: boolean("rescue_updates").notNull().default(true),
    lostFoundNearby: boolean("lost_found_nearby").notNull().default(true),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    deviceName: text("device_name"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("user_sessions_user_active_idx").on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
  ],
);

export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerUserId: uuid("blocker_user_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    reasonCode: text("reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.blockerUserId, table.blockedUserId],
      name: "user_blocks_pk",
    }),
    index("user_blocks_blocked_idx").on(table.blockedUserId),
  ],
);

export const companions = pgTable(
  "companions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    primaryOwnerUserId: uuid("primary_owner_user_id")
      .notNull()
      .references(() => accounts.id),
    publicHandle: text("public_handle"),
    normalizedPublicHandle: text("normalized_public_handle"),
    name: text("name").notNull(),
    species: text("species").notNull(),
    breedPublic: text("breed_public"),
    ageDisplay: text("age_display"),
    genderDisplay: text("gender_display"),
    about: text("about"),
    mood: text("mood"),
    avatarAssetId: uuid("avatar_asset_id").references(() => mediaAssets.id),
    profileVisibility: visibilityEnum("profile_visibility")
      .notNull()
      .default("everyone"),
    status: companionStatusEnum("status").notNull().default("active"),
    sourceType: companionSourceEnum("source_type").notNull().default("manual"),
    sourceAdoptionRecordId: uuid("source_adoption_record_id"),
    verifiedStatus: verificationStatusEnum("verified_status")
      .notNull()
      .default("unverified"),
    profileVersion: integer("profile_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("companions_normalized_handle_uidx")
      .on(table.normalizedPublicHandle)
      .where(sql`${table.normalizedPublicHandle} is not null`),
    index("companions_owner_status_idx").on(
      table.primaryOwnerUserId,
      table.status,
    ),
  ],
);

export const companionManagers = pgTable(
  "companion_managers",
  {
    companionId: uuid("companion_id")
      .notNull()
      .references(() => companions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    role: companionManagerRoleEnum("role").notNull(),
    canEditProfile: boolean("can_edit_profile").notNull().default(false),
    canManageAvatar: boolean("can_manage_avatar").notNull().default(false),
    canAttachToPosts: boolean("can_attach_to_posts").notNull().default(false),
    canPostAsCompanion: boolean("can_post_as_companion")
      .notNull()
      .default(false),
    canViewCareRecord: boolean("can_view_care_record")
      .notNull()
      .default(false),
    canUseVetServices: boolean("can_use_vet_services")
      .notNull()
      .default(false),
    canManageAccess: boolean("can_manage_access").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.companionId, table.userId],
      name: "companion_managers_pk",
    }),
    index("companion_managers_user_idx").on(table.userId, table.revokedAt),
  ],
);

export const companionCareProfiles = pgTable("companion_care_profiles", {
  companionId: uuid("companion_id")
    .primaryKey()
    .references(() => companions.id, { onDelete: "cascade" }),
  dateOfBirth: timestamp("date_of_birth", { withTimezone: true }),
  breedPrivate: text("breed_private"),
  sex: text("sex"),
  vaccinationStatus: text("vaccination_status"),
  neuterStatus: text("neuter_status"),
  microchipStatus: text("microchip_status"),
  microchipIdentifierEncrypted: text("microchip_identifier_encrypted"),
  allergies: text("allergies"),
  medicalNotes: text("medical_notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const companionFollowers = pgTable(
  "companion_followers",
  {
    companionId: uuid("companion_id")
      .notNull()
      .references(() => companions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.companionId, table.userId],
      name: "companion_followers_pk",
    }),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_scope_uidx").on(
      table.userId,
      table.scope,
      table.key,
    ),
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => accounts.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    requestId: text("request_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_target_idx").on(table.targetType, table.targetId),
    index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    index("outbox_events_unpublished_idx").on(
      table.publishedAt,
      table.availableAt,
    ),
  ],
);

export const companionTransfers = pgTable(
  "companion_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companionId: uuid("companion_id").notNull().references(() => companions.id, { onDelete: "cascade" }),
    fromOwnerUserId: uuid("from_owner_user_id").notNull().references(() => accounts.id),
    toUserId: uuid("to_user_id").notNull().references(() => accounts.id),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("companion_transfers_pending_uidx")
      .on(table.companionId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const companionRelationships = pgTable(
  "companion_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companionId: uuid("companion_id").notNull().references(() => companions.id, { onDelete: "cascade" }),
    relatedCompanionId: uuid("related_companion_id").notNull().references(() => companions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => accounts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("companion_relationships_pair_uidx").on(table.companionId, table.relatedCompanionId, table.type),
  ],
);

export const companionTreats = pgTable(
  "companion_treats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companionId: uuid("companion_id").notNull().references(() => companions.id, { onDelete: "cascade" }),
    giverUserId: uuid("giver_user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("companion_treats_companion_idx").on(table.companionId, table.createdAt),
    index("companion_treats_giver_idx").on(table.giverUserId, table.createdAt),
    uniqueIndex("companion_treats_giver_idempotency_uidx").on(table.giverUserId, table.idempotencyKey),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").notNull().references(() => accounts.id),
    authorUserId: uuid("author_user_id").notNull().references(() => accounts.id),
    presentationMode: text("presentation_mode").notNull().default("user"),
    authorCompanionId: uuid("author_companion_id").references(() => companions.id),
    body: text("body"),
    category: text("category"),
    visibility: visibilityEnum("visibility").notNull().default("everyone"),
    status: text("status").notNull().default("published"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("posts_author_created_idx").on(table.authorUserId, table.createdAt),
    index("posts_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const postCompanions = pgTable(
  "post_companions",
  {
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    companionId: uuid("companion_id").notNull().references(() => companions.id),
    relationshipType: text("relationship_type").notNull(),
    position: integer("position").notNull(),
    displayNameSnapshot: text("display_name_snapshot").notNull(),
    avatarAssetIdSnapshot: uuid("avatar_asset_id_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.companionId, table.relationshipType], name: "post_companions_pk" }),
    uniqueIndex("post_companions_position_uidx").on(table.postId, table.position),
  ],
);

export const postAssets = pgTable(
  "post_assets",
  {
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => mediaAssets.id),
    position: integer("position").notNull(),
    altText: text("alt_text"),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.assetId], name: "post_assets_pk" }),
    uniqueIndex("post_assets_position_uidx").on(table.postId, table.position),
  ],
);

export const postPlacements = pgTable(
  "post_placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    destinationType: text("destination_type").notNull(),
    destinationId: uuid("destination_id"),
    visibility: visibilityEnum("visibility").notNull().default("everyone"),
    moderationStatus: moderationStatusEnum("moderation_status").notNull().default("approved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("post_placements_destination_uidx").on(table.postId, table.destinationType, table.destinationId),
    index("post_placements_feed_idx").on(table.destinationType, table.destinationId, table.createdAt),
  ],
);

export const postReactions = pgTable(
  "post_reactions",
  {
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    reactionType: text("reaction_type").notNull().default("pawprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.postId, table.userId], name: "post_reactions_pk" })],
);

export const postComments = pgTable(
  "post_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").notNull().references(() => accounts.id),
    parentCommentId: uuid("parent_comment_id"),
    body: text("body").notNull(),
    state: text("state").notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("post_comments_post_created_idx").on(table.postId, table.createdAt)],
);

export const postSaves = pgTable(
  "post_saves",
  {
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.postId], name: "post_saves_pk" })],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    actorUserId: uuid("actor_user_id").references(() => accounts.id),
    targetType: text("target_type"),
    targetId: text("target_id"),
    deduplicationKey: text("deduplication_key"),
    data: jsonb("data").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notifications_dedup_uidx").on(table.userId, table.deduplicationKey).where(sql`${table.deduplicationKey} is not null`),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    domainType: text("domain_type"),
    domainId: uuid("domain_id"),
    state: text("state").notNull().default("active"),
    lastMessageId: uuid("last_message_id"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => accounts.id),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("conversations_type_activity_idx").on(table.type, table.lastActivityAt)],
);

export const directConversationPairs = pgTable(
  "direct_conversation_pairs",
  {
    conversationId: uuid("conversation_id").primaryKey().references(() => conversations.id, { onDelete: "cascade" }),
    lowerUserId: uuid("lower_user_id").notNull().references(() => accounts.id),
    higherUserId: uuid("higher_user_id").notNull().references(() => accounts.id),
  },
  (table) => [uniqueIndex("direct_conversation_pairs_uidx").on(table.lowerUserId, table.higherUserId)],
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("active"),
    role: text("role").notNull().default("member"),
    requestState: text("request_state").notNull().default("accepted"),
    lastReadMessageId: uuid("last_read_message_id"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId], name: "conversation_participants_pk" }),
    index("conversation_participants_inbox_idx").on(table.userId, table.archivedAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id").references(() => accounts.id),
    type: text("type").notNull().default("text"),
    text: text("text"),
    replyToMessageId: uuid("reply_to_message_id"),
    clientIdempotencyKey: text("client_idempotency_key"),
    state: text("state").notNull().default("active"),
    moderationState: text("moderation_state").notNull().default("approved"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("messages_client_key_uidx").on(table.conversationId, table.senderUserId, table.clientIdempotencyKey).where(sql`${table.clientIdempotencyKey} is not null`),
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => mediaAssets.id),
    attachmentType: text("attachment_type").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.assetId], name: "message_attachments_pk" })],
);

export const communities = pgTable(
  "communities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => accounts.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    about: text("about").notNull(),
    iconAssetId: uuid("icon_asset_id").references(() => mediaAssets.id),
    coverAssetId: uuid("cover_asset_id").references(() => mediaAssets.id),
    tint: text("tint"),
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("communities_slug_uidx").on(table.slug), index("communities_status_idx").on(table.status)],
);

export const communitySettings = pgTable("community_settings", {
  communityId: uuid("community_id").primaryKey().references(() => communities.id, { onDelete: "cascade" }),
  joinPolicy: text("join_policy").notNull().default("open"),
  membersOnly: boolean("members_only").notNull().default(false),
  discoverable: boolean("discoverable").notNull().default(true),
  showLocation: boolean("show_location").notNull().default(false),
  allowLinks: boolean("allow_links").notNull().default(true),
  postApprovalRequired: boolean("post_approval_required").notNull().default(false),
  requirePhotoLostFound: boolean("require_photo_lost_found").notNull().default(true),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => accounts.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const communityMemberships = pgTable(
  "community_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    role: text("role"),
    requestMessage: text("request_message"),
    invitedBy: uuid("invited_by").references(() => accounts.id),
    resolvedBy: uuid("resolved_by").references(() => accounts.id),
    resolutionReason: text("resolution_reason"),
    notificationLevel: text("notification_level").notNull().default("all"),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("community_memberships_user_uidx").on(table.communityId, table.userId),
    index("community_memberships_state_idx").on(table.communityId, table.state),
  ],
);

export const communityRules = pgTable(
  "community_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    position: integer("position").notNull(),
    version: integer("version").notNull().default(1),
    active: boolean("active").notNull().default(true),
  },
  (table) => [uniqueIndex("community_rules_position_uidx").on(table.communityId, table.position)],
);

export const communityReports = pgTable(
  "community_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
    reporterUserId: uuid("reporter_user_id").notNull().references(() => accounts.id),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    status: text("status").notNull().default("open"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => accounts.id),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("community_reports_community_status_idx").on(table.communityId, table.status),
    index("community_reports_target_idx").on(table.targetType, table.targetId),
  ],
);

export const pawCircles = pgTable(
  "paw_circles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => accounts.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    bio: text("bio"),
    locationLabel: text("location_label"),
    privacy: text("privacy").notNull().default("open"),
    visibility: text("visibility").notNull().default("discoverable"),
    status: text("status").notNull().default("active"),
    iconAssetId: uuid("icon_asset_id").references(() => mediaAssets.id),
    themeTint: text("theme_tint"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("paw_circles_slug_uidx").on(table.slug)],
);

export const pawCircleUserStates = pgTable("paw_circle_user_states", {
  userId: uuid("user_id").primaryKey().references(() => accounts.id, { onDelete: "cascade" }),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const circleMemberships = pgTable(
  "circle_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id").notNull().references(() => pawCircles.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    lastReadMessageId: uuid("last_read_message_id"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
  },
  (table) => [uniqueIndex("circle_memberships_user_uidx").on(table.circleId, table.userId)],
);

export const circleJoinRequests = pgTable(
  "circle_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id").notNull().references(() => pawCircles.id, { onDelete: "cascade" }),
    requesterUserId: uuid("requester_user_id").notNull().references(() => accounts.id),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => accounts.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("circle_join_requests_user_uidx").on(table.circleId, table.requesterUserId)],
);

export const circleBans = pgTable(
  "circle_bans",
  {
    circleId: uuid("circle_id").notNull().references(() => pawCircles.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    bannedByUserId: uuid("banned_by_user_id").notNull().references(() => accounts.id),
    reason: text("reason"),
    bannedAt: timestamp("banned_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.circleId, table.userId], name: "circle_bans_pk" })],
);

export const circleInvitations = pgTable(
  "circle_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id").notNull().references(() => pawCircles.id, { onDelete: "cascade" }),
    invitedUserId: uuid("invited_user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    invitedByUserId: uuid("invited_by_user_id").notNull().references(() => accounts.id),
    message: text("message"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("circle_invitations_user_uidx").on(table.circleId, table.invitedUserId),
    index("circle_invitations_recipient_idx").on(table.invitedUserId, table.status),
  ],
);

export const circleOwnershipTransfers = pgTable(
  "circle_ownership_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id").notNull().references(() => pawCircles.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id").notNull().references(() => accounts.id),
    toUserId: uuid("to_user_id").notNull().references(() => accounts.id),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("circle_ownership_transfers_circle_idx").on(table.circleId, table.status),
    index("circle_ownership_transfers_recipient_idx").on(table.toUserId, table.status),
  ],
);

export const circleMessages = pgTable(
  "circle_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id").notNull().references(() => pawCircles.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id").references(() => accounts.id),
    type: text("type").notNull().default("text"),
    text: text("text"),
    sourcePostId: uuid("source_post_id").references(() => posts.id),
    replyToMessageId: uuid("reply_to_message_id"),
    status: text("status").notNull().default("active"),
    clientIdempotencyKey: text("client_idempotency_key"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("circle_messages_client_uidx").on(table.circleId, table.senderUserId, table.clientIdempotencyKey).where(sql`${table.clientIdempotencyKey} is not null`),
    index("circle_messages_circle_created_idx").on(table.circleId, table.createdAt),
  ],
);

export const circleMessagePins = pgTable(
  "circle_message_pins",
  {
    circleId: uuid("circle_id").notNull().references(() => pawCircles.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => circleMessages.id, { onDelete: "cascade" }),
    pinnedByUserId: uuid("pinned_by_user_id").notNull().references(() => accounts.id),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.circleId, table.messageId], name: "circle_message_pins_pk" })],
);

export const adoptionListings = pgTable(
  "adoption_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    posterId: uuid("poster_id").notNull().references(() => accounts.id),
    animalName: text("animal_name").notNull(),
    species: text("species").notNull(),
    breed: text("breed"),
    ageDisplay: text("age_display"),
    genderDisplay: text("gender_display"),
    vaccinationStatus: text("vaccination_status"),
    neutered: boolean("neutered").notNull().default(false),
    personality: text("personality"),
    requirements: jsonb("requirements").$type<string[]>().notNull().default([]),
    healthNotes: text("health_notes"),
    description: text("description").notNull(),
    locationLabel: text("location_label"),
    status: text("status").notNull().default("available"),
    urgent: boolean("urgent").notNull().default(false),
    selectedRequestId: uuid("selected_request_id"),
    activeAdoptionRecordId: uuid("active_adoption_record_id"),
    adoptedAt: timestamp("adopted_at", { withTimezone: true }),
    adoptedNote: text("adopted_note"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("adoption_listings_status_idx").on(table.status, table.publishedAt), index("adoption_listings_poster_idx").on(table.posterId)],
);

export const adoptionRequests = pgTable(
  "adoption_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => adoptionListings.id, { onDelete: "cascade" }),
    posterId: uuid("poster_id").notNull().references(() => accounts.id),
    requesterId: uuid("requester_id").notNull().references(() => accounts.id),
    message: text("message").notNull(),
    status: text("status").notNull().default("submitted"),
    threadId: uuid("thread_id").references(() => conversations.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    adoptedAt: timestamp("adopted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("adoption_requests_listing_user_active_uidx")
      .on(table.listingId, table.requesterId)
      .where(sql`${table.status} in ('submitted', 'approved')`),
  ],
);

export const adoptionRecords = pgTable(
  "adoption_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => adoptionListings.id),
    selectedRequestId: uuid("selected_request_id").notNull().references(() => adoptionRequests.id),
    posterId: uuid("poster_id").notNull().references(() => accounts.id),
    adopterId: uuid("adopter_id").notNull().references(() => accounts.id),
    animalName: text("animal_name").notNull(),
    species: text("species").notNull(),
    breed: text("breed"),
    status: text("status").notNull().default("confirmed"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    chatThreadId: uuid("chat_thread_id").references(() => conversations.id),
    companionId: uuid("companion_id").references(() => companions.id),
  },
  (table) => [uniqueIndex("adoption_records_listing_active_uidx").on(table.listingId).where(sql`${table.closedAt} is null`)],
);

export const adoptionMilestones = pgTable(
  "adoption_milestones",
  {
    adoptionRecordId: uuid("adoption_record_id").notNull().references(() => adoptionRecords.id, { onDelete: "cascade" }),
    milestoneId: text("milestone_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("upcoming"),
    satisfiedByUpdateId: uuid("satisfied_by_update_id"),
    excusedByUpdateId: uuid("excused_by_update_id"),
  },
  (table) => [primaryKey({ columns: [table.adoptionRecordId, table.milestoneId], name: "adoption_milestones_pk" })],
);

export const adoptionUpdates = pgTable(
  "adoption_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adoptionRecordId: uuid("adoption_record_id").notNull().references(() => adoptionRecords.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    authorId: uuid("author_id").notNull().references(() => accounts.id),
    milestoneId: text("milestone_id"),
    text: text("text"),
    recommendation: text("recommendation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("adoption_updates_record_idx").on(table.adoptionRecordId, table.createdAt)],
);

export const rescueCases = pgTable(
  "rescue_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicCaseNumber: text("public_case_number").notNull(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => accounts.id),
    animalName: text("animal_name").notNull(),
    species: text("species").notNull(),
    headline: text("headline").notNull(),
    originalStory: text("original_story").notNull(),
    status: text("status").notNull().default("needs_help"),
    resolutionOutcome: text("resolution_outcome"),
    resolutionNote: text("resolution_note"),
    publicLocationLabel: text("public_location_label"),
    privateLatitude: doublePrecision("private_latitude"),
    privateLongitude: doublePrecision("private_longitude"),
    locationPrecision: text("location_precision").notNull().default("area"),
    visibility: visibilityEnum("visibility").notNull().default("everyone"),
    moderationStatus: moderationStatusEnum("moderation_status").notNull().default("approved"),
    linkedAnnouncementPostId: uuid("linked_announcement_post_id").references(() => posts.id),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("rescue_cases_number_uidx").on(table.publicCaseNumber), index("rescue_cases_status_idx").on(table.status, table.createdAt)],
);

export const rescueCaseUpdates = pgTable(
  "rescue_case_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => rescueCases.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").notNull().references(() => accounts.id),
    text: text("text"),
    statusBefore: text("status_before"),
    statusAfter: text("status_after"),
    resolutionOutcome: text("resolution_outcome"),
    clientIdempotencyKey: text("client_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("rescue_updates_client_uidx").on(table.caseId, table.authorUserId, table.clientIdempotencyKey).where(sql`${table.clientIdempotencyKey} is not null`)],
);

export const rescueCaseFollowers = pgTable(
  "rescue_case_followers",
  {
    caseId: uuid("case_id").notNull().references(() => rescueCases.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    notificationMode: text("notification_mode").notNull().default("all_updates"),
    followedAt: timestamp("followed_at", { withTimezone: true }).notNull().defaultNow(),
    unfollowedAt: timestamp("unfollowed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.caseId, table.userId], name: "rescue_case_followers_pk" })],
);

export const rescueHelpOffers = pgTable(
  "rescue_help_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => rescueCases.id, { onDelete: "cascade" }),
    helperUserId: uuid("helper_user_id").notNull().references(() => accounts.id),
    type: text("type").notNull(),
    message: text("message"),
    availability: text("availability"),
    privateContactMethod: text("private_contact_method"),
    status: text("status").notNull().default("offered"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => accounts.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("rescue_help_offers_active_uidx").on(table.caseId, table.helperUserId, table.type)],
);

export const lostFoundSubjects = pgTable("lost_found_subjects", {
  id: uuid("id").primaryKey().defaultRandom(),
  species: text("species").notNull(),
  breedDescription: text("breed_description"),
  ageDescription: text("age_description"),
  sexDescription: text("sex_description"),
  appearance: text("appearance").notNull(),
  collarDescription: text("collar_description"),
  temperament: text("temperament"),
  secured: boolean("secured"),
  publicNotes: text("public_notes"),
  privateVerificationNotes: text("private_verification_notes"),
});

export const lostFoundAlerts = pgTable(
  "lost_found_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("active"),
    reporterUserId: uuid("reporter_user_id").notNull().references(() => accounts.id),
    reporterRole: text("reporter_role").notNull().default("reporter"),
    subjectCompanionId: uuid("subject_companion_id").references(() => companions.id),
    temporarySubjectId: uuid("temporary_subject_id").references(() => lostFoundSubjects.id),
    canonicalPostId: uuid("canonical_post_id").references(() => posts.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    alertRadiusKm: integer("alert_radius_km").notNull().default(10),
    contactMode: text("contact_mode").notNull().default("message"),
    publicContactEncrypted: text("public_contact_encrypted"),
    resolutionOutcome: text("resolution_outcome"),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => accounts.id),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lost_found_alerts_kind_status_idx").on(table.kind, table.status, table.createdAt)],
);

export const lostFoundLocations = pgTable("lost_found_locations", {
  alertId: uuid("alert_id").primaryKey().references(() => lostFoundAlerts.id, { onDelete: "cascade" }),
  locationLabel: text("location_label").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  geohash: text("geohash"),
  publicPrecision: text("public_precision").notNull().default("area"),
  source: text("source").notNull().default("manual"),
  visibility: text("visibility").notNull().default("public_area"),
});

export const lostFoundUpdates = pgTable(
  "lost_found_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id").notNull().references(() => lostFoundAlerts.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").notNull().references(() => accounts.id),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lost_found_updates_alert_idx").on(table.alertId, table.createdAt)],
);

export const lostFoundSightings = pgTable(
  "lost_found_sightings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id").notNull().references(() => lostFoundAlerts.id, { onDelete: "cascade" }),
    reporterUserId: uuid("reporter_user_id").notNull().references(() => accounts.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    locationLabel: text("location_label").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    publicPrecision: text("public_precision").notNull().default("area"),
    stillPresent: boolean("still_present"),
    note: text("note"),
    moderationStatus: moderationStatusEnum("moderation_status").notNull().default("approved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lost_found_sightings_alert_idx").on(table.alertId, table.createdAt)],
);

export const lostFoundClaims = pgTable(
  "lost_found_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    foundAlertId: uuid("found_alert_id").notNull().references(() => lostFoundAlerts.id, { onDelete: "cascade" }),
    claimantUserId: uuid("claimant_user_id").notNull().references(() => accounts.id),
    status: text("status").notNull().default("submitted"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}),
    reviewerUserId: uuid("reviewer_user_id").references(() => accounts.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("lost_found_claims_alert_user_uidx").on(table.foundAlertId, table.claimantUserId)],
);

export const lostFoundMatches = pgTable(
  "lost_found_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lostAlertId: uuid("lost_alert_id").notNull().references(() => lostFoundAlerts.id, { onDelete: "cascade" }),
    foundAlertId: uuid("found_alert_id").notNull().references(() => lostFoundAlerts.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(50),
    status: text("status").notNull().default("suggested"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => accounts.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lost_found_matches_pair_uidx").on(table.lostAlertId, table.foundAlertId),
    index("lost_found_matches_status_idx").on(table.status, table.createdAt),
  ],
);

export const savedLostFoundAlerts = pgTable(
  "saved_lost_found_alerts",
  {
    userId: uuid("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id").notNull().references(() => lostFoundAlerts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.alertId], name: "saved_lost_found_alerts_pk" })],
);

export const domainMedia = pgTable(
  "domain_media",
  {
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    assetId: uuid("asset_id").notNull().references(() => mediaAssets.id),
    role: text("role").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.targetType, table.targetId, table.assetId], name: "domain_media_pk" }),
    uniqueIndex("domain_media_position_uidx").on(table.targetType, table.targetId, table.position),
  ],
);
