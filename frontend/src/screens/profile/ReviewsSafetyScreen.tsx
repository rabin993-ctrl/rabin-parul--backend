import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/tokens';
import { Card } from '../../components/ui/Card';
import { Stars } from '../../components/ui/Stars';
import { Empty } from '../../components/ui/Empty';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Avatar } from '../../components/ui/Avatar';
import { ProfileSubHeader, ProfileTrustBadge } from '../../components/profile/ProfileChrome';
import type { ProfileTrust } from '../../data/profileData';
import { useTabBarScrollPadding } from '../../navigation/tabBarInsets';
import { useTabBarScrollProps } from '../../context/TabBarScrollContext';
import { Icon } from '../../components/icons/Icon';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

type ReviewResource = {
  review: {
    id: string;
    rating: number;
    text: string | null;
    createdAt: string;
  };
  reviewerName: string;
  reviewerHandle: string | null;
};

function relativeTime(value: string): string {
  const days = Math.floor(Math.max(0, Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export function ReviewsSafetyScreen() {
  const { colors } = useTheme();
  const { accountId } = useAuth();
  const tabBarPad = useTabBarScrollPadding();
  const tabBarScrollProps = useTabBarScrollProps();
  const [reviews, setReviews] = useState<ReviewResource[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    apiRequest<{ reviews: ReviewResource[] }>(`/users/${accountId}/reviews`)
      .then(response => {
        setReviews(response.reviews);
        setLoadError(null);
      })
      .catch(error => {
        setLoadError(error instanceof Error ? error.message : 'Could not load reviews.');
      });
  }, [accountId]);

  const trust = useMemo<ProfileTrust>(() => {
    const rating = reviews.length
      ? reviews.reduce((sum, item) => sum + item.review.rating, 0) / reviews.length
      : 0;
    return {
      rating,
      reviewCount: reviews.length,
      flagCount: 0,
      status: reviews.length === 0 || rating >= 4.5
        ? 'trusted'
        : rating >= 3.5
          ? 'good'
          : rating >= 2.5
            ? 'warning'
            : 'flagged',
    };
  }, [reviews]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <ProfileSubHeader title="Reviews & Safety" rightIcon="shield" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarPad }]}
        showsVerticalScrollIndicator={false}
        {...tabBarScrollProps}
      >
        <Card>
          <View style={styles.trustRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.trustTitle, { color: colors.text }]}>Profile reputation</Text>
              <ProfileTrustBadge trust={trust} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={[styles.ratingBig, { color: colors.text }]}>
                {trust.reviewCount ? trust.rating.toFixed(1) : '—'}
              </Text>
              <Stars value={trust.rating} size={14} />
              <Text style={[styles.ratingCount, { color: colors.textSecondary }]}>{trust.reviewCount} reviews</Text>
            </View>
          </View>
        </Card>

        {trust.status === 'warning' || trust.status === 'flagged' ? (
          <AlertBanner
            tone="warning"
            icon="flag"
            title="Profile under review"
            body="Multiple reports were received. Please respond to open cases to restore full visibility."
          />
        ) : (
          <View style={[styles.safetyNote, { backgroundColor: colors.successBg, borderColor: colors.success + '30' }]}>
            <Icon name="shield" size={18} color={colors.success} />
            <Text style={[styles.safetyText, { color: colors.text }]}>
              Your profile meets community safety standards. Keep fostering trust with honest updates.
            </Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>COMMUNITY REVIEWS</Text>

        {loadError ? (
          <Empty icon="alert" title="Could not load reviews" body={loadError} />
        ) : reviews.length === 0 ? (
          <Empty icon="star" title="No reviews yet" body="Reviews from adoptions and fosters will appear here." />
        ) : (
          <View style={{ gap: 10 }}>
            {reviews.map(r => {
              const user = {
                id: r.review.id,
                name: r.reviewerName,
                handle: r.reviewerHandle ?? 'parul-user',
                tint: '#7C5CBF',
                loc: 'Parul community',
                location: 'Parul community',
                verified: false,
              };
              return (
                <Card key={r.review.id} padding={12}>
                  <View style={styles.reviewHead}>
                    <Avatar user={user} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.reviewer, { color: colors.text }]}>{r.reviewerName}</Text>
                      <Stars value={r.review.rating} size={12} />
                    </View>
                    <Text style={[styles.reviewTime, { color: colors.textTertiary }]}>
                      {relativeTime(r.review.createdAt)}
                    </Text>
                  </View>
                  <Text style={[styles.reviewBody, { color: colors.textSecondary }]}>
                    {r.review.text || 'No written review.'}
                  </Text>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12, paddingTop: 4 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  trustTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  ratingBig: { fontSize: 32, fontWeight: '900' },
  ratingCount: { fontSize: 12, marginTop: 4 },
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  safetyText: { flex: 1, fontSize: 13.5, lineHeight: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  reviewer: { fontSize: 14, fontWeight: '700' },
  reviewTime: { fontSize: 12 },
  reviewBody: { fontSize: 13.5, lineHeight: 20 },
});
