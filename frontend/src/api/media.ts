import * as ImagePicker from 'expo-image-picker';
import { apiRequest } from './client';

export type UploadedMedia = {
  assetId: string;
  localUri: string;
  url: string | null;
  mimeType: string;
  width: number;
  height: number;
};

type UploadSession = {
  mediaAssetId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
};

type CompletedAsset = {
  id: string;
  url: string | null;
  mimeType: string;
};

type MediaPurpose =
  | 'profile_avatar'
  | 'companion_avatar'
  | 'feed_post'
  | 'community_post'
  | 'adoption_listing'
  | 'adoption_home_update'
  | 'rescue_case'
  | 'rescue_update'
  | 'lost_found';

async function uploadPickerAssets(
  assets: ImagePicker.ImagePickerAsset[],
  purpose: MediaPurpose,
  limit: number,
): Promise<UploadedMedia[]> {
  const uploaded: UploadedMedia[] = [];
  for (const asset of assets.slice(0, limit)) {
    const blob: Blob = asset.file ?? await fetch(asset.uri).then(response => response.blob());
    const mimeType = asset.mimeType || blob.type || (
      asset.type === 'video' ? 'video/mp4' : 'image/jpeg'
    );
    const byteSize = asset.fileSize ?? blob.size;
    if (!byteSize) throw new Error('Could not determine the selected media size.');

    const session = await apiRequest<UploadSession>('/media/upload-sessions', {
      method: 'POST',
      body: {
        purpose,
        mimeType,
        byteSize,
        originalFilename: asset.fileName ?? `parul-${Date.now()}`,
      },
    });
    const upload = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: session.requiredHeaders,
      body: blob,
    });
    if (!upload.ok) throw new Error(`Media upload failed with status ${upload.status}.`);
    const completed = await apiRequest<CompletedAsset>(
      `/media/${session.mediaAssetId}/complete`,
      { method: 'POST' },
    );
    uploaded.push({
      assetId: completed.id,
      localUri: asset.uri,
      url: completed.url,
      mimeType,
      width: asset.width,
      height: asset.height,
    });
  }
  return uploaded;
}

export async function pickAndUploadImages(options: {
  purpose: MediaPurpose;
  selectionLimit?: number;
}): Promise<UploadedMedia[]> {
  const limit = Math.max(1, options.selectionLimit ?? 1);
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo library permission is required.');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 0.9,
  });
  if (result.canceled) return [];
  return uploadPickerAssets(result.assets, options.purpose, limit);
}

export async function pickAndUploadVideo(
  purpose: MediaPurpose,
): Promise<UploadedMedia | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo library permission is required.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    selectionLimit: 1,
    videoMaxDuration: 60,
    quality: 0.9,
  });
  if (result.canceled || !result.assets[0]) return null;
  const [uploaded] = await uploadPickerAssets(result.assets, purpose, 1);
  return uploaded ?? null;
}
