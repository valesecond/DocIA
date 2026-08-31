import { Injectable } from '@nestjs/common';
import { DocumentStatus } from './document-status.enum';
import { RetryErrorClassifier } from './retry-error-classifier';
import { TrustPolicyService } from './trust-policy.service';
import { DocumentIntelligenceProvider } from './document-intelligence-provider.port';
import { DocumentRepository } from './document-repository.port';

export type ProcessingDependencies = {
  repository: DocumentRepository;
  provider: DocumentIntelligenceProvider;
  trustPolicy: TrustPolicyService;
  queue: {
    add: (jobName: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ id: string }>;
  };
  classifier: RetryErrorClassifier;
  maxAttempts: number;
  backoffMs: number;
  providerTimeoutMs?: number;
};

class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider analysis timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

@Injectable()
export class DocumentProcessingService {
  constructor(private readonly deps: ProcessingDependencies) {}

  async processDocument(documentId: string): Promise<void> {
    const document = await this.deps.repository.findById(documentId);
    if (!document) {
      return;
    }

    if (document.status === DocumentStatus.DONE || document.status === DocumentStatus.PENDING_REVIEW || document.status === DocumentStatus.FAILED) {
      return;
    }

    await this.deps.repository.update(documentId, { status: DocumentStatus.PROCESSING, updatedAt: new Date() });

    try {
      const analysis = this.deps.provider.analyze({
        documentId,
        storagePath: document.storagePath,
        contentHash: document.contentHash,
        mimeType: document.mimeType,
        filename: document.filename,
      });
      const timeoutMs = this.deps.providerTimeoutMs ?? 45000;
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new ProviderTimeoutError(timeoutMs)), timeoutMs);
      });
      const result = await Promise.race([analysis, timeout]).finally(() => clearTimeout(timeoutHandle));

      const shouldApprove = this.deps.trustPolicy.shouldApprove(result.confidence);
      const updated: Partial<typeof document> = {
        confidence: result.confidence,
        result: { ...result },
        provenance: { promptText: result.promptText, modelId: result.modelId, temperature: result.temperature },
        status: shouldApprove ? DocumentStatus.DONE : DocumentStatus.PENDING_REVIEW,
        updatedAt: new Date(),
      };

      if (!shouldApprove) {
        updated.errorType = null;
        updated.lastError = null;
      }

      await this.deps.repository.update(documentId, updated);
    } catch (error) {
      const kind = this.deps.classifier.classify(error);
      const nextAttempt = document.attempts + 1;
      const retryable = kind === 'retryable';
      const shouldRetry = retryable && nextAttempt < this.deps.maxAttempts;

      if (shouldRetry) {
        const retryDelay = this.deps.backoffMs * Math.pow(2, nextAttempt - 1);
        await this.deps.repository.update(documentId, {
          attempts: nextAttempt,
          lastError: error instanceof Error ? error.message : 'Retryable processing error',
          errorType: 'retryable',
          status: DocumentStatus.PROCESSING,
          updatedAt: new Date(),
        });

        await this.deps.queue.add('document-processing', { documentId }, { delay: retryDelay, attempts: 1 });
        return;
      }

      const failed = await this.deps.repository.update(documentId, {
        attempts: nextAttempt,
        lastError: error instanceof Error ? error.message : 'Processing error',
        errorType: kind,
        status: DocumentStatus.FAILED,
        updatedAt: new Date(),
      });

      if (failed) {
        await this.deps.repository.update(documentId, {
          status: DocumentStatus.PENDING_REVIEW,
          errorType: kind,
          updatedAt: new Date(),
        });
      }
    }
  }
}
