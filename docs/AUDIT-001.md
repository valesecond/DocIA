# AUDIT-001

## Adendo de correções verificadas - 31/08/2026

As classificações abaixo foram atualizadas após correções pontuais e nova execução de testes:

- Item 2.5 (API-key placeholder): `CONFORME` no código e nos testes focados.
- Item 2.3 (credencial hardcoded): `CONFORME`; `DATABASE_URL` agora é obrigatória e há `.env.example` sem credencial operacional.
- Item 3.3 (timeout): `CONFORME`; timeout configurável de 45 segundos implementado e testado.
- Item 3.4 (índice): schema e migration presentes; aplicação em banco real permanece não verificada por `P1001`.
- Item de logging: eventos preservados com `Logger` nativo do NestJS, sem `console.*` no worker.

Saída final verificada: 4 suítes, 11 testes e build NestJS passaram. O teste de integração com PostgreSQL não concluiu porque não havia servidor acessível em `localhost:5432`.

## Escopo

Este documento avalia o estado atual do software em quatro dimensões: coesão, segurança, escalabilidade e coerência.

A avaliação abaixo é estritamente baseada em evidência verificada no repositório e nos testes executados no ambiente atual:
- código em `src/` e `prisma/`;
- documentação disponível no workspace (`ADRS.md`, `docs/AS-BUILT-001.md`);
- execução real da suíte Jest no ambiente.

> Não foi localizada uma especificação original em `docs/SPEC-001.md` nem ADRs em `docs/adr/*.md`. O relatório abaixo registra apenas o que foi verificado e não extrapola conformidade fora do que a implementação e os testes demonstram.

---

## Resumo executivo

| Dimensão | Classificação | Observação breve |
|---|---|---|
| Coesão | CONFORME | A arquitetura de domínio, portas, adaptadores e fila está consistente com a divisão esperada. |
| Segurança | PARCIAL | Há validação básica de tipo de arquivo e ausência de auth/authorization; não há camada de autenticação nem limites de upload explícitos. |
| Escalabilidade | PARCIAL | Há fila e worker assíncronos com concorrência configurável, mas não há proteção operacionais de produção explícitas. |
| Coerência | CONFORME | O fluxo de estados e a correção aplicada foram verificados em testes reais. |

| Item | Classificação | Resultado verificado |
|---|---|---|
| 3.3 Timeout na chamada ao provider | CONFORME | Timeout configurável de 45s implementado e coberto por teste; provider externo não foi executado. |
| 3.4 Índice no campo `status` | CONFORME | Índice adicionado ao schema e migration gerada; aplicação no banco não foi executada nesta auditoria. |
| 2.5 Middleware placeholder de API-key | NÃO CONFORME | Nenhum middleware global ou mecanismo placeholder foi encontrado em `src/`. |
| 3.2 Estado em memória entre instâncias | CONFORME | Nenhuma variável de estado em escopo de módulo foi encontrada nos serviços/adapters analisados. |
| 2.2 Log de dado extraído | CONFORME | Nenhuma chamada de log contém `result` ou `extractedText`. |
| 2.3 Credencial hardcoded | NÃO CONFORME | `src/config.ts` contém fallback literal com `user:password`. |
| 4.1 Nomenclatura consistente | PARCIAL | Não verificável contra o diagrama solicitado, pois o arquivo não existe no workspace. |
| 4.3 Contrato HTTP vs. especificação | PARCIAL | Os status observados no código foram registrados, mas a comparação exata com RF-01/RF-07 não é verificável sem `SPEC-001.md`. |
| 4.4 ADRs desatualizados | CONFORME | A correção da máquina de estados não contradiz os textos de ADR-001, ADR-002 ou ADR-003; os ADRs individuais não existem, apenas `ADRS.md`. |

---

## Complementação dos itens pendentes

### 3.3 Timeout na chamada ao provider

### Classificação: CONFORME

