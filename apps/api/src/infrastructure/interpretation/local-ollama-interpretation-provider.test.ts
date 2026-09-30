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
            schedule: { date: "tomorrow", hour: 9, minute: null },
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
    });

    expect(result).toEqual({
      model: "qwen3.5:4b",
      rawOutput: {
        action: "create_task",
        title: "Buy milk",
        schedule: { date: "tomorrow", hour: 9, minute: null },
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({ "content-type": "application/json" });
    const requestBody = JSON.parse(options?.body as string) as { readonly format: { readonly oneOf: readonly Record<string, unknown>[] }; readonly messages: readonly { readonly content: string }[] };
    expect(requestBody).toMatchObject({
      model: "qwen3.5:4b",
      stream: false,
      think: false,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: expect.stringContaining("absolute UTC timestamp") },
        { role: "user", content: "add task buy milk tomorrow" },
      ],
      format: { type: "object", oneOf: expect.any(Array) },
    });
    expect(requestBody.format.oneOf[0]?.properties).not.toHaveProperty("dueAt");
    expect(requestBody.messages[0]?.content).not.toContain("capturedAt");
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
      })).rejects.toEqual(new LocalOllamaInterpretationProviderError(message));
    }
  });
});
