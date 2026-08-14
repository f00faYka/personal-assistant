import { MemberListScreen } from "./src/list/MemberListScreen";
import { useAudioRecorder, RecordingPresets } from "expo-audio";
import { createCaptureSubmitter } from "./src/capture/voice-capture";
import { createExpoVoiceRecorder, readRecordedAudioAsBase64 } from "./src/capture/expo-voice-recorder";
import { ReviewScreen } from "./src/review/ReviewScreen";
import { useState } from "react";

export default function App() {
  const [detailUrl, setDetailUrl] = useState<string | null>(null);
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const memberId = process.env.EXPO_PUBLIC_MEMBER_ID ?? "member-1";
  if (detailUrl) return <ReviewScreen apiBaseUrl={apiBaseUrl} memberId={memberId} detailUrl={detailUrl} onBack={() => setDetailUrl(null)} />;
  return <MemberListScreen apiBaseUrl={apiBaseUrl} memberId={memberId} onOpenDetail={setDetailUrl} voiceRecorder={createExpoVoiceRecorder(recorder)} captureSubmitter={createCaptureSubmitter(apiBaseUrl, readRecordedAudioAsBase64)} />;
}
