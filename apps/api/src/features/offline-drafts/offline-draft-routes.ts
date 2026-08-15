import type { FastifyInstance } from "fastify";
import * as z from "zod";

import {
  ConflictingOfflineDraftError,
  InvalidOfflineDraftError,
  OfflineDraftNotFoundError,
  OfflineDraftService,
} from "./offline-draft.js";

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("audio"), audioBase64: z.string(), contentType: z.string() }),
  z.object({ kind: z.literal("text"), text: z.string() }),
]);
const syncSchema = z.object({ draftId: z.string(), memberId: z.string(), capturedAt: z.string(), source: sourceSchema });

export function registerOfflineDraftRoutes(application: FastifyInstance, service: OfflineDraftService): void {
  application.post<{ Body: unknown }>("/offline-drafts/sync", async (request, reply) => {
    try {
      const body = syncSchema.parse(request.body);
      const source = body.source.kind === "audio"
        ? { kind: "audio" as const, audio: decodeBase64(body.source.audioBase64), contentType: body.source.contentType }
        : body.source;
      return { draft: await service.sync({ draftId: body.draftId, memberId: body.memberId, capturedAt: body.capturedAt, source }) };
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof InvalidOfflineDraftError) return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid Offline draft" });
      if (error instanceof ConflictingOfflineDraftError) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  application.get<{ Params: { id: string }; Querystring: { memberId?: string } }>("/offline-drafts/:id", async (request, reply) => {
    try {
      if (!request.query.memberId) return reply.code(400).send({ error: "memberId is required" });
      return { draft: service.get(request.query.memberId, request.params.id) };
    } catch (error) {
      if (error instanceof OfflineDraftNotFoundError) return reply.code(404).send({ error: error.message });
      throw error;
    }
  });
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new InvalidOfflineDraftError("audioBase64 must be valid base64");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new InvalidOfflineDraftError("audioBase64 must be valid base64");
  return new Uint8Array(decoded);
}
