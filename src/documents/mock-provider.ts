import { Injectable } from '@nestjs/common';
import { DocumentIntelligenceProvider } from './document-intelligence-provider.port';
import { AnalysisResult } from './document.types';

export type MockProviderConfig = {
  successConfidence?: number;
  failureMode?: 'retryable' | 'non_retryable';
  timeoutMs?: number;
};

@Injectable()
export class MockProvider extends DocumentIntelligenceProvider {
  constructor(private readonly config: MockProviderConfig = {}) {
    super();
  }

  async analyze(payload: {
    documentId: string;
    storagePath: string;
    contentHash: string;
    mimeType: string;
    filename: string;
  }): Promise<AnalysisResult> {
    if (this.config.failureMode === 'retryable') {
      throw Object.assign(new Error('timeout while calling provider'), {
        name: 'TimeoutError',
        status: 504,
      });
    }

    if (this.config.failureMode === 'non_retryable') {
      throw Object.assign(new Error('document rejected by provider'), {
        name: 'ValidationError',
        status: 422,
      });
    }

    return {
      confidence: this.config.successConfidence ?? 0.9,
      extractedText: `Processed ${payload.filename}`,
      promptText: 'Extract the document fields',
      modelId: 'mock-model',
      temperature: 0.2,
    };
  }
}
