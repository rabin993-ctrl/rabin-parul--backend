import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { ApiError, apiRequest, clientIdempotencyKey } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { companions, users } from '../data/mockData';
import { registerDevReset } from '../dev/devResetRegistry';
import { useUserPrivacy } from './UserPrivacyContext';

const GIVE_DEBOUNCE_MS = 600;

export type TreatGift = {
  id: string;
  fromUserId: string;
  companionId: string;
  ownerId: string;
  amount: number;
  at: string;
};

type TreatWalletResponse = {
  monthlyAllowance: number;
  used: number;
  remaining: number;
  resetsAt: string;
};

type RecentTreatResource = {
  id: string;
  companionId: string;
  createdAt: string;
  giverUserId: string;
  giverName: string;
  giverHandle: string | null;
};

type OwnerTreatSummary = {
  total: number;
  companions: Array<{
    companionId: string;
    companionName: string;
    total: number;
  }>;
  recent: RecentTreatResource[];
};

export type GiveTreatResult =
  | { ok: true; remaining: number; ownerId: string }
  | { ok: false; reason: 'empty' | 'own_pet' | 'not_ready' | 'debounce' | 'unknown_pet' };

interface TreatWalletContextValue {
  ready: boolean;
  remaining: number;
  daysUntilReset: number;
  showTreatsOnProfile: boolean;
  setShowTreatsOnProfile: (show: boolean) => void;
  canGive: (companionId: string) => boolean;
  isOwnPet: (companionId: string) => boolean;
  giveTreat: (companionId: string) => Promise<GiveTreatResult>;
  ensureCompanionTreats: (companionId: string) => Promise<void>;
  getOwnerReceivedTreats: (ownerId: string) => number;
  getCompanionReceivedTreats: (companionId: string) => number;
  getRecentGifts: (companionId: string, limit?: number) => TreatGift[];
  getRecentGiftsForOwner: (ownerId: string, limit?: number) => TreatGift[];
  lastGiftBanner: { companionId: string; ownerId: string; fromUserId: string; handle: string } | null;
  clearGiftBanner: () => void;
}

const TreatWalletContext = createContext<TreatWalletContextValue | null>(null);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function backendCompanionId(companionId: string): string | null {
  return companions[companionId]?.backendId ?? (isUuid(companionId) ? companionId : null);
}

function localCompanionId(serverId: string): string {
  return Object.values(companions).find(item => item.backendId === serverId)?.id ?? serverId;
}

function registerGiver(item: RecentTreatResource) {
  if (users[item.giverUserId]) return;
  users[item.giverUserId] = {
    id: item.giverUserId,
    name: item.giverName,
    handle: item.giverHandle ?? 'parul-user',
    tint: '#7C5CBF',
    loc: 'Parul community',
    location: 'Parul community',
    verified: false,
  };
}

function mapGift(item: RecentTreatResource, ownerId: string): TreatGift {
  registerGiver(item);
  return {
    id: item.id,
    fromUserId: item.giverUserId,
    companionId: localCompanionId(item.companionId),
    ownerId,
    amount: 1,
    at: item.createdAt,
  };
}

