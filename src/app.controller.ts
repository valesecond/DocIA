import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { DocumentIngestionService } from './documents/document-ingestion.service';
import { DocumentRepository } from './documents/document-repository.port';
import { DocumentStatus } from './documents/document-status.enum';

@Controller()
export class AppController {
  constructor(
    private readonly ingestionService: DocumentIngestionService,
    private readonly repository: DocumentRepository,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'DOC Intelligence - Trilha A',
    };
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  async createDocument(@UploadedFile() file: any, @Res({ passthrough: true }) res: Response) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const buffer = file.buffer ?? Buffer.alloc(0);
    if (buffer.length < 4) {
      throw new BadRequestException('Invalid document content');
    }

    const header = buffer.subarray(0, 8).toString('hex');
    const isPdf = header.startsWith('255044462d'); // %PDF-
    const isPng = header.startsWith('89504e470d0a1a0a');
    const isJpeg = buffer.subarray(0, 2).toString('hex') === 'ffd8';

    if (!isPdf && !isPng && !isJpeg) {
      throw new BadRequestException('Unsupported file type');
    }

    const result = await this.ingestionService.ingestDocument({
      buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });

    res.status(result.existing ? 200 : 202);
    return {
      id: result.id,
      status: result.status,
      duplicate: result.existing,
    };
  }

  @Get('documents')
  async listDocuments(@Query('status') status?: DocumentStatus) {
    return this.repository.listByStatus(status);
  }

  @Get('documents/:id')
  async getDocument(@Param('id') id: string) {
    const document = await this.repository.findById(id);
    if (!document) {
      return { id, status: DocumentStatus.FAILED, result: null, confidence: null, provenance: null };
    }

    return {
      id: document.id,
      status: document.status,
      result: document.result ?? null,
      confidence: document.confidence ?? null,
      provenance: document.provenance ?? null,
    };
  }

}
