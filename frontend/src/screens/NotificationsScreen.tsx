import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/tokens';
import { Badge } from '../components/ui/Badge';
import { IconButton } from '../components/ui/Button';
import { Empty } from '../components/ui/Empty';
import { Segmented } from '../components/ui/Segmented';
import { Icon } from '../components/icons/Icon';
import { useTabBarScrollPadding } from '../navigation/tabBarInsets';
import { apiRequest } from '../api/client';

type NotifFilter = 'all' | 'unread' | 'circles' | 'posts' | 'adoption';

type ServerNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};

const FILTER_OPTIONS: { id: NotifFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'adoption', label: 'Adoption' },
  { id: 'circles', label: 'Circles' },
  { id: 'posts', label: 'Posts' },
];

function tone(type: string): { icon: string; color: string } {
  if (type.includes('adoption')) return { icon: 'adoption', color: '#F2972E' };
  if (type.includes('circle') || type.includes('community')) return { icon: 'circles', color: '#14A697' };
  if (type.includes('comment')) return { icon: 'comment', color: '#6b7bef' };
  if (type.includes('reaction') || type.includes('like')) return { icon: 'heart', color: '#e85d7d' };
  if (type.includes('rescue')) return { icon: 'shield', color: '#E5424F' };
  if (type.includes('lost') || type.includes('found')) return { icon: 'alert', color: '#ef4444' };
  if (type.includes('message')) return { icon: 'comment', color: '#7C5CBF' };
  return { icon: 'bell', color: '#7A6A56' };
}

function inFilter(notification: ServerNotification, filter: NotifFilter) {
  const type = notification.type.toLowerCase();
  if (filter === 'unread') return !notification.readAt;
  if (filter === 'adoption') return type.includes('adoption');
  if (filter === 'circles') return type.includes('circle') || type.includes('community');
  if (filter === 'posts') return ['post', 'comment', 'reaction', 'like', 'mention'].some(value => type.includes(value));
  return true;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function NotificationsScreen() {
  const { colors } = useTheme();
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [filter, setFilter] = useState<NotifFilter>('all');
  const [loading, setLoading] = useState(true);
  const tabBarPad = useTabBarScrollPadding();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest<{ notifications: ServerNotification[] }>('/notifications');
      setNotifications(response.notifications);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => notifications.filter(notification => inFilter(notification, filter)),
    [filter, notifications],
  );
  const unreadCount = notifications.filter(notification => !notification.readAt).length;

  const markRead = useCallback((id: string) => {
    const now = new Date().toISOString();
    setNotifications(previous => previous.map(item => item.id === id ? { ...item, readAt: now } : item));
    void apiRequest(`/notifications/${id}/read`, { method: 'POST' }).catch(() => void load());
  }, [load]);

  const dismiss = useCallback((id: string) => {
    setNotifications(previous => previous.filter(item => item.id !== id));
    void apiRequest(`/notifications/${id}/dismiss`, { method: 'POST' }).catch(() => void load());
  }, [load]);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications(previous => previous.map(item => ({ ...item, readAt: item.readAt ?? now })));
    void apiRequest('/notifications/read-all', { method: 'POST' }).catch(() => void load());
  }, [load]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>Notifications</Text>
          {unreadCount > 0 ? <Badge tone="primary">{unreadCount}</Badge> : null}
        </View>
        {unreadCount > 0 ? (
          <Pressable onPress={markAllRead} style={styles.markReadButton}>
            <Text style={[styles.markRead, { color: colors.primary }]}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filters}>
        <Segmented
          options={FILTER_OPTIONS}
          value={filter}
          onChange={value => setFilter(value as NotifFilter)}
        />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarPad }]}
        showsVerticalScrollIndicator={false}
      >
        {!loading && filtered.length === 0 ? (
          <Empty icon="bell" title="All caught up" body="No notifications here." />
        ) : filtered.map(notification => {
          const unread = !notification.readAt;
          const visual = tone(notification.type.toLowerCase());
          return (
            <Pressable
              key={notification.id}
              onPress={() => markRead(notification.id)}
              style={[
                styles.card,
                {
                  backgroundColor: unread ? colors.primary + '10' : colors.surface,
                  borderColor: unread ? colors.primary + '28' : colors.border,
                },
              ]}
            >
              <View style={[styles.iconWrap, { backgroundColor: visual.color + '20' }]}>
                <Icon name={visual.icon} size={20} color={visual.color} />
              </View>
              <View style={styles.body}>
                <Text style={[styles.notificationTitle, { color: colors.text }]}>{notification.title}</Text>
                <Text style={[styles.notificationBody, { color: colors.textSecondary }]}>{notification.body}</Text>
                <Text style={[styles.time, { color: colors.textTertiary }]}>{formatTime(notification.createdAt)}</Text>
              </View>
              <IconButton name="close" size={32} tone="soft" onPress={() => dismiss(notification.id)} />
              {unread ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  markReadButton: { paddingHorizontal: 4, paddingVertical: 6 },
  markRead: { fontSize: 13.5, fontWeight: '600' },
  filters: { paddingHorizontal: 14, marginTop: 12, marginBottom: 4 },
  scroll: { padding: 14, gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  notificationTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  notificationBody: { fontSize: 13, lineHeight: 18 },
  time: { fontSize: 12 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0 },
});
