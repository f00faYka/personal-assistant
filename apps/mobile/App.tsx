import { MemberListScreen } from "./src/list/MemberListScreen";
import { Pressable } from "react-native";
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from "expo-audio";
import { createCaptureSubmitter } from "./src/capture/voice-capture";
import { createExpoVoiceRecorder, readRecordedAudioAsBase64 } from "./src/capture/expo-voice-recorder";
import { ReviewScreen } from "./src/review/ReviewScreen";
import { createMetadataClient } from "./src/review/metadata";
import { createOrganizationProposalClient } from "./src/review/organization-proposals";
import { createSpacesClient } from "./src/spaces/spaces";
import { createReviewFixtureClient } from "./src/review/review";
import { createExpoOfflineDraftStore } from "./src/offline/expo-offline-drafts";
import { createOfflineDraftSyncClient } from "./src/offline/synchronize-offline-drafts";
import { useMemo, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppShell, CalendarSurface, FindSurface, MeSurface, type ShellTab } from "./src/AppShell";
import { SelectedDayTaskScreen } from "./src/day/SelectedDayTaskScreen";
import { TaskRow } from "./src/design-system";
import { createStaticMemberItemsClient, type MemberListItem } from "./src/list/member-items";
import { createBrowserFixtureData } from "./src/web/fixture-data";

export default function App() {
  const uiFixture = process.env.EXPO_PUBLIC_UI_FIXTURE === "true";
  const [detailUrl, setDetailUrl] = useState<string | null>(null);
  const [fixtureMode, setFixtureMode] = useState(process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" || process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "note");
  const [tab, setTab] = useState<ShellTab>("home");
  const [captureRequest, setCaptureRequest] = useState(0);
  const [showToday, setShowToday] = useState(false);
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 150);
  const offlineDraftStore = useMemo(() => createExpoOfflineDraftStore(), []);
  const offlineDraftSyncClient = useMemo(() => createOfflineDraftSyncClient(apiBaseUrl, { readBase64: readRecordedAudioAsBase64 }), [apiBaseUrl]);
  const memberId = process.env.EXPO_PUBLIC_MEMBER_ID ?? "member-1";
  const fixtureItems = uiFixture ? createStaticMemberItemsClient(createBrowserFixtureData().tasks.map((task, index) => fixtureTaskItem(task, index))) : undefined;
  const fixtureKind = process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" ? "task" : "note";
  const openCapture = () => { setTab("home"); setCaptureRequest((request) => request + 1); };
  const content = detailUrl || fixtureMode
    ? <ReviewScreen apiBaseUrl={apiBaseUrl} memberId={memberId} detailUrl={detailUrl ?? "/captures/demo-capture-1/review"} {...(!fixtureMode ? { metadataClient: createMetadataClient(apiBaseUrl), organizationProposalClient: createOrganizationProposalClient(apiBaseUrl), spacesClient: createSpacesClient(apiBaseUrl) } : {})} {...(fixtureMode ? { client: createReviewFixtureClient(fixtureKind) } : {})} offlineDraftStore={offlineDraftStore} onBack={() => { setDetailUrl(null); setFixtureMode(false); }} />
    : showToday ? <SelectedDayTaskScreen apiBaseUrl={apiBaseUrl} memberId={memberId} selectedDate={new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date()) as `${number}-${number}-${number}`} timeZone="Europe/Warsaw" renderTask={(task) => <PressableTaskRow title={task.title} detailUrl={task.detailUrl} onOpenDetail={setDetailUrl} />} />
    : tab === "find" ? <FindSurface />
    : tab === "calendar" ? <CalendarSurface />
    : tab === "me" ? <MeSurface />
    : <MemberListScreen apiBaseUrl={apiBaseUrl} {...(fixtureItems ? { client: fixtureItems } : {})} memberId={memberId} home={tab === "home" && process.env.NODE_ENV !== "test"} onOpenToday={() => setShowToday(true)} onOpenDetail={setDetailUrl} voiceRecorder={createExpoVoiceRecorder(recorder)} recordingMetering={recorderState.metering} recordingInterrupted={recorderState.mediaServicesDidReset} captureSubmitter={createCaptureSubmitter(apiBaseUrl, readRecordedAudioAsBase64)} offlineDraftStore={offlineDraftStore} offlineDraftSyncClient={offlineDraftSyncClient} captureRequest={captureRequest} />;
  return <SafeAreaProvider><AppShell tab={tab} onTabChange={(nextTab) => { setTab(nextTab); setShowToday(false); }} onCapture={openCapture}>{content}</AppShell></SafeAreaProvider>;
}

function PressableTaskRow({ title, detailUrl, onOpenDetail }: { readonly title: string; readonly detailUrl: string; readonly onOpenDetail: (url: string) => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open Task ${title}`} onPress={() => onOpenDetail(detailUrl)}><TaskRow title={title} detail="Scheduled today" /></Pressable>;
}

function fixtureDueAt(value: string | undefined, index: number): string | undefined {
  if (!value || index > 1) return value;
  const today = new Date();
  const source = new Date(value);
  today.setHours(source.getUTCHours(), source.getUTCMinutes(), 0, 0);
  return today.toISOString();
}

function fixtureTaskItem(task: ReturnType<typeof createBrowserFixtureData>["tasks"][number], index: number): MemberListItem {
  const dueAt = fixtureDueAt(task.dueAt, index);
  return { kind: "task", id: task.id, captureId: `fixture-${task.id}`, title: task.title, ...(dueAt === undefined ? {} : { dueAt }), state: task.status, createdAt: task.dueAt ?? new Date().toISOString(), detailUrl: `/tasks/${task.id}`, ...(task.spaceId === undefined ? {} : { spaceId: task.spaceId }) };
}
