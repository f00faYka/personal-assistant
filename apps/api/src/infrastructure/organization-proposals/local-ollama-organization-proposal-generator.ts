import { organizationContextMatches, organizationTargetsForKind, type OrganizationCandidateInput, type OrganizationContext } from "../../features/organization-proposals/organization-proposal.js";
import type { OrganizationProposalGenerator } from "../../features/organization-proposals/organization-proposal-worker.js";

export interface LocalOllamaOrganizationProposalGeneratorOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMilliseconds: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class LocalOllamaOrganizationProposalGenerator implements OrganizationProposalGenerator {
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: LocalOllamaOrganizationProposalGeneratorOptions) { this.request = options.fetch ?? globalThis.fetch; }

  async generate(input: Parameters<OrganizationProposalGenerator["generate"]>[0]): Promise<{ readonly modelVersion: string; readonly candidates: readonly OrganizationCandidateInput[] }> {
    try {
      const response = await this.request(this.options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          think: false,
          format: schema,
          options: { temperature: 0 },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify({ item: input.item, transcription: input.transcriptionText, context: input.context }) },
          ],
        }),
        signal: AbortSignal.timeout(this.options.timeoutMilliseconds),
      });
      if (!response.ok) throw new LocalOllamaOrganizationProposalGeneratorError(`Local Ollama request failed (HTTP ${response.status})`);
      const body: unknown = await response.json();
      if (!isResponse(body)) throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama returned an invalid response");
      return { modelVersion: this.options.model, candidates: parseCandidates(body.message.content, input.context) };
    } catch (error) {
      if (error instanceof LocalOllamaOrganizationProposalGeneratorError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") throw new LocalOllamaOrganizationProposalGeneratorError(`Local Ollama request timed out after ${this.options.timeoutMilliseconds}ms`);
      throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama request failed");
    }
  }
}

export class LocalOllamaOrganizationProposalGeneratorError extends Error {
  constructor(message: string) { super(message); this.name = "LocalOllamaOrganizationProposalGeneratorError"; }
}

const schema = {
  type: "object",
  properties: {
    candidates: { type: "array", items: { oneOf: [
      { type: "object", properties: { kind: { type: "string", enum: ["space", "tag", "entity"] }, confidence: { type: "number", minimum: 0, maximum: 1 }, targetId: { type: "string", minLength: 1 }, provenance: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 5 } }, required: ["kind", "targetId", "confidence", "provenance"], additionalProperties: false },
      { type: "object", properties: { kind: { type: "string", enum: ["space", "tag"] }, confidence: { type: "number", minimum: 0, maximum: 1 }, suggestedName: { type: "string", minLength: 1 }, provenance: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 5 } }, required: ["kind", "suggestedName", "confidence", "provenance"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "entity" }, confidence: { type: "number", minimum: 0, maximum: 1 }, suggestedName: { type: "string", minLength: 1 }, entityType: { type: "string", enum: ["Person", "Place", "Organization", "Object"] }, provenance: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 5 } }, required: ["kind", "suggestedName", "entityType", "confidence", "provenance"], additionalProperties: false },
    ] } },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

const systemPrompt = "Return JSON with candidate metadata only. Each candidate must use exactly one form: an existing Space, Tag, or Entity with its exact context targetId and no suggestedName; or a new Space, Tag, or Entity suggestedName and no targetId. For a new Entity include entityType. Prefer the ID of a same or semantically similar existing entry; use a new name only when no suitable entry exists in context. Exact normalized duplicate names must resolve to an existing ID. New names are proposals for user review only. Every candidate must include confidence from 0 to 1 and short provenance labels identifying supporting transcription evidence or matching context; do not include chain-of-thought. Return an empty candidates array when no organization is useful. Do not create or assign anything.";

function isResponse(value: unknown): value is { readonly message: { readonly content: string } } {
  return typeof value === "object" && value !== null && "message" in value && typeof value.message === "object" && value.message !== null && "content" in value.message && typeof value.message.content === "string";
}

function parseCandidates(content: string, context: OrganizationContext): readonly OrganizationCandidateInput[] {
  let parsed: unknown;
  try { parsed = JSON.parse(content) as unknown; }
  catch { throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama returned invalid structured output"); }
  if (!isCandidateList(parsed)) throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama returned invalid structured output");
  return parsed.candidates.map((candidate) => {
    if (Boolean(candidate.targetId) === Boolean(candidate.suggestedName)) throw new LocalOllamaOrganizationProposalGeneratorError("invalid_candidate_representation");
    if (candidate.entityType !== undefined && (candidate.kind !== "entity" || candidate.targetId !== undefined)) throw new LocalOllamaOrganizationProposalGeneratorError("invalid_entity_type_usage");
    if (candidate.targetId) {
      const target = organizationTargetsForKind(context, candidate.kind).find((entry) => entry.id === candidate.targetId);
      if (!target) throw new LocalOllamaOrganizationProposalGeneratorError("unknown_or_wrong_kind_target");
      return candidate;
    }
    if (!candidate.suggestedName?.trim()) throw new LocalOllamaOrganizationProposalGeneratorError("empty_suggested_name");
    if (candidate.kind === "entity" && !["Person", "Place", "Organization", "Object"].includes(candidate.entityType ?? "")) throw new LocalOllamaOrganizationProposalGeneratorError("invalid_new_entity_type");
    const name = candidate.suggestedName.trim();
    const matches = organizationContextMatches(context, candidate.kind, name, candidate.entityType);
    if (matches.length > 1) throw new LocalOllamaOrganizationProposalGeneratorError("ambiguous_organization_name");
    if (matches.length === 1) return { kind: candidate.kind, targetId: matches[0]!.id, confidence: candidate.confidence, provenance: candidate.provenance };
    return { ...candidate, suggestedName: name };
  });
}

function isCandidateList(value: unknown): value is { readonly candidates: readonly OrganizationCandidateInput[] } {
  if (typeof value !== "object" || value === null || !("candidates" in value) || !Array.isArray(value.candidates)) return false;
  return value.candidates.every((candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const value = candidate as Record<string, unknown>;
    return ["space", "tag", "entity"].includes(String(value.kind))
      && typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
      && Array.isArray(value.provenance) && value.provenance.length > 0 && value.provenance.every((part: unknown) => typeof part === "string" && part.trim().length > 0)
      && (value.targetId === undefined || typeof value.targetId === "string")
      && (value.suggestedName === undefined || typeof value.suggestedName === "string")
      && (value.entityType === undefined || typeof value.entityType === "string")
      && hasOnlyKeys(value, ["kind", "targetId", "suggestedName", "confidence", "provenance", "entityType"]);
  });
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
