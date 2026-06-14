import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid fields.",
          details: {
            fields: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          requestId: request.id,
        },
      });
    }

    if (
      "code" in error &&
      (error as FastifyError & { code?: string }).code === "23505"
    ) {
      return reply.status(409).send({
        error: {
          code: "RESOURCE_CONFLICT",
          message: "A record with this value already exists.",
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.status(error.statusCode ?? 500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: request.id,
      },
    });
  });
}
