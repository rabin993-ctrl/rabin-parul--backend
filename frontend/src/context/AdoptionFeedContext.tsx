import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { registerDevReset } from '../dev/devResetRegistry';
import {
  AdoptionListing,
  AdoptionStatus,
  VaccinationStatus,
  AdoptionSpecies,
} from '../data/adoptionData';
import { users } from '../data/mockData';

export type AdoptionRequestStatus =
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'adopted'
  | 'cancelled';

export function isActiveAdoptionRequest(request: AdoptionRequest): boolean {
  return request.status === 'submitted' || request.status === 'approved';
}

export type AdoptionRequest = {
  id: string;
  listingId: string;
  listingName: string;
  posterId: string;
  requesterId: string;
  requesterName: string;
  message: string;
  submittedAt: string;
  status: AdoptionRequestStatus;
  threadId?: string;
};

export type AdoptionFeedNotification = {
  id: string;
  type: 'request_received' | 'approved' | 'rejected' | 'adopted';
  title: string;
  body: string;
  listingId: string;
  requestId: string;
  recipientId: string;
  time: string;
  read: boolean;
};

export type CreateListingInput = {
  name: string;
  species: AdoptionSpecies;
  breed: string;
  age: string;
  gender: 'Male' | 'Female';
  location: string;
  vacc: VaccinationStatus;
  neutered: boolean;
  personality: string;
  story: string;
  requirements: string[];
  urgent: boolean;
  status?: AdoptionStatus;
  assetIds: string[];
  imageUris: string[];
};

type ApiRequestResource = {
  id: string;
  listingId: string;
  posterId: string;
  requesterId: string;
  message: string;
  status: AdoptionRequestStatus;
  threadId: string | null;
  submittedAt: string;
  requester?: {
    displayName: string;
  };
};

type ApiListingResource = {
  id: string;
  posterId: string;
  animalName: string;
  species: string;
  breed: string | null;
  ageDisplay: string | null;
  genderDisplay: string | null;
  vaccinationStatus: string | null;
  neutered: boolean;
  personality: string | null;
  requirements: string[];
  healthNotes: string | null;
  description: string;
  locationLabel: string | null;
  status: 'available' | 'urgent' | 'adopted';
  urgent: boolean;
  adoptedAt: string | null;
  adoptedNote: string | null;
  publishedAt: string;
  version: number;
  poster: {
    id: string;
    displayName: string;
    handle: string | null;
  };
  media: Array<{
    assetId: string;
    url: string;
    position: number;
  }>;
  requests: ApiRequestResource[];
};

type AdoptionFeedValue = {
  listings: AdoptionListing[];
  savedIds: Set<string>;
  requests: AdoptionRequest[];
  notifications: AdoptionFeedNotification[];
  toggleSaved: (id: string) => void;
  isSaved: (id: string) => boolean;
  submitRequest: (input: {
    listingId: string;
    listingName: string;
    posterId: string;
    message: string;
    threadId?: string;
  }) => string;
  approveRequest: (requestId: string) => void;
  rejectRequest: (requestId: string) => void;
  cancelRequest: (requestId: string) => void;
  completeAdoption: (requestId: string, note?: string) => void;
  getRequestsForListing: (listingId: string) => AdoptionRequest[];
  getMyOutgoingRequests: () => AdoptionRequest[];
  getIncomingRequests: () => AdoptionRequest[];
  getRequestForListing: (listingId: string, requesterId?: string) => AdoptionRequest | undefined;
  markNotificationRead: (id: string) => void;
  getMyNotifications: () => AdoptionFeedNotification[];
  attachThreadToRequest: (requestId: string, threadId: string) => void;
  addListing: (input: CreateListingInput) => AdoptionListing;
  updateListing: (id: string, patch: Partial<AdoptionListing>) => void;
  markAdopted: (id: string, note?: string) => void;
  relistListing: (id: string) => void;
  clearRequestOnRelist: (listingId: string, requesterId: string) => void;
  refresh: () => Promise<void>;
};

