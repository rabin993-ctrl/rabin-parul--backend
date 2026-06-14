import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { RescueOpenCaseFlowProvider } from '../context/RescueOpenCaseFlowContext';
import { RescueOpenCaseForm, type RescueOpenCaseDraft } from '../components/rescue/RescueOpenCaseForm';
import { RescueCaseDetailScreen } from '../screens/profile/RescueCaseDetailScreen';
import { RescuePostUpdateScreen } from '../screens/rescue/RescuePostUpdateScreen';
import { Sheet } from '../components/ui/Sheet';
import { Button } from '../components/ui/Button';
import { useRescueFeed } from '../context/RescueFeedContext';
import type { RescueStackParamList } from './RescueNavigator';

const Stack = createNativeStackNavigator<RescueStackParamList>();

function OpenCaseSheet({
  visible,
  onClose,
  onPublished,
}: {
  visible: boolean;
  onClose: () => void;
  onPublished: (caseId: string) => void;
}) {
  const { addCase } = useRescueFeed();
  const [canPublish, setCanPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const publishRef = useRef<(() => RescueOpenCaseDraft | null) | null>(null);

  const publish = useCallback(async () => {
    const draft = publishRef.current?.();
    if (!draft) return;
    setPublishing(true);
    try {
      const item = await addCase(draft);
      onPublished(item.id);
    } finally {
      setPublishing(false);
    }
  }, [addCase, onPublished]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Open a case"
      maxHeight={Platform.OS === 'web' ? 680 : undefined}
      footer={(
        <Button full disabled={!canPublish || publishing} onPress={() => void publish()} icon="shield">
          {publishing ? 'Opening…' : 'Open case'}
        </Button>
      )}
    >
      <View style={styles.sheetBody}>
        <RescueOpenCaseForm
          onCanPublishChange={setCanPublish}
          publishRef={publishRef}
        />
      </View>
    </Sheet>
  );
}

function DetailFlow({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { colors } = useTheme();

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.detailRoot, { backgroundColor: colors.bg }]}>
        <RescueOpenCaseFlowProvider close={onClose}>
          <NavigationIndependentTree>
            <NavigationContainer>
              <Stack.Navigator
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg, flex: 1 },
                  animation: 'slide_from_right',
                }}
                initialRouteName="Detail"
              >
                <Stack.Screen name="Detail" initialParams={{ caseId }} component={RescueCaseDetailScreen} />
                <Stack.Screen name="PostUpdate" component={RescuePostUpdateScreen} />
              </Stack.Navigator>
            </NavigationContainer>
          </NavigationIndependentTree>
        </RescueOpenCaseFlowProvider>
      </View>
    </Modal>
  );
}

export function RescueOpenCaseModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [caseId, setCaseId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) setCaseId(null);
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <OpenCaseSheet
        visible={!caseId}
        onClose={onClose}
        onPublished={setCaseId}
      />
      {caseId ? <DetailFlow caseId={caseId} onClose={onClose} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  detailRoot: { flex: 1 },
  sheetBody: { paddingHorizontal: 18 },
});
