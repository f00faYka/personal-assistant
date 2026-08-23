import { describe, expect, test, vi } from "vitest";

import {
  LocalOllamaInterpretationProvider,
  LocalOllamaInterpretationProviderError,
} from "./local-ollama-interpretation-provider.js";

describe("LocalOllamaInterpretationProvider", () => {
  test("requests a deterministic structured interpretation from local Ollama", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        model: "qwen3.5:4b",
        message: {
          role: "assistant",
          content: JSON.stringify({
            action: "create_task",
            title: "Buy milk",
            dueAt: "2026-08-16T09:00:00.000Z",
          }),
        },
        done: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const provider = new LocalOllamaInterpretationProvider({
      endpoint: "http://127.0.0.1:11434/api/chat",
      model: "qwen3.5:4b",
      timeoutMilliseconds: 30_000,
      fetch: request,
    });

    const result = await provider.interpret({
      transcriptionText: "add task buy milk tomorrow",
      catalogVersion: "direct-instructions.v1",
      capturedAt: "2026-08-23T12:00:00.000Z",
    });

    expect(result).toEqual({
      model: "qwen3.5:4b",
      rawOutput: {
        action: "create_task",
        title: "Buy milk",
        dueAt: "2026-08-16T09:00:00.000Z",
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(options?.body as string)).toMatchObject({
      model: "qwen3.5:4b",
      stream: false,
      think: false,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: expect.stringContaining("2026-08-23T12:00:00.000Z") },
        { role: "user", content: "add task buy milk tomorrow" },
      ],
      format: { type: "object", oneOf: expect.any(Array) },
    });
  });

  test("translates provider, timeout, and malformed-output failures without leaking response content", async () => {
    const cases: Array<{ readonly response: Response | Error; readonly message: string }> = [
      {
        response: new Response("private provider diagnostics", { status: 503 }),
        message: "Local Ollama request failed (HTTP 503)",
      },
      {
        response: new Response(JSON.stringify({ message: { content: "not JSON" } }), { status: 200 }),
        message: "Local Ollama returned invalid structured output",
      },
      {
        response: new DOMException("private timeout details", "TimeoutError"),
        message: "Local Ollama request timed out after 30000ms",
      },
    ];

    for (const { response, message } of cases) {
      const request = response instanceof Response
        ? vi.fn<typeof fetch>().mockResolvedValue(response)
        : vi.fn<typeof fetch>().mockRejectedValue(response);
      const provider = new LocalOllamaInterpretationProvider({
        endpoint: "http://127.0.0.1:11434/api/chat",
        model: "qwen3.5:4b",
        timeoutMilliseconds: 30_000,
        fetch: request,
      });

      await expect(provider.interpret({
        transcriptionText: "private transcription",
        catalogVersion: "direct-instructions.v1",
        capturedAt: "2026-08-23T12:00:00.000Z",
      })).rejects.toEqual(new LocalOllamaInterpretationProviderError(message));
    }
  });
});
