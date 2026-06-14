import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { apiRequest } from '../api/client';
import { type Community } from '../data/mockData';
import { COMMUNITY_RULES } from '../data/communityPosts';

export type CommunityAdminSettings = {
  name: string;
  about: string;
  tint: string;
  defaultCategory: string;
  enabledTopics: string[];
  requirePhotoLostFound: boolean;
  allowLinks: boolean;
  postApproval: boolean;
  joinPolicy: 'open' | 'request' | 'invite';
  membersOnly: boolean;
  showLocation: boolean;
  discoverable: boolean;
  guidelines: string[];
};

export type CreateCommunityInput = {
  name: string;
  about: string;
  tint: string;
  icon: string;
  joinPolicy: CommunityAdminSettings['joinPolicy'];
  enabledTopics: string[];
};

export type CommunityPendingRequest = {
  id: string;
  communityId: string;
  userId: string;
  time: string;
};

type CommunityResource = {
  id: string;
  name: string;
  about: string;
  tint: string | null;
  version: number;
  memberCount: number;
  relationship: string;
  viewerRole: string | null;
  settings: {
    version: number;
    joinPolicy: 'open' | 'request' | 'invite';
    membersOnly: boolean;
    discoverable: boolean;
    showLocation: boolean;
    allowLinks: boolean;
    postApprovalRequired: boolean;
    requirePhotoLostFound: boolean;
  };
};

type MembershipResource = {
  id: string;
  communityId: string;
  userId: string;
  state: string;
  role: string | null;
  createdAt: string;
  displayName?: string;
  handle?: string | null;
};

const DEFAULT_ADMIN: Omit<CommunityAdminSettings, 'name' | 'about' | 'tint'> = {
  defaultCategory: 'general',
  enabledTopics: ['general', 'rescue', 'health', 'lost-found', 'tips', 'events'],
  requirePhotoLostFound: true,
  allowLinks: true,
  postApproval: false,
  joinPolicy: 'open',
  membersOnly: false,
  showLocation: true,
  discoverable: true,
  guidelines: [...COMMUNITY_RULES],
};

function roleLabel(role: string | null): string | null {
  if (role === 'owner' || role === 'admin') return 'Admin';
  if (role === 'moderator') return 'Moderator';
  if (role === 'member') return 'Member';
  return null;
}

function fromResource(resource: CommunityResource, localId = resource.id): Community {
  return {
    id: localId,
    backendId: resource.id,
    backendVersion: resource.version,
    settingsVersion: resource.settings.version,
    relationship: resource.relationship,
    name: resource.name,
    about: resource.about,
    tint: resource.tint ?? '#7C5CBF',
    icon: 'communities',
    members: String(resource.memberCount),
    joined: resource.relationship === 'active',
    role: roleLabel(resource.viewerRole),
  };
}

function settingsFromResource(resource: CommunityResource): CommunityAdminSettings {
  return {
    name: resource.name,
    about: resource.about,
    tint: resource.tint ?? '#7C5CBF',
    ...DEFAULT_ADMIN,
    joinPolicy: resource.settings.joinPolicy,
    membersOnly: resource.settings.membersOnly,
    showLocation: resource.settings.showLocation,
    discoverable: resource.settings.discoverable,
    allowLinks: resource.settings.allowLinks,
    postApproval: resource.settings.postApprovalRequired,
    requirePhotoLostFound: resource.settings.requirePhotoLostFound,
  };
}

type CommunityGroupsContextValue = {
  communities: Community[];
  joinedCommunities: Community[];
  adminCommunities: Community[];
  modCommunities: Community[];
  ready: boolean;
  syncError: string | null;
  isAdmin: (communityId: string) => boolean;
  isMod: (communityId: string) => boolean;
  getCommunity: (id: string) => Community | undefined;
  getPendingRequestCount: (communityId: string) => number;
  getPendingRequests: (communityId?: string) => CommunityPendingRequest[];
  getCommunityMemberIds: (communityId: string) => string[];
  getCommunityMembers: (communityId: string) => MembershipResource[];
  getCommunityMemberCount: (communityId: string) => number;
  formatCommunityMemberLabel: (communityId: string) => string;
  removeCommunityMember: (communityId: string, userId: string) => boolean;
  toggleJoin: (id: string) => void;
  createCommunity: (input: CreateCommunityInput) => Community;
  getAdminSettings: (communityId: string) => CommunityAdminSettings;
  updateAdminSettings: (
    communityId: string,
    patch: Partial<CommunityAdminSettings>,
  ) => void;
  reloadCommunities: () => Promise<void>;
};

const CommunityGroupsContext = createContext<CommunityGroupsContextValue | null>(null);

