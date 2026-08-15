import { describe, expect, test, vi } from "vitest";

import { LocalWhisperProvider } from "./local-whisper-provider.js";

describe("LocalWhisperProvider", () => {
  test("maps immutable audio to whisper.cpp multipart inference and records configured metadata", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ text: " Buy milk tomorrow. " }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const provider = new LocalWhisperProvider({
      endpoint: "http://127.0.0.1:8080/inference",
      model: "ggml-small",
      timeoutMilliseconds: 30_000,
      fetch: request,
    });

    const result = await provider.transcribe({
      audio: Uint8Array.from([1, 2, 3]),
      contentType: "audio/m4a",
    });

    expect(result).toEqual({ text: "Buy milk tomorrow.", provider: "whisper.cpp", model: "ggml-small" });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:8080/inference");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBeInstanceOf(FormData);
    const form = options?.body as FormData;
    expect(form.get("response_format")).toBe("json");
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("capture.m4a");
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
  });

  test("reports safe errors without retaining the provider response body", async () => {
    const provider = new LocalWhisperProvider({
      endpoint: "http://127.0.0.1:8080/inference",
      model: "ggml-small",
      timeoutMilliseconds: 30_000,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        "private provider diagnostics",
        { status: 503 },
      )),
    });

    await expect(provider.transcribe({
      audio: Uint8Array.from([1]),
      contentType: "audio/wav",
    })).rejects.toThrow("Local Whisper request failed (HTTP 503)");
    await expect(provider.transcribe({
      audio: Uint8Array.from([1]),
      contentType: "audio/wav",
    })).rejects.not.toThrow("private provider diagnostics");
  });

  test("rejects malformed successful responses as safe provider errors", async () => {
    const provider = new LocalWhisperProvider({
      endpoint: "http://127.0.0.1:8080/inference",
      model: "ggml-small",
      timeoutMilliseconds: 30_000,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ unexpected: "shape" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )),
    });

    await expect(provider.transcribe({
      audio: Uint8Array.from([1]),
      contentType: "audio/wav",
    })).rejects.toThrow("Local Whisper returned an invalid response");
  });
});
