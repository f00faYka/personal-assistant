import type { FastifyInstance } from "fastify";
import * as z from "zod";

import { InvalidMemberItemsQueryError, MemberItemsService } from "./items.js";

const querySchema = z.object({
  memberId: z.string(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export function registerItemRoutes(application: FastifyInstance, service: MemberItemsService): void {
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
}