export function CommunityGroupsProvider({ children }: { children: React.ReactNode }) {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [adminByGroup, setAdminByGroup] = useState<Record<string, CommunityAdminSettings>>({});
  const [pendingByGroup, setPendingByGroup] = useState<Record<string, CommunityPendingRequest[]>>({});
  const [memberIdsByGroup, setMemberIdsByGroup] = useState<Record<string, string[]>>({});
  const [membersByGroup, setMembersByGroup] = useState<Record<string, MembershipResource[]>>({});
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const mergeResources = useCallback((resources: CommunityResource[]) => {
    setCommunities(previous => {
      const localByBackend = new Map(
        previous.filter(item => item.backendId).map(item => [item.backendId!, item.id]),
      );
      const mapped = resources.map(resource => fromResource(
        resource,
        localByBackend.get(resource.id) ?? resource.id,
      ));
      setAdminByGroup(current => {
        const next = { ...current };
        for (let index = 0; index < resources.length; index += 1) {
          next[mapped[index].id] = settingsFromResource(resources[index]);
        }
        return next;
      });
      return mapped;
    });
  }, []);

  const reloadCommunities = useCallback(async () => {
    try {
      const [discover, joined] = await Promise.all([
        apiRequest<{ communities: CommunityResource[] }>('/communities/discover?limit=50'),
        apiRequest<{ communities: CommunityResource[] }>('/me/communities'),
      ]);
      const byId = new Map<string, CommunityResource>();
      for (const resource of discover.communities) byId.set(resource.id, resource);
      for (const resource of joined.communities) byId.set(resource.id, resource);
      mergeResources([...byId.values()]);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not load communities.');
    } finally {
      setReady(true);
    }
  }, [mergeResources]);

  useEffect(() => {
    void reloadCommunities();
  }, [reloadCommunities]);

  const joinedCommunities = useMemo(
    () => communities.filter(community => community.joined),
    [communities],
  );
  const adminCommunities = useMemo(
    () => communities.filter(community => community.joined && community.role === 'Admin'),
    [communities],
  );
  const modCommunities = useMemo(
    () => communities.filter(community => (
      community.joined
      && (community.role === 'Admin' || community.role === 'Moderator')
    )),
    [communities],
  );

  useEffect(() => {
    for (const community of modCommunities) {
      const backendId = community.backendId ?? community.id;
      void apiRequest<{ requests: MembershipResource[] }>(
        `/communities/${backendId}/join-requests`,
      ).then(response => {
        setPendingByGroup(previous => ({
          ...previous,
          [community.id]: response.requests.map(item => ({
            id: item.id,
            communityId: community.id,
            userId: item.userId,
            time: new Date(item.createdAt).toLocaleDateString(),
          })),
        }));
      }).catch(() => {});
    }
    for (const community of joinedCommunities) {
      const backendId = community.backendId ?? community.id;
      void apiRequest<{ members: MembershipResource[] }>(
        `/communities/${backendId}/members`,
      ).then(response => {
        setMembersByGroup(previous => ({
          ...previous,
          [community.id]: response.members,
        }));
        setMemberIdsByGroup(previous => ({
          ...previous,
          [community.id]: response.members.map(item => item.userId),
        }));
      }).catch(() => {});
    }
  }, [joinedCommunities, modCommunities]);

  const getCommunity = useCallback(
    (id: string) => communities.find(community => community.id === id),
    [communities],
  );

  const toggleJoin = useCallback((id: string) => {
    const community = communities.find(item => item.id === id);
    if (!community || community.role === 'Admin') return;
    const joining = !community.joined;
    setCommunities(previous => previous.map(item => item.id === id
      ? {
        ...item,
        joined: joining,
        relationship: joining ? 'active' : 'left',
        role: joining ? 'Member' : null,
      }
      : item));
    const backendId = community.backendId ?? id;
    void apiRequest(`/communities/${backendId}/${joining ? 'join' : 'membership'}`, {
      method: joining ? 'POST' : 'DELETE',
      ...(joining && { body: {} }),
    }).then(reloadCommunities).catch(error => {
      setSyncError(error instanceof Error ? error.message : 'Could not update membership.');
      void reloadCommunities();
    });
  }, [communities, reloadCommunities]);

  const createCommunity = useCallback((input: CreateCommunityInput): Community => {
    const localId = `community-${Date.now()}`;
    const optimistic: Community = {
      id: localId,
      name: input.name.trim(),
      about: input.about.trim(),
      tint: input.tint,
      icon: input.icon,
      members: '1',
      joined: true,
      role: 'Admin',
      relationship: 'active',
    };
    setCommunities(previous => [...previous, optimistic]);
    setAdminByGroup(previous => ({
      ...previous,
      [localId]: {
        name: optimistic.name,
        about: optimistic.about,
        tint: optimistic.tint,
        ...DEFAULT_ADMIN,
        joinPolicy: input.joinPolicy,
        enabledTopics: input.enabledTopics,
      },
    }));
    void apiRequest<CommunityResource>('/communities', {
      method: 'POST',
      body: {
        name: input.name.trim(),
        about: input.about.trim(),
        tint: input.tint,
        joinPolicy: input.joinPolicy,
      },
    }).then(resource => {
      const mapped = fromResource(resource, localId);
      mapped.icon = input.icon;
      setCommunities(previous => previous.map(item => item.id === localId ? mapped : item));
      setAdminByGroup(previous => ({
        ...previous,
        [localId]: {
          ...settingsFromResource(resource),
          enabledTopics: input.enabledTopics,
        },
      }));
      setSyncError(null);
    }).catch(error => {
      setCommunities(previous => previous.filter(item => item.id !== localId));
      setSyncError(error instanceof Error ? error.message : 'Could not create community.');
    });
    return optimistic;
  }, []);

  const getAdminSettings = useCallback((communityId: string) => {
    const community = communities.find(item => item.id === communityId);
    return adminByGroup[communityId] ?? {
      ...DEFAULT_ADMIN,
      name: community?.name ?? '',
      about: community?.about ?? '',
      tint: community?.tint ?? '#7C5CBF',
    };
  }, [adminByGroup, communities]);

  const updateAdminSettings = useCallback((
    communityId: string,
    patch: Partial<CommunityAdminSettings>,
  ) => {
    const community = communities.find(item => item.id === communityId);
    if (!community) return;
    setAdminByGroup(previous => ({
      ...previous,
      [communityId]: { ...getAdminSettings(communityId), ...patch },
    }));
    setCommunities(previous => previous.map(item => item.id === communityId
      ? {
        ...item,
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.about !== undefined && { about: patch.about }),
        ...(patch.tint !== undefined && { tint: patch.tint }),
      }
      : item));
    if (!community.backendVersion || !community.settingsVersion) return;
    void apiRequest(`/communities/${community.backendId ?? community.id}`, {
      method: 'PATCH',
      body: {
        version: community.backendVersion,
        settingsVersion: community.settingsVersion,
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.about !== undefined && { about: patch.about }),
        ...(patch.tint !== undefined && { tint: patch.tint }),
        ...(patch.joinPolicy !== undefined && { joinPolicy: patch.joinPolicy }),
        ...(patch.membersOnly !== undefined && { membersOnly: patch.membersOnly }),
        ...(patch.discoverable !== undefined && { discoverable: patch.discoverable }),
        ...(patch.showLocation !== undefined && { showLocation: patch.showLocation }),
        ...(patch.allowLinks !== undefined && { allowLinks: patch.allowLinks }),
        ...(patch.postApproval !== undefined && { postApprovalRequired: patch.postApproval }),
        ...(patch.requirePhotoLostFound !== undefined && {
          requirePhotoLostFound: patch.requirePhotoLostFound,
        }),
      },
    }).then(reloadCommunities).catch(error => {
      setSyncError(error instanceof Error ? error.message : 'Could not update community.');
      void reloadCommunities();
    });
  }, [communities, getAdminSettings, reloadCommunities]);

  const removeCommunityMember = useCallback((communityId: string, userId: string) => {
    const community = communities.find(item => item.id === communityId);
    const current = memberIdsByGroup[communityId] ?? [];
    if (!community || !current.includes(userId)) return false;
    setMemberIdsByGroup(previous => ({
      ...previous,
      [communityId]: current.filter(id => id !== userId),
    }));
    void apiRequest(`/communities/${community.backendId ?? community.id}/members/${userId}`, {
      method: 'DELETE',
    }).catch(error => {
      setSyncError(error instanceof Error ? error.message : 'Could not remove member.');
      void reloadCommunities();
    });
    return true;
  }, [communities, memberIdsByGroup, reloadCommunities]);

  const value = useMemo<CommunityGroupsContextValue>(() => ({
    communities,
    joinedCommunities,
    adminCommunities,
    modCommunities,
    ready,
    syncError,
    isAdmin: id => communities.find(item => item.id === id)?.role === 'Admin',
    isMod: id => ['Admin', 'Moderator'].includes(
      communities.find(item => item.id === id)?.role ?? '',
    ),
    getCommunity,
    getPendingRequestCount: id => pendingByGroup[id]?.length ?? 0,
    getPendingRequests: id => id
      ? pendingByGroup[id] ?? []
      : Object.values(pendingByGroup).flat(),
    getCommunityMemberIds: id => memberIdsByGroup[id] ?? [],
    getCommunityMembers: id => membersByGroup[id] ?? [],
    getCommunityMemberCount: id => (
      memberIdsByGroup[id]?.length
      ?? Number(communities.find(item => item.id === id)?.members ?? 0)
    ),
    formatCommunityMemberLabel: id => {
      const count = memberIdsByGroup[id]?.length
        ?? Number(communities.find(item => item.id === id)?.members ?? 0);
      return `${count} member${count === 1 ? '' : 's'}`;
    },
    removeCommunityMember,
    toggleJoin,
    createCommunity,
    getAdminSettings,
    updateAdminSettings,
    reloadCommunities,
  }), [
    communities, joinedCommunities, adminCommunities, modCommunities, ready,
    syncError, getCommunity, pendingByGroup, memberIdsByGroup, membersByGroup,
    removeCommunityMember, toggleJoin, createCommunity, getAdminSettings,
    updateAdminSettings, reloadCommunities,
  ]);

  return (
    <CommunityGroupsContext.Provider value={value}>
      {children}
    </CommunityGroupsContext.Provider>
  );
}

export function useCommunityGroups() {
  const context = useContext(CommunityGroupsContext);
  if (!context) {
    throw new Error('useCommunityGroups must be used within CommunityGroupsProvider');
  }
  return context;
}
