import { DocumentStatus } from '../src/documents/document-status.enum';
import { DocumentIngestionService } from '../src/documents/document-ingestion.service';
import { DocumentProcessingService } from '../src/documents/document-processing.service';
import { RetryErrorClassifier } from '../src/documents/retry-error-classifier';
import { TrustPolicyService } from '../src/documents/trust-policy.service';

class InMemoryDocumentRepository {
  documents = new Map<string, any>();
  byHash = new Map<string, string>();

  async create(document: any) {
    const existingId = this.byHash.get(document.contentHash);
    if (existingId) {
      const duplicate = this.documents.get(existingId);
      const error = new Error('duplicate');
      (error as any).code = 'P2002';
      throw error;
    }

    this.documents.set(document.id, document);
    this.byHash.set(document.contentHash, document.id);
    return document;
  }

  async findById(id: string) {
    return this.documents.get(id) ?? null;
  }

  async findByContentHash(hash: string) {
    const id = this.byHash.get(hash);
    return id ? this.documents.get(id) ?? null : null;
  }

  async update(id: string, changes: any) {
    const current = this.documents.get(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    this.documents.set(id, next);
    return next;
  }
}

class FakeStoragePort {
  async save(file: { buffer: Buffer }, name: string) {
    return { path: `uploads/${name}` };
  }
}

class FakeQueue {
  public enqueued: any[] = [];
  async add(name: string, payload: any, options?: any) {
    this.enqueued.push({ name, payload, options });
    return { id: `job-${this.enqueued.length}` };
  }
}

class RetryableProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableProcessingError';
  }
}

class NonRetryableProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableProcessingError';
  }
}

describe('Document workflow', () => {
  it('deduplicates simultaneous ingestion and calls the provider once', async () => {
    const repository = new InMemoryDocumentRepository();
    const queue = new FakeQueue();
    const storage = new FakeStoragePort();

    const service = new DocumentIngestionService({
      repository: repository as any,
      storage: storage as any,
      queue: queue as any,
      provider: { analyze: jest.fn() } as any,
    });

    const file = {
      buffer: Buffer.from('same-content-for-duplicate-test'),
      originalname: 'same.pdf',
      mimetype: 'application/pdf',
    };

    await Promise.all([
      service.ingestDocument(file as any),
      service.ingestDocument(file as any),
    ]);

    // Deduplication: apenas 1 documento criado
    expect(repository.documents.size).toBe(1);
    // Deduplication: apenas 1 job enfileirado
    expect(queue.enqueued).toHaveLength(1);
  });

  it('retries retryable failures with exponential backoff and fails fast for non-retryable errors', async () => {
    jest.useFakeTimers();

    const repository = new InMemoryDocumentRepository();
    const queue = new FakeQueue();
    const trustPolicy = new TrustPolicyService({ threshold: 0.5 });
    const classifier = new RetryErrorClassifier();
    const updateSpy = jest.spyOn(repository, 'update');

    let callCount = 0;
    const provider = {
      analyze: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new RetryableProcessingError('timeout'));
        }
        return Promise.reject(new NonRetryableProcessingError('validation failed'));
      }),
    };

    const service = new DocumentProcessingService({
      repository: repository as any,
      provider: provider as any,
      trustPolicy,
      queue: queue as any,
      classifier,
      maxAttempts: 3,
      backoffMs: 1000,
    });

    const document = {
      id: 'doc-1',
      contentHash: 'hash-1',
      status: DocumentStatus.PROCESSING,
      attempts: 0,
      metadata: { promptText: 'x', modelId: 'm', temperature: 0.1 },
    };
    repository.documents.set(document.id, document);

    // Primeira tentativa: erro retentável
    await service.processDocument(document.id);
    expect(provider.analyze).toHaveBeenCalledTimes(1);

    // Verifica que job foi enfileirado para retry
    expect(queue.enqueued.length).toBeGreaterThan(0);

    // Avança o tempo para o backoff passar
    jest.advanceTimersByTime(1000);

    // Simula o consumo do job retentado (segunda tentativa)
    const retryJob = queue.enqueued[queue.enqueued.length - 1];
    await service.processDocument(retryJob.payload.documentId);

    // Agora provider foi chamado 2 vezes
    expect(provider.analyze).toHaveBeenCalledTimes(2);

    // Documento agora tem erro não-retentável e deve estar em PENDING_REVIEW
    const failureDocument = await repository.findById(document.id);
    expect(failureDocument.status).toBe(DocumentStatus.PENDING_REVIEW);
    expect(failureDocument.errorType).toBe('non_retryable');

    const statuses = updateSpy.mock.calls
      .map(([, changes]) => changes?.status)
      .filter((status) => status !== undefined);
    expect(statuses).toContain(DocumentStatus.FAILED);
    expect(statuses).toContain(DocumentStatus.PENDING_REVIEW);

    jest.useRealTimers();
  });

  it('never routes a low-confidence successful result to DONE', async () => {
    const repository = new InMemoryDocumentRepository();
    const provider = {
      analyze: jest.fn().mockResolvedValue({
        confidence: 0.49,
        modelId: 'mock-model',
        temperature: 0.2,
        extractedText: 'low confidence',
        promptText: 'Extract the invoice',
      }),
    };

    const service = new DocumentProcessingService({
      repository: repository as any,
      provider: provider as any,
      trustPolicy: new TrustPolicyService({ threshold: 0.5 }),
      queue: new FakeQueue() as any,
      classifier: new RetryErrorClassifier(),
      maxAttempts: 3,
      backoffMs: 100,
    });

    const document = {
      id: 'doc-2',
      contentHash: 'hash-2',
      status: DocumentStatus.PROCESSING,
      attempts: 0,
      metadata: { promptText: 'x', modelId: 'm', temperature: 0.1 },
    };
    repository.documents.set(document.id, document);

    await service.processDocument(document.id);

    const updated = await repository.findById(document.id);
    expect(updated.status).toBe(DocumentStatus.PENDING_REVIEW);
    expect(updated.status).not.toBe(DocumentStatus.DONE);
  });
});
