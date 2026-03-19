import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * In non-production, include the underlying error message so API clients (and the
 * Vite `/api` proxy) surface actionable failures instead of a generic 500.
 */
@Catch()
export class DevVerboseExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : (body as Record<string, unknown>);
      return res.status(status).json(payload);
    }

    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    const isProd = process.env.NODE_ENV === 'production';
    const msg = exception instanceof Error ? exception.message : String(exception);
    const name = exception instanceof Error ? exception.name : 'Error';

    return res.status(status).json({
      statusCode: status,
      message: isProd ? 'Internal server error' : msg,
      ...(!isProd && { error: name }),
    });
  }
}
