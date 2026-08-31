# MOCK-CONFIGURATION: Ambiente Simulado vs Real

## Visão Geral

A aplicação suporta dois modos de operação:

1. **Modo Mock (Padrão em Desenvolvimento)**: Usa infraestrutura simulada em memória
2. **Modo Real (Produção/Testes com Infraestrutura)**: Conecta a serviços reais (PostgreSQL, Redis)

## Modos de Operação

### Modo Mock (ENABLE_MOCKS=true)

**Comportamento**: Infraestrutura completamente simulada em memória

**Componentes Afetados**:
- ✅ **Banco de Dados**: `MockPrismaRepository` (em memória)
- ✅ **Cache/Fila**: `MockRedisClient` (em memória)
- ✅ **Worker**: Não inicializado (processamento síncrono)
- ✅ **Provider**: `MockProvider` (análise simulada)
- ✅ **Storage**: `FileSystemStorage` (arquivo local)

**Variáveis de Ambiente**:
```bash
ENABLE_MOCKS=true
# DATABASE_URL é ignorado
# REDIS_HOST/REDIS_PORT são ignorados
```

**Vantagens**:
- Não requer Docker/serviços externos
- Testes rápidos (sem I/O de rede)
- Perfeito para desenvolvimento local
- CI/CD sem dependências de infraestrutura

### Modo Real (ENABLE_MOCKS=false)

**Comportamento**: Conecta a serviços reais

**Componentes Afetados**:
- 🔗 **Banco de Dados**: `PrismaPostgresRepository` (PostgreSQL real)
- 🔗 **Cache/Fila**: `BullMQQueueAdapter` com Redis real
- 🔗 **Worker**: `BullMQWorkerAdapter` (processa jobs assincronamente)
- ✅ **Provider**: `MockProvider` (análise simulada)
- ✅ **Storage**: `FileSystemStorage` (arquivo local)

**Variáveis de Ambiente**:
```bash
ENABLE_MOCKS=false
DATABASE_URL=postgresql://user:password@localhost:5432/doc-intelligence
REDIS_HOST=localhost
REDIS_PORT=6379
```

**Requisitos**:
- Docker em execução com PostgreSQL 16-alpine
- Docker em execução com Redis 7-alpine
- Migrações Prisma aplicadas

```bash
docker-compose up -d
npm run migrate:deploy
```

## Configuração Prática

### Padrão para Desenvolvimento (Mock)

```bash
# 1. Sem variáveis de ambiente, defaults para mock
npm run start:dev
# ou
npm test
```

### Para Testes com Infraestrutura Real

```bash
# 1. Inicie Docker
docker-compose up -d

# 2. Aplique migrações
DATABASE_URL=postgresql://user:password@localhost:5432/doc-intelligence npx prisma migrate deploy

# 3. Execute testes
ENABLE_MOCKS=false DATABASE_URL=postgresql://user:password@localhost:5432/doc-intelligence npm run test:e2e
ENABLE_MOCKS=false DATABASE_URL=postgresql://user:password@localhost:5432/doc-intelligence npm run test:integration
```

## Detalhes Técnicos

### MockPrismaRepository

**Localização**: `src/infrastructure/mocks/mock-prisma-repository.ts`

**Métodos Implementados**:
- `findById(id)` - Busca por ID em memória
- `findByContentHash(hash)` - Busca por hash de conteúdo
- `create(data)` - Cria documento em memória
- `updateStatus(id, status, result, confidence)` - Atualiza status
- `findByStatus(status)` - Lista por status
- `deleteMany(where)` - Deleta por critério
- `clear()` - Limpa todos os dados
- `count()` - Retorna quantidade
- `getAll()` - Retorna todos os documentos

**Dados Armazenados**: Map<string, DocumentRecord>

### MockRedisClient

**Localização**: `src/infrastructure/mocks/mock-redis-client.ts`

