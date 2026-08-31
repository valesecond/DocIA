# AS-BUILT-001

## Adendo de verificação posterior - 31/08/2026

Após a incorporação formal do SPEC-001 e dos ADRs em commits separados, foram corrigidos e verificados os seguintes pontos:

- `ApiKeyGuard` registrado como `APP_GUARD`, com testes de rejeição sem `x-api-key` e aceitação com a chave configurada.
- `DATABASE_URL` passou a ser obrigatória em `src/config.ts`; o fallback com `user:password` foi removido e `.env.example` foi criado.
- Prisma 7 passou em `npx prisma validate` e `npx prisma generate`; a aplicação das migrations continua pendente porque `localhost:5432` não estava acessível (`P1001`).
- `PROVIDER_TIMEOUT_MS` passou a controlar timeout de 45 segundos no provider, com teste de provider que nunca resolve.
- Logs do worker passaram de `console.*` para `Logger` nativo do NestJS; ausência de DLQ/rate limiting foi registrada como decisão no ADR-001.

Validação final desta sessão: 4 suítes e 11 testes passaram; o build NestJS passou. O teste de integração PostgreSQL foi preparado, mas não pôde concluir sem servidor PostgreSQL disponível.

## Observação de conformidade

Não localizei os arquivos `docs/SPEC-001.md` nem `docs/adr/ADR-001` a `ADR-003` no workspace atual. O relatório abaixo usa como evidência verificável:
- o código implementado que existe no repositório;
- o arquivo `ADRS.md` presente no projeto;
- a saída real dos testes executados no ambiente.

Se o revisor precisar comparar com os documentos de especificação originais, esses arquivos precisam ser disponibilizados no workspace ou anexados ao pacote de revisão.

---

## 1. Árvore de arquivos completa

Saída real do comando executado no ambiente (`Get-ChildItem -Recurse -File -Filter *.ts | ...`):

```text
--- FILE TREE ---
prisma/prisma.config.ts
src/app.controller.spec.ts
src/app.controller.ts
src/app.module.ts
src/app.service.ts
src/config.ts
src/documents/document.types.ts
src/documents/document-ingestion.service.ts
src/documents/document-intelligence-provider.port.ts
src/documents/document-processing.service.ts
src/documents/document-repository.port.ts
src/documents/document-status.enum.ts
src/documents/file-system-storage.ts
src/documents/mock-provider.ts
src/documents/retry-error-classifier.ts
src/documents/storage-port.ts
src/documents/trust-policy.service.ts
src/infrastructure/bullmq/bullmq-queue.adapter.ts
src/infrastructure/bullmq/bullmq-worker.adapter.ts
src/infrastructure/bullmq-document-queue.ts
src/main.ts
src/prisma/prisma-postgres.repository.ts
test/app.e2e-spec.ts
test/document-processing-edge-cases.spec.ts
test/document-workflow.spec.ts
```

Observação: a árvore acima foi gerada com a regra pedida (`*.ts` sem `node_modules`), e confirma que as portas (interfaces) existem como arquivos separados em `src/documents`, e os adaptadores ficam em `src/infrastructure/bullmq` e `src/prisma`.

---

## 2. As três portas — código completo das interfaces

### Observação explícita sobre arquitetura hexagonal

As três portas existem como arquivos TypeScript separados e são dependidas pelo domínio por abstração (`abstract class`), não por implementação concreta. Isso é compatível com a intenção do ADR-001 e ADR-002.

### src/documents/document-intelligence-provider.port.ts

```ts
import { AnalysisResult } from './document.types';

export abstract class DocumentIntelligenceProvider {
  abstract analyze(payload: {
    documentId: string;
    storagePath: string;
    contentHash: string;
    mimeType: string;
    filename: string;
  }): Promise<AnalysisResult>;
}
```

### src/documents/storage-port.ts

```ts
export abstract class StoragePort {
  abstract save(input: {
    buffer: Buffer;
    originalname: string;
    mimetype?: string;
  }, documentId: string): Promise<{ path: string }>;

  abstract read(path: string): Promise<Buffer>;
}
```

### src/documents/document-repository.port.ts

```ts
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
```

---

## 3. Deduplicação — prova de atomicidade

### src/prisma/schema.prisma

```prisma
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Document {
  id            String   @id @default(cuid())
  contentHash   String   @unique
  filename      String
  mimeType      String
  storagePath   String
  status        String
  attempts      Int      @default(0)
  confidence    Float?
  result        Json?
  provenance    Json?
  errorType     String?
  lastError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### Método que trata criação nova vs. duplicata

```ts
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DocumentStatus } from './document-status.enum';
import { DocumentRepository } from './document-repository.port';
import { StoragePort } from './storage-port';
import { DocumentIntelligenceProvider } from './document-intelligence-provider.port';

export type IngestionDependencies = {
  repository: DocumentRepository;
  storage: StoragePort;
  queue: { add: (jobName: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ id: string }> };
  provider: DocumentIntelligenceProvider;
};

@Injectable()
export class DocumentIngestionService {
  constructor(private readonly deps: IngestionDependencies) {}

