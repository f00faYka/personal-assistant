import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

export function buildApi(options: FastifyServerOptions = {}): FastifyInstance {
  const application = Fastify(options);

  application.get("/health", async () => ({ status: "ok" }));

  return application;
}
