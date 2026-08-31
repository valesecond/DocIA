import { createHash } from 'crypto';
import { DocumentIngestionService } from '../../src/documents/document-ingestion.service';
import { DocumentProcessingService } from '../../src/documents/document-processing.service';
import { DocumentStatus } from '../../src/documents/document-status.enum';
import { RetryErrorClassifier } from '../../src/documents/retry-error-classifier';
import { TrustPolicyService } from '../../src/documents/trust-policy.service';
import { PrismaPostgresRepository } from '../../src/prisma/prisma-postgres.repository';

class IntegrationStorage {
  async save(input: { originalname: string }, documentId: string) {
    return { path: `${documentId}-${input.originalname}` };
  }
}

class IntegrationQueue {
  jobs: Array<{ documentId: string }> = [];

  async add(_name: string, payload: { documentId: string }) {
    this.jobs.push(payload);
    return { id: `job-${this.jobs.length}` };
  }
}

describe('Document deduplication with PostgreSQL', () => {
  it('creates one row and processes one provider call under concurrent ingestion', async () => {
    const repository = new PrismaPostgresRepository();
    const prisma = (repository as any).prisma;
    const content = Buffer.from('%PDF-1.7\nreal integration document');
    const contentHash = createHash('sha256').update(content).digest('hex');
    await prisma.document.deleteMany({ where: { contentHash } });

    const queue = new IntegrationQueue();
    const provider = {
      analyze: jest.fn().mockResolvedValue({
        confidence: 0.95,
        extractedText: 'integration result',
        promptText: 'integration prompt',
        modelId: 'integration-model',
        temperature: 0,
      }),
    };
    const ingestion = new DocumentIngestionService({
      repository,
      storage: new IntegrationStorage() as any,
      queue: queue as any,
      provider: provider as any,
    });

    const results = await Promise.all([
      ingestion.ingestDocument({ buffer: content, originalname: 'same.pdf', mimetype: 'application/pdf' }),
      ingestion.ingestDocument({ buffer: content, originalname: 'renamed.pdf', mimetype: 'application/octet-stream' }),
    ]);

    expect(results.filter((result) => !result.existing)).toHaveLength(1);
    expect(results.filter((result) => result.existing)).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);

    const processing = new DocumentProcessingService({
      repository,
      provider: provider as any,
      trustPolicy: new TrustPolicyService({ threshold: 0.8 }),
      queue: queue as any,
      classifier: new RetryErrorClassifier(),
      maxAttempts: 3,
      backoffMs: 10,
      providerTimeoutMs: 45000,
    });
    await processing.processDocument(queue.jobs[0].documentId);

    const count = await prisma.document.count({ where: { contentHash } });
    expect(count).toBe(1);
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    const processedDocument = await repository.findById(queue.jobs[0].documentId);
    expect(processedDocument?.status).toBe(DocumentStatus.DONE);
    await prisma.document.deleteMany({ where: { contentHash } });
    await prisma.$disconnect();
  }, 30000);
});
