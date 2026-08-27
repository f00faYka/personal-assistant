import type { FastifyInstance } from "fastify";
import * as z from "zod";
import { InvalidSpaceOperationError, SpaceItemNotFoundError, SpaceService } from "./space.js";

const memberSchema = z.object({ memberId: z.string().min(1) });
const createSchema = memberSchema.extend({ name: z.string(), parentId: z.string().optional() });
const assignSchema = memberSchema.extend({ spaceId: z.string().nullable() });

export function registerSpaceRoutes(application: FastifyInstance, service: SpaceService): void {
  application.post<{ Body: unknown }>("/spaces", async (request, reply) => {
    try { const body = createSchema.parse(request.body); return reply.code(201).send({ space: service.create(body.memberId, body.name, body.parentId) }); }
    catch (error) { return handleError(reply, error, "invalid Space"); }
  });
  application.get<{ Querystring: { memberId?: string } }>("/spaces", async (request, reply) => {
    try { if (!request.query.memberId) return reply.code(400).send({ error: "memberId is required" }); return { spaces: service.list(request.query.memberId) }; }
    catch (error) { return handleError(reply, error, "invalid Space query"); }
  });
  for (const kind of ["tasks", "notes"] as const) {
    application.put<{ Params: { id: string }; Body: unknown }>(`/${kind}/:id/space`, async (request, reply) => {
      try { const body = assignSchema.parse(request.body); return { assignment: service.assign(request.params.id, kind === "tasks" ? "task" : "note", body.memberId, body.spaceId) }; }
      catch (error) { return handleError(reply, error, "invalid Space assignment"); }
    });
    application.delete<{ Params: { id: string }; Querystring: { memberId?: string } }>(`/${kind}/:id/space`, async (request, reply) => {
      try { if (!request.query.memberId) return reply.code(400).send({ error: "memberId is required" }); return { assignment: service.assign(request.params.id, kind === "tasks" ? "task" : "note", request.query.memberId, null) }; }
      catch (error) { return handleError(reply, error, "invalid Space assignment"); }
    });
  }
}

function handleError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown, fallback: string): unknown {
  if (error instanceof z.ZodError || error instanceof InvalidSpaceOperationError) return reply.code(400).send({ error: error instanceof Error ? error.message : fallback });
  if (error instanceof SpaceItemNotFoundError) return reply.code(404).send({ error: error.message });
  throw error;
}
