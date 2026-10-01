import { responseError } from "../http/request-error";

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
    readonly timeZone: string;
  }): Promise<{ readonly captureId: string }>;
}

export function createCaptureSubmitter(
  apiBaseUrl: string,
  readBase64: (uri: string) => Promise<string>,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): CaptureSubmitter {
  return {
    async submit({ memberId, idempotencyKey, audio, capturedAt, timeZone }) {
      const response = await fetcher(`${apiBaseUrl}/captures`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberId,
          idempotencyKey,
          audioBase64: await readBase64(audio.uri),
          contentType: audio.contentType,
          capturedAt,
          timeZone,
        }),
      });
      if (!response.ok) {
        const message = `Unable to submit Capture (${response.status})`;
        throw responseError(message, response.status);
      }
      const body: unknown = await response.json();
      if (!isCaptureSubmissionResponse(body)) throw new Error("Invalid Capture submission response");
      return { captureId: body.capture.id };
    },
  };
}

function isCaptureSubmissionResponse(value: unknown): value is { readonly capture: { readonly id: string } } {
  return typeof value === "object" && value !== null && "capture" in value
    && typeof value.capture === "object" && value.capture !== null && "id" in value.capture
    && typeof value.capture.id === "string";
}

export function createIdempotencyKey(): string {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
