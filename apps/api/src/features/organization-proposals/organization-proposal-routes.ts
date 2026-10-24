import type { FastifyInstance } from "fastify";
import * as z from "zod";
import { InvalidOrganizationProposalError, OrganizationProposalNotFoundError, OrganizationProposalService, type OrganizationCandidateInput, type OrganizationContext } from "./organization-proposal.js";
import type { OrganizationProposalWorker } from "./organization-proposal-worker.js";

const candidateSchema = z.object({ kind: z.enum(["space", "tag", "entity"]), confidence: z.number(), targetId: z.string().optional(), suggestedName: z.string().optional(), entityType: z.string().optional(), provenance: z.array(z.string()).min(1) });
const createSchema = z.object({ memberId: z.string().min(1), itemId: z.string().min(1), itemKind: z.enum(["task", "note"]), idempotencyKey: z.string().min(1), modelVersion: z.string().min(1), rulesVersion: z.string().min(1), context: z.object({ spaces: z.array(z.object({ id: z.string(), name: z.string(), path: z.string(), description: z.string().optional(), examples: z.array(z.string()) })), tags: z.array(z.object({ id: z.string(), name: z.string() })), entities: z.array(z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()).optional() })) }), candidates: z.array(candidateSchema) });
const decisionSchema = z.object({ memberId: z.string().min(1), candidateIds: z.array(z.string()).optional() });
const retrySchema = z.object({ memberId: z.string().min(1), itemKind: z.enum(["task", "note"]) });

export function registerOrganizationProposalRoutes(application: FastifyInstance, service: OrganizationProposalService, worker?: OrganizationProposalWorker): void {
  application.post<{ Body: unknown }>("/organization-proposals", async (request, reply) => { try { const body = createSchema.parse(request.body); return reply.code(201).send({ proposal: service.create({ ...body, context: normalizeContext(body.context), candidates: body.candidates.map(normalizeCandidate) }) }); } catch (error) { return handleError(reply, error); } });
  application.get<{ Params: { itemId: string }; Querystring: { memberId?: string; itemKind?: "task" | "note" } }>("/items/:itemId/organization-proposals", async (request, reply) => { try { if (!request.query.itemKind) throw new InvalidOrganizationProposalError("itemKind is required"); const memberId = request.query.memberId ?? ""; const proposals = service.list(memberId, request.params.itemId, request.query.itemKind); const generation = worker?.status(memberId, request.params.itemId, request.query.itemKind) ?? { state: "pending" as const }; return { generation, proposals }; } catch (error) { return handleError(reply, error); } });
  application.post<{ Params: { itemId: string }; Body: unknown }>("/items/:itemId/organization-proposals/retry", async (request, reply) => { try { const body = retrySchema.parse(request.body); if (!worker) throw new InvalidOrganizationProposalError("organization proposal generation is unavailable"); const generation = worker.retry(body.memberId, request.params.itemId); return { generation, proposals: service.list(body.memberId, request.params.itemId, body.itemKind) }; } catch (error) { return handleError(reply, error); } });
  for (const [state, path] of [["accepted", "accept"], ["dismissed", "dismiss"]] as const) application.post<{ Params: { id: string }; Body: unknown }>(`/organization-proposals/:id/${path}`, async (request, reply) => { try { const body = decisionSchema.parse(request.body); return { proposal: service.decide(body.memberId, request.params.id, state, body.candidateIds) }; } catch (error) { return handleError(reply, error); } });
}
function handleError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown): unknown { if (error instanceof z.ZodError || error instanceof InvalidOrganizationProposalError) return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid organization proposal" }); if (error instanceof OrganizationProposalNotFoundError) return reply.code(404).send({ error: error.message }); throw error; }

function normalizeContext(context: z.infer<typeof createSchema>["context"]): OrganizationContext {
  return {
    spaces: context.spaces.map((space) => space.description === undefined ? { id: space.id, name: space.name, path: space.path, examples: space.examples } : { id: space.id, name: space.name, path: space.path, description: space.description, examples: space.examples }),
    tags: context.tags,
    entities: context.entities.map((entity) => entity.aliases === undefined ? { id: entity.id, name: entity.name } : { id: entity.id, name: entity.name, aliases: entity.aliases }),
  };
}

function normalizeCandidate(candidate: z.infer<typeof candidateSchema>): OrganizationCandidateInput {
  return {
    kind: candidate.kind, confidence: candidate.confidence, provenance: candidate.provenance,
    ...(candidate.targetId === undefined ? {} : { targetId: candidate.targetId }),
    ...(candidate.suggestedName === undefined ? {} : { suggestedName: candidate.suggestedName }),
    ...(candidate.entityType === undefined ? {} : { entityType: candidate.entityType }),
  };
}
