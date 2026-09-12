import { MemberListScreen } from "./src/list/MemberListScreen";
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
import { BrowserPreview } from "./src/web/BrowserPreview";

export default function App() {
  if (process.env.EXPO_PUBLIC_UI_FIXTURE === "true") {
    return <SafeAreaProvider><BrowserPreview /></SafeAreaProvider>;
  }
  const [detailUrl, setDetailUrl] = useState<string | null>(null);
  const [fixtureMode, setFixtureMode] = useState(process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" || process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "note");
  const [tab, setTab] = useState<ShellTab>("home");
  const [captureRequest, setCaptureRequest] = useState(0);
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 150);
  const offlineDraftStore = useMemo(() => createExpoOfflineDraftStore(), []);
  const offlineDraftSyncClient = useMemo(() => createOfflineDraftSyncClient(apiBaseUrl, { readBase64: readRecordedAudioAsBase64 }), [apiBaseUrl]);
  const memberId = process.env.EXPO_PUBLIC_MEMBER_ID ?? "member-1";
  const fixtureKind = process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" ? "task" : "note";
  const openCapture = () => { setTab("home"); setCaptureRequest((request) => request + 1); };
  const content = detailUrl || fixtureMode
    ? <ReviewScreen apiBaseUrl={apiBaseUrl} memberId={memberId} detailUrl={detailUrl ?? "/captures/demo-capture-1/review"} {...(!fixtureMode ? { metadataClient: createMetadataClient(apiBaseUrl), organizationProposalClient: createOrganizationProposalClient(apiBaseUrl), spacesClient: createSpacesClient(apiBaseUrl) } : {})} {...(fixtureMode ? { client: createReviewFixtureClient(fixtureKind) } : {})} offlineDraftStore={offlineDraftStore} onBack={() => { setDetailUrl(null); setFixtureMode(false); }} />
    : tab === "find" ? <FindSurface />
    : tab === "calendar" ? <CalendarSurface />
    : tab === "me" ? <MeSurface />
    : <MemberListScreen apiBaseUrl={apiBaseUrl} memberId={memberId} onOpenDetail={setDetailUrl} voiceRecorder={createExpoVoiceRecorder(recorder)} recordingMetering={recorderState.metering} recordingInterrupted={recorderState.mediaServicesDidReset} captureSubmitter={createCaptureSubmitter(apiBaseUrl, readRecordedAudioAsBase64)} offlineDraftStore={offlineDraftStore} offlineDraftSyncClient={offlineDraftSyncClient} captureRequest={captureRequest} />;
  return <SafeAreaProvider><AppShell tab={tab} onTabChange={setTab} onCapture={openCapture}>{content}</AppShell></SafeAreaProvider>;
}