const AdoptionFeedContext = createContext<AdoptionFeedValue | null>(null);

function ageGroupFromAge(age: string): AdoptionListing['ageGroup'] {
  const value = Number.parseInt(age, 10);
  if (age.includes('week') || (age.includes('month') && value < 12)) return 'puppy-kitten';
  if (age.includes('yr') && value >= 7) return 'senior';
  if (age.includes('yr')) return 'adult';
  return 'young';
}

function statusFromApi(status: ApiListingResource['status']): AdoptionStatus {
  if (status === 'adopted') return 'Adopted';
  if (status === 'urgent') return 'Urgent';
  return 'Available';
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Date(value).toLocaleDateString();
}

function speciesFromApi(value: string): AdoptionSpecies {
  return value === 'dog' || value === 'cat' ? value : 'other';
}

function tintFor(species: AdoptionSpecies): string {
  if (species === 'dog') return '#E0503F';
  if (species === 'cat') return '#7A5AE0';
  return '#3B82C4';
}

function mapRequest(
  request: ApiRequestResource,
  listingName: string,
  listingId: string,
  accountId: string | null,
): AdoptionRequest {
  return {
    id: request.id,
    listingId,
    listingName,
    posterId: request.posterId === accountId ? 'you' : request.posterId,
    requesterId: request.requesterId === accountId ? 'you' : request.requesterId,
    requesterName: request.requester?.displayName ?? (
      request.requesterId === accountId ? users.you.name : 'Parul member'
    ),
    message: request.message,
    submittedAt: relativeTime(request.submittedAt),
    status: request.status,
    threadId: request.threadId ?? undefined,
  };
}

function mapListing(resource: ApiListingResource, accountId: string | null): AdoptionListing {
  const species = speciesFromApi(resource.species);
  const tint = tintFor(species);
  const imageUris = resource.media
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(item => item.url);
  const ownerId = resource.posterId === accountId ? 'you' : resource.posterId;
  if (ownerId !== 'you' && !users[ownerId]) {
    users[ownerId] = {
      id: ownerId,
      name: resource.poster.displayName,
      handle: resource.poster.handle ?? 'parul-user',
      tint,
      loc: resource.locationLabel ?? 'Parul community',
      location: resource.locationLabel ?? 'Parul community',
      verified: false,
    };
  }
  const vacc = ['Done', 'Partial', 'Not yet'].includes(resource.vaccinationStatus ?? '')
    ? resource.vaccinationStatus as VaccinationStatus
    : 'Not yet';
  const gender = resource.genderDisplay === 'Male' ? 'Male' : 'Female';
  return {
    id: resource.id,
    backendId: resource.id,
    version: resource.version,
    assetIds: resource.media.map(item => item.assetId),
    imageUris,
    pet: null,
    name: resource.animalName,
    species,
    icon: species === 'dog' ? 'dog' : species === 'cat' ? 'cat' : 'paw',
    breed: resource.breed ?? 'Mixed breed',
    age: resource.ageDisplay ?? 'Age not listed',
    ageGroup: ageGroupFromAge(resource.ageDisplay ?? ''),
    gender,
    loc: resource.locationLabel ?? 'Location not listed',
    location: resource.locationLabel ?? 'Location not listed',
    vacc,
    tint,
    owner: resource.poster.handle ?? resource.poster.displayName,
    userId: ownerId,
    urgent: resource.urgent,
    status: statusFromApi(resource.status),
    personality: resource.personality ?? 'Ready for a caring home.',
    story: resource.description,
    requirements: resource.requirements ?? [],
    neutered: resource.neutered,
    microchipped: false,
    healthNotes: resource.healthNotes ?? `Vaccination: ${vacc}`,
    gallery: imageUris.length ? imageUris : [tint],
    postedAt: relativeTime(resource.publishedAt),
    adoptedDate: resource.adoptedAt ? relativeTime(resource.adoptedAt) : undefined,
    adoptedNote: resource.adoptedNote ?? undefined,
  };
}

