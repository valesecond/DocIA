import { DocumentStatus } from './document-status.enum';

export type ProvenanceSnapshot = {
  promptText: string;
  modelId: string;
  temperature: number;
};

export type AnalysisResult = {
  confidence: number;
  extractedText: string;
  promptText: string;
  modelId: string;
  temperature: number;
};

export type StoredDocument = {
  id: string;
  contentHash: string;
  filename: string;
  mimeType: string;
  storagePath: string;
  status: DocumentStatus;
  attempts: number;
  confidence?: number;
  result?: Record<string, unknown> | null;
  provenance?: ProvenanceSnapshot | null;
  errorType?: string | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
};
