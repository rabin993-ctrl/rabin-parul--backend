import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import type { FeedPostResource } from '../api/types';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { companions, posts as seedPosts, Post, users } from '../data/mockData';
import { countFeedThreadComments } from '../utils/postComments';
import { PostComposer, PostComposerOptions } from '../components/feed/PostComposer';
import { RescueOpenCaseModal } from '../navigation/RescueOpenCaseModal';
import { Toast, ToastData } from '../components/ui/Toast';

export type { PostComposerOptions };

type FeedPostContextValue = {
  posts: Post[];
  setPosts: React.Dispatch<React.SetStateAction<Post[]>>;
  ready: boolean;
  syncError: string | null;
  savedPosts: Post[];
  toggleReaction: (postId: string) => boolean;
  toggleSaved: (postId: string) => boolean;
  addPost: (post: Post) => void;
  addComment: (
    postId: string,
    text: string,
    opts?: { userId?: string; replyToThreadIndex?: number },
  ) => void;
  getPostsForCompanion: (companionId: string) => Post[];
  getCompanionPostCount: (companionId: string, baseCount?: number) => number;
  reloadFeed: () => Promise<void>;
  composerOpen: boolean;
  composerOptions: PostComposerOptions;
  openComposer: (options?: PostComposerOptions) => void;
  closeComposer: () => void;
  caseFlowOpen: boolean;
  openCaseFlow: () => void;
  closeCaseFlow: () => void;
};

const FeedPostContext = createContext<FeedPostContextValue | null>(null);
const EMPTY_OPTIONS: PostComposerOptions = {};

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function localCompanionId(serverId: string, name = 'Companion'): string {
  const existing = Object.values(companions).find(item => item.backendId === serverId);
  if (existing) return existing.id;
  companions[serverId] = {
    id: serverId,
    backendId: serverId,
    name,
    species: 'pet',
    icon: 'paw',
    breed: '—',
    age: '—',
    gender: '—',
    owner: 'Parul member',
    ownerId: '',
    tint: '#7C5CBF',
    traits: [],
    vaccinated: false,
    neutered: false,
    microchipped: false,
    about: '',
    followers: 0,
    pawprints: 0,
    treats: 0,
    postsCount: 0,
    siblings: [],
    online: true,
    verified: false,
  };
  return serverId;
}

function postFromResource(resource: FeedPostResource, accountId: string | null): Post {
  const isMe = resource.displayAuthor.type === 'user' && resource.displayAuthor.id === accountId;
  let authorId = isMe ? 'you' : resource.displayAuthor.id;
  let companionAuthorId: string | undefined;

  if (resource.displayAuthor.type === 'user') {
    if (!isMe && !users[authorId]) {
      users[authorId] = {
        id: authorId,
        name: resource.displayAuthor.name,
        handle: resource.displayAuthor.handle ?? 'parul-user',
        tint: '#7C5CBF',
        loc: 'Parul community',
        location: 'Parul community',
        verified: false,
      };
    }
  } else {
    companionAuthorId = localCompanionId(resource.displayAuthor.id, resource.displayAuthor.name);
    authorId = 'you';
  }

  const category = resource.category;
  return {
    id: resource.id,
    backendId: resource.id,
    author: authorId,
    userId: authorId,
    companionAuthorId,
    companions: resource.companions.map(item => localCompanionId(item.id, item.name)),
    time: relativeTime(resource.createdAt),
    loc: '',
    circle: false,
    text: resource.body ?? '',
    images: resource.media.length,
    assetIds: resource.media.map(item => item.assetId),
    imageUris: resource.media.flatMap(item => item.url ? [item.url] : []),
    label: category,
    tag: category === 'adoption'
      ? 'adoption'
      : category === 'rescue'
        ? 'rescue'
        : category === 'lost' || category === 'found'
          ? 'lost-found'
          : resource.presentationMode === 'companion'
            ? 'paw-posting'
            : 'discussion',
    paws: resource.counts.reactions,
    reacted: resource.viewer.reaction != null,
    comments: resource.counts.comments,
    forwards: 0,
    saved: resource.viewer.saved,
    threads: [],
  };
}

