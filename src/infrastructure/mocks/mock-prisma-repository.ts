/**
 * Mock Prisma Repository
 *
 * Simula o comportamento de um repositório Prisma para testes em ambiente
 * de desenvolvimento sem necessidade de banco de dados real.
 *
 * Armazena dados em memória.
 */

import { Injectable } from '@nestjs/common';
import { DocumentRepository } from '../../documents/document-repository.port';
import { DocumentStatus } from '../../documents/document-status.enum';
import { StoredDocument } from '../../documents/document.types';

@Injectable()
export class MockPrismaRepository extends DocumentRepository {
  private documents: Map<string, StoredDocument> = new Map();

  async create(
    document: Omit<StoredDocument, 'createdAt' | 'updatedAt'> & {
      createdAt?: Date;
      updatedAt?: Date;
    },
  ): Promise<StoredDocument> {
    const now = new Date();
    const stored: StoredDocument = {
      ...document,
      createdAt: document.createdAt ?? now,
      updatedAt: document.updatedAt ?? now,
    };

    this.documents.set(document.id, stored);
    return stored;
  }

  async findById(id: string): Promise<StoredDocument | null> {
    return this.documents.get(id) ?? null;
  }

  async findByContentHash(contentHash: string): Promise<StoredDocument | null> {
    for (const doc of this.documents.values()) {
      if (doc.contentHash === contentHash) {
        return doc;
      }
    }
    return null;
  }

  async update(id: string, changes: Partial<StoredDocument>): Promise<StoredDocument | null> {
    const doc = this.documents.get(id);
    if (!doc) {
      return null;
    }

    const updated: StoredDocument = {
      ...doc,
      ...changes,
      updatedAt: changes.updatedAt ?? new Date(),
    };

    this.documents.set(id, updated);
    return updated;
  }

  async listByStatus(status?: DocumentStatus): Promise<StoredDocument[]> {
    const list = Array.from(this.documents.values());
    return status ? list.filter((doc) => doc.status === status) : list;
  }

  async clear(): Promise<void> {
    this.documents.clear();
  }
}

export const createMockPrismaRepository = () => new MockPrismaRepository();
