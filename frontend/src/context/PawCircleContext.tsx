import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { apiRequest } from '../api/client';
import {
  FeedCircleEntry,
  PawCircle,
  toFeedEntry,
} from '../data/pawCircles';

type CircleResource = {
  id: string;
  name: string;
  bio: string | null;
  locationLabel: string | null;
  privacy: 'open' | 'request';
  visibility: string;
  themeTint: string | null;
  version: number;
  memberCount: number;
  relationship: string;
  viewerRole: string | null;
};

type PawCircleContextValue = {
  ready: boolean;
  onboardingComplete: boolean;
  createdCircles: PawCircle[];
  joinedCircles: PawCircle[];
  feedCreated: FeedCircleEntry[];
  feedJoined: FeedCircleEntry[];
  defaultCircleId: string | null;
  completeOnboarding: (opts: { joinLocal: boolean }) => Promise<void>;
  joinCircle: (id: string) => Promise<void>;
  leaveCircle: (id: string) => Promise<void>;
  createCircle: (
    name: string,
    location: string,
    privacy?: PawCircle['privacy'],
  ) => Promise<PawCircle>;
  updateCircle: (id: string, patch: {
    name?: string;
    bio?: string;
    locationLabel?: string;
    privacy?: PawCircle['privacy'];
  }) => Promise<void>;
  deleteCircle: (id: string) => Promise<void>;
  removeMember: (circleId: string, userId: string) => Promise<void>;
  transferOwnership: (circleId: string, userId: string) => Promise<void>;
  isJoined: (id: string) => boolean;
  getCircle: (id: string) => PawCircle | null;
  exploreCircles: PawCircle[];
  resetPawCircles: () => Promise<void>;
  reloadCircles: () => Promise<void>;
  syncError: string | null;
};

const PawCircleContext = createContext<PawCircleContextValue | null>(null);

function fromResource(resource: CircleResource): PawCircle {
  const tint = resource.themeTint ?? '#7C5CBF';
  return {
    id: resource.id,
    backendId: resource.id,
    backendVersion: resource.version,
    viewerRole: resource.viewerRole,
    relationship: resource.relationship,
    name: resource.name,
    location: resource.locationLabel ?? 'Parul community',
    memberCount: resource.memberCount,
    icon: 'paw',
    tint,
    iconBg: `${tint}20`,
    tagline: resource.bio ?? undefined,
    bio: resource.bio ?? undefined,
    privacy: resource.privacy,
  };
}