function localListing(input: CreateListingInput): AdoptionListing {
  const tint = tintFor(input.species);
  return {
    id: `adoption-local-${Date.now()}`,
    pet: null,
    name: input.name.trim(),
    species: input.species,
    icon: input.species === 'dog' ? 'dog' : input.species === 'cat' ? 'cat' : 'paw',
    breed: input.breed.trim(),
    age: input.age.trim(),
    ageGroup: ageGroupFromAge(input.age),
    gender: input.gender,
    loc: input.location.trim(),
    location: input.location.trim(),
    vacc: input.vacc,
    tint,
    owner: 'you',
    userId: 'you',
    urgent: input.urgent,
    status: input.urgent ? 'Urgent' : 'Available',
    personality: input.personality.trim(),
    story: input.story.trim(),
    requirements: input.requirements.filter(Boolean),
    neutered: input.neutered,
    microchipped: false,
    healthNotes: `Vaccination: ${input.vacc} - Sterilization: ${input.neutered ? 'Yes' : 'No'}`,
    gallery: input.imageUris,
    imageUris: input.imageUris,
    assetIds: input.assetIds,
    postedAt: 'Just now',
    rating: 4.9,
  };
}

export function AdoptionFeedProvider({ children }: { children: React.ReactNode }) {
  const { accountId } = useAuth();
  const [listings, setListings] = useState<AdoptionListing[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [requests, setRequests] = useState<AdoptionRequest[]>([]);
  const [notifications, setNotifications] = useState<AdoptionFeedNotification[]>([]);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const [active, adopted] = await Promise.all([
      apiRequest<{ listings: ApiListingResource[] }>('/adoption-listings?limit=100'),
      apiRequest<{ listings: ApiListingResource[] }>(
        `/adoption-listings?status=adopted&posterId=${accountId}&limit=100`,
      ),
    ]);
    const resources = [...active.listings, ...adopted.listings]
      .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
    setListings(resources.map(item => mapListing(item, accountId)));
    setRequests(resources.flatMap(item => (
      item.requests.map(request => mapRequest(request, item.animalName, item.id, accountId))
    )));
  }, [accountId]);

  useEffect(() => {
    void refresh().catch(() => {
      setListings([]);
      setRequests([]);
    });
  }, [refresh]);

  const resetDevState = useCallback(() => {
    setListings([]);
    setSavedIds(new Set());
    setRequests([]);
    setNotifications([]);
    void refresh();
  }, [refresh]);
  useEffect(() => registerDevReset(resetDevState), [resetDevState]);

  const toggleSaved = useCallback((id: string) => {
    setSavedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const getRequestsForListing = useCallback(
    (listingId: string) => requests.filter(item => item.listingId === listingId),
    [requests],
  );
  const getMyOutgoingRequests = useCallback(
    () => requests.filter(item => item.requesterId === 'you'),
    [requests],
  );
  const getIncomingRequests = useCallback(
    () => requests.filter(item => item.posterId === 'you'),
    [requests],
  );
  const getRequestForListing = useCallback(
    (listingId: string, requesterId = 'you') => requests.find(item => (
      item.listingId === listingId
      && item.requesterId === requesterId
      && isActiveAdoptionRequest(item)
    )),
    [requests],
  );

  const submitRequest = useCallback((input: {
    listingId: string;
    listingName: string;
    posterId: string;
    message: string;
    threadId?: string;
  }) => {
    const listing = listings.find(item => item.id === input.listingId);
    const backendListingId = listing?.backendId ?? input.listingId;
    const localId = `adoption-request-local-${Date.now()}`;
    const optimistic: AdoptionRequest = {
      id: localId,
      listingId: input.listingId,
      listingName: input.listingName,
      posterId: input.posterId,
      requesterId: 'you',
      requesterName: users.you.name,
      message: input.message.trim(),
      submittedAt: 'Just now',
      status: 'submitted',
      threadId: input.threadId,
    };
    setRequests(previous => [optimistic, ...previous]);
    void apiRequest<ApiRequestResource>(`/adoption-listings/${backendListingId}/requests`, {
      method: 'POST',
      body: { message: input.message.trim() },
    }).then(resource => {
      setRequests(previous => previous.map(item => (
        item.id === localId
          ? mapRequest(resource, input.listingName, input.listingId, accountId)
          : item
      )));
    }).catch(() => {
      setRequests(previous => previous.filter(item => item.id !== localId));
    });
    return localId;
  }, [accountId, listings]);

  const patchRequest = useCallback((
    requestId: string,
    action: 'approve' | 'reject' | 'cancel',
    status: AdoptionRequestStatus,
  ) => {
    const previousRequest = requests.find(item => item.id === requestId);
    setRequests(previous => previous.map(item => (
      item.id === requestId ? { ...item, status } : item
    )));
    if (!requestId.includes('-local-')) {
      void apiRequest<ApiRequestResource>(`/adoption-requests/${requestId}/${action}`, {
        method: 'POST',
      }).then(resource => {
        setRequests(previous => previous.map(item => (
          item.id === requestId
            ? {
              ...item,
              id: resource.id,
              status: resource.status,
              threadId: resource.threadId ?? undefined,
            }
            : item
        )));
      }).catch(() => {
        if (previousRequest) {
          setRequests(previous => previous.map(item => (
            item.id === requestId ? previousRequest : item
          )));
        }
      });
    }
  }, [requests]);

  const approveRequest = useCallback((id: string) => patchRequest(id, 'approve', 'approved'), [patchRequest]);
  const rejectRequest = useCallback((id: string) => patchRequest(id, 'reject', 'rejected'), [patchRequest]);
  const cancelRequest = useCallback((id: string) => patchRequest(id, 'cancel', 'cancelled'), [patchRequest]);

  const completeAdoption = useCallback((requestId: string, note?: string) => {
    const target = requests.find(item => item.id === requestId);
    if (!target || requestId.includes('-local-')) return;
    void apiRequest(`/adoption-requests/${requestId}/mark-adopted`, {
      method: 'POST',
      body: { note: note?.trim() || undefined },
    }).then(() => {
      setRequests(previous => previous.map(item => (
        item.id === requestId
          ? { ...item, status: 'adopted' }
          : item.listingId === target.listingId && isActiveAdoptionRequest(item)
            ? { ...item, status: 'rejected' }
            : item
      )));
      setListings(previous => previous.map(item => (
        item.id === target.listingId
          ? {
            ...item,
            status: 'Adopted',
            urgent: false,
            adoptedDate: 'Just now',
            adoptedNote: note || `Successfully adopted by ${target.requesterName}`,
          }
          : item
      )));
    }).catch(() => undefined);
  }, [requests]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(previous => previous.map(item => (
      item.id === id ? { ...item, read: true } : item
    )));
  }, []);
  const getMyNotifications = useCallback(
    () => notifications.filter(item => item.recipientId === 'you'),
    [notifications],
  );
  const attachThreadToRequest = useCallback((requestId: string, threadId: string) => {
    setRequests(previous => previous.map(item => (
      item.id === requestId ? { ...item, threadId } : item
    )));
  }, []);

  const addListing = useCallback((input: CreateListingInput) => {
    const optimistic = localListing(input);
    setListings(previous => [optimistic, ...previous]);
    void apiRequest<ApiListingResource>('/adoption-listings', {
      method: 'POST',
      body: {
        animalName: input.name.trim(),
        species: input.species,
        breed: input.breed.trim(),
        ageDisplay: input.age.trim(),
        genderDisplay: input.gender,
        vaccinationStatus: input.vacc,
        neutered: input.neutered,
        personality: input.personality.trim(),
        requirements: input.requirements.filter(Boolean),
        healthNotes: optimistic.healthNotes,
        description: input.story.trim(),
        locationLabel: input.location.trim(),
        urgent: input.urgent,
        assetIds: input.assetIds,
      },
    }).then(resource => {
      const mapped = mapListing(resource, accountId);
      setListings(previous => previous.map(item => (
        item.id === optimistic.id
          ? { ...mapped, id: optimistic.id, backendId: mapped.id }
          : item
      )));
    }).catch(() => {
      setListings(previous => previous.filter(item => item.id !== optimistic.id));
    });
    return optimistic;
  }, [accountId]);

  const updateListing = useCallback((id: string, patch: Partial<AdoptionListing>) => {
    const current = listings.find(item => item.id === id);
    if (!current) return;
    setListings(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item));
    if (!current.backendId || !current.version) return;
    const next = { ...current, ...patch };
    void apiRequest<ApiListingResource>(`/adoption-listings/${current.backendId}`, {
      method: 'PATCH',
      body: {
        version: current.version,
        animalName: next.name,
        species: next.species,
        breed: next.breed,
        ageDisplay: next.age,
        genderDisplay: next.gender,
        vaccinationStatus: next.vacc,
        neutered: next.neutered,
        personality: next.personality,
        requirements: next.requirements,
        healthNotes: next.healthNotes,
        description: next.story,
        locationLabel: next.location,
        urgent: next.urgent,
      },
    }).then(resource => {
      const mapped = mapListing(resource, accountId);
      setListings(previous => previous.map(item => (
        item.id === id ? { ...mapped, id, backendId: resource.id } : item
      )));
    }).catch(() => {
      setListings(previous => previous.map(item => item.id === id ? current : item));
    });
  }, [accountId, listings]);

  const markAdopted = useCallback((listingId: string, note?: string) => {
    const approved = requests.find(item => item.listingId === listingId && item.status === 'approved');
    if (approved) completeAdoption(approved.id, note);
  }, [completeAdoption, requests]);

  const relistListing = useCallback((id: string) => {
    setListings(previous => previous.map(item => (
      item.id === id
        ? {
          ...item,
          status: 'Available',
          urgent: false,
          adoptedDate: undefined,
          adoptedNote: undefined,
          postedAt: 'Just now',
        }
        : item
    )));
  }, []);

  const clearRequestOnRelist = useCallback((listingId: string, requesterId: string) => {
    setRequests(previous => previous.filter(item => !(
      item.listingId === listingId && item.requesterId === requesterId
    )));
  }, []);

  const value = useMemo<AdoptionFeedValue>(() => ({
    listings,
    savedIds,
    requests,
    notifications,
    toggleSaved,
    isSaved,
    submitRequest,
    approveRequest,
    rejectRequest,
    cancelRequest,
    completeAdoption,
    getRequestsForListing,
    getMyOutgoingRequests,
    getIncomingRequests,
    getRequestForListing,
    markNotificationRead,
    getMyNotifications,
    attachThreadToRequest,
    addListing,
    updateListing,
    markAdopted,
    relistListing,
    clearRequestOnRelist,
    refresh,
  }), [
    listings, savedIds, requests, notifications, toggleSaved, isSaved,
    submitRequest, approveRequest, rejectRequest, cancelRequest, completeAdoption,
    getRequestsForListing, getMyOutgoingRequests, getIncomingRequests,
    getRequestForListing, markNotificationRead, getMyNotifications,
    attachThreadToRequest, addListing, updateListing, markAdopted,
    relistListing, clearRequestOnRelist, refresh,
  ]);

  return (
    <AdoptionFeedContext.Provider value={value}>
      {children}
    </AdoptionFeedContext.Provider>
  );
}

export function useAdoptionFeed() {
  const context = useContext(AdoptionFeedContext);
  if (!context) throw new Error('useAdoptionFeed must be used within AdoptionFeedProvider');
  return context;
}