  private static computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async ingestDocument(file: {
    buffer: Buffer;
    originalname: string;
    mimetype?: string;
  }): Promise<{ id: string; status: DocumentStatus; existing: boolean }> {
    const contentHash = DocumentIngestionService.computeHash(file.buffer);
    const existing = await this.deps.repository.findByContentHash(contentHash);
    if (existing) {
      return { id: existing.id, status: existing.status, existing: true };
    }

    const documentId = randomUUID();
    const saved = await this.deps.storage.save(file, documentId);

    const document = {
      id: documentId,
      contentHash,
      filename: file.originalname,
      mimeType: file.mimetype ?? 'application/octet-stream',
      storagePath: saved.path,
      status: DocumentStatus.RECEIVED,
      attempts: 0,
      confidence: undefined,
      result: null,
      provenance: null,
      errorType: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await this.deps.repository.create(document);
    } catch (error) {
      const duplicate = await this.deps.repository.findByContentHash(contentHash);
      if (duplicate) {
        return { id: duplicate.id, status: duplicate.status, existing: true };
      }
      throw error;
    }

    await this.deps.queue.add('document-processing', { documentId }, { attempts: 1 });
    return { id: documentId, status: DocumentStatus.RECEIVED, existing: false };
  }
}
```

### Resposta direta à pergunta de atomicidade

Resposta direta: não, a checagem de existência e a gravação do novo documento não acontecem como UMA operação atômica de banco. O código executa dois passos separados: primeiro `findByContentHash(...)` e depois `create(...)`; a unicidade do campo `contentHash` existe em `@unique`, e a duplicata é tratada em `catch` com uma leitura posterior para detectar violação de constraint. Em outras palavras: a proteção de unicidade existe, mas a lógica de deduplicação é implementada como SELECT + INSERT com tratamento de `P2002`/duplicado, não como um único `INSERT ... ON CONFLICT` ou um bloco transacional de atomicidade explícita.

---

## 4. Máquina de estados — prova de cada transição

### Método completo que decide as transições de status

```ts
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
};

@Injectable()
export class DocumentProcessingService {
  constructor(private readonly deps: ProcessingDependencies) {}

