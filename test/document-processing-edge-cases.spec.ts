import { DocumentStatus } from '../src/documents/document-status.enum';
import { DocumentProcessingService } from '../src/documents/document-processing.service';
import { RetryErrorClassifier } from '../src/documents/retry-error-classifier';
import { TrustPolicyService } from '../src/documents/trust-policy.service';

class InMemoryDocumentRepository {
  documents = new Map<string, any>();

  async findById(id: string) {
    return this.documents.get(id) ?? null;
  }

  async update(id: string, changes: any) {
    const current = this.documents.get(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    this.documents.set(id, next);
    return next;
  }
}

class FakeQueue {
  public enqueued: any[] = [];
  async add(name: string, payload: any, options?: any) {
    this.enqueued.push({ name, payload, options });
    return { id: `job-${this.enqueued.length}` };
  }
}

describe('DocumentProcessingService edge cases', () => {
  it('exhausts max retries, records FAILED before routing to PENDING_REVIEW', async () => {
    const repository = new InMemoryDocumentRepository();
    const queue = new FakeQueue();
    const classifier = new RetryErrorClassifier();
    const updateSpy = jest.spyOn(repository, 'update');

    let callCount = 0;
    const provider = {
      analyze: jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error('timeout'));
      }),
    };

    const service = new DocumentProcessingService({
      repository: repository as any,
      provider: provider as any,
      trustPolicy: new TrustPolicyService({ threshold: 0.5 }),
      queue: queue as any,
      classifier,
      maxAttempts: 2,
      backoffMs: 100,
    });

    const document = {
      id: 'doc-exhausted',
      contentHash: 'hash-exhausted',
      status: DocumentStatus.PROCESSING,
      attempts: 0,
      metadata: { promptText: 'x', modelId: 'm', temperature: 0.1 },
    };
    repository.documents.set(document.id, document);

    // Attempt 1: retry enqueued while preserving PROCESSING status
    await service.processDocument(document.id);
    expect(queue.enqueued).toHaveLength(1);
    expect((await repository.findById(document.id)).status).toBe(DocumentStatus.PROCESSING);
    expect((await repository.findById(document.id)).errorType).toBe('retryable');

    // Simulate Retry attempt 2: exhausted and routed through FAILED -> PENDING_REVIEW
    const doc1 = await repository.findById(document.id);
    doc1.attempts = 1;
    doc1.status = DocumentStatus.PROCESSING;

    await service.processDocument(document.id);

    const final = await repository.findById(document.id);
    expect(final.status).toBe(DocumentStatus.PENDING_REVIEW);
    expect(final.errorType).toBe('retryable');
    expect(final.lastError).toBeTruthy();
    expect(queue.enqueued).toHaveLength(1); // No more retries

    const statuses = updateSpy.mock.calls
      .map(([, changes]) => changes?.status)
      .filter((status) => status !== undefined);
    expect(statuses).toContain(DocumentStatus.FAILED);
    expect(statuses).toContain(DocumentStatus.PENDING_REVIEW);
  });

  it('handles non-retryable errors immediately (no retry enqueue)', async () => {
    const repository = new InMemoryDocumentRepository();
    const queue = new FakeQueue();
    const classifier = new RetryErrorClassifier();

    const provider = {
      analyze: jest.fn().mockRejectedValue(new Error('validation failed')),
    };

    const service = new DocumentProcessingService({
      repository: repository as any,
      provider: provider as any,
      trustPolicy: new TrustPolicyService({ threshold: 0.5 }),
      queue: queue as any,
      classifier,
      maxAttempts: 5,
      backoffMs: 100,
    });

    const document = {
      id: 'doc-non-retryable',
      contentHash: 'hash-non-retryable',
      status: DocumentStatus.PROCESSING,
      attempts: 0,
      metadata: { promptText: 'x', modelId: 'm', temperature: 0.1 },
    };
    repository.documents.set(document.id, document);

    await service.processDocument(document.id);

    const result = await repository.findById(document.id);
    expect(result.status).toBe(DocumentStatus.PENDING_REVIEW);
    expect(result.errorType).toBe('non_retryable');
    expect(result.attempts).toBe(1);
    expect(queue.enqueued).toHaveLength(0); // No retry enqueued
  });

  it('skips processing if document already in terminal state', async () => {
    const repository = new InMemoryDocumentRepository();
    const provider = { analyze: jest.fn() };

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
      id: 'doc-done',
      contentHash: 'hash-done',
      status: DocumentStatus.DONE,
      attempts: 5,
      metadata: { promptText: 'x', modelId: 'm', temperature: 0.1 },
    };
    repository.documents.set(document.id, document);

    await service.processDocument(document.id);

    expect(provider.analyze).not.toHaveBeenCalled();
    expect(repository.documents.get(document.id).attempts).toBe(5); // Unchanged
  });

  it('increments attempts counter on each retry', async () => {
    const repository = new InMemoryDocumentRepository();
    const queue = new FakeQueue();
    const classifier = new RetryErrorClassifier();

    let callCount = 0;
    const provider = {
      analyze: jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error('timeout'));
      }),
    };

    const service = new DocumentProcessingService({
      repository: repository as any,
      provider: provider as any,
      trustPolicy: new TrustPolicyService({ threshold: 0.5 }),
      queue: queue as any,
      classifier,
      maxAttempts: 4,
      backoffMs: 50,
    });

    const document = {
      id: 'doc-attempt-count',
      contentHash: 'hash-attempt-count',
      status: DocumentStatus.PROCESSING,
      attempts: 0,
      metadata: { promptText: 'x', modelId: 'm', temperature: 0.1 },
    };
    repository.documents.set(document.id, document);

    // Attempt 1
    await service.processDocument(document.id);
    expect(repository.documents.get(document.id).attempts).toBe(1);

    // Attempt 2
    let doc = await repository.findById(document.id);
    doc.status = DocumentStatus.QUEUED;
    await service.processDocument(document.id);
    expect(repository.documents.get(document.id).attempts).toBe(2);

    // Attempt 3
    doc = await repository.findById(document.id);
    doc.status = DocumentStatus.QUEUED;
    await service.processDocument(document.id);
    expect(repository.documents.get(document.id).attempts).toBe(3);
  });

  it('times out an unresponsive provider and schedules a retryable failure', async () => {
    const repository = new InMemoryDocumentRepository();
    const queue = new FakeQueue();
    const provider = { analyze: jest.fn(() => new Promise<never>(() => undefined)) };
    const service = new DocumentProcessingService({
      repository: repository as any,
      provider: provider as any,
      trustPolicy: new TrustPolicyService({ threshold: 0.5 }),
      queue: queue as any,
      classifier: new RetryErrorClassifier(),
      maxAttempts: 3,
      backoffMs: 10,
      providerTimeoutMs: 10,
    });
    const document = {
      id: 'doc-timeout',
      contentHash: 'hash-timeout',
      status: DocumentStatus.PROCESSING,
      attempts: 0,
      metadata: { promptText: 'x', modelId: 'm', temperature: 0.1 },
    };
    repository.documents.set(document.id, document);

    await service.processDocument(document.id);

    const result = await repository.findById(document.id);
    expect(result.status).toBe(DocumentStatus.PROCESSING);
    expect(result.errorType).toBe('retryable');
    expect(result.lastError).toContain('timed out');
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0].options.delay).toBe(10);
  });
});
