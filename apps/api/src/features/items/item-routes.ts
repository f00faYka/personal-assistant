import type { FastifyInstance } from "fastify";
import * as z from "zod";

import { InvalidMemberItemsQueryError, ItemSearchService, MemberItemsService } from "./items.js";

const querySchema = z.object({
  memberId: z.string(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
const searchQuerySchema = z.object({
  memberId: z.string(),
  q: z.string().optional(),
  spaceId: z.string().optional(),
  unassigned: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  tagId: z.string().optional(),
  entityId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export function registerItemRoutes(application: FastifyInstance, service: MemberItemsService, searchService?: ItemSearchService): void {
  application.get<{ Querystring: Record<string, string | undefined> }>("/items", async (request, reply) => {
    try {
      const query = querySchema.parse(request.query);
      return service.list({
        memberId: query.memberId,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof InvalidMemberItemsQueryError) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid item query" });
      }
      throw error;
    }
  });
  if (searchService) {
    application.get<{ Querystring: Record<string, string | undefined> }>("/items/search", async (request, reply) => {
      try {
        const query = searchQuerySchema.parse(request.query);
        return searchService.search({
          memberId: query.memberId,
          ...(query.q === undefined ? {} : { text: query.q }),
          ...(query.spaceId === undefined ? {} : { spaceId: query.spaceId }),
          ...(query.unassigned === undefined ? {} : { unassigned: query.unassigned }),
          ...(query.tagId === undefined ? {} : { tagId: query.tagId }),
          ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        });
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof InvalidMemberItemsQueryError) {
          return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid item search" });
        }
        throw error;
      }
    });
  }
}
