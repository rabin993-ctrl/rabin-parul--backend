export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
};

export type AuthResponse = {
  account: {
    id: string;
    onboardingStatus: 'username_required' | 'complete';
    nextStep: 'username_required' | 'app';
  };
  tokens: TokenPair;
};

export type OwnerProfile = {
  profile: {
    id: string;
    displayName: string;
    handle: string | null;
    bio: string | null;
    avatar: { mediaAssetId: string; url?: string | null } | null;
    publicLocationLabel: string | null;
    websiteUrl: string | null;
    verification: { status: string };
    joinedAt: string;
    version: number;
  };
  onboarding: {
    status: 'username_required' | 'complete';
    nextStep: 'username_required' | 'app';
  };
  impact: {
    rescues: number;
    rehomed: number;
    adopted: number;
  };
  privateAlerts: {
    adoptionMissedUpdates: number;
    adoptionDueSoon: number;
  };
};

export type CompanionResource = {
  id: string;
  ownerId: string;
  name: string;
  handle: string | null;
  species: string;
  breed: string | null;
  ageDisplay: string | null;
  genderDisplay: string | null;
  about: string | null;
  mood: string | null;
  avatar: { mediaAssetId: string } | null;
  profileVisibility: 'everyone' | 'circles' | 'only_me';
  status: string;
  sourceType: string;
  verification: { status: string };
  stats: {
    followers: number;
    pawprints: number;
    treats: number | null;
    posts: number;
  };
  version: number;
};

export type FeedPostResource = {
  id: string;
  body: string | null;
  category: string | null;
  visibility: 'everyone' | 'circles' | 'only_me';
  presentationMode: 'user' | 'companion';
  displayAuthor:
    | { type: 'user'; id: string; name: string; handle: string | null; avatarMediaId: string | null }
    | { type: 'companion'; id: string; name: string; avatarMediaId: string | null };
  companions: Array<{
    id: string;
    name: string;
    avatarMediaId: string | null;
    relationship: string;
  }>;
  media: Array<{
    assetId: string;
    position: number;
    altText: string | null;
    mediaType?: string;
    mimeType?: string;
    url?: string;
  }>;
  counts: { reactions: number; comments: number };
  viewer: {
    reaction: string | null;
    saved: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
};
