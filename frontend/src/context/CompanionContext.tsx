import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { apiRequest } from '../api/client';
import type { CompanionResource } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { companions as companionsStore, type Companion } from '../data/mockData';
import type { AdoptionRecord } from '../data/adoptionRecords';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function defaultIcon(species: string): string {
  if (species === 'cat') return 'cat';
  if (species === 'dog') return 'dog';
  return 'paw';
}

function tintForSpecies(species: string): string {
  if (species === 'dog') return '#F2972E';
  if (species === 'cat') return '#7A5AE0';
  return '#7C5CBF';
}

function fromResource(resource: CompanionResource, localId?: string): Companion {
  return {
    id: localId ?? resource.handle ?? resource.id,
    backendId: resource.id,
    name: resource.name,
    species: resource.species,
    icon: defaultIcon(resource.species),
    breed: resource.breed ?? '—',
    age: resource.ageDisplay ?? '—',
    gender: resource.genderDisplay ?? '—',
    owner: 'you',
    ownerId: 'you',
    tint: tintForSpecies(resource.species),
    traits: [],
    vaccinated: false,
    neutered: false,
    microchipped: false,
    about: resource.about ?? '',
    handle: resource.handle ?? undefined,
    mood: resource.mood ?? undefined,
    followers: resource.stats.followers,
    pawprints: resource.stats.pawprints,
    treats: resource.stats.treats ?? 0,
    postsCount: resource.stats.posts,
    siblings: [],
    online: resource.status === 'active',
    verified: resource.verification.status === 'verified',
  };
}

function optimisticCompanion(input: {
  name: string;
  species: 'dog' | 'cat' | 'other';
  age: string;
}): Companion {
  const id = slugify(input.name) || `companion-${Date.now()}`;
  const species = input.species === 'other' ? 'pet' : input.species;
  return {
    id,
    name: input.name.trim(),
    species,
    icon: defaultIcon(species),
    breed: '—',
    age: input.age.trim() || '—',
    gender: '—',
    owner: 'you',
    ownerId: 'you',
    tint: tintForSpecies(species),
    traits: [],
    vaccinated: false,
    neutered: false,
    microchipped: false,
    about: '',
    handle: id,
    mood: 'New on the block',
    followers: 0,
    pawprints: 0,
    treats: 0,
    postsCount: 0,
    siblings: [],
    online: true,
    verified: false,
  };
}

type CompanionContextValue = {
  revision: number;
  ready: boolean;
  syncError: string | null;
  getMyCompanions: (ownerId: string) => Companion[];
  hasCompanionForAdoption: (record: AdoptionRecord) => boolean;
  addFromAdoption: (record: AdoptionRecord) => Companion | null;
  addManual: (input: {
    name: string;
    species: 'dog' | 'cat' | 'other';
    age: string;
    ownerId: string;
  }) => Companion | null;
  removeCompanion: (id: string, ownerId: string) => Companion | null;
  reloadCompanions: () => Promise<void>;
};

