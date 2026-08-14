import type { FastifyInstance } from "fastify";
import * as z from "zod";

import { CaptureNotFoundError } from "../captures/capture.js";
import {
  ConcurrentNoteUpdateError,
  InvalidNoteMutationError,
  NoteNotFoundError,
  NoteService,
} from "./outcome.js";

const noteEditSchema = z.object({
  memberId: z.string(),
  expectedVersion: z.number().int().nonnegative(),
  content: z.string(),
});

const noteSaveSchema = z.object({ memberId: z.string(), content: z.string() });

interface ReviewReader {
  get(captureId: string): {
    capture: { id: string; memberId: string };
    source: { id: string };
    transcription: { status: string } | null;
    interpretation: { id: string } | null;
  };
}

export function registerOutcomeRoutes(application: FastifyInstance, noteService: NoteService, reviewReader?: ReviewReader): void {
  if (reviewReader) {
    application.post<{ Params: { id: string }; Body: unknown }>("/captures/:id/review/note", async (request, reply) => {
      try {
        const body = noteSaveSchema.parse(request.body);
        const review = reviewReader.get(request.params.id);
        if (body.memberId !== review.capture.memberId) return reply.code(403).send({ error: "Member cannot save another Member's review" });
        if (review.transcription?.status !== "succeeded" || review.interpretation === null) {
          return reply.code(409).send({ error: "review is not ready to save as a Note" });
        }
        const note = noteService.saveFromReview({
          memberId: body.memberId,
          interpretationId: review.interpretation.id,
          captureId: review.capture.id,
          sourceId: review.source.id,
          content: body.content,
        });
        return reply.code(201).send({ note });
      } catch (error) {
        if (error instanceof CaptureNotFoundError) return reply.code(404).send({ error: error.message });
        if (error instanceof z.ZodError || isNoteMutationError(error)) return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid Note save" });
        throw error;
      }
    });
  }

  application.patch<{ Params: { id: string }; Body: unknown }>("/notes/:id", async (request, reply) => {
    try {
      const body = noteEditSchema.parse(request.body);
      return { note: noteService.edit(request.params.id, body.memberId, body.expectedVersion, { content: body.content }) };
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof InvalidNoteMutationError) return reply.code(400).send({ error: error.message });
      if (error instanceof NoteNotFoundError) return reply.code(404).send({ error: error.message });
      if (error instanceof ConcurrentNoteUpdateError) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
}

function isNoteMutationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "InvalidNoteMutationError";
}
