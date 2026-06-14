import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/icons/Icon';
import { HubToggleBar } from '../../components/ui/HubToggleBar';
import { Toast, ToastData } from '../../components/ui/Toast';
import { usePawCircles } from '../../context/PawCircleContext';
import { CirclePrivacy } from '../../data/pawCircles';
import type { CirclesStackParamList } from '../../navigation/CirclesNavigator';
import { useTabBarScrollPadding } from '../../navigation/tabBarInsets';
import { CircleHeroCard, EditCircleSheet } from './CircleHeroCard';
import {
  PawCircleHairline,
  PawCirclePageHeader,
  PawCircleSectionLabel,
  pawCircleStyles,
} from './PawCircleChrome';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

type Route = RouteProp<CirclesStackParamList, 'CircleAdmin'>;
type Nav = NativeStackNavigationProp<CirclesStackParamList, 'CircleAdmin'>;

const AVATAR_INSET = 68;

const PRIVACY_OPTIONS = [
  { id: 'open' as const, label: 'Open' },
  { id: 'request' as const, label: 'Request' },
];

type CircleMemberResource = {
  userId: string;
  role: string;
  joinedAt: string;
  displayName: string;
  handle: string | null;
};

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export function CircleAdminScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const { accountId } = useAuth();
  const route = useRoute<Route>();
  const { circleId } = route.params;
  const {
    getCircle,
    createdCircles,
    updateCircle,
    deleteCircle,
    removeMember,
    transferOwnership,
  } = usePawCircles();
  const circle = getCircle(circleId);
  const [name, setName] = useState(circle?.name ?? '');
  const [location, setLocation] = useState(circle?.location ?? '');
  const [privacy, setPrivacy] = useState<CirclePrivacy>(circle?.privacy ?? 'open');
  const [members, setMembers] = useState<CircleMemberResource[]>([]);
  const [transferMode, setTransferMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const tabBarPad = useTabBarScrollPadding();

  useEffect(() => {
    if (!circle) return;
    void apiRequest<{ members: CircleMemberResource[] }>(
      `/paw-circles/${circle.backendId ?? circle.id}/members`,
    ).then(response => setMembers(response.members))
      .catch(error => setToast({ msg: error instanceof Error ? error.message : 'Could not load members', icon: 'alert', tone: 'danger' }));
  }, [circle?.backendId, circle?.id]);

  const isOwner = createdCircles.some(c => c.id === circleId);

  if (!circle || !isOwner) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
        <PawCirclePageHeader title="Admin controls" />
        <Text style={{ padding: spacing.lg, color: colors.textSecondary }}>
          Admin access only for circle creators.
        </Text>
      </SafeAreaView>
    );
  }

  const displayBio = circle.bio ?? circle.tagline ?? '';
  const removableMembers = members.filter(m => m.userId !== accountId && m.role !== 'owner');

  const saveDetails = async () => {
    try {
      await updateCircle(circleId, {
        name,
        locationLabel: location,
        privacy,
      });
      setToast({ msg: 'Circle settings saved', icon: 'check', tone: 'success' });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Could not save settings', icon: 'alert', tone: 'danger' });
    }
  };

  const saveEdit = async (editName: string, bio: string) => {
    if (!editName.trim()) return;
    setSavingEdit(true);
    try {
      await updateCircle(circleId, { name: editName, bio });
      setName(editName);
      setEditOpen(false);
      setToast({ msg: 'Circle updated', icon: 'check', tone: 'success' });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Could not update circle', icon: 'alert', tone: 'danger' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteCircle(circleId);
      navigation.navigate('Hub');
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Could not delete circle', icon: 'alert', tone: 'danger' });
    }
  };

  return (
    <>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
        <PawCirclePageHeader title="Admin controls" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[pawCircleStyles.detailScroll, { paddingBottom: tabBarPad }]}
        >
          <CircleHeroCard
            circle={circle}
            bio={displayBio}
            role="You created this circle"
            canEdit
            onEdit={() => setEditOpen(true)}
          />

          <View>
            <PawCircleSectionLabel>Circle details</PawCircleSectionLabel>
            <View style={styles.formGroup}>
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.textTertiary }]}>Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  style={[styles.fieldInput, { color: colors.text, borderBottomColor: colors.border }]}
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <PawCircleHairline />
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.textTertiary }]}>Location</Text>
                <TextInput
                  value={location}
                  onChangeText={setLocation}
                  style={[styles.fieldInput, { color: colors.text, borderBottomColor: colors.border }]}
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <PawCircleHairline />
              <View style={styles.privacyField}>
                <Text style={[styles.fieldLabel, { color: colors.textTertiary }]}>Privacy</Text>
                <HubToggleBar
                  items={PRIVACY_OPTIONS}
                  value={privacy}
                  onChange={id => setPrivacy(id as CirclePrivacy)}
                  bordered={false}
                  style={styles.privacyToggle}
                />
              </View>
            </View>
            <Button variant="primary" full onPress={() => void saveDetails()} style={styles.saveBtn}>
              Save changes
            </Button>
          </View>

          {removableMembers.length > 0 && (
            <View>
              <PawCircleSectionLabel>Remove members</PawCircleSectionLabel>
              <View style={styles.listGroup}>
                {removableMembers.map((m, index) => {
                  const u = {
                    id: m.userId,
                    name: m.displayName,
                    handle: m.handle ?? 'member',
                    tint: circle.tint,
                    loc: circle.location,
                    verified: false,
                  };
                  return (
                    <View key={m.userId}>
                      <View style={styles.memberRow}>
                        <Avatar user={u} size={36} />
                        <View style={styles.rowBody}>
                          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                            {u.name}
                          </Text>
                          <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                            @{u.handle}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            void removeMember(circleId, m.userId).then(() => {
                              setMembers(ms => ms.filter(x => x.userId !== m.userId));
                              setToast({ msg: `Removed ${u.name}`, icon: 'check', tone: 'neutral' });
                            }).catch(error => setToast({ msg: error instanceof Error ? error.message : 'Could not remove member', icon: 'alert', tone: 'danger' }));
                          }}
                          style={({ pressed }) => [styles.removeBtn, pressed && styles.rowPressed]}
                        >
                          <Text style={[styles.removeBtnText, { color: colors.lost }]}>Remove</Text>
                        </Pressable>
                      </View>
                      {index < removableMembers.length - 1 && (
                        <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <SettingsGroup>
            <Pressable
              onPress={() => setTransferMode(value => !value)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Icon name="circles" size={22} color={colors.textSecondary} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>Transfer ownership</Text>
              <Icon name="chevronRight" size={16} color={colors.textTertiary} />
            </Pressable>
          </SettingsGroup>
          {transferMode && (
            <SettingsGroup>
              <Text style={[styles.fieldLabel, { color: colors.textTertiary }]}>
                Choose a member to receive the ownership request
              </Text>
              {removableMembers.map(member => (
                <Pressable
                  key={member.userId}
                  onPress={() => {
                    void transferOwnership(circleId, member.userId).then(() => {
                      setTransferMode(false);
                      setToast({ msg: `Ownership request sent to ${member.displayName}`, icon: 'check', tone: 'success' });
                    }).catch(error => setToast({ msg: error instanceof Error ? error.message : 'Could not transfer ownership', icon: 'alert', tone: 'danger' }));
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <Text style={[styles.rowLabel, { color: colors.text }]}>{member.displayName}</Text>
                  <Text style={{ color: colors.textTertiary }}>@{member.handle ?? 'member'}</Text>
                </Pressable>
              ))}
            </SettingsGroup>
          )}

          <SettingsGroup>
            <Pressable
              onPress={() => void handleDelete()}
              style={({ pressed }) => [styles.destructiveRow, pressed && styles.rowPressed]}
            >
              <Text style={[styles.destructiveLabel, { color: colors.lost }]}>
                {confirmDelete ? 'Tap again to delete circle permanently' : 'Delete circle'}
              </Text>
            </Pressable>
          </SettingsGroup>
        </ScrollView>
      </SafeAreaView>

      <EditCircleSheet
        visible={editOpen}
        circle={circle}
        onClose={() => setEditOpen(false)}
        onSave={saveEdit}
        saving={savingEdit}
      />

      <Toast data={toast} onHide={() => setToast(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  group: { gap: 0 },
  listGroup: { gap: 0 },
  formGroup: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  field: { gap: 8 },
  privacyField: { gap: 10, paddingTop: 4 },
  privacyToggle: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  fieldInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
    paddingVertical: 11,
    fontSize: 16,
    fontWeight: '500',
  },
  saveBtn: { marginTop: 12 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    minHeight: 60,
  },
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  rowName: { fontSize: 16, fontWeight: '500', letterSpacing: -0.2 },
  rowMeta: { fontSize: 13 },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: AVATAR_INSET,
  },
  rowPressed: { opacity: 0.55 },
  removeBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  removeBtnText: { fontSize: 14, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    minHeight: 52,
    ...Platform.select({
      web: { cursor: 'pointer' as const },
      default: {},
    }),
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: -0.2,
  },
  destructiveRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    minHeight: 52,
    ...Platform.select({
      web: { cursor: 'pointer' as const },
      default: {},
    }),
  },
  destructiveLabel: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
