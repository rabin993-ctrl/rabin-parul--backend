import React, { useState } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MockMediaTile } from '../../components/ui/MockMediaTile';
import { useTheme } from '../../theme/ThemeContext';
import { radius, typography } from '../../theme/tokens';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/icons/Icon';
import { Toast, ToastData } from '../../components/ui/Toast';
import { PawCircleSubHeader } from '../pawCircles/PawCircleViews';
import { useRescueFeed } from '../../context/RescueFeedContext';
import { useRescueOpenCaseBack } from '../../context/RescueOpenCaseFlowContext';
import { getRescueCaseById } from '../../data/rescueData';
import { RESCUE_STATUS_META, formatRescueUpdateTime } from '../../data/profileData';
import type { RescueStackParamList } from '../../navigation/RescueNavigator';
import {
  pickAndUploadImages,
  pickAndUploadVideo,
  type UploadedMedia,
} from '../../api/media';

type Nav = NativeStackNavigationProp<RescueStackParamList, 'PostUpdate'>;

const MAX_PHOTOS = 3;

export function RescuePostUpdateScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const handleBack = useRescueOpenCaseBack(navigation);
  const route = useRoute();
  const { caseId } = route.params as { caseId: string };
  const { cases, addUpdate } = useRescueFeed();
  const item = cases.find(c => c.id === caseId) ?? getRescueCaseById(caseId);

  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<UploadedMedia[]>([]);
  const [video, setVideo] = useState<UploadedMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  if (!item) return null;

  const statusMeta = RESCUE_STATUS_META[item.status];
  const autoDate = formatRescueUpdateTime();
  const photoCount = photos.length;
  const canSubmit = photoCount > 0;

  const publish = async () => {
    if (!canSubmit) return;
    setPublishing(true);
    try {
      await addUpdate(caseId, {
        text: text.trim() || 'Case update posted.',
        assetIds: [...photos.map(photo => photo.assetId), ...(video ? [video.assetId] : [])],
      });
      setToast({ msg: `Update posted for ${item.name}`, icon: 'paw', tone: 'success' });
      setTimeout(() => navigation.goBack(), 480);
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Could not post update', icon: 'alert', tone: 'danger' });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <PawCircleSubHeader title="Post update" onBack={handleBack} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.eyebrow, { color: colors.textTertiary }]}>
          {item.name} · {statusMeta.shortLabel}
        </Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Share how {item.name} is doing — photos help followers follow the rescue.
        </Text>

        <Text style={[styles.autoDate, { color: colors.textTertiary }]}>
          {autoDate}
        </Text>

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          PHOTOS · REQUIRED · UP TO {MAX_PHOTOS}
        </Text>
        <View style={styles.photoRow}>
          {[0, 1, 2].map(i => {
            const photo = photos[i];
            return (
            <MockMediaTile
              key={i}
              imageKey={`${caseId}-update-${i}`}
              imageIndex={i}
              filled={Boolean(photo)}
              uri={photo?.localUri}
              icon="image"
              label={photo ? `Photo ${i + 1}` : uploading ? 'Uploading…' : i === 0 ? 'Add photo' : 'Add'}
              onPress={() => {
                if (photo) {
                  setPhotos(previous => previous.filter((_, index) => index !== i));
                  return;
                }
                if (uploading || photos.length >= MAX_PHOTOS) return;
                setUploading(true);
                void pickAndUploadImages({ purpose: 'rescue_update', selectionLimit: MAX_PHOTOS - photos.length })
                  .then(uploaded => setPhotos(previous => [...previous, ...uploaded].slice(0, MAX_PHOTOS)))
                  .catch(error => setToast({ msg: error instanceof Error ? error.message : 'Photo upload failed', icon: 'alert', tone: 'danger' }))
                  .finally(() => setUploading(false));
              }}
              size="square"
            />
            );
          })}
        </View>
        {!canSubmit && (
          <Text style={[styles.note, { color: colors.warning }]}>
            Add at least one photo to post this update.
          </Text>
        )}

        <Text style={[styles.label, { color: colors.textSecondary }]}>VIDEO · OPTIONAL</Text>
        <MockMediaTile
          imageKey={`${caseId}-video`}
          filled={Boolean(video)}
          uri={video?.localUri}
          icon="play-square"
          label={video ? 'Video added' : uploading ? 'Uploading…' : 'Add a short clip'}
          onPress={() => {
            if (video) {
              setVideo(null);
              return;
            }
            if (uploading) return;
            setUploading(true);
            void pickAndUploadVideo('rescue_update')
              .then(setVideo)
              .catch(error => setToast({ msg: error instanceof Error ? error.message : 'Video upload failed', icon: 'alert', tone: 'danger' }))
              .finally(() => setUploading(false));
          }}
          size="wide"
          showPlay
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>UPDATE · OPTIONAL</Text>
        <TextInput
          style={[styles.input, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
          placeholder="Vet visit, appetite, mood, next steps..."
          placeholderTextColor={colors.textTertiary}
          value={text}
          onChangeText={setText}
          multiline
          textAlignVertical="top"
        />

        <Button onPress={() => void publish()} disabled={!canSubmit || publishing || uploading} style={{ marginTop: 8 }}>
          {publishing ? 'Sharing…' : 'Share update'}
        </Button>
      </ScrollView>

      <Toast data={toast} onHide={() => setToast(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, gap: 10, paddingBottom: 40 },
  eyebrow: { ...typography.sectionLabel, fontSize: 10 },
  hint: { ...typography.small, lineHeight: 18 },
  autoDate: { fontSize: 13, fontWeight: '600' },
  label: { ...typography.sectionLabel, fontSize: 10, marginTop: 4 },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoTile: { flex: 1, minWidth: 0, aspectRatio: 1 },
  photoTileInner: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
  },
  videoTile: { width: '100%', height: 112 },
  videoTileInner: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 12,
  },
  tileLabel: { ...typography.caption, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  filledBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { ...typography.meta, fontSize: 11, lineHeight: 16 },
  input: {
    minHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
  },
});
