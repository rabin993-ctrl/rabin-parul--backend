import { useMemo } from 'react';
import { companions } from '../data/mockData';
import {
  getProfileTrust,
  getRescuesForUser,
  getProfileImpactStats,
} from '../data/profileData';
import {
  filterIncomingAdopted,
  filterOutgoingAdoptions,
  getAdopterTrustSummary,
} from '../data/adoptionRecords';
import { useAdoption } from '../context/AdoptionContext';
import { useFeedPosts } from '../context/FeedPostContext';
import { useRescueFeedOptional } from '../context/RescueFeedContext';

/** Shared profile feed data for own profile (ProfileHome) and public profile (UserProfile). */
export function useProfileViewData(userId: string) {
  const { records } = useAdoption();
  const { posts: feedPosts } = useFeedPosts();
  const rescueFeed = useRescueFeedOptional();

  const companionIds = useMemo(
    () => new Set(
      Object.values(companions)
        .filter(c => c.ownerId === userId)
        .map(c => c.id),
    ),
    [userId],
  );

  const userCompanions = useMemo(
    () => Object.values(companions).filter(c => c.ownerId === userId),
    [userId],
  );

  const posts = useMemo(
    () => feedPosts.filter(p => {
      const isOwner =
        p.userId === userId ||
        (p.companionAuthorId != null && companionIds.has(p.companionAuthorId));
      return isOwner && !p.circle;
    }),
    [feedPosts, userId, companionIds],
  );

  const rescues = useMemo(() => {
    if (!rescueFeed) return getRescuesForUser(userId);
    if (userId === 'you') return rescueFeed.cases.filter(item => item.isOwner);
    return rescueFeed.cases.filter(item => item.userId === userId);
  }, [rescueFeed, userId]);
  const outgoingAdoptions = useMemo(
    () => filterOutgoingAdoptions(records, userId),
    [records, userId],
  );
  const incomingAdopted = useMemo(
    () => filterIncomingAdopted(records, userId),
    [records, userId],
  );
  const impactStats = useMemo(() => ({
    ...getProfileImpactStats(userId, records),
    rescues: rescues.length,
  }), [userId, records, rescues.length]);
  const trust = useMemo(() => getProfileTrust(userId), [userId]);
  const adopterTrust = useMemo(
    () => getAdopterTrustSummary(records, userId),
    [records, userId],
  );

  return {
    posts,
    rescues,
    outgoingAdoptions,
    incomingAdopted,
    impactStats,
    trust,
    adopterTrust,
    userCompanions,
  };
}
