import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import {
  companions,
  domainMedia,
  mediaAssets,
  postAssets,
  userProfiles,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";

const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
});

const publicSigner = new S3Client({
  endpoint: config.S3_PUBLIC_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
});

const purposeLimits: Record<string, { types: string[]; maxBytes: number }> = {
  profile_avatar: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], maxBytes: 10_000_000 },
  companion_avatar: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], maxBytes: 10_000_000 },
  feed_post: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "video/mp4", "video/quicktime"], maxBytes: 100_000_000 },
  community_post: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], maxBytes: 10_000_000 },
  message_attachment: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "video/mp4", "application/pdf"], maxBytes: 25_000_000 },
  adoption_listing: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], maxBytes: 10_000_000 },
  adoption_home_update: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "video/mp4", "video/quicktime"], maxBytes: 100_000_000 },
  rescue_case: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], maxBytes: 10_000_000 },
  rescue_update: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "video/mp4", "video/quicktime"], maxBytes: 100_000_000 },
  lost_found: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], maxBytes: 10_000_000 },
  circle_message: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "video/mp4", "application/pdf"], maxBytes: 25_000_000 },
};

function mediaType(mimeType: string): "image" | "video" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

export async function createUploadSession(input: {
  userId: string;
  purpose: string;
  mimeType: string;
  byteSize: number;
  originalFilename?: string | undefined;
  checksum?: string | undefined;
}) {
  const limit = purposeLimits[input.purpose];
  if (!limit) {
    throw new AppError(400, "MEDIA_PURPOSE_NOT_ALLOWED", "Media purpose is not supported.");
  }
  if (!limit.types.includes(input.mimeType)) {
    throw new AppError(400, "MEDIA_TYPE_NOT_ALLOWED", "Media type is not allowed for this purpose.");
  }
  if (input.byteSize > limit.maxBytes) {
    throw new AppError(400, "MEDIA_LIMIT_EXCEEDED", "Media file is too large.", { maxBytes: limit.maxBytes });
  }

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      ownerUserId: input.userId,
      purpose: input.purpose,
      mediaType: mediaType(input.mimeType),
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      originalFilename: input.originalFilename,
      checksum: input.checksum,
    })
    .returning({ id: mediaAssets.id });

  if (!asset) throw new AppError(500, "MEDIA_CREATE_FAILED", "Upload session was not created.");

  const storageKey = `${input.userId}/${input.purpose}/${asset.id}`;
  await db.update(mediaAssets).set({ storageKey, status: "uploading" }).where(eq(mediaAssets.id, asset.id));

  const uploadUrl = await getSignedUrl(
    publicSigner,
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: storageKey,
      ContentType: input.mimeType,
      ContentLength: input.byteSize,
    }),
    { expiresIn: 900 },
  );

  return {
    mediaAssetId: asset.id,
    uploadUrl,
    requiredHeaders: { "content-type": input.mimeType },
    expiresInSeconds: 900,
    maxBytes: limit.maxBytes,
  };
}

export async function completeUpload(userId: string, assetId: string) {
  const [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerUserId, userId))).limit(1);
  if (!asset?.storageKey) throw new AppError(404, "MEDIA_NOT_FOUND", "Media asset was not found.");

  let object;
  try {
    object = await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: asset.storageKey }));
  } catch {
    throw new AppError(409, "MEDIA_UPLOAD_INCOMPLETE", "Uploaded object could not be verified.");
  }

  if (asset.byteSize && object.ContentLength !== asset.byteSize) {
    throw new AppError(400, "MEDIA_SIZE_MISMATCH", "Uploaded file size does not match the session.");
  }
  if (object.ContentType && object.ContentType !== asset.mimeType) {
    throw new AppError(400, "MEDIA_TYPE_MISMATCH", "Uploaded media type does not match the session.");
  }

  const [updated] = await db
    .update(mediaAssets)
    .set({ status: "ready", moderationStatus: "approved", uploadedAt: new Date() })
    .where(eq(mediaAssets.id, assetId))
    .returning();

  return {
    ...serializeAsset(updated!),
    ...(await getReadyMediaReadModel(updated!.id)),
  };
}

export async function getMediaAsset(userId: string, assetId: string) {
  const [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerUserId, userId))).limit(1);
  if (!asset) throw new AppError(404, "MEDIA_NOT_FOUND", "Media asset was not found.");
  return asset.status === "ready"
    ? { ...serializeAsset(asset), ...(await getReadyMediaReadModel(asset.id)) }
    : serializeAsset(asset);
}

export function serializeAsset(asset: typeof mediaAssets.$inferSelect) {
  return {
    id: asset.id,
    purpose: asset.purpose,
    status: asset.status,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    url: null,
    createdAt: asset.createdAt,
  };
}

export async function getReadyMediaReadModel(assetId: string) {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, assetId))
    .limit(1);
  if (
    !asset?.storageKey
    || asset.status !== "ready"
    || asset.moderationStatus !== "approved"
  ) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "Media asset was not found.");
  }
  const url = await getSignedUrl(
    publicSigner,
    new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: asset.storageKey,
    }),
    { expiresIn: 3_600 },
  );
  return {
    id: asset.id,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    url,
    expiresInSeconds: 3_600,
  };
}

export async function requireReadyOwnedAssets(userId: string, assetIds: string[]) {
  if (assetIds.length === 0) return [];
  const assets = await Promise.all(assetIds.map((id) => getMediaAsset(userId, id)));
  if (assets.some((asset) => asset.status !== "ready")) {
    throw new AppError(409, "MEDIA_NOT_READY", "Every attached media asset must be ready.");
  }
  return assets;
}

export async function deleteMediaAsset(userId: string, assetId: string) {
  const [asset] = await db.select().from(mediaAssets).where(and(
    eq(mediaAssets.id, assetId),
    eq(mediaAssets.ownerUserId, userId),
  )).limit(1);
  if (!asset) throw new AppError(404, "MEDIA_NOT_FOUND", "Media asset was not found.");

  const [domainLink, postLink, profileLink, companionLink] = await Promise.all([
    db.select({ id: domainMedia.assetId }).from(domainMedia).where(and(eq(domainMedia.assetId, assetId), isNull(domainMedia.removedAt))).limit(1),
    db.select({ id: postAssets.assetId }).from(postAssets).where(eq(postAssets.assetId, assetId)).limit(1),
    db.select({ id: userProfiles.userId }).from(userProfiles).where(eq(userProfiles.avatarMediaId, assetId)).limit(1),
    db.select({ id: companions.id }).from(companions).where(eq(companions.avatarAssetId, assetId)).limit(1),
  ]);
  if (domainLink.length || postLink.length || profileLink.length || companionLink.length) {
    throw new AppError(409, "MEDIA_IN_USE", "Attached media cannot be deleted.");
  }
  if (asset.storageKey) {
    await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: asset.storageKey }));
  }
  await db.update(mediaAssets).set({
    status: "deleted",
    deletedAt: new Date(),
  }).where(eq(mediaAssets.id, assetId));
  return { deleted: true };
}
