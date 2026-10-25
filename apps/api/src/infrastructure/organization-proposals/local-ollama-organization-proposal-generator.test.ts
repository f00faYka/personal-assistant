import { describe, expect, test } from "vitest";
import { LocalOllamaOrganizationProposalGenerator, LocalOllamaOrganizationProposalGeneratorError } from "./local-ollama-organization-proposal-generator.js";

const context = { spaces: [{ id: "space-1", name: "Home", path: "Home", examples: [] }], tags: [{ id: "tag-1", name: "errands" }], entities: [{ id: "entity-1", name: "Ava" }] };

describe("LocalOllamaOrganizationProposalGenerator", () => {
  test("rejects the sanitized missing-target-and-name regression fixture", async () => {
    const sanitizedRegressionFixture = { kind: "tag", confidence: 0.72, provenance: ["context-match"] };
    const provider = new LocalOllamaOrganizationProposalGenerator({ endpoint: "http://ollama.test", model: "qwen-local", timeoutMilliseconds: 1000, fetch: async () => Response.json({ message: { content: JSON.stringify({ candidates: [sanitizedRegressionFixture] }) } }) });
    await expect(provider.generate({ item: { id: "note-fixture", memberId: "member-fixture", kind: "note", text: "sanitized fixture" }, transcriptionText: "sanitized fixture", context })).rejects.toEqual(new LocalOllamaOrganizationProposalGeneratorError("invalid_candidate_representation"));
  });

  test("sends saved item, transcription, and member organization context to local Ollama", async () => {
    let requestBody = "";
    const provider = new LocalOllamaOrganizationProposalGenerator({ endpoint: "http://ollama.test/api/chat", model: "qwen-local", timeoutMilliseconds: 1000, fetch: async (_input, init) => { requestBody = String(init?.body); return Response.json({ message: { content: JSON.stringify({ candidates: [{ kind: "tag", targetId: "tag-1", confidence: 0.82, provenance: ["transcription: errands"] }, { kind: "entity", suggestedName: "Mira", entityType: "Person", confidence: 0.6, provenance: ["transcription: Mira"] }] }) } }); } });
    const result = await provider.generate({ item: { id: "note-1", memberId: "member-1", kind: "note", text: "Mira at the store" }, transcriptionText: "Mira at the store", context });
    expect(JSON.parse(requestBody)).toMatchObject({ model: "qwen-local", think: false, messages: [{}, { content: expect.stringContaining("member-1") }] });
    expect(result).toEqual({ modelVersion: "qwen-local", candidates: [{ kind: "tag", targetId: "tag-1", confidence: 0.82, provenance: ["transcription: errands"] }, { kind: "entity", suggestedName: "Mira", entityType: "Person", confidence: 0.6, provenance: ["transcription: Mira"] }] });
  });

  test("uses one exclusive candidate schema and accepts new Space proposals", async () => {
    let requestBody = "";
    const provider = new LocalOllamaOrganizationProposalGenerator({ endpoint: "http://ollama.test", model: "qwen-local", timeoutMilliseconds: 1000, fetch: async (_input, init) => { requestBody = String(init?.body); return Response.json({ message: { content: JSON.stringify({ candidates: [{ kind: "space", suggestedName: "Garden", confidence: 0.9, provenance: ["transcription"] }] }) } }); } });
    const result = await provider.generate({ item: { id: "note-1", memberId: "member-1", kind: "note", text: "Garden plans" }, transcriptionText: "Garden plans", context });
    const body = JSON.parse(requestBody) as { format: { properties: { candidates: { items: { oneOf: readonly unknown[] } } } }; messages: readonly { content: string }[] };
    expect(body.format.properties.candidates.items.oneOf).toHaveLength(3);
    expect(body.messages[0]?.content).toContain("Prefer");
    expect(result.candidates[0]).toMatchObject({ kind: "space", suggestedName: "Garden" });
  });

  test.each([
    { kind: "tag", targetId: "tag-1", suggestedName: "other", confidence: 0.9, provenance: ["transcription"] },
    { kind: "tag", confidence: 0.9, provenance: ["transcription"] },
    { kind: "tag", suggestedName: "  ", confidence: 0.9, provenance: ["transcription"] },
    { kind: "entity", suggestedName: "Mira", confidence: 0.9, provenance: ["transcription"] },
  ])("rejects malformed candidate forms without exposing model content", async (candidate) => {
    const provider = new LocalOllamaOrganizationProposalGenerator({ endpoint: "http://ollama.test", model: "qwen-local", timeoutMilliseconds: 1000, fetch: async () => Response.json({ message: { content: JSON.stringify({ candidates: [candidate] }) } }) });
    await expect(provider.generate({ item: { id: "note-1", memberId: "member-1", kind: "note", text: "private" }, transcriptionText: "private", context })).rejects.toBeInstanceOf(LocalOllamaOrganizationProposalGeneratorError);
  });

  test.each([
    { candidates: [{ kind: "tag", targetId: "tag-1", suggestedName: "other", confidence: 0.9, provenance: ["transcription"] }], code: "invalid_candidate_representation" },
    { candidates: [{ kind: "tag", confidence: 0.9, provenance: ["transcription"] }], code: "invalid_candidate_representation" },
    { candidates: [{ kind: "tag", suggestedName: "  ", confidence: 0.9, provenance: ["transcription"] }], code: "empty_suggested_name" },
    { candidates: [{ kind: "entity", suggestedName: "Mira", confidence: 0.9, provenance: ["transcription"] }], code: "invalid_new_entity_type" },
    { candidates: [{ kind: "entity", suggestedName: "Mira", entityType: "Animal", confidence: 0.9, provenance: ["transcription"] }], code: "invalid_new_entity_type" },
    { candidates: [{ kind: "tag", targetId: "other-members-tag", confidence: 0.9, provenance: ["transcription"] }], code: "unknown_or_wrong_kind_target" },
    { candidates: [{ kind: "tag", targetId: "space-1", confidence: 0.9, provenance: ["transcription"] }], code: "unknown_or_wrong_kind_target" },
    { candidates: [{ kind: "space", suggestedName: "Garden", confidence: 0.9, provenance: ["transcription"] }], code: "" },
  ])("rejects unsafe candidate forms", async ({ candidates, code }) => {
    const provider = new LocalOllamaOrganizationProposalGenerator({ endpoint: "http://ollama.test", model: "qwen-local", timeoutMilliseconds: 1000, fetch: async () => Response.json({ message: { content: JSON.stringify({ candidates }) } }) });
    const input = { item: { id: "note-1", memberId: "member-1", kind: "note" as const, text: "content" }, transcriptionText: "content", context };
    if (code) await expect(provider.generate(input)).rejects.toEqual(new LocalOllamaOrganizationProposalGeneratorError(code));
    else await expect(provider.generate(input)).resolves.toMatchObject({ candidates: [{ kind: "space", suggestedName: "Garden" }] });
  });
});