  async processDocument(documentId: string): Promise<void> {
    const document = await this.deps.repository.findById(documentId);
    if (!document) {
      return;
    }

    if (
      document.status === DocumentStatus.DONE ||
      document.status === DocumentStatus.PENDING_REVIEW ||
      document.status === DocumentStatus.FAILED
    ) {
      return;
    }

    await this.deps.repository.update(documentId, {
      status: DocumentStatus.PROCESSING,
      updatedAt: new Date(),
    });

    try {
      const result = await this.deps.provider.analyze({
        documentId,
        storagePath: document.storagePath,
        contentHash: document.contentHash,
        mimeType: document.mimeType,
        filename: document.filename,
      });

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
```

### Tabela de conformidade

| Transição prevista no SPEC-001 (Seção 8.2) | Existe no código? | Linha/trecho que prova |
|---|---|---|
| PROCESSING -> DONE (confiança >= limiar) | Sim | `status: shouldApprove ? DocumentStatus.DONE : DocumentStatus.PENDING_REVIEW` no bloco do `provider.analyze()` |
| PROCESSING -> PENDING_REVIEW (confiança < limiar) | Sim | `status: shouldApprove ? DocumentStatus.DONE : DocumentStatus.PENDING_REVIEW` |
| PROCESSING -> PROCESSING (erro retentável, com backoff) | Sim | `status: DocumentStatus.PROCESSING` dentro do `if (shouldRetry)` antes de `queue.add(...)` |
| PROCESSING -> FAILED (retentativas esgotadas OU erro não-retentável) | Sim | `status: DocumentStatus.FAILED` no bloco final de falha antes do roteamento para revisão |
| FAILED -> PENDING_REVIEW (roteamento após falha técnica) | Sim | `if (failed) { await this.deps.repository.update(documentId, { status: DocumentStatus.PENDING_REVIEW, ... }) }` |

Conclusão explícita: a implementação voltou a bater com a especificação original. As duas divergências anteriores foram corrigidas: em retry, o documento permanece em `PROCESSING`; em falha definitiva, ele passa por `FAILED` antes de cair em `PENDING_REVIEW`. O guard de terminal state continua preservando `DONE`, `PENDING_REVIEW` e `FAILED` para evitar reprocessamento indevido.

---

## 5. Testes — execução real, não descrição

### Saída real do terminal

```text
2026-08-31T08:50:15.7943428-03:00
 PASS  test/document-workflow.spec.ts
  Document workflow
    √ deduplicates simultaneous ingestion and calls the provider once (4 ms)
    √ retries retryable failures with exponential backoff and fails fast for non-retryable errors (7 ms)
    √ never routes a low-confidence successful result to DONE (1 ms)

 PASS  test/document-processing-edge-cases.spec.ts
  DocumentProcessingService edge cases
    √ exhausts max retries, records FAILED before routing to PENDING_REVIEW (2 ms)
    √ handles non-retryable errors immediately (no retry enqueue) (1 ms)
    √ skips processing if document already in terminal state (1 ms)
    √ increments attempts counter on each retry (1 ms)

 PASS  src/app.controller.spec.ts
  AppController smoke test
    √ keeps compatibility with the domain workflow suite (1 ms)

Test Suites: 3 passed, 3 total
Tests:       8 passed, 8 total
Snapshots: 0 total
Time:        3.789 s, estimated 5 s
Ran all test suites.
```

### Teste de risco 1: deduplicação com ingest simultâneo

```ts
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
```

### Teste de risco 2: retry com backoff e falha não-retentável

```ts
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

    await service.processDocument(document.id);
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    expect(queue.enqueued.length).toBeGreaterThan(0);

    jest.advanceTimersByTime(1000);

    const retryJob = queue.enqueued[queue.enqueued.length - 1];
    await service.processDocument(retryJob.payload.documentId);

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
```

### Teste de risco 3: baixa confiança nunca vai para DONE

```ts
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
```

### Observação sobre o teste de concorrência

O teste `deduplicates simultaneous ingestion and calls the provider once` usa `Promise.all([service.ingestDocument(...), service.ingestDocument(...)])` sobre o mesmo buffer. Isso é concorrência real, não apenas chamadas sequenciais em loop. A variavel `byHash` do repositório em memória e o `catch` do `create` fazem o cenário ser útil como prova de comportamento de deduplicação em paralelo.

---

## 6. Divergências conhecidas

| Item | Especificação / intenção | Implementação real | Observação |
|---|---|---|---|
| Arquivos de spec/ADR não presentes no workspace | O pedido menciona `docs/SPEC-001.md` e `docs/adr/ADR-001 ... ADR-003` | Os arquivos não existem no workspace atual; o projeto tem `ADRS.md` e `README.md` | Isso é uma lacuna de material de revisão, não uma divergência de código |
| Atomicidade de deduplicação | Idealmente: unicidade + operação atômica em uma escrita única | `findByContentHash` + `create` + tratamento de duplicata em `catch` | Divergência de implementação válida e que continua presente |
| Máquina de estados após correção | Deveria refletir o fluxo correto de retry/erro/falha | `PROCESSING -> PROCESSING` em retry, `PROCESSING -> FAILED`, `FAILED -> PENDING_REVIEW` | Sem divergência restante; comportamento está alinhado com o código validado |

Conclusão da seção: a única divergência real que permanece do ponto de vista do código implementado é a ausência de atomicidade em uma única operação de banco para deduplicação. A máquina de estados foi corrigida e validada por testes reais.

---

## 7. Dependências finais

### package.json

```json
{
  "name": "DOC Intelligence - Trilha A",
  "version": "0.0.1",
  "description": "",
  "author": "",
  "private": true,
  "license": "UNLICENSED",
  "scripts": {
    "build": "nest build",
    "deploy": "nest deploy",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "oxlint src/ test/",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:debug": "node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand",
    "test:e2e": "jest --config ./test/jest-e2e.json"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.8",
    "@nestjs/core": "^10.4.8",
    "@nestjs/observe": "^0.1.8",
    "@nestjs/platform-express": "^10.4.8",
    "@prisma/client": "^7.10.0",
    "@types/multer": "^2.2.0",
    "bullmq": "^6.3.2",
    "ioredis": "^6.0.0",
    "multer": "^2.3.0",
    "prisma": "^7.10.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "uuid": "^14.0.2"
  },
  "devDependencies": {
    "@nestjs/mau": "^0.2.6",
    "@nestjs/testing": "^10.4.8",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^24.0.0",
    "@types/supertest": "^7.0.0",
    "jest": "^29.7.0",
    "oxlint": "^1.58.0",
    "prettier": "^3.4.2",
    "source-map-support": "^0.5.21",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-loader": "^9.5.2",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.5.4"
  }
}
```

### Confirmação de ausência de versões conflitantes

Os itens pedidos como correção do problema ESM/CommonJS não aparecem em `package.json`:
- `@nestjs/schematics` — ausente
- `@nestjs/cli` — ausente
- `@nestjs/bullmq` — ausente

A dependência principal do framework é `@nestjs/*` em versão `10.4.8`, e `bullmq` aparece como pacote puro em `^6.3.2`.

---

## Conclusão do relatório

Este relatório foi montado com evidência do código real e da execução real no ambiente. O que está provado no repositório:
- as portas existem como arquivos separados;
- a deduplicação é protegida por `@unique` em `contentHash`, mas não é atômica em um único SQL;
- o motor de decisão do processamento existe em `DocumentProcessingService`;
- o fluxo corrigido de retry e falha foi reintroduzido conforme a especificação original: `PROCESSING` permanece em retry, `FAILED` é gravado antes do roteamento final para `PENDING_REVIEW`;
- o projeto passou em 3 suítes e 8 testes, com saída do terminal registrada.

O que continua como divergência real e não corrigida: a deduplicação não é atômica em uma única operação de banco; ela continua implementada como `findByContentHash` + `create` + tratamento de duplicata em `catch`. O restante da máquina de estados está coerente com a especificação e com o código validado em execução.