function serverId(post: Post): string | null {
  const id = post.backendId ?? post.id;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export function FeedPostProvider({ children }: { children: React.ReactNode }) {
  const { accountId } = useAuth();
  const [posts, setPosts] = useState<Post[]>(seedPosts);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerOptions, setComposerOptions] = useState<PostComposerOptions>(EMPTY_OPTIONS);
  const [caseFlowOpen, setCaseFlowOpen] = useState(false);

  const reloadFeed = useCallback(async () => {
    try {
      const response = await apiRequest<{ posts: FeedPostResource[] }>('/feed?limit=50');
      setPosts(response.posts.map(item => postFromResource(item, accountId)));
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not load the feed.');
    } finally {
      setReady(true);
    }
  }, [accountId]);

  useEffect(() => {
    void reloadFeed();
  }, [reloadFeed]);

  const savedPosts = useMemo(() => posts.filter(post => post.saved), [posts]);

  const toggleReaction = useCallback((postId: string) => {
    const current = posts.find(post => post.id === postId);
    if (!current) return false;
    const nowReacted = !current.reacted;
    setPosts(previous => previous.map(post => post.id === postId
      ? {
        ...post,
        reacted: nowReacted,
        paws: Math.max(0, post.paws + (nowReacted ? 1 : -1)),
      }
      : post));
    const remoteId = serverId(current);
    if (remoteId) {
      void apiRequest(`/posts/${remoteId}/reaction`, {
        method: nowReacted ? 'PUT' : 'DELETE',
        ...(nowReacted && { body: { type: 'paw' } }),
      }).catch(() => {
        setPosts(previous => previous.map(post => post.id === postId
          ? {
            ...post,
            reacted: current.reacted,
            paws: current.paws,
          }
          : post));
      });
    }
    return nowReacted;
  }, [posts]);

  const toggleSaved = useCallback((postId: string) => {
    const current = posts.find(post => post.id === postId);
    if (!current) return false;
    const nowSaved = !current.saved;
    setPosts(previous => previous.map(post => (
      post.id === postId ? { ...post, saved: nowSaved } : post
    )));
    const remoteId = serverId(current);
    if (remoteId) {
      void apiRequest(`/posts/${remoteId}/save`, {
        method: nowSaved ? 'PUT' : 'DELETE',
      }).catch(() => {
        setPosts(previous => previous.map(post => (
          post.id === postId ? { ...post, saved: current.saved } : post
        )));
      });
    }
    return nowSaved;
  }, [posts]);

  const addPost = useCallback((post: Post) => {
    setPosts(previous => [post, ...previous]);
    const companionIds = post.companions
      .map(id => companions[id]?.backendId)
      .filter((id): id is string => Boolean(id));
    const authorCompanionId = post.companionAuthorId
      ? companions[post.companionAuthorId]?.backendId
      : undefined;

    void apiRequest<FeedPostResource>('/posts', {
      method: 'POST',
      body: {
        body: post.text,
        category: post.label,
        visibility: 'everyone',
        presentationMode: authorCompanionId ? 'companion' : 'user',
        authorCompanionId: authorCompanionId ?? null,
        companionIds,
        assetIds: post.assetIds ?? [],
        destinations: [{ type: 'feed' }],
      },
    }).then(resource => {
      const mapped = postFromResource(resource, accountId);
      setPosts(previous => previous.map(item => (
        item.id === post.id ? { ...mapped, id: post.id, backendId: resource.id } : item
      )));
      setSyncError(null);
    }).catch(error => {
      setPosts(previous => previous.filter(item => item.id !== post.id));
      setSyncError(error instanceof Error ? error.message : 'Could not publish the post.');
    });
  }, [accountId]);

  const addComment = useCallback((
    postId: string,
    text: string,
    opts?: { userId?: string; replyToThreadIndex?: number },
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = posts.find(post => post.id === postId);
    if (!current) return;
    const userId = opts?.userId ?? 'you';

    setPosts(previous => previous.map(post => {
      if (post.id !== postId) return post;
      const threads = opts?.replyToThreadIndex != null && opts.replyToThreadIndex >= 0
        ? post.threads.map((thread, index) => index === opts.replyToThreadIndex
          ? {
            ...thread,
            replies: [...thread.replies, { user: userId, text: trimmed, time: 'Just now' }],
          }
          : thread)
        : [
          ...post.threads,
          { user: userId, text: trimmed, time: 'Just now', replies: [] },
        ];
      return { ...post, threads, comments: countFeedThreadComments(threads) };
    }));

    const remoteId = serverId(current);
    if (remoteId) {
      void apiRequest(`/posts/${remoteId}/comments`, {
        method: 'POST',
        body: { body: trimmed },
      }).catch(error => {
        setSyncError(error instanceof Error ? error.message : 'Could not post the comment.');
        void reloadFeed();
      });
    }
  }, [posts, reloadFeed]);

  const getPostsForCompanion = useCallback(
    (companionId: string) => posts.filter(post => post.companions.includes(companionId)),
    [posts],
  );

  const getCompanionPostCount = useCallback(
    (companionId: string, baseCount = 0) => Math.max(
      baseCount,
      posts.filter(post => post.companions.includes(companionId)).length,
    ),
    [posts],
  );

  const openComposer = useCallback((options: PostComposerOptions = {}) => {
    setComposerOptions(options);
    setComposerOpen(true);
  }, []);
  const closeComposer = useCallback(() => {
    setComposerOpen(false);
    setComposerOptions(EMPTY_OPTIONS);
  }, []);
  const openCaseFlow = useCallback(() => setCaseFlowOpen(true), []);
  const closeCaseFlow = useCallback(() => setCaseFlowOpen(false), []);

  const value = useMemo<FeedPostContextValue>(() => ({
    posts,
    setPosts,
    ready,
    syncError,
    savedPosts,
    toggleReaction,
    toggleSaved,
    addPost,
    addComment,
    getPostsForCompanion,
    getCompanionPostCount,
    reloadFeed,
    composerOpen,
    composerOptions,
    openComposer,
    closeComposer,
    caseFlowOpen,
    openCaseFlow,
    closeCaseFlow,
  }), [
    posts, ready, syncError, savedPosts, toggleReaction, toggleSaved, addPost,
    addComment, getPostsForCompanion, getCompanionPostCount, reloadFeed,
    composerOpen, composerOptions, openComposer, closeComposer,
    caseFlowOpen, openCaseFlow, closeCaseFlow,
  ]);

  return <FeedPostContext.Provider value={value}>{children}</FeedPostContext.Provider>;
}

export function FeedPostOverlays() {
  const {
    composerOpen,
    composerOptions,
    closeComposer,
    addPost,
    caseFlowOpen,
    closeCaseFlow,
  } = useFeedPosts();
  const [toast, setToast] = useState<ToastData | null>(null);

  return (
    <>
      <PostComposer
        visible={composerOpen}
        options={composerOptions}
        onClose={closeComposer}
        onSubmit={addPost}
        onToast={setToast}
      />
      <RescueOpenCaseModal visible={caseFlowOpen} onClose={closeCaseFlow} />
      <Toast data={toast} onHide={() => setToast(null)} />
    </>
  );
}

export function useFeedPosts() {
  const context = useContext(FeedPostContext);
  if (!context) throw new Error('useFeedPosts must be used within FeedPostProvider');
  return context;
}