**Métodos Implementados**:
- Operações String: `get`, `set`, `del`, `expire`, `ttl`
- Operações Lista: `lpush`, `rpop`, `llen`, `blpop`
- Operações Set Ordenado: `zadd`, `zrem`
- Operações Hash: `hset`, `hget`, `hgetall`, `hdel`
- Gerenciamento: `flushdb`, `quit`

**Recursos**:
- Suporta expiração de chaves (TTL)
- Estruturas de dados JSON serializadas
- Implementação thread-safe com Map

## Fluxo de Decisão

```
┌─────────────────────────────────────────┐
│    Aplicação Inicia                     │
└──────────────┬──────────────────────────┘
               │
               ▼
        ┌────────────────────┐
        │ Ler ENABLE_MOCKS   │
        └────────┬───────────┘
                 │
        ┌────────┴────────┐
        │                 │
    (true)             (false)
        │                 │
        ▼                 ▼
    ┌───────────────┐  ┌──────────────────┐
    │ MockProviders │  │ RealProviders    │
    │               │  │                  │
    │ - MockPrisma  │  │ - PrismaPostgres │
    │ - MockRedis   │  │ - BullMQ+Redis   │
    │ - No Worker   │  │ - Worker iniciado│
    └───────────────┘  └──────────────────┘
```

## Checklist de Migração

### De Mock para Real

1. ✅ Verificar `docker-compose.yml` (postgres + redis)
2. ✅ Executar `docker-compose up -d`
3. ✅ Executar migrações: `prisma migrate deploy`
4. ✅ Definir `ENABLE_MOCKS=false`
5. ✅ Definir `DATABASE_URL=postgresql://...`
6. ✅ Executar testes: `npm run test:e2e`

### De Real para Mock

1. ✅ Remover `ENABLE_MOCKS=false` (volta ao padrão `true`)
2. ✅ Remover/ignorar `DATABASE_URL`
3. ✅ Executar testes: `npm test`

## Testes de Validação

### Modo Mock
```bash
npm test
# Testes unitários: 4 suites, 11 testes
```

### Modo Real
```bash
ENABLE_MOCKS=false DATABASE_URL=postgresql://user:password@localhost:5432/doc-intelligence npm run test:e2e
# E2E: 1 suite, 1 teste

ENABLE_MOCKS=false DATABASE_URL=postgresql://user:password@localhost:5432/doc-intelligence npm run test:integration
# Integração: 1 suite, 1 teste
```

## Troubleshooting

### Erro: "DATABASE_URL is required" em modo mock

**Problema**: ENABLE_MOCKS não foi detectado corretamente

**Solução**:
```bash
ENABLE_MOCKS=true npm run start:dev
```

### Erro: "Cannot connect to PostgreSQL" em modo real

**Problema**: Docker não está rodando ou credenciais erradas

**Solução**:
```bash
docker-compose ps  # Verificar se containers estão rodando
docker-compose logs postgres  # Ver logs do PostgreSQL
```

### Erro: "BullMQ: Your redis options maxRetriesPerRequest must be null"

**Problema**: Ocorria em testes anteriores com Redis real

**Solução**: Já corrigido no código (adicionado `maxRetriesPerRequest: null`)

## Referência de Ambiente

| Variável | Mock | Real | Padrão |
|----------|------|------|--------|
| ENABLE_MOCKS | true | false | true |
| DATABASE_URL | ignorado | obrigatório | mock://in-memory |
| REDIS_HOST | ignorado | localhost | localhost |
| REDIS_PORT | ignorado | 6379 | 6379 |
| NODE_ENV | development | production | development |

## Conclusão

O sistema agora suporta:
- ✅ Desenvolvimento rápido com mocks (padrão)
- ✅ Validação com infraestrutura real quando necessário
- ✅ Alternância transparente entre modos
- ✅ Testes consistentes em ambos os modos

---

**Última Atualização**: 2026-08-31  
**Status**: ✅ Implementado e Validado
