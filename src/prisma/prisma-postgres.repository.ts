import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { DocumentRepository } from '../documents/document-repository.port';
import { DocumentStatus } from '../documents/document-status.enum';
import { StoredDocument } from '../documents/document.types';
import { config } from '../config';

@Injectable()
export class PrismaPostgresRepository extends DocumentRepository {
  private readonly prisma: PrismaClient;

  constructor() {
    super();
    // Apenas tenta conectar em modo real
    if (config.mock.enabled) {
      this.prisma = null as any;
      return;
    }
    this.prisma = new PrismaClient({ adapter: new PrismaPg(config.database.url) });
  }

  async create(document: Omit<StoredDocument, 'createdAt' | 'updatedAt'> & { createdAt?: Date; updatedAt?: Date }): Promise<StoredDocument> {
    const created = await this.prisma.document.create({
      data: {
        id: document.id,
        contentHash: document.contentHash,
        filename: document.filename,
        mimeType: document.mimeType,
        storagePath: document.storagePath,
        status: document.status,
        attempts: document.attempts,
        confidence: document.confidence ?? null,
        result: (document.result ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        provenance: document.provenance ?? Prisma.JsonNull,
        errorType: document.errorType ?? null,
        lastError: document.lastError ?? null,
        createdAt: document.createdAt ?? new Date(),
        updatedAt: document.updatedAt ?? new Date(),
      },
    });

    return this.mapEntity(created);
  }

  async findById(id: string): Promise<StoredDocument | null> {
    const found = await this.prisma.document.findUnique({ where: { id } });
    return found ? this.mapEntity(found) : null;
  }

  async findByContentHash(contentHash: string): Promise<StoredDocument | null> {
    const found = await this.prisma.document.findUnique({ where: { contentHash } });
    return found ? this.mapEntity(found) : null;
  }

  async update(id: string, changes: Partial<StoredDocument>): Promise<StoredDocument | null> {
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        status: changes.status,
        attempts: changes.attempts,
        confidence: changes.confidence ?? null,
        result: (changes.result ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        provenance: changes.provenance ?? Prisma.JsonNull,
        errorType: changes.errorType ?? null,
        lastError: changes.lastError ?? null,
        updatedAt: changes.updatedAt ?? new Date(),
      },
    });

    return this.mapEntity(updated);
  }

  async listByStatus(status?: DocumentStatus): Promise<StoredDocument[]> {
    const list = await this.prisma.document.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return list.map((item: any) => this.mapEntity(item));
  }

  private mapEntity(entity: any): StoredDocument {
    return {
      id: entity.id,
      contentHash: entity.contentHash,
      filename: entity.filename,
      mimeType: entity.mimeType,
      storagePath: entity.storagePath,
      status: entity.status as DocumentStatus,
      attempts: entity.attempts,
      confidence: entity.confidence ?? undefined,
      result: entity.result ?? null,
      provenance: entity.provenance ?? null,
      errorType: entity.errorType ?? null,
      lastError: entity.lastError ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