Busca realizada em `src/`:

```text
src/documents/document-intelligence-provider.port.ts:4:  abstract analyze(payload: {
src/documents/document-processing.service.ts:37:      const result = await this.deps.provider.analyze({
src/documents/mock-provider.ts:23:  async analyze(payload: {
```

Foi implementado um timeout configurável de 45 segundos, acima da latência máxima de 40 segundos documentada em ENV-A, usando `Promise.race` e limpeza do timer:

```ts
const analysis = this.deps.provider.analyze({
  documentId,
  storagePath: document.storagePath,
  contentHash: document.contentHash,
  mimeType: document.mimeType,
  filename: document.filename,
});
const timeout = new Promise<never>((_, reject) => {
  timeoutHandle = setTimeout(() => reject(new ProviderTimeoutError(timeoutMs)), timeoutMs);
});
const result = await Promise.race([analysis, timeout]).finally(() => clearTimeout(timeoutHandle));
```

`ProviderTimeoutError` usa `name = 'TimeoutError'`, portanto o `RetryErrorClassifier` o classifica como retentável. O teste focado passou com cinco testes, incluindo provider que nunca resolve, confirmando `PROCESSING`, `errorType = retryable`, backoff e re-enfileiramento.

### 3.4 Índice no campo `status`

### Classificação: CONFORME no repositório; aplicação ainda não verificada

Antes da correção, `prisma/schema.prisma` não continha `@@index([status])`. O índice foi adicionado ao model `Document`:

```prisma
@@index([status])
```

Também foi gerado o artefato:

```text
prisma/migrations/20260831090000_add_document_status_index/migration.sql
```

Conteúdo real da migration:

```sql
-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");
```

A migration não foi aplicada nesta auditoria. A tentativa de validação automática do schema foi executada com `npx prisma validate` e falhou antes de validar o índice por uma incompatibilidade existente do Prisma 7:

```text
Error: Prisma schema validation - (validate wasm)
Error code: P1012
error: The datasource property `url` is no longer supported in schema files. Move connection URLs for Migrate to `prisma.config.ts` ...
  --> prisma\schema.prisma:10
10 |   url      = env("DATABASE_URL")
Validation Error Count: 1
Prisma CLI Version : 7.10.0
```

O índice está declarado no schema e possui SQL de migration, mas a execução contra um banco real continua não verificada.

### 2.5 Middleware placeholder de API-key

### Classificação: NÃO CONFORME

Busca em todo `src/`, incluindo `main.ts` e `app.module.ts`, não encontrou middleware global, guard ou API-key placeholder:

```text
--- UPLOAD/AUTH SEARCH ---
src\app.controller.ts:12:import { FileInterceptor } from '@nestjs/platform-express';
src\app.controller.ts:26:  @UseInterceptors(FileInterceptor('file'))
```

`src/main.ts` apenas cria a aplicação, habilita CORS e inicia o servidor; `src/app.module.ts` registra controllers/providers e não registra middleware de autenticação. Portanto, conforme o item especificado, trata-se de pendência de implementação, não de risco aceito.

### 3.2 Estado em memória que impede múltiplas instâncias

### Classificação: CONFORME

Foi feita busca por declarações no escopo de módulo e por estado compartilhado nos quatro arquivos solicitados. Não foi encontrado estado de negócio fora de classes. Os únicos campos relevantes são instâncias privadas:

```ts
// BullMQWorkerAdapter
private worker: Worker | null = null;

// BullMQQueueAdapter
private readonly queue: Queue;
```

Os documentos são persistidos no repositório e os jobs no Redis. Não há `Map`, array ou singleton de documentos no escopo do módulo nos serviços/adapters analisados.

### 2.2 Log de dado extraído

### Classificação: CONFORME

Busca específica em todo `src/` por `result`, `extractedText` e chamadas de log mostrou que esses nomes aparecem no domínio, nos tipos e na persistência, mas não em `console.*`/logger. As chamadas de log verificadas foram:

