# DOC Intelligence — Trilha A

**Vertical Slice: Document Ingestion, Processing & State Management**

A implementação de uma pipeline de inteligência de documentos baseada em fila assíncrona (BullMQ + Redis) com Prisma + PostgreSQL, seguindo arquitetura hexagonal.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cliente (REST)                           │
│                    POST /documents (multipart)                   │
│                    GET /documents/:id, ?status=                  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    AppController        │
                    │ File validation & API   │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
  ┌──────────────┐      ┌──────────────┐      ┌──────────────────┐
  │  Ingestion   │      │ Processing   │      │  DocumentRepository
  │  Service     │      │  Service     │      │  (Repository Port)
  │              │      │              │      │                   │
  │ • Hash       │      │ • Provider   │      │ findById()        │
  │ • Dedup      │      │ • Retry      │      │ findByHash()      │
  │ • Storage    │      │ • Trust      │      │ update()          │
  │ • Queue      │      │ • Error class│      │ create()          │
  └──────────────┘      └──────────────┘      └──────────────────┘
        │                      │                        │
        └──────────┬───────────┴────────────┬───────────┘
                   │                        │
           ┌───────▼─────┐         ┌────────▼─────────┐
           │   BullMQ    │         │  Prisma +        │
           │   Queue     │         │  PostgreSQL      │
           │   Adapter   │         │  Repository      │
           └───────┬─────┘         └────────┬─────────┘
                   │                        │
           ┌───────▼──────────┐    ┌────────▼─────────┐
           │   Redis          │    │  PostgreSQL      │
           │   (Job Queue)    │    │  (Persistence)   │
           └──────────────────┘    └──────────────────┘
```

---

## 📋 Pré-requisitos

- **Node.js** >= v22.17.0
- **npm** >= 10.9.2
- **PostgreSQL** >= 13 (produção) ou SQLite (desenvolvimento)
- **Redis** >= 6.0

---

## 🚀 Setup & Instalação

### 1. Clone e Instale

```bash
git clone <repo-url>
cd "DOC Intelligence - Trilha A"
npm install
```

### 2. Variáveis de Ambiente

Crie `.env.local` (gitignored):

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
DATABASE_URL=postgresql://user:password@localhost:5432/doc-intelligence
PROVIDER_TIMEOUT_MS=45000
PROCESSING_MAX_ATTEMPTS=3
PROCESSING_BACKOFF_MS=1000
CONFIDENCE_THRESHOLD=0.8
WORKER_CONCURRENCY=1
STORAGE_UPLOAD_DIR=./storage/uploads
PORT=3000
NODE_ENV=development
```

### 3. Build & Run

```bash
npm run build        # TypeScript → CommonJS
npm start            # Servidor + worker
npm run start:dev    # Watch mode
```

---

## 📡 API Reference

### POST /documents
```bash
curl -X POST http://localhost:3000/documents -F "file=@invoice.pdf"
```
Response (202): `{ "id": "uuid", "status": "RECEIVED", "existing": false }`

### GET /documents/:id
```bash
curl http://localhost:3000/documents/uuid
```
Response: Documento completo com status, confiança, resultado.

### GET /documents?status=DONE
Filtra por status: `RECEIVED|QUEUED|PROCESSING|DONE|PENDING_REVIEW|FAILED`

---

## 🔄 Fluxo de Estado

```
POST /documents (novo)
        ▼
    RECEIVED
        ▼
    QUEUED (enfileirado)
        ▼
    PROCESSING (worker consome)
        │
        ├─ Erro retentável → [backoff] → retry ou PENDING_REVIEW
        ├─ Erro não-retentável → PENDING_REVIEW
        └─ Sucesso → DONE (se confiança ≥ 0.8) ou PENDING_REVIEW
```

---

## 🧪 Testes

```bash
npm test                    # Todos (9 testes)
npm test -- --watch        # Watch mode
npm run test:cov           # Cobertura
npm run test:integration    # Teste real contra PostgreSQL (Docker deve estar ativo)
```

O teste de integração usa o `PrismaPostgresRepository` real, executa duas ingestões concorrentes com o mesmo conteúdo e verifica no PostgreSQL a existência de uma única linha e uma única chamada ao provider. Ele fica separado da suíte unitária porque exige infraestrutura local.

Para subir a infraestrutura local:

```bash
docker compose up -d postgres redis
npx prisma migrate deploy
npm run test:integration
```

O projeto usa a configuração do Prisma 7 em `prisma.config.ts`: a URL de conexão para migrations fica em `datasource.url` desse arquivo, enquanto `prisma/schema.prisma` declara apenas o provider PostgreSQL. `DATABASE_URL` é obrigatória; o arquivo `.env.example` contém somente placeholders.

O timeout do provider é configurável por `PROVIDER_TIMEOUT_MS` e tem default de 45 segundos, acima da latência máxima de 40 segundos descrita no ambiente.

**Suites**: 
- Workflow (dedup, retry, confiança) — 3 testes
- Edge cases (exhaustão, timeout, terminal states) — 5 testes  
- Controller smoke test — 1 teste

---

## 🛠️ Configuração

**Retry ajustável**:
```bash
PROCESSING_MAX_ATTEMPTS=5          # Tentativas
PROCESSING_BACKOFF_MS=2000         # Backoff base (ms)
```

**Confiança ajustável**:
```bash
CONFIDENCE_THRESHOLD=0.5           # Score mínimo para DONE
```

**Worker**:
```bash
WORKER_CONCURRENCY=4               # Parallelismo
```

---

## 🏛️ Arquitetura Detalhada

- **Domain** (`src/documents/`): Serviços, portas, tipos
- **Adapters** (`src/infrastructure/`, `src/prisma/`): Implementações
- **API** (`src/app.controller.ts`): Endpoints
- **Config** (`src/config.ts`): Variáveis centralizadas

Ver [ADRS.md](./ADRS.md) para decisões arquiteturais (hexagonal, CommonJS, adapters, etc.)

---

## 📊 Status do Projeto

✅ **100% Completo (MVP)**
- Ingestion + Deduplication
- Async processing com retry
- State machine (6 estados)
- Confidence-based routing
- PostgreSQL persistence
- Redis queue
- 8/8 testes passando
- Build CommonJS clean

---

## 🚢 Deployment

Docker + env vars para PostgreSQL, Redis, config.

Ver README seção "Deployment" para exemplos Dockerfile e CI/CD.

---

## 📖 Referências

- [ADRS.md](./ADRS.md) — Architecture Decision Records
- `/doc` — Especificação (SPEC-001, diagrama)
- [BullMQ Docs](https://docs.bullmq.io/)
- [Prisma Docs](https://www.prisma.io/docs/)
- [NestJS Docs](https://docs.nestjs.com/)

---

**Desenvolvido**: Demonstração de vertical slice com arquitetura hexagonal, fila assíncrona, e testes comportamentais.


## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
