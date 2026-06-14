import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Empty } from '../../components/ui/Empty';
import { ProfileSubHeader } from '../../components/profile/ProfileChrome';
import { useTabBarScrollProps } from '../../context/TabBarScrollContext';
import { useTabBarScrollPadding } from '../../navigation/tabBarInsets';
import { useTheme } from '../../theme/ThemeContext';

type ActivityComment = {
  comment: {
    id: string;
    body: string;
    createdAt: string;
  };
  postBody: string | null;
};

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ProfileActivityScreen() {
  const { colors } = useTheme();
  const tabBarPad = useTabBarScrollPadding();
  const tabBarScrollProps = useTabBarScrollProps();
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ comments: ActivityComment[] }>('/me/activity/comments')
      .then(response => {
        setComments(response.comments);
        setLoadError(null);
      })
      .catch(error => {
        setLoadError(error instanceof Error ? error.message : 'Could not load activity.');
      });
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <ProfileSubHeader title="Activity" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarPad }]}
        showsVerticalScrollIndicator={false}
        {...tabBarScrollProps}
      >
        {loadError ? (
          <Empty icon="alert" title="Could not load activity" body={loadError} />
        ) : comments.length === 0 ? (
          <Empty
            icon="comment"
            title="No comments yet"
            body="Comments you leave on feed posts will show up here."
          />
        ) : (
          comments.map(item => (
            <Card key={item.comment.id} padding={14}>
              <View style={styles.metaRow}>
                <Text style={[styles.label, { color: colors.primary }]}>YOUR COMMENT</Text>
                <Text style={[styles.time, { color: colors.textTertiary }]}>
                  {relativeTime(item.comment.createdAt)}
                </Text>
              </View>
              <Text style={[styles.comment, { color: colors.text }]}>{item.comment.body}</Text>
              {item.postBody ? (
                <View style={[styles.postContext, { backgroundColor: colors.surface2 }]}>
                  <Text style={[styles.postLabel, { color: colors.textTertiary }]}>On post</Text>
                  <Text style={[styles.postBody, { color: colors.textSecondary }]} numberOfLines={3}>
                    {item.postBody}
                  </Text>
                </View>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  time: { fontSize: 12 },
  comment: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  postContext: { marginTop: 12, padding: 10, borderRadius: 10, gap: 3 },
  postLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  postBody: { fontSize: 12.5, lineHeight: 18 },
});
