import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { ApiKeyGuard } from './api-key.guard';
import { DocumentIngestionService } from './documents/document-ingestion.service';
import { DocumentProcessingService } from './documents/document-processing.service';
import { DocumentRepository } from './documents/document-repository.port';
import { RetryErrorClassifier } from './documents/retry-error-classifier';
import { TrustPolicyService } from './documents/trust-policy.service';
import { DocumentIntelligenceProvider } from './documents/document-intelligence-provider.port';
import { StoragePort } from './documents/storage-port';
import { MockProvider } from './documents/mock-provider';
import { FileSystemStorage } from './documents/file-system-storage';
import { PrismaPostgresRepository } from './prisma/prisma-postgres.repository';
import { BullMQQueueAdapter } from './infrastructure/bullmq/bullmq-queue.adapter';
import { BullMQWorkerAdapter } from './infrastructure/bullmq/bullmq-worker.adapter';
import { MockPrismaRepository } from './infrastructure/mocks/mock-prisma-repository';
import { config } from './config';

const trustPolicy = new TrustPolicyService({ threshold: config.processing.confidenceThreshold });

// Provedores base que são sempre necessários
const baseProviders = [
  {
    provide: APP_GUARD,
    useClass: ApiKeyGuard,
  },
  FileSystemStorage,
  RetryErrorClassifier,
  BullMQQueueAdapter,
  BullMQWorkerAdapter,
  {
    provide: TrustPolicyService,
    useValue: trustPolicy,
  },
  {
    provide: DocumentIntelligenceProvider,
    useFactory: () => new MockProvider({}),
  },
  {
    provide: StoragePort,
    useClass: FileSystemStorage,
  },
];

// Provedores específicos por modo
const repositoryProviders = config.mock.enabled
  ? [
      MockPrismaRepository,
      {
        provide: DocumentRepository,
        useClass: MockPrismaRepository,
      },
    ]
  : [
      PrismaPostgresRepository,
      {
        provide: DocumentRepository,
        useClass: PrismaPostgresRepository,
      },
    ];

// Provedores de serviço
const serviceProviders = [
  {
    provide: DocumentIngestionService,
    useFactory: (
      repository: DocumentRepository,
      storage: StoragePort,
      provider: DocumentIntelligenceProvider,
      queue: BullMQQueueAdapter,
    ) =>
      new DocumentIngestionService({
        repository,
        storage,
        provider,
        queue,
      }),
    inject: [DocumentRepository, StoragePort, DocumentIntelligenceProvider, BullMQQueueAdapter],
  },
  {
    provide: DocumentProcessingService,
    useFactory: (
      repository: DocumentRepository,
      provider: DocumentIntelligenceProvider,
      trustPolicyService: TrustPolicyService,
      classifier: RetryErrorClassifier,
      queue: BullMQQueueAdapter,
    ) =>
      new DocumentProcessingService({
        repository,
        provider,
        trustPolicy: trustPolicyService,
        queue,
        classifier,
        maxAttempts: config.processing.maxAttempts,
        backoffMs: config.processing.backoffMs,
        providerTimeoutMs: config.processing.providerTimeoutMs,
      }),
    inject: [DocumentRepository, DocumentIntelligenceProvider, TrustPolicyService, RetryErrorClassifier, BullMQQueueAdapter],
  },
];

@Module({
  controllers: [AppController],
  providers: [...baseProviders, ...repositoryProviders, ...serviceProviders],
})
export class AppModule {}
