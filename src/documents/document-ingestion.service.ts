import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DocumentStatus } from './document-status.enum';
import { DocumentRepository } from './document-repository.port';
import { StoragePort } from './storage-port';
import { DocumentIntelligenceProvider } from './document-intelligence-provider.port';

export type IngestionDependencies = {
  repository: DocumentRepository;
  storage: StoragePort;
  queue: { add: (jobName: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ id: string }> };
  provider: DocumentIntelligenceProvider;
};

@Injectable()
export class DocumentIngestionService {
  constructor(private readonly deps: IngestionDependencies) {}

  private static computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async ingestDocument(file: {
    buffer: Buffer;
    originalname: string;
    mimetype?: string;
  }): Promise<{ id: string; status: DocumentStatus; existing: boolean }> {
    const contentHash = DocumentIngestionService.computeHash(file.buffer);
    const existing = await this.deps.repository.findByContentHash(contentHash);
    if (existing) {
      return { id: existing.id, status: existing.status, existing: true };
    }

    const documentId = randomUUID();
    const saved = await this.deps.storage.save(file, documentId);

    const document = {
      id: documentId,
      contentHash,
      filename: file.originalname,
      mimeType: file.mimetype ?? 'application/octet-stream',
      storagePath: saved.path,
      status: DocumentStatus.RECEIVED,
      attempts: 0,
      confidence: undefined,
      result: null,
      provenance: null,
      errorType: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await this.deps.repository.create(document);
    } catch (error) {
      const duplicate = await this.deps.repository.findByContentHash(contentHash);
      if (duplicate) {
        return { id: duplicate.id, status: duplicate.status, existing: true };
      }
      throw error;
    }

    await this.deps.queue.add('document-processing', { documentId }, { attempts: 1 });
    return { id: documentId, status: DocumentStatus.RECEIVED, existing: false };
  }
}
