import { DocumentStatus } from './document-status.enum';
import { StoredDocument } from './document.types';

export abstract class DocumentRepository {
  abstract create(document: Omit<StoredDocument, 'createdAt' | 'updatedAt'> & {
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<StoredDocument>;

  abstract findById(id: string): Promise<StoredDocument | null>;

  abstract findByContentHash(contentHash: string): Promise<StoredDocument | null>;

  abstract update(id: string, changes: Partial<StoredDocument>): Promise<StoredDocument | null>;

  abstract listByStatus(status?: DocumentStatus): Promise<StoredDocument[]>;
}
