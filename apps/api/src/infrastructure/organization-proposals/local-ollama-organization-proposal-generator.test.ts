import { describe, expect, test } from "vitest";
import { LocalOllamaOrganizationProposalGenerator, LocalOllamaOrganizationProposalGeneratorError } from "./local-ollama-organization-proposal-generator.js";

const context = { spaces: [{ id: "space-1", name: "Home", path: "Home", examples: [] }], tags: [{ id: "tag-1", name: "errands" }], entities: [{ id: "entity-1", name: "Ava" }] };

describe("LocalOllamaOrganizationProposalGenerator", () => {
  test("sends saved item, transcription, and member organization context to local Ollama", async () => {
    let requestBody = "";
    const provider = new LocalOllamaOrganizationProposalGenerator({ endpoint: "http://ollama.test/api/chat", model: "qwen-local", timeoutMilliseconds: 1000, fetch: async (_input, init) => { requestBody = String(init?.body); return Response.json({ message: { content: JSON.stringify({ candidates: [{ kind: "tag", targetId: "tag-1", confidence: 0.82, provenance: ["transcription: errands"] }, { kind: "entity", suggestedName: "Mira", entityType: "Person", confidence: 0.6, provenance: ["transcription: Mira"] }] }) } }); } });
    const result = await provider.generate({ item: { id: "note-1", memberId: "member-1", kind: "note", text: "Mira at the store" }, transcriptionText: "Mira at the store", context });
    expect(JSON.parse(requestBody)).toMatchObject({ model: "qwen-local", think: false, messages: [{}, { content: expect.stringContaining("member-1") }] });
    expect(result).toEqual({ modelVersion: "qwen-local", candidates: [{ kind: "tag", targetId: "tag-1", confidence: 0.82, provenance: ["transcription: errands"] }, { kind: "entity", suggestedName: "Mira", entityType: "Person", confidence: 0.6, provenance: ["transcription: Mira"] }] });
  });

  test.each([
    { candidates: [{ kind: "space", suggestedName: "New place", confidence: 0.9, provenance: ["transcription"] }], message: "Spaces cannot be suggested for automatic creation" },
    { candidates: [{ kind: "tag", targetId: "other-members-tag", confidence: 0.9, provenance: ["transcription"] }], message: "Local Ollama returned an unknown organization target" },
  ])("rejects unsafe candidate targets: $message", async ({ candidates, message }) => {
    const provider = new LocalOllamaOrganizationProposalGenerator({ endpoint: "http://ollama.test", model: "qwen-local", timeoutMilliseconds: 1000, fetch: async () => Response.json({ message: { content: JSON.stringify({ candidates }) } }) });
    await expect(provider.generate({ item: { id: "note-1", memberId: "member-1", kind: "note", text: "content" }, transcriptionText: "content", context })).rejects.toEqual(new LocalOllamaOrganizationProposalGeneratorError(message));
  });
});
