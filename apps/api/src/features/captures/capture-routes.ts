import type { FastifyInstance } from "fastify";
import * as z from "zod";

import {
  CaptureNotFoundError,
  CaptureService,
  ConflictingCaptureRetryError,
  InvalidCaptureSubmissionError,
} from "./capture.js";

const submissionSchema = z.object({
  memberId: z.string(),
  idempotencyKey: z.string(),
  audioBase64: z.string(),
  contentType: z.string(),
  capturedAt: z.string(),
});

export function registerCaptureRoutes(application: FastifyInstance, service: CaptureService): void {
  application.post<{ Body: unknown }>("/captures", async (request, reply) => {
    try {
      const body = submissionSchema.parse(request.body);
      const capture = await service.submit({
        memberId: body.memberId,
        idempotencyKey: body.idempotencyKey,
        audio: decodeBase64(body.audioBase64),
        contentType: body.contentType,
        capturedAt: body.capturedAt,
      });
      return reply.code(201).send({ capture });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof InvalidCaptureSubmissionError) {
        return reply.code(400).send({ error: error.message });
      }
      if (error instanceof ConflictingCaptureRetryError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  application.get<{ Params: { id: string } }>("/captures/:id", async (request, reply) => {
    try {
      return { capture: service.get(request.params.id) };
    } catch (error) {
      if (error instanceof CaptureNotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new InvalidCaptureSubmissionError("audioBase64 must be valid base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new InvalidCaptureSubmissionError("audioBase64 must be valid base64");
  }
  return new Uint8Array(decoded);
}