export function TreatWalletProvider({ children }: { children: React.ReactNode }) {
  const { authenticated, accountId } = useAuth();
  const { settings, patchSettings } = useUserPrivacy();
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState<TreatWalletResponse>({
    monthlyAllowance: 100,
    used: 0,
    remaining: 100,
    resetsAt: new Date().toISOString(),
  });
  const [gifts, setGifts] = useState<TreatGift[]>([]);
  const [ownerReceived, setOwnerReceived] = useState(0);
  const [companionTotals, setCompanionTotals] = useState<Record<string, number>>({});
  const [lastGiftBanner, setLastGiftBanner] = useState<TreatWalletContextValue['lastGiftBanner']>(null);
  const lastGiveAt = useRef(0);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestedCompanions = useRef(new Set<string>());

  const reloadWallet = useCallback(async () => {
    if (!authenticated) return;
    try {
      const [nextWallet, summary] = await Promise.all([
        apiRequest<TreatWalletResponse>('/me/treat-wallet'),
        apiRequest<OwnerTreatSummary>('/me/companions/treats/summary'),
      ]);
      const totals: Record<string, number> = {};
      for (const item of summary.companions) {
        totals[localCompanionId(item.companionId)] = item.total;
      }
      setWallet(nextWallet);
      setOwnerReceived(summary.total);
      setCompanionTotals(totals);
      setGifts(summary.recent.map(item => mapGift(item, 'you')));
    } catch {
      // Existing profile and companion views remain usable while the API reconnects.
    } finally {
      setReady(true);
    }
  }, [authenticated]);

  useEffect(() => {
    void reloadWallet();
  }, [reloadWallet]);

  useEffect(() => registerDevReset(reloadWallet), [reloadWallet]);

  const setShowTreatsOnProfile = useCallback((show: boolean) => {
    void patchSettings({ showTreatsOnProfile: show });
  }, [patchSettings]);

  const isOwnPet = useCallback((companionId: string) => {
    const companion = companions[companionId];
    return companion?.ownerId === 'you' || companion?.ownerId === accountId;
  }, [accountId]);

  const canGive = useCallback((companionId: string) => {
    if (!ready || wallet.remaining <= 0 || isOwnPet(companionId)) return false;
    return backendCompanionId(companionId) !== null;
  }, [ready, wallet.remaining, isOwnPet]);

  const ensureCompanionTreats = useCallback(async (companionId: string) => {
    const serverId = backendCompanionId(companionId);
    if (!serverId || requestedCompanions.current.has(serverId)) return;
    requestedCompanions.current.add(serverId);
    try {
      const [summary, recent] = await Promise.all([
        apiRequest<{ total: number | null; visibility: 'visible' | 'hidden' }>(`/companions/${serverId}/treats/summary`),
        apiRequest<{ treats: RecentTreatResource[]; visibility: 'visible' | 'hidden' }>(`/companions/${serverId}/treats/recent`),
      ]);
      if (summary.total !== null) {
        setCompanionTotals(current => ({ ...current, [companionId]: summary.total! }));
      }
      const ownerId = companions[companionId]?.ownerId ?? '';
      const mapped = recent.treats.map(item => mapGift(item, ownerId));
      setGifts(current => [
        ...mapped,
        ...current.filter(item => item.companionId !== companionId),
      ]);
    } catch {
      requestedCompanions.current.delete(serverId);
    }
  }, []);

  const getOwnerReceivedTreats = useCallback((ownerId: string) => {
    if (ownerId === 'you' || ownerId === accountId) return ownerReceived;
    return gifts
      .filter(gift => gift.ownerId === ownerId)
      .reduce((sum, gift) => sum + gift.amount, 0);
  }, [accountId, gifts, ownerReceived]);

  const getCompanionReceivedTreats = useCallback((companionId: string) => (
    companionTotals[companionId] ?? companions[companionId]?.treats ?? 0
  ), [companionTotals]);

  const getRecentGifts = useCallback((companionId: string, limit = 8) => (
    gifts.filter(gift => gift.companionId === companionId).slice(0, limit)
  ), [gifts]);

  const getRecentGiftsForOwner = useCallback((ownerId: string, limit = 12) => (
    gifts.filter(gift => (
      ownerId === 'you' || ownerId === accountId ? gift.ownerId === 'you' : gift.ownerId === ownerId
    )).slice(0, limit)
  ), [accountId, gifts]);

  const clearGiftBanner = useCallback(() => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setLastGiftBanner(null);
  }, []);

  const showGiftBanner = useCallback((companionId: string, ownerId: string) => {
    const fromUserId = accountId ?? 'you';
    const handle = users.you?.handle ?? 'you';
    setLastGiftBanner({ companionId, ownerId, fromUserId, handle });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setLastGiftBanner(null), 2500);
  }, [accountId]);

  const giveTreat = useCallback(async (companionId: string): Promise<GiveTreatResult> => {
    if (!ready) return { ok: false, reason: 'not_ready' };
    if (isOwnPet(companionId)) return { ok: false, reason: 'own_pet' };
    const serverId = backendCompanionId(companionId);
    if (!serverId) return { ok: false, reason: 'unknown_pet' };

    const now = Date.now();
    if (now - lastGiveAt.current < GIVE_DEBOUNCE_MS) return { ok: false, reason: 'debounce' };
    if (wallet.remaining <= 0) return { ok: false, reason: 'empty' };
    lastGiveAt.current = now;

    try {
      const response = await apiRequest<{
        treat: { id: string; companionId: string; giverUserId: string; createdAt: string };
        remaining: number;
        companionTreatCount: number;
        ownerId: string;
      }>(`/companions/${serverId}/treats`, {
        method: 'POST',
        headers: { 'idempotency-key': clientIdempotencyKey('treat') },
      });
      setWallet(current => ({
        ...current,
        used: current.monthlyAllowance - response.remaining,
        remaining: response.remaining,
      }));
      setCompanionTotals(current => ({ ...current, [companionId]: response.companionTreatCount }));
      const gift: TreatGift = {
        id: response.treat.id,
        fromUserId: accountId ?? 'you',
        companionId,
        ownerId: companions[companionId]?.ownerId ?? response.ownerId,
        amount: 1,
        at: response.treat.createdAt,
      };
      setGifts(current => [gift, ...current.filter(item => item.id !== gift.id)]);
      if (gift.ownerId === 'you' || gift.ownerId === accountId) {
        setOwnerReceived(current => current + 1);
      }
      showGiftBanner(companionId, gift.ownerId);
      return { ok: true, remaining: response.remaining, ownerId: gift.ownerId };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TREAT_WALLET_EMPTY') {
        setWallet(current => ({ ...current, remaining: 0, used: current.monthlyAllowance }));
        return { ok: false, reason: 'empty' };
      }
      if (error instanceof ApiError && error.code === 'COMPANION_TREAT_FORBIDDEN') {
        return { ok: false, reason: 'own_pet' };
      }
      return { ok: false, reason: 'unknown_pet' };
    }
  }, [accountId, isOwnPet, ready, showGiftBanner, wallet.remaining]);

  const resetAt = new Date(wallet.resetsAt).getTime();
  const daysUntilReset = Math.max(0, Math.ceil((resetAt - Date.now()) / 86_400_000));

  const value = useMemo<TreatWalletContextValue>(() => ({
    ready,
    remaining: wallet.remaining,
    daysUntilReset,
    showTreatsOnProfile: settings.showTreatsOnProfile,
    setShowTreatsOnProfile,
    canGive,
    isOwnPet,
    giveTreat,
    ensureCompanionTreats,
    getOwnerReceivedTreats,
    getCompanionReceivedTreats,
    getRecentGifts,
    getRecentGiftsForOwner,
    lastGiftBanner,
    clearGiftBanner,
  }), [
    ready, wallet.remaining, daysUntilReset, settings.showTreatsOnProfile,
    setShowTreatsOnProfile, canGive, isOwnPet, giveTreat, ensureCompanionTreats,
    getOwnerReceivedTreats, getCompanionReceivedTreats, getRecentGifts,
    getRecentGiftsForOwner, lastGiftBanner, clearGiftBanner,
  ]);

  return (
    <TreatWalletContext.Provider value={value}>
      {children}
    </TreatWalletContext.Provider>
  );
}

export function useTreatWallet() {
  const ctx = useContext(TreatWalletContext);
  if (!ctx) throw new Error('useTreatWallet must be used within TreatWalletProvider');
  return ctx;
}
