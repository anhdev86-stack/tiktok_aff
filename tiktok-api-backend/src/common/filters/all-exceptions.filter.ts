import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type FastifyReply, type FastifyRequest } from 'fastify';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Internal server error';
    let error: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const obj = res as { message?: unknown; error?: string };
        if (obj.message !== undefined) message = obj.message;
        error = obj.error;
      }
    } else if (exception instanceof Error) {
      // Không leak stack/message của Error chưa biết → dùng generic
      message = 'Internal server error';
    }

    if (status >= 500) {
      this.logger.error(
        `[${req.method}] ${req.url} -> ${status}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    reply.status(status).send({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