const CompanionContext = createContext<CompanionContextValue | null>(null);

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth();
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const remoteLocalIds = useRef(new Set<string>());

  const bump = useCallback(() => setRevision(value => value + 1), []);

  const reloadCompanions = useCallback(async () => {
    if (!authenticated) return;
    try {
      const response = await apiRequest<{ companions: CompanionResource[] }>('/me/companions');
      for (const localId of remoteLocalIds.current) delete companionsStore[localId];
      const nextIds = new Set<string>();
      for (const resource of response.companions) {
        let localId = resource.handle ?? resource.id;
        if (companionsStore[localId] && companionsStore[localId].backendId !== resource.id) {
          localId = resource.id;
        }
        companionsStore[localId] = fromResource(resource, localId);
        nextIds.add(localId);
      }
      remoteLocalIds.current = nextIds;
      setSyncError(null);
      bump();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not load companions.');
    } finally {
      setReady(true);
    }
  }, [authenticated, bump]);

  useEffect(() => {
    void reloadCompanions();
  }, [reloadCompanions]);

  const getMyCompanions = useCallback(
    (ownerId: string) => Object.values(companionsStore).filter(item => item.ownerId === ownerId),
    [revision],
  );

  const hasCompanionForAdoption = useCallback((record: AdoptionRecord) => (
    Object.values(companionsStore).some(
      item => item.ownerId === 'you'
        && item.name.toLowerCase() === record.petName.toLowerCase(),
    )
  ), [revision]);

  const persistNewCompanion = useCallback((
    companion: Companion,
    input: { name: string; species: string; age: string; about?: string },
  ) => {
    void apiRequest<CompanionResource>('/companions', {
      method: 'POST',
      body: {
        name: input.name,
        species: input.species,
        publicHandle: companion.handle,
        ageDisplay: input.age || null,
        about: input.about || null,
        mood: companion.mood,
        profileVisibility: 'everyone',
      },
    }).then(resource => {
      companionsStore[companion.id] = fromResource(resource, companion.id);
      remoteLocalIds.current.add(companion.id);
      setSyncError(null);
      bump();
    }).catch(error => {
      delete companionsStore[companion.id];
      setSyncError(error instanceof Error ? error.message : 'Could not create companion.');
      bump();
    });
  }, [bump]);

  const addManual = useCallback((input: {
    name: string;
    species: 'dog' | 'cat' | 'other';
    age: string;
    ownerId: string;
  }) => {
    const name = input.name.trim();
    if (!name) return null;
    let companion = optimisticCompanion({ ...input, name });
    if (companionsStore[companion.id]) {
      companion = { ...companion, id: `${companion.id}-${Date.now().toString(36)}` };
    }
    companionsStore[companion.id] = companion;
    bump();
    persistNewCompanion(companion, {
      name,
      species: input.species,
      age: input.age.trim(),
    });
    return companion;
  }, [bump, persistNewCompanion]);

  const addFromAdoption = useCallback((record: AdoptionRecord) => {
    if (hasCompanionForAdoption(record)) return null;
    const species = record.species === 'dog' || record.species === 'cat'
      ? record.species
      : 'other';
    const companion = optimisticCompanion({
      name: record.petName,
      species,
      age: '',
    });
    companion.icon = record.icon;
    companion.tint = record.tint;
    companion.about = record.newHome
      ? `Adopted recently. Now at ${record.newHome}.`
      : 'Adopted recently.';
    companionsStore[companion.id] = companion;
    bump();
    persistNewCompanion(companion, {
      name: companion.name,
      species,
      age: '',
      about: companion.about,
    });
    return companion;
  }, [bump, hasCompanionForAdoption, persistNewCompanion]);

  const removeCompanion = useCallback((id: string, ownerId: string) => {
    const companion = companionsStore[id];
    if (!companion || companion.ownerId !== ownerId) return null;
    delete companionsStore[id];
    remoteLocalIds.current.delete(id);
    bump();
    if (companion.backendId) {
      void apiRequest(`/companions/${companion.backendId}/archive`, { method: 'POST' })
        .catch(error => {
          companionsStore[id] = companion;
          remoteLocalIds.current.add(id);
          setSyncError(error instanceof Error ? error.message : 'Could not archive companion.');
          bump();
        });
    }
    return companion;
  }, [bump]);

  const value = useMemo<CompanionContextValue>(() => ({
    revision,
    ready,
    syncError,
    getMyCompanions,
    hasCompanionForAdoption,
    addFromAdoption,
    addManual,
    removeCompanion,
    reloadCompanions,
  }), [
    revision, ready, syncError, getMyCompanions, hasCompanionForAdoption,
    addFromAdoption, addManual, removeCompanion, reloadCompanions,
  ]);

  return (
    <CompanionContext.Provider value={value}>
      {children}
    </CompanionContext.Provider>
  );
}

export function useCompanions() {
  const context = useContext(CompanionContext);
  if (!context) throw new Error('useCompanions must be used within CompanionProvider');
  return context;
}
