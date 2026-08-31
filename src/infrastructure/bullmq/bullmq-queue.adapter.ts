import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { DocumentProcessingService } from '../../documents/document-processing.service';
import { config } from '../../config';

/**
 * BullMQ Queue Adapter
 *
 * Encapsula a criação e gerenciamento de uma fila BullMQ, expondo apenas
 * os métodos necessários ao Serviço de Ingestão (ADR-002: Infraestrutura
 * deve ficar atrás de uma fronteira que o domínio controla).
 *
 * Responsabilidade: enfileirar jobs de processamento de documentos.
 * Não contém lógica de negócio.
 *
 * Modo Mock: Usa Redis em memória para testes
 * Modo Real: Usa Redis real via Docker/infraestrutura
 */
@Injectable()
export class BullMQQueueAdapter implements OnModuleInit {
  private queue: Queue | null = null;
  private processingService?: DocumentProcessingService;

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    if (config.mock.enabled) {
      this.processingService = this.moduleRef.get(DocumentProcessingService, { strict: false });
      return;
    }

    const redisConnection = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    this.queue = new Queue('document-processing', {
      connection: redisConnection,
    });
  }

  /**
   * Enfileira um job genérico (compatível com interface de porta do domínio).
   * Adaptador para o padrão hexagonal: expõe interface genérica.
   */
  async add(
    jobName: string,
    payload: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ id: string }> {
    if (config.mock.enabled) {
      const id = randomUUID();
      const documentId = payload.documentId;
      if (typeof documentId === 'string' && this.processingService) {
        void this.processingService.processDocument(documentId);
      }
      return { id };
    }

    const job = await this.queue!.add(jobName, payload, {
      attempts: (options?.attempts as number) ?? 1,
      delay: (options?.delay as number) ?? 0,
      removeOnComplete: true,
      removeOnFail: false,
    });

    return { id: job.id ?? '' };
  }

  /**
   * Fecha a conexão com Redis (para graceful shutdown).
   */
  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
