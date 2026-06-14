import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { registerDevReset } from '../dev/devResetRegistry';

export type ProfileVisibility = 'everyone' | 'circles' | 'only_me';
export type MessagePolicy = 'everyone' | 'circles' | 'none';

export type UserPrivacySettings = {
  profileVisibility: ProfileVisibility;
  postVisibility: ProfileVisibility;
  messagePolicy: MessagePolicy;
  discoverable: boolean;
  showOnline: boolean;
  showLocation: boolean;
  showCompanions: boolean;
  showTreatsOnProfile: boolean;
};

export type BlockedUser = {
  id: string;
  displayName: string;
  handle: string | null;
  blockedAt: string;
};

type PrivacyResponse = {
  profileVisibility: ProfileVisibility;
  defaultPostVisibility: ProfileVisibility;
  messagePolicy: MessagePolicy;
  discoverable: boolean;
  showOnline: boolean;
  showLocation: boolean;
  showCompanions: boolean;
  showTreatsOnProfile: boolean;
  version: number;
};

const DEFAULT_SETTINGS: UserPrivacySettings = {
  profileVisibility: 'everyone',
  postVisibility: 'everyone',
  messagePolicy: 'everyone',
  discoverable: true,
  showOnline: true,
  showLocation: true,
  showCompanions: true,
  showTreatsOnProfile: true,
};

type UserPrivacyContextValue = {
  ready: boolean;
  syncError: string | null;
  settings: UserPrivacySettings;
  blockedUsers: BlockedUser[];
  blockedUserIds: string[];
  patchSettings: (patch: Partial<UserPrivacySettings>) => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  isBlocked: (userId: string) => boolean;
  reloadPrivacy: () => Promise<void>;
};

const UserPrivacyContext = createContext<UserPrivacyContextValue | null>(null);

function mapSettings(response: PrivacyResponse): UserPrivacySettings {
  return {
    profileVisibility: response.profileVisibility,
    postVisibility: response.defaultPostVisibility,
    messagePolicy: response.messagePolicy,
    discoverable: response.discoverable,
    showOnline: response.showOnline,
    showLocation: response.showLocation,
    showCompanions: response.showCompanions,
    showTreatsOnProfile: response.showTreatsOnProfile,
  };
}

function requestPatch(patch: Partial<UserPrivacySettings>) {
  const {
    postVisibility,
    ...rest
  } = patch;
  return {
    ...rest,
    ...(postVisibility !== undefined && { defaultPostVisibility: postVisibility }),
  };
}

export function UserPrivacyProvider({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth();
  const [settings, setSettings] = useState<UserPrivacySettings>(DEFAULT_SETTINGS);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const versionRef = useRef(1);
  const mutationQueue = useRef(Promise.resolve());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const reloadPrivacy = useCallback(async () => {
    if (!authenticated) return;
    try {
      const [privacy, blocked] = await Promise.all([
        apiRequest<PrivacyResponse>('/me/privacy-settings'),
        apiRequest<{ users: BlockedUser[] }>('/me/blocked-users'),
      ]);
      const mapped = mapSettings(privacy);
      versionRef.current = privacy.version;
      settingsRef.current = mapped;
      setSettings(mapped);
      setBlockedUsers(blocked.users);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not load privacy settings.');
    } finally {
      setReady(true);
    }
  }, [authenticated]);

  useEffect(() => {
    void reloadPrivacy();
  }, [reloadPrivacy]);

  useEffect(() => registerDevReset(reloadPrivacy), [reloadPrivacy]);

  const patchSettings = useCallback(async (patch: Partial<UserPrivacySettings>) => {
    const optimistic = { ...settingsRef.current, ...patch };
    settingsRef.current = optimistic;
    setSettings(optimistic);

    const operation = mutationQueue.current.then(async () => {
      try {
        const response = await apiRequest<PrivacyResponse>('/me/privacy-settings', {
          method: 'PATCH',
          body: {
            version: versionRef.current,
            ...requestPatch(patch),
          },
        });
        versionRef.current = response.version;
        setSyncError(null);
      } catch (error) {
        await reloadPrivacy();
        throw error;
      }
    });
    mutationQueue.current = operation.catch(() => {});
    return operation;
  }, [reloadPrivacy]);

  const blockUser = useCallback(async (userId: string) => {
    if (blockedUsers.some(user => user.id === userId)) return;
    try {
      await apiRequest<void>(`/me/blocked-users/${userId}`, { method: 'PUT' });
      const response = await apiRequest<{ users: BlockedUser[] }>('/me/blocked-users');
      setBlockedUsers(response.users);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not block this user.');
      throw error;
    }
  }, [blockedUsers]);

  const unblockUser = useCallback(async (userId: string) => {
    const previous = blockedUsers;
    setBlockedUsers(current => current.filter(user => user.id !== userId));
    try {
      await apiRequest<void>(`/me/blocked-users/${userId}`, { method: 'DELETE' });
      setSyncError(null);
    } catch (error) {
      setBlockedUsers(previous);
      setSyncError(error instanceof Error ? error.message : 'Could not unblock this user.');
      throw error;
    }
  }, [blockedUsers]);

  const blockedUserIds = useMemo(() => blockedUsers.map(user => user.id), [blockedUsers]);
  const isBlocked = useCallback(
    (userId: string) => blockedUserIds.includes(userId),
    [blockedUserIds],
  );

  const value = useMemo<UserPrivacyContextValue>(() => ({
    ready,
    syncError,
    settings,
    blockedUsers,
    blockedUserIds,
    patchSettings,
    blockUser,
    unblockUser,
    isBlocked,
    reloadPrivacy,
  }), [
    ready, syncError, settings, blockedUsers, blockedUserIds,
    patchSettings, blockUser, unblockUser, isBlocked, reloadPrivacy,
  ]);

  return (
    <UserPrivacyContext.Provider value={value}>
      {children}
    </UserPrivacyContext.Provider>
  );
}

export function useUserPrivacy() {
  const ctx = useContext(UserPrivacyContext);
  if (!ctx) throw new Error('useUserPrivacy must be used within UserPrivacyProvider');
  return ctx;
}
