import { MemberListScreen } from "./src/list/MemberListScreen";
import { useAudioRecorder, RecordingPresets } from "expo-audio";
import { createCaptureSubmitter } from "./src/capture/voice-capture";
import { createExpoVoiceRecorder, readRecordedAudioAsBase64 } from "./src/capture/expo-voice-recorder";
import { ReviewScreen } from "./src/review/ReviewScreen";
import { createReviewFixtureClient } from "./src/review/review";
import { useState } from "react";

export default function App() {
  const [detailUrl, setDetailUrl] = useState<string | null>(null);
  const [fixtureMode, setFixtureMode] = useState(process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" || process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "note");
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const memberId = process.env.EXPO_PUBLIC_MEMBER_ID ?? "member-1";
  const fixtureKind = process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" ? "task" : "note";
  if (detailUrl || fixtureMode) return <ReviewScreen apiBaseUrl={apiBaseUrl} memberId={memberId} detailUrl={detailUrl ?? "/captures/demo-capture-1/review"} {...(fixtureMode ? { client: createReviewFixtureClient(fixtureKind) } : {})} onBack={() => { setDetailUrl(null); setFixtureMode(false); }} />;
  return <MemberListScreen apiBaseUrl={apiBaseUrl} memberId={memberId} onOpenDetail={setDetailUrl} voiceRecorder={createExpoVoiceRecorder(recorder)} captureSubmitter={createCaptureSubmitter(apiBaseUrl, readRecordedAudioAsBase64)} />;
}