```text
src\infrastructure\bullmq\bullmq-worker.adapter.ts:42: console.error(`Job ${job.id} failed: ${err.message}`);
src\infrastructure\bullmq\bullmq-worker.adapter.ts:44: console.error(`Job failed: ${err.message}`);
src\infrastructure\bullmq\bullmq-worker.adapter.ts:49: console.log(`Job ${job.id} completed`);
src\infrastructure\bullmq\bullmq-worker.adapter.ts:52: console.log('BullMQ worker started');
src\infrastructure\bullmq\bullmq-worker.adapter.ts:76: console.log('BullMQ worker closed');
```

Nenhuma delas registra conteúdo extraído ou o campo `result`.

### 2.3 Credencial hardcoded

### Classificação: NÃO CONFORME

Busca por literais de senha/chave/token no código encontrou:

```text
src/config.ts:17:    url: process.env.DATABASE_URL ?? 'postgresql://user:password@localhost:5432/doc-intelligence',
```

Embora seja um fallback de desenvolvimento e não uma credencial operacional comprovada, o literal contém `user:password` no código-fonte. Isso viola o critério de ausência de credencial hardcoded e deve ser substituído por configuração obrigatória ou placeholder sem senha utilizável.

### 4.1 Nomenclatura consistente

### Classificação: PARCIAL; verificação documental não concluída

O enum real é:

```ts
export enum DocumentStatus {
  RECEIVED = 'RECEIVED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  PENDING_REVIEW = 'PENDING_REVIEW',
  FAILED = 'FAILED',
}
```

A busca por `docs/diagrams/document-lifecycle.mermaid` não encontrou o arquivo. Assim, não é possível comparar automaticamente os nomes do diagrama com `DocumentStatus`; nenhuma conclusão de conformidade entre esses dois artefatos pode ser feita.

### 4.3 Contrato HTTP real vs. especificado

### Classificação: PARCIAL; comparação com RF-01/RF-07 não verificável

O contrato observado no controller é:

```ts
res.status(result.existing ? 200 : 202);
```

Portanto, `POST /documents` retorna `202` para novo documento e `200` para duplicata. `GET /documents/:id` não define status explicitamente; o Nest usa o status padrão `200`, inclusive no objeto de fallback quando o documento não existe. `GET /documents` também usa o status padrão `200`.

Os arquivos `docs/SPEC-001.md` e os ADRs individuais solicitados não existem no workspace. Sem RF-01/RF-07 disponíveis, não é possível confirmar se esses códigos batem exatamente com a especificação; a classificação permanece `PARCIAL` por ausência da fonte normativa.

### 4.4 ADRs desatualizados

### Classificação: CONFORME, com limitação de localização

Não existem arquivos separados `ADR-001.md`, `ADR-002.md` ou `ADR-003.md`; os textos estão reunidos em `ADRS.md`. A releitura confirmou:

- ADR-001 continua descrevendo portas/adaptadores e não fixa a máquina de estados;
- ADR-002 continua descrevendo BullMQ puro e adapters finos;
- ADR-003 continua descrevendo NestJS 10/CommonJS e não contradiz a correção feita em `document-processing.service.ts`.

Não foi identificado trecho desses três ADRs tornado desatualizado pela correção de retry em `PROCESSING` e da sequência `FAILED -> PENDING_REVIEW`. A limitação é apenas que os caminhos individuais referenciados não estão presentes.

---

## 1) Coesão

### Classificação: CONFORME

### Evidência verificada

O domínio depende de interfaces abstratas em vez de implementações concretas:

- `src/documents/document-repository.port.ts`
- `src/documents/document-intelligence-provider.port.ts`
- `src/documents/storage-port.ts`

Essas abstrações são consumidas pelo serviço de domínio `DocumentProcessingService` e `DocumentIngestionService`, e os adaptadores ficam fora do domínio:

