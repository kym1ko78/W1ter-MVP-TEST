import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { ATTACHMENT_MAX_MB } from "./attachment-rules";

@Catch()
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const isMulterError =
      typeof exception === "object" &&
      exception !== null &&
      "name" in exception &&
      (exception as { name?: string }).name === "MulterError";

    if (!isMulterError) {
      throw exception;
    }

    const errorCode =
      "code" in (exception as Record<string, unknown>)
        ? (exception as { code?: string }).code
        : undefined;
    const response = host.switchToHttp().getResponse<Response>();

    if (errorCode === "LIMIT_FILE_SIZE") {
      response.status(400).json({
        statusCode: 400,
        message: `Размер файла не должен превышать ${ATTACHMENT_MAX_MB} MB.`,
        error: "Bad Request",
      });
      return;
    }

    response.status(400).json({
      statusCode: 400,
      message: "Не удалось обработать загруженный файл.",
      error: "Bad Request",
    });
  }
}
