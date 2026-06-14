import React, {
  createContext, useCallback, useContext, useMemo,
} from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { users, type User } from '../data/mockData';

export type UserProfilePatch = {
  bio?: string;
  location?: string;
};

type CurrentUserProfileContextValue = {
  ready: boolean;
  me: User;
  updateProfile: (patch: UserProfilePatch) => Promise<void>;
};

const CurrentUserProfileContext = createContext<CurrentUserProfileContextValue | null>(null);

export function CurrentUserProfileProvider({ children }: { children: React.ReactNode }) {
  const { profile, reloadProfile } = useAuth();

  const me = useMemo<User>(() => {
    const source = profile?.profile;
    if (!source) return users.you;
    const location = source.publicLocationLabel ?? '';
    return {
      ...users.you,
      id: 'you',
      name: source.displayName,
      handle: source.handle ?? 'parul-user',
      avatarUri: source.avatar?.url ?? undefined,
      bio: source.bio ?? '',
      loc: location,
      location,
      website: source.websiteUrl ?? undefined,
      verified: source.verification.status === 'verified',
      joinedDate: new Date(source.joinedAt).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      }),
      adoptionsCount: profile?.impact.adopted ?? 0,
    };
  }, [profile]);

  const updateProfile = useCallback(async (patch: UserProfilePatch) => {
    if (!profile) throw new Error('Profile is not ready.');
    await apiRequest('/me/profile', {
      method: 'PATCH',
      body: {
        version: profile.profile.version,
        ...(patch.bio !== undefined && { bio: patch.bio }),
        ...(patch.location !== undefined && { publicLocationLabel: patch.location }),
      },
    });
    await reloadProfile();
  }, [profile, reloadProfile]);

  const value = useMemo<CurrentUserProfileContextValue>(() => ({
    ready: profile != null,
    me,
    updateProfile,
  }), [me, profile, updateProfile]);

  return (
    <CurrentUserProfileContext.Provider value={value}>
      {children}
    </CurrentUserProfileContext.Provider>
  );
}

export function useCurrentUserProfile() {
  const context = useContext(CurrentUserProfileContext);
  if (!context) {
    throw new Error('useCurrentUserProfile must be used within CurrentUserProfileProvider');
  }
  return context;
}
