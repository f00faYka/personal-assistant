import { MemberListScreen } from "./src/list/MemberListScreen";
import { useAudioRecorder, RecordingPresets } from "expo-audio";
import { createCaptureSubmitter } from "./src/capture/voice-capture";
import { createExpoVoiceRecorder, readRecordedAudioAsBase64 } from "./src/capture/expo-voice-recorder";

export default function App() {
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  return <MemberListScreen apiBaseUrl={apiBaseUrl} memberId={process.env.EXPO_PUBLIC_MEMBER_ID ?? "member-1"} voiceRecorder={createExpoVoiceRecorder(recorder)} captureSubmitter={createCaptureSubmitter(apiBaseUrl, readRecordedAudioAsBase64)} />;
}
