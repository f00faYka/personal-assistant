import type { FastifyInstance } from "fastify";
import * as z from "zod";

import { ConcurrentTaskUpdateError, InvalidTaskMutationError, TaskNotFoundError, TaskService, type TaskChanges } from "./outcome.js";

const taskEditSchema = z.object({ memberId: z.string(), expectedVersion: z.number().int().nonnegative(), title: z.string().optional(), dueAt: z.string().datetime({ offset: true }).nullable().optional() });

export function registerTaskRoutes(application: FastifyInstance, taskService: TaskService): void {
  application.patch<{ Params: { id: string }; Body: unknown }>("/tasks/:id", async (request, reply) => {
    try {
      const body = taskEditSchema.parse(request.body);
      const { memberId, expectedVersion } = body;
      const changes: TaskChanges = {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.dueAt === undefined ? {} : { dueAt: body.dueAt }),
      };
      return { task: taskService.edit(request.params.id, memberId, expectedVersion, changes) };
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof InvalidTaskMutationError) return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid Task edit" });
      if (error instanceof TaskNotFoundError) return reply.code(404).send({ error: error.message });
      if (error instanceof ConcurrentTaskUpdateError) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
}