- `src/prisma/prisma-postgres.repository.ts`
- `src/infrastructure/bullmq/bullmq-worker.adapter.ts`
- `src/infrastructure/bullmq/bullmq-queue.adapter.ts`

Trecho do serviço de processamento:

```ts
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
```

E a orquestração do serviço está coesa com a arquitetura hexagonal descrita em `ADRS.md`.

Também há clareza funcional de responsabilidade:
- `DocumentIngestionService` salva o arquivo e enfileira o processamento;
- `DocumentProcessingService` decide o estado, retry e roteamento;
- `BullMQWorkerAdapter` apenas consome o job e delega ao domínio.

### Limitação real verificada

A única divergência de coesão que persiste não é um erro de arquitetura, mas uma ausência documental: o workspace não contém os documentos de especificação originais referenciados em `docs/AS-BUILT-001.md`.

Isso limita a comparação formal "especificação × implementação"; no entanto, não invalida a consistência interna do código que existe.

---

## 2) Segurança

### Classificação: PARCIAL

### Evidência verificada

Há validação básica de tipo de arquivo no endpoint de upload:

```ts
const header = buffer.subarray(0, 8).toString('hex');
const isPdf = header.startsWith('255044462d46');
const isPng = header.startsWith('89504e470d0a1a0a');
const isJpeg = buffer.subarray(0, 2).toString('hex') === 'ffd8';

if (!isPdf && !isPng && !isJpeg) {
  throw new BadRequestException('Unsupported file type');
}
```

Esse bloco está em `src/app.controller.ts` e impede tipos claramente inválidos no upload.

### O que continua ausente e foi verificado

1. Nenhuma autenticação/autorização no API:
   - ausência de `AuthGuard`, `UseGuards`, `Authorization`, `Bearer`, `jwt`, `passport` em `src/`.
   - comando executado com busca real no projeto:

```text
--- UPLOAD/AUTH SEARCH ---
src\app.controller.ts:12:import { FileInterceptor } from '@nestjs/platform-express';
src\app.controller.ts:26:  @UseInterceptors(FileInterceptor('file'))
```

2. Nenhum limite de tamanho de upload explícito:
   - não há `limits`, `memoryStorage`, `diskStorage`, `multer` customizado com limite de bytes.

3. Não há regra de preservação de segredos por ambiente em arquivo versionado:
   - `src/config.ts` usa defaults e variáveis de ambiente, mas não há `.env.example` ou regra visible de secret management no workspace.

4. Há `console.log` em worker:

```ts
this.worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

console.log('BullMQ worker started');
```

Isso não é crítico para vazamento de informação sensível em tese, mas indica falta de observabilidade padronizada e logging de produção.

### Conclusão de segurança

A aplicação possui uma camada muito básica de validação de entrada e rejeição de tipos explícitos, mas ainda está em estado funcional e não em estado de produção seguro por padrão. Por isso a classificação é `PARCIAL` e não `CONFORME`.

---

## 3) Escalabilidade

### Classificação: PARCIAL

### Evidência verificada

A aplicação usa fila assíncrona com BullMQ e worker com concorrência configurável:

- `src/config.ts`

```ts
worker: {
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
},
```

- `src/infrastructure/bullmq/bullmq-worker.adapter.ts`

```ts
this.worker = new Worker('document-processing', this.processor.bind(this), {
  connection: redisConnection,
  concurrency: config.worker.concurrency,
});
```

Há também retry com backoff configurável:

```ts
processing: {
  maxAttempts: Number(process.env.PROCESSING_MAX_ATTEMPTS ?? 3),
  backoffMs: Number(process.env.PROCESSING_BACKOFF_MS ?? 1000),
  confidenceThreshold: Number(process.env.CONFIDENCE_THRESHOLD ?? 0.8),
},
```

