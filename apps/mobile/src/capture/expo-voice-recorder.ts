import { AudioRecorder, requestRecordingPermissionsAsync, RecordingPresets } from "expo-audio";
import { File } from "expo-file-system";

import type { RecordedAudio, VoiceRecorder } from "./voice-capture";

export function createExpoVoiceRecorder(recorder: AudioRecorder): VoiceRecorder {
  return {
    async requestPermission() {
      return (await requestRecordingPermissionsAsync()).granted;
    },
    async start() {
      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
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
