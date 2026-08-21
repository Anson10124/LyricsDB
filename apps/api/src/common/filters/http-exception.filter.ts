import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "An internal server error occurred.";
    let error = "Internal Server Error";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === "string") {
        message = res;
      } else if (typeof res === "object" && res !== null) {
        const resObj = res as Record<string, unknown>;
        if (Array.isArray(resObj.message)) {
          message = resObj.message.join("; ");
        } else if (typeof resObj.message === "string") {
          message = resObj.message;
        }
        if (typeof resObj.error === "string") {
          error = resObj.error;
        }
      }
    } else if (exception instanceof Error) {
      if (
        exception.name === "ProviderRateLimitedError" ||
        exception.name === "ThrottlerException"
      ) {
        status = HttpStatus.TOO_MANY_REQUESTS;
        message = exception.message;
        error = "Too Many Requests";
      } else if (exception.name === "SsrfError") {
        status = HttpStatus.BAD_REQUEST;
        message = exception.message;
        error = "Bad Request";
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        error = "Internal Server Error";
        // Do not leak internal database errors or stack messages to API consumers in production
        message =
          process.env.NODE_ENV === "production"
            ? "An internal server error occurred."
            : exception.message;
      }
    }

    if (status >= 500) {
      this.logger.error(
        `[${status}] ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    if (!response.headersSent) {
      response.status(status).json({
        statusCode: status,
        message,
        error,
      });
    }
  }
}