O desenho é apropriado para desacoplamento e processamento em lote, e a fila permite escalonamento horizontal do worker se houver múltiplas instâncias do serviço.

### O que ainda limita a escalabilidade real

1. A concorrência padrão é 1 (`WORKER_CONCURRENCY` default = 1).
2. Não há configuração de rate limiting, queue backlog policy, DLQ, retries por job por infra, ou partitioning por tenant/tenant key.
3. O worker usa `console.log` em vez de logger estruturado e sem níveis configuráveis.
4. O projeto não demonstra integração de observabilidade, métricas, tracing ou métricas de throughput.

### Conclusão de escalabilidade

A estrutura é adequada para processamento assíncrono incremental, mas ainda não está em um padrão de produção robusto para carga real. Portanto a classificação é `PARCIAL`.

---

## 4) Coerência

### Classificação: CONFORME

### Evidência verificada no código

A máquina de estados foi corrigida e a lógica de transição foi preservada:

```ts
if (document.status === DocumentStatus.DONE || document.status === DocumentStatus.PENDING_REVIEW || document.status === DocumentStatus.FAILED) {
  return;
}

await this.deps.repository.update(documentId, { status: DocumentStatus.PROCESSING, updatedAt: new Date() });
```

E no fluxo de falha:

```ts
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
```

Também há retry preservando o `PROCESSING` e re-enfileirando o job com delay exponencial:

```ts
await this.deps.repository.update(documentId, {
  attempts: nextAttempt,
  lastError: error instanceof Error ? error.message : 'Retryable processing error',
  errorType: 'retryable',
  status: DocumentStatus.PROCESSING,
  updatedAt: new Date(),
});

await this.deps.queue.add('document-processing', { documentId }, { delay: retryDelay, attempts: 1 });
```

### Evidência verificada em testes reais

Comando executado:

```text
npm test -- --runInBand --watch=false
```

Saída real:

```text
> DOC Intelligence - Trilha A@0.0.1 test
> jest

 PASS  src/app.controller.spec.ts (6.816 s)
 PASS  test/document-processing-edge-cases.spec.ts (14.542 s)
 PASS  test/document-workflow.spec.ts (14.547 s)

Test Suites: 3 passed, 3 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        17.623 s
Ran all test suites.
```

Os testes confirmam que o fluxo de retry, falha e roteamento para revisão continua consistente no estado atual.

### Divergência real ainda presente e verificada

A deduplicação não é atômica no nível de SQL:

```ts
const contentHash = DocumentIngestionService.computeHash(file.buffer);
const existing = await this.deps.repository.findByContentHash(contentHash);
if (existing) {
  return { id: existing.id, status: existing.status, existing: true };
}
...
try {
  await this.deps.repository.create(document);
} catch (error) {
  const duplicate = await this.deps.repository.findByContentHash(contentHash);
  if (duplicate) {
    return { id: duplicate.id, status: duplicate.status, existing: true };
  }
  throw error;
}
```

A unicidade existe em `contentHash` marcado como `@unique`, mas a operação de detecção e inserção não é um único comando atômico; isso foi explicitado em `docs/AS-BUILT-001.md` e permanece como divergência real de implementação, não como hipótese.

---

## Conclusão final

Do ponto de vista verificado no workspace atual:

- a arquitetura e a lógica de estados estão coerentes e sustentadas por testes;
- a solução ainda está incompleta em segurança e produção operacional;
- a escalabilidade é boa como desenho assíncrono, mas não como infraestrutura pronta para carga real;
- a coerência funcional está confirmada por execução real; não há evidência de regressão recente no fluxo de estados.

O software não pode ser declarado "pronto" sem essa ressalva. O que foi validado, de forma objetiva, é que:
- os três suites passaram;
- oito testes passaram;
- o fluxo principal e os edge cases do processamento documental foram testados e aprovados;
- as divergências restantes relevantes foram registradas com evidência e não generalizadas.
