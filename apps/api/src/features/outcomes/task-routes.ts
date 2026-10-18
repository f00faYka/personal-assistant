import type { FastifyInstance, FastifyReply } from "fastify";
import * as z from "zod";

import { ConcurrentTaskUpdateError, InvalidTaskMutationError, TaskNotFoundError, TaskOperationMismatchError, TaskService, type TaskChanges } from "./outcome.js";

const taskEditSchema = z.object({
  memberId: z.string(),
  expectedVersion: z.number().int().nonnegative(),
  title: z.string().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});
const taskCompleteSchema = z.object({ memberId: z.string(), expectedVersion: z.number().int().nonnegative() });
const taskEditOperationSchema = taskEditSchema.extend({
  memberId: z.string().min(1),
  operationId: z.string().min(1),
  dueAt: z.string().datetime().nullable().optional(),
}).strict();
const taskCompleteOperationSchema = taskCompleteSchema.extend({ memberId: z.string().min(1), operationId: z.string().min(1) }).strict();

export function registerTaskRoutes(application: FastifyInstance, taskService: TaskService): void {
  application.patch<{ Params: { id: string }; Body: unknown }>("/tasks/:id", async (request, reply) => {
    const operationRequest = hasOperationId(request.body);
    try {
      if (operationRequest) {
        const body = taskEditOperationSchema.parse(request.body);
        const changes: Omit<TaskChanges, "status"> = {
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.dueAt === undefined ? {} : { dueAt: body.dueAt }),
        };
        return { task: taskService.editWithOperation(request.params.id, body.memberId, body.expectedVersion, body.operationId, changes) };
      }
      const body = taskEditSchema.parse(request.body);
      const { memberId, expectedVersion } = body;
      const changes: TaskChanges = {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.dueAt === undefined ? {} : { dueAt: body.dueAt }),
      };
      return { task: taskService.edit(request.params.id, memberId, expectedVersion, changes) };
    } catch (error) {
      const response = taskMutationErrorResponse(error, reply, operationRequest, "invalid Task edit");
      if (response) return response;
      throw error;
    }
  });

  application.post<{ Params: { id: string }; Body: unknown }>("/tasks/:id/complete", async (request, reply) => {
    const operationRequest = hasOperationId(request.body);
    try {
      if (operationRequest) {
        const body = taskCompleteOperationSchema.parse(request.body);
        return { task: taskService.completeWithOperation(request.params.id, body.memberId, body.expectedVersion, body.operationId) };
      }
      const { memberId, expectedVersion } = taskCompleteSchema.parse(request.body);
      return { task: taskService.complete(request.params.id, memberId, expectedVersion) };
    } catch (error) {
      const response = taskMutationErrorResponse(error, reply, operationRequest, "invalid Task completion");
      if (response) return response;
      throw error;
    }
  });

  application.post<{ Params: { id: string }; Body: unknown }>("/tasks/:id/reopen", async (request, reply) => {
    try {
      const { memberId, expectedVersion, operationId } = taskCompleteOperationSchema.parse(request.body);
      return { task: taskService.reopen(request.params.id, memberId, expectedVersion, operationId) };
    } catch (error) {
      const response = taskMutationErrorResponse(error, reply, true, "invalid Task reopen");
      if (response) return response;
      throw error;
    }
  });
}

function taskMutationErrorResponse(error: unknown, reply: FastifyReply, operationKeyed: boolean, fallback: string): FastifyReply | undefined {
  if (error instanceof z.ZodError || error instanceof InvalidTaskMutationError) {
    const message = error instanceof Error ? error.message : fallback;
    return reply.code(400).send(operationKeyed ? { error: message, code: "validation_error" } : { error: message });
  }
  if (error instanceof TaskNotFoundError) {
    return reply.code(404).send(operationKeyed ? { error: error.message, code: "task_not_found" } : { error: error.message });
  }
  if (error instanceof TaskOperationMismatchError) {
    return reply.code(409).send({ error: error.message, code: "idempotency_key_mismatch" });
  }
  if (error instanceof ConcurrentTaskUpdateError) {
    const currentTask = operationKeyed && error.currentTask !== undefined ? { task: error.currentTask } : {};
    return reply.code(409).send(operationKeyed
      ? { error: error.message, code: "task_version_conflict", ...currentTask }
      : { error: error.message });
  }
  return undefined;
}

function hasOperationId(value: unknown): value is { operationId: unknown } {
  return typeof value === "object" && value !== null && "operationId" in value;
}
