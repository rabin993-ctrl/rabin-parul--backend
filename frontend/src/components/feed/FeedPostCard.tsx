import React, { useState } from 'react';
import { Image, View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/tokens';
import { PhotoSlot } from '../ui/PhotoSlot';
import { Icon } from '../icons/Icon';
import { PostAuthorRow } from './PostAuthorRow';
import { getPostPoster } from '../../utils/postAuthor';
import { type Post, type PostTag } from '../../data/mockData';
import { countFeedThreadComments } from '../../utils/postComments';

export function resolvePostTagKey(post: Post): PostTag {
  if (post.companionAuthorId || post.tag === 'paw-posting') return 'paw-posting';
  if (post.tag) return post.tag;
  if (post.label === 'adoption') return 'adoption';
  if (post.label === 'lost' || post.label === 'found') return 'lost-found';
  if (post.label === 'rescue') return 'rescue';
  return 'discussion';
}

function PostTagPill({ post }: { post: Post }) {
  const { postTag } = useTheme();
  const tag = postTag(resolvePostTagKey(post));
  return (
    <View style={[styles.postTag, { backgroundColor: tag.bg }]}>
      <Text style={[styles.postTagText, { color: tag.text }]}>{tag.label}</Text>
    </View>
  );
}

function ReactionBtn({ icon, count, active, activeColor, fill, onPress }: {
  icon: string; count: number; active?: boolean; activeColor: string; fill?: boolean; onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.reactionBtn}>
      <Icon name={icon} size={20} color={active ? activeColor : colors.textSecondary} fill={fill && active ? activeColor : 'none'} />
      {count > 0 && (
        <Text style={[styles.reactionCount, { color: active ? activeColor : colors.textSecondary }]}>
          {count}
        </Text>
      )}
    </Pressable>
  );
}

export function FeedPostCard({
  post,
  onPaw,
  onSave,
  onComments,
  onForward,
  onUserPress,
  onCompanionPress,
  compact,
}: {
  post: Post;
  onPaw: () => void;
  onSave: () => void;
  onComments: () => void;
  onForward: () => void;
  onUserPress?: (userId: string) => void;
  onCompanionPress?: (companionId: string) => void;
  /** Tighter padding for embedded profile lists */
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const commentCount = countFeedThreadComments(post.threads);
  const poster = getPostPoster(post);
  const mediaTint = poster.type === 'companion' ? poster.companion.tint : poster.user.tint;
  const [textExpanded, setTextExpanded] = useState(false);
  const [textTruncated, setTextTruncated] = useState(false);

  return (
    <View style={[styles.post, compact && styles.postCompact]}>
      <View style={styles.postHeader}>
        <PostAuthorRow
          post={post}
          size={44}
          onUserPress={onUserPress}
          onCompanionPress={onCompanionPress}
        />
      </View>

      <Text
        style={[styles.postText, { color: colors.text }]}
        numberOfLines={textExpanded ? undefined : 4}
        onTextLayout={e => {
          if (!textExpanded && !textTruncated && e.nativeEvent.lines.length >= 4)
            setTextTruncated(true);
        }}
      >
        {post.text}
      </Text>
      {!textExpanded && textTruncated && (
        <Pressable onPress={() => setTextExpanded(true)}>
          <Text style={[styles.moreLink, { color: colors.primary }]}>more</Text>
        </Pressable>
      )}

      <View style={styles.postTagRow}>
        <PostTagPill post={post} />
      </View>

      {post.images === 1 && (
        <View style={styles.postMedia}>
          {post.imageUris?.[0] ? (
            <Image
              source={{ uri: post.imageUris[0] }}
              style={{ width: '100%', height: 240, borderRadius: radius.lg }}
              resizeMode="cover"
            />
          ) : (
            <PhotoSlot height={240} imageKey={post.id} imageIndex={0} borderRadius={radius.lg} label="" />
          )}
        </View>
      )}
      {post.images === 2 && (
        <View style={[styles.imgGrid2, styles.postMedia]}>
          {[0, 1].map(index => post.imageUris?.[index] ? (
            <Image
              key={index}
              source={{ uri: post.imageUris[index] }}
              style={{ flex: 1, height: 160, borderRadius: radius.md }}
              resizeMode="cover"
            />
          ) : (
            <PhotoSlot
              key={index}
              height={160}
              imageKey={post.id}
              imageIndex={index}
              style={{ flex: 1 }}
              label=""
              borderRadius={radius.md}
            />
          ))}
        </View>
      )}

      <View style={styles.reactionBar}>
        <ReactionBtn
          icon={post.reacted ? 'paw' : 'paw-line'}
          count={post.paws}
          active={post.reacted}
          activeColor={colors.primary}
          fill={post.reacted}
          onPress={onPaw}
        />
        <ReactionBtn icon="comment" count={commentCount} activeColor={colors.accent} onPress={onComments} />
        <ReactionBtn icon="forward" count={post.forwards} activeColor={colors.accent} onPress={onForward} />
        <View style={{ flex: 1 }} />
        <ReactionBtn
          icon={post.saved ? 'bookmark' : 'bookmark-line'}
          count={0}
          active={post.saved}
          activeColor={colors.primary}
          fill={post.saved}
          onPress={onSave}
        />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  post: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  postCompact: { paddingHorizontal: 0, paddingTop: 12 },
  postHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingBottom: 0 },
  postText: { fontSize: 15.5, lineHeight: 23, paddingTop: 10, paddingBottom: 0 },
  moreLink: { fontSize: 14, fontWeight: '600', marginTop: 3 },
  postTagRow: { paddingTop: 8 },
  postTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  postTagText: { fontSize: 12, fontWeight: '700' },
  postMedia: { paddingTop: 12 },
  imgGrid2: { flexDirection: 'row', gap: 6 },
  reactionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 4,
    marginTop: 4,
  },
  reactionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingVertical: 6 },
  reactionCount: { fontSize: 13.5, fontWeight: '600' },
});