export function PawCircleProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [joinedCircles, setJoinedCircles] = useState<PawCircle[]>([]);
  const [exploreCircles, setExploreCircles] = useState<PawCircle[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);

  const reloadCircles = useCallback(async () => {
    try {
      const [joined, explore, onboarding] = await Promise.all([
        apiRequest<{ circles: CircleResource[] }>('/paw-circles'),
        apiRequest<{ circles: CircleResource[] }>('/paw-circles/explore'),
        apiRequest<{ completed: boolean }>('/paw-circles/onboarding'),
      ]);
      setJoinedCircles(joined.circles.map(fromResource));
      setExploreCircles(explore.circles.map(fromResource));
      setOnboardingComplete(onboarding.completed);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not load Paw Circles.');
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reloadCircles();
  }, [reloadCircles]);

  const completeOnboarding = useCallback(async ({ joinLocal }: { joinLocal: boolean }) => {
    if (joinLocal) {
      const local = exploreCircles.find(circle => (
        circle.name.toLowerCase().includes('dhanmondi')
        || circle.location.toLowerCase().includes('dhanmondi')
      ));
      if (local) {
        await apiRequest(`/paw-circles/${local.backendId ?? local.id}/join`, {
          method: 'POST',
          body: {},
        });
        await reloadCircles();
      }
    }
    await apiRequest('/paw-circles/onboarding/complete', { method: 'POST' });
    setOnboardingComplete(true);
  }, [exploreCircles, reloadCircles]);

  const joinCircle = useCallback(async (id: string) => {
    const circle = [...joinedCircles, ...exploreCircles].find(item => item.id === id);
    await apiRequest(`/paw-circles/${circle?.backendId ?? id}/join`, {
      method: 'POST',
      body: {},
    });
    await reloadCircles();
  }, [exploreCircles, joinedCircles, reloadCircles]);

  const leaveCircle = useCallback(async (id: string) => {
    const circle = joinedCircles.find(item => item.id === id);
    await apiRequest(`/paw-circles/${circle?.backendId ?? id}/membership`, {
      method: 'DELETE',
    });
    await reloadCircles();
  }, [joinedCircles, reloadCircles]);

  const createCircle = useCallback(async (
    name: string,
    location: string,
    privacy: PawCircle['privacy'] = 'open',
  ) => {
    const resource = await apiRequest<CircleResource>('/paw-circles', {
      method: 'POST',
      body: {
        name: name.trim(),
        locationLabel: location.trim() || undefined,
        privacy,
      },
    });
    const circle = fromResource(resource);
    await reloadCircles();
    return circle;
  }, [reloadCircles]);

  const updateCircle = useCallback(async (
    id: string,
    patch: { name?: string; bio?: string; locationLabel?: string; privacy?: PawCircle['privacy'] },
  ) => {
    const circle = joinedCircles.find(item => item.id === id);
    if (!circle?.backendVersion) return;
    await apiRequest(`/paw-circles/${circle.backendId ?? id}`, {
      method: 'PATCH',
      body: {
        version: circle.backendVersion,
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.bio !== undefined && { bio: patch.bio.trim() }),
        ...(patch.locationLabel !== undefined && { locationLabel: patch.locationLabel.trim() }),
        ...(patch.privacy !== undefined && { privacy: patch.privacy }),
      },
    });
    await reloadCircles();
  }, [joinedCircles, reloadCircles]);

  const deleteCircle = useCallback(async (id: string) => {
    const circle = joinedCircles.find(item => item.id === id);
    await apiRequest(`/paw-circles/${circle?.backendId ?? id}`, { method: 'DELETE' });
    await reloadCircles();
  }, [joinedCircles, reloadCircles]);

  const removeMember = useCallback(async (circleId: string, userId: string) => {
    const circle = joinedCircles.find(item => item.id === circleId);
    await apiRequest(`/paw-circles/${circle?.backendId ?? circleId}/members/${userId}`, {
      method: 'DELETE',
    });
  }, [joinedCircles]);

  const transferOwnership = useCallback(async (circleId: string, userId: string) => {
    const circle = joinedCircles.find(item => item.id === circleId);
    await apiRequest(`/paw-circles/${circle?.backendId ?? circleId}/ownership-transfers`, {
      method: 'POST',
      body: { userId },
    });
  }, [joinedCircles]);

  const resetPawCircles = useCallback(async () => {
    setOnboardingComplete(false);
    await reloadCircles();
  }, [reloadCircles]);

  const createdCircles = useMemo(
    () => joinedCircles.filter(circle => circle.viewerRole === 'owner'),
    [joinedCircles],
  );
  const feedCreated = useMemo(() => createdCircles.map(toFeedEntry), [createdCircles]);
  const feedJoined = useMemo(
    () => joinedCircles.filter(circle => circle.viewerRole !== 'owner').map(toFeedEntry),
    [joinedCircles],
  );
  const defaultCircleId = feedCreated[0]?.id ?? feedJoined[0]?.id ?? null;

  const value = useMemo<PawCircleContextValue>(() => ({
    ready,
    onboardingComplete,
    createdCircles,
    joinedCircles,
    feedCreated,
    feedJoined,
    defaultCircleId,
    completeOnboarding,
    joinCircle,
    leaveCircle,
    createCircle,
    updateCircle,
    deleteCircle,
    removeMember,
    transferOwnership,
    isJoined: (id: string) => joinedCircles.some(circle => circle.id === id),
    getCircle: (id: string) => (
      joinedCircles.find(circle => circle.id === id)
      ?? exploreCircles.find(circle => circle.id === id)
      ?? null
    ),
    exploreCircles,
    resetPawCircles,
    reloadCircles,
    syncError,
  }), [
    ready, onboardingComplete, createdCircles, joinedCircles, feedCreated,
    feedJoined, defaultCircleId, completeOnboarding, joinCircle, leaveCircle,
    createCircle, updateCircle, deleteCircle, removeMember, transferOwnership,
    exploreCircles, resetPawCircles,
    reloadCircles, syncError,
  ]);

  return <PawCircleContext.Provider value={value}>{children}</PawCircleContext.Provider>;
}

export function usePawCircles() {
  const context = useContext(PawCircleContext);
  if (!context) throw new Error('usePawCircles must be used within PawCircleProvider');
  return context;
}
