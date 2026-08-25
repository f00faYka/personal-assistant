import { requestRecordingPermissionsAsync, RecordingPresets, setAudioModeAsync } from "expo-audio";
import { File } from "expo-file-system";

import type { RecordedAudio, VoiceRecorder } from "./voice-capture";

interface ExpoRecorder {
  readonly isRecording: boolean;
  readonly uri: string | null;
  prepareToRecordAsync(options: typeof RecordingPresets.HIGH_QUALITY): Promise<void>;
  record(): void;
  stop(): Promise<void>;
}

export function createExpoVoiceRecorder(recorder: ExpoRecorder): VoiceRecorder {
  return {
    async requestPermission() {
      return (await requestRecordingPermissionsAsync()).granted;
    },
    async start() {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
      recorder.record();
    },
    async stop(): Promise<RecordedAudio | null> {
      await recorder.stop();
      return recorder.uri ? { uri: recorder.uri, contentType: "audio/m4a" } : null;
    },
    async cancel() {
      if (recorder.isRecording) await recorder.stop();
      if (recorder.uri) new File(recorder.uri).delete();
    },
  };
}

export function readRecordedAudioAsBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}
