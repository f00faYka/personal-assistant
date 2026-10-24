import type { OrganizationCandidateInput, OrganizationContext } from "../../features/organization-proposals/organization-proposal.js";
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
    candidates: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["space", "tag", "entity"] }, confidence: { type: "number", minimum: 0, maximum: 1 }, targetId: { type: "string" }, suggestedName: { type: "string" }, entityType: { type: "string", enum: ["Person", "Place", "Organization", "Object"] }, provenance: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 5 } }, required: ["kind", "confidence", "provenance"], additionalProperties: false } },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

const systemPrompt = "Return JSON with candidate metadata only. Suggest existing Space, Tag, or Entity targets by their exact context IDs. You may suggest a temporary new Tag or Entity by name, never a new Space. Every candidate must include confidence from 0 to 1 and short provenance labels identifying supporting transcription evidence or matching context; do not include chain-of-thought. Return an empty candidates array when no organization is useful. Do not create or assign anything.";

function isResponse(value: unknown): value is { readonly message: { readonly content: string } } {
  return typeof value === "object" && value !== null && "message" in value && typeof value.message === "object" && value.message !== null && "content" in value.message && typeof value.message.content === "string";
}

function parseCandidates(content: string, context: OrganizationContext): readonly OrganizationCandidateInput[] {
  let parsed: unknown;
  try { parsed = JSON.parse(content) as unknown; }
  catch { throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama returned invalid structured output"); }
  if (!isCandidateList(parsed)) throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama returned invalid structured output");
  const spaces = new Set(context.spaces.map((space) => space.id));
  const tags = new Set(context.tags.map((tag) => tag.id));
  const entities = new Set(context.entities.map((entity) => entity.id));
  for (const candidate of parsed.candidates) {
    const targets = candidate.kind === "space" ? spaces : candidate.kind === "tag" ? tags : entities;
    if (candidate.targetId && !targets.has(candidate.targetId)) throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama returned an unknown organization target");
    if (candidate.kind === "space" && !candidate.targetId) throw new LocalOllamaOrganizationProposalGeneratorError("Spaces cannot be suggested for automatic creation");
    if (!candidate.targetId && (candidate.kind === "space" || !candidate.suggestedName)) throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama returned an invalid temporary suggestion");
    if (candidate.kind === "entity" && !candidate.targetId && !candidate.entityType) throw new LocalOllamaOrganizationProposalGeneratorError("Local Ollama returned a temporary Entity without a type");
  }
  return parsed.candidates;
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
      && (value.entityType === undefined || ["Person", "Place", "Organization", "Object"].includes(String(value.entityType)));
  });
}
