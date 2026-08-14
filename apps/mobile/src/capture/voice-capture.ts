export interface RecordedAudio {
  readonly uri: string;
  readonly contentType: string;
}

export interface VoiceRecorder {
  requestPermission(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<RecordedAudio | null>;
  cancel(): Promise<void>;
}

export interface CaptureSubmitter {
  submit(input: {
    readonly memberId: string;
    readonly idempotencyKey: string;
    readonly audio: RecordedAudio;
    readonly capturedAt: string;
  }): Promise<void>;
}

export function createCaptureSubmitter(
  apiBaseUrl: string,
  readBase64: (uri: string) => Promise<string>,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): CaptureSubmitter {
  return {
    async submit({ memberId, idempotencyKey, audio, capturedAt }) {
      const response = await fetcher(`${apiBaseUrl}/captures`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberId,
          idempotencyKey,
          audioBase64: await readBase64(audio.uri),
          contentType: audio.contentType,
          capturedAt,
        }),
      });
      if (!response.ok) {
        throw new Error(`Unable to submit Capture (${response.status})`);
      }
    },
  };
}

export function createIdempotencyKey(): string {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
