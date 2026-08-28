import type { FastifyInstance } from "fastify";
import * as z from "zod";
import { entityTypes, InvalidMetadataOperationError, MetadataDuplicateError, MetadataResourceNotFoundError, MetadataService, type MetadataItemKind } from "./metadata.js";

const memberSchema = z.object({ memberId: z.string().min(1) });
const tagSchema = memberSchema.extend({ name: z.string() });
const entitySchema = memberSchema.extend({ name: z.string(), type: z.enum(entityTypes) });
const itemQuerySchema = z.object({ memberId: z.string().min(1) });

export function registerMetadataRoutes(application: FastifyInstance, service: MetadataService): void {
  application.post<{ Body: unknown }>("/tags", async (request, reply) => { try { const body = tagSchema.parse(request.body); return reply.code(201).send({ tag: service.createTag(body.memberId, body.name) }); } catch (error) { return handleError(reply, error); } });
  application.get<{ Querystring: { memberId?: string } }>("/tags", async (request, reply) => { try { const body = itemQuerySchema.parse(request.query); return { tags: service.listTags(body.memberId) }; } catch (error) { return handleError(reply, error); } });
  application.patch<{ Params: { id: string }; Body: unknown }>("/tags/:id", async (request, reply) => { try { const body = tagSchema.parse(request.body); return { tag: service.updateTag(request.params.id, body.memberId, body.name) }; } catch (error) { return handleError(reply, error); } });
  application.post<{ Body: unknown }>("/entities", async (request, reply) => { try { const body = entitySchema.parse(request.body); return reply.code(201).send({ entity: service.createEntity(body.memberId, body.name, body.type) }); } catch (error) { return handleError(reply, error); } });
  application.get<{ Querystring: { memberId?: string } }>("/entities", async (request, reply) => { try { const body = itemQuerySchema.parse(request.query); return { entities: service.listEntities(body.memberId) }; } catch (error) { return handleError(reply, error); } });
  application.patch<{ Params: { id: string }; Body: unknown }>("/entities/:id", async (request, reply) => { try { const body = entitySchema.parse(request.body); return { entity: service.updateEntity(request.params.id, body.memberId, body.name, body.type) }; } catch (error) { return handleError(reply, error); } });

  for (const kind of ["tasks", "notes"] as const) {
    const itemKind: MetadataItemKind = kind === "tasks" ? "task" : "note";
    application.get<{ Params: { id: string }; Querystring: { memberId?: string } }>(`/${kind}/:id/metadata`, async (request, reply) => { try { const query = itemQuerySchema.parse(request.query); return service.listLinks(request.params.id, itemKind, query.memberId); } catch (error) { return handleError(reply, error); } });
    for (const metadata of ["tags", "entities"] as const) {
      application.put<{ Params: { id: string; metadataId: string }; Body: unknown }>(`/${kind}/:id/${metadata}/:metadataId`, async (request, reply) => { try { const body = memberSchema.parse(request.body); return metadata === "tags" ? service.linkTag(request.params.id, itemKind, body.memberId, request.params.metadataId) : service.linkEntity(request.params.id, itemKind, body.memberId, request.params.metadataId); } catch (error) { return handleError(reply, error); } });
      application.delete<{ Params: { id: string; metadataId: string }; Querystring: { memberId?: string } }>(`/${kind}/:id/${metadata}/:metadataId`, async (request, reply) => { try { const query = itemQuerySchema.parse(request.query); return metadata === "tags" ? service.unlinkTag(request.params.id, itemKind, query.memberId, request.params.metadataId) : service.unlinkEntity(request.params.id, itemKind, query.memberId, request.params.metadataId); } catch (error) { return handleError(reply, error); } });
    }
  }
}

function handleError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof z.ZodError || error instanceof InvalidMetadataOperationError || error instanceof MetadataDuplicateError) return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid metadata" });
  if (error instanceof MetadataResourceNotFoundError) return reply.code(404).send({ error: error.message });
  throw error;
}
