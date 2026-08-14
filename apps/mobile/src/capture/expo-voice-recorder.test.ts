import { describe, expect, test, vi } from "vitest";

const { setAudioModeAsync } = vi.hoisted(() => ({ setAudioModeAsync: vi.fn().mockResolvedValue(undefined) }));

vi.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: ".m4a" } },
  requestRecordingPermissionsAsync: vi.fn(),
  setAudioModeAsync,
}));

vi.mock("expo-file-system", () => ({ File: class File {} }));

import { createExpoVoiceRecorder } from "./expo-voice-recorder";

describe("Expo voice recorder", () => {
  test("enables iOS recording mode before preparing the recorder", async () => {
    const recorder = {
      isRecording: false,
      uri: null,
      prepareToRecordAsync: vi.fn().mockResolvedValue(undefined),
      record: vi.fn(),
      stop: vi.fn(),
    };

    await createExpoVoiceRecorder(recorder).start();

    expect(setAudioModeAsync).toHaveBeenCalledWith({ allowsRecording: true, playsInSilentMode: true });
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
    expect(setAudioModeAsync.mock.invocationCallOrder[0]).toBeLessThan(recorder.prepareToRecordAsync.mock.invocationCallOrder[0] ?? Infinity);
  });
});
