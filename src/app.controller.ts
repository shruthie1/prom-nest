import { Controller, Get, Post, Body, ValidationPipe, Logger, HttpException, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import * as https from 'https';
import { URL } from 'url';

@ApiTags('App')
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private readonly DEFAULT_TIMEOUT = 30000;
  private readonly MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB

  constructor() {}

  @Get()
  getHello(): string {
    return 'Hello World!';
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHeaders = ['authorization', 'cookie', 'proxy-authorization', 'x-api-key'];
    const sanitized = { ...headers };
    sensitiveHeaders.forEach(header => {
      Object.keys(sanitized).forEach(key => {
        if (key.toLowerCase() === header.toLowerCase()) {
          sanitized[key] = '[REDACTED]';
        }
      });
    });

    return sanitized;
  }

  private isBinaryResponse(responseType: string, contentType?: string): boolean {
    if (responseType === 'arraybuffer') return true;

    if (contentType) {
      const binaryTypes = [
        'application/octet-stream',
        'image/',
        'audio/',
        'video/',
        'application/pdf',
        'application/zip',
        'application/x-zip-compressed',
        'application/binary'
      ];

      return binaryTypes.some(type => contentType.toLowerCase().includes(type.toLowerCase()));
    }

    return false;
  }

  private handleRequestError(error: any, requestId: string): any {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      // Handle specific error types
      if (axiosError.code === 'ECONNABORTED') {
        return {
          status: HttpStatus.GATEWAY_TIMEOUT,
          error: 'Request timeout',
          message: 'The request took too long to complete',
          requestId
        };
      }

      if (axiosError.code === 'ECONNREFUSED') {
        return {
          status: HttpStatus.BAD_GATEWAY,
          error: 'Connection refused',
          message: 'Could not connect to the target server',
          requestId
        };
      }

      if (axiosError.response) {
        return {
          status: axiosError.response.status,
          headers: this.sanitizeHeaders(axiosError.response.headers as Record<string, string>),
          data: axiosError.response.data,
          requestId
        };
      }

      if (axiosError.request) {
        return {
          status: HttpStatus.BAD_GATEWAY,
          error: 'No response',
          message: 'The request was made but no response was received',
          code: axiosError.code,
          requestId
        };
      }

      return {
        status: HttpStatus.BAD_GATEWAY,
        error: axiosError.code || 'Request failed',
        message: axiosError.message,
        requestId
      };
    }

    // Handle non-Axios errors
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal server error',
      message: error.message || 'An unexpected error occurred',
      requestId
    };
  }
}
