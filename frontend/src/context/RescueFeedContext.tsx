import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest, clientIdempotencyKey } from '../api/client';
import {
  type RescueCase,
  type RescueStatus,
  type RescueUpdate,
} from '../data/profileData';

type ApiMedia = {
  assetId: string;
  mediaType: 'image' | 'video' | 'file';
  url: string;
};

type ApiUpdate = {
  id: string;
  text: string | null;
  createdAt: string;
  media: ApiMedia[];
};

type ApiCase = {
  id: string;
  ownerUserId: string;
  animalName: string;
  species: 'dog' | 'cat' | 'other';
  headline: string;
  originalStory: string;
  status: 'needs_help' | 'under_treatment' | 'resolved';
  publicLocationLabel: string;
  publicCaseNumber: string;
  createdAt: string;
  version: number;
  owner: { id: string; displayName: string; handle: string | null };
  media: ApiMedia[];
  counters: { followers: number; updates: number };
  viewer: { isOwner: boolean; isFollowing: boolean };
};

export type CreateCaseInput = {
  name: string;
  species: 'dog' | 'cat' | 'other';
  headline: string;
  location: string;
  story: string;
  status: RescueStatus;
  tint?: string;
  icon?: string;
  assetIds: string[];
  imageUris: string[];
};

export type RescueUpdatePayload = {
  text: string;
  assetIds: string[];
};

type RescueFeedContextValue = {
  cases: RescueCase[];
  followedIds: Set<string>;
  loading: boolean;
  error: string | null;
  isFollowing: (id: string) => boolean;
  toggleFollow: (id: string) => void;
  addCase: (input: CreateCaseInput) => Promise<RescueCase>;
  addUpdate: (caseId: string, payload: RescueUpdatePayload) => Promise<void>;
  refresh: () => Promise<void>;
};

const RescueFeedContext = createContext<RescueFeedContextValue | null>(null);

const SPECIES_META = {
  dog: { tint: '#14A697', icon: 'dog' },
  cat: { tint: '#7A5AE0', icon: 'cat' },
  other: { tint: '#C98E2A', icon: 'paw' },
} as const;

const statusFromApi = (status: ApiCase['status']): RescueStatus => (
  status === 'resolved' ? 'recovered' : status === 'under_treatment' ? 'under_treatment' : 'active'
);

const statusToApi = (status: RescueStatus): 'needs_help' | 'under_treatment' => (
  status === 'under_treatment' ? 'under_treatment' : 'needs_help'
);

const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(value));

function mapUpdate(update: ApiUpdate): RescueUpdate {
  const images = update.media.filter(item => item.mediaType === 'image').map(item => item.url);
  return {
    id: update.id,
    time: formatTime(update.createdAt),
    text: update.text || 'Case update posted.',
    hasPhoto: images.length > 0,
    imageUris: images,
    videoUri: update.media.find(item => item.mediaType === 'video')?.url,
  };
}

async function mapCase(item: ApiCase): Promise<RescueCase> {
  const updatesResponse = await apiRequest<{ updates: ApiUpdate[] }>(`/rescue-cases/${item.id}/updates`);
  const meta = SPECIES_META[item.species];
  return {
    id: item.id,
    backendId: item.id,
    version: item.version,
    userId: item.owner.id,
    ownerName: item.owner.displayName,
    ownerHandle: item.owner.handle,
    isOwner: item.viewer.isOwner,
    isFollowing: item.viewer.isFollowing,
    name: item.animalName,
    species: item.species,
    icon: meta.icon,
    tint: meta.tint,
    status: statusFromApi(item.status),
    date: formatTime(item.createdAt),
    location: item.publicLocationLabel,
    headline: item.headline,
    story: item.originalStory,
    caseId: item.publicCaseNumber,
    followers: item.counters.followers,
    tags: [item.species === 'dog' ? 'Dog' : item.species === 'cat' ? 'Cat' : 'Other'],
    imageUris: item.media.filter(media => media.mediaType === 'image').map(media => media.url),
    updates: updatesResponse.updates.map(mapUpdate),
  };
}

export function RescueFeedProvider({ children }: { children: React.ReactNode }) {
  const [cases, setCases] = useState<RescueCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest<{ cases: ApiCase[] }>('/rescue-cases');
      setCases(await Promise.all(response.cases.map(mapCase)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load rescue cases.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const followedIds = useMemo(
    () => new Set(cases.filter(item => item.isFollowing).map(item => item.id)),
    [cases],
  );
  const isFollowing = useCallback((id: string) => followedIds.has(id), [followedIds]);

  const toggleFollow = useCallback((id: string) => {
    const current = cases.find(item => item.id === id);
    if (!current || current.isOwner) return;
    const next = !current.isFollowing;
    setCases(previous => previous.map(item => item.id === id
      ? { ...item, isFollowing: next, followers: Math.max(0, (item.followers ?? 0) + (next ? 1 : -1)) }
      : item));
    void apiRequest<void>(`/rescue-cases/${id}/follow`, { method: next ? 'PUT' : 'DELETE' }).catch(() => {
      setCases(previous => previous.map(item => item.id === id
        ? { ...item, isFollowing: !next, followers: Math.max(0, (item.followers ?? 0) + (next ? -1 : 1)) }
        : item));
    });
  }, [cases]);

  const addUpdate = useCallback(async (caseId: string, payload: RescueUpdatePayload) => {
    const update = await apiRequest<ApiUpdate>(`/rescue-cases/${caseId}/updates`, {
      method: 'POST',
      body: {
        text: payload.text.trim() || null,
        assetIds: payload.assetIds,
        clientIdempotencyKey: clientIdempotencyKey('rescue-update'),
      },
    });
    setCases(previous => previous.map(item => item.id === caseId
      ? { ...item, updates: [mapUpdate(update), ...(item.updates ?? [])] }
      : item));
  }, []);

  const addCase = useCallback(async (input: CreateCaseInput): Promise<RescueCase> => {
    const created = await apiRequest<ApiCase>('/rescue-cases', {
      method: 'POST',
      body: {
        animalName: input.name.trim(),
        species: input.species,
        headline: input.headline.trim(),
        originalStory: input.story.trim(),
        status: statusToApi(input.status),
        publicLocationLabel: input.location.trim(),
        visibility: 'everyone',
        assetIds: input.assetIds,
      },
    });
    const item = await mapCase(created);
    setCases(previous => [item, ...previous]);
    return item;
  }, []);

  const value = useMemo(
    () => ({ cases, followedIds, loading, error, isFollowing, toggleFollow, addCase, addUpdate, refresh }),
    [cases, followedIds, loading, error, isFollowing, toggleFollow, addCase, addUpdate, refresh],
  );

  return <RescueFeedContext.Provider value={value}>{children}</RescueFeedContext.Provider>;
}

export function useRescueFeed() {
  const ctx = useContext(RescueFeedContext);
  if (!ctx) throw new Error('useRescueFeed must be used within RescueFeedProvider');
  return ctx;
}

export function useRescueFeedOptional() {
  return useContext(RescueFeedContext);
}
