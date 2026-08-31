# Architecture Decision Records (ADRs)

Esta página documenta decisões arquiteturais e técnicas significativas do projeto DOC Intelligence.

---

## ADR-001: Arquitetura Hexagonal com Portas e Adaptadores

**Status**: Aceito  
**Data**: 2026-08-31  
**Context**: Necessidade de isolamento entre lógica de domínio e infraestrutura  

### Decisão
Implementar arquitetura hexagonal com:
- **Domínio** (`src/documents/`): Serviços, entidades, portas (interfaces)
- **Adapters** (`src/infrastructure/`, `src/prisma/`): Implementações de fila, storage, persistence
- **API** (`src/app.controller.ts`): Endpoints REST como "saída"

### Rationale
- Isolamento de mudanças: Trocar BullMQ por outra fila requer apenas novo adapter
- Testabilidade: Testes de domínio usam mocks; adapters testam separadamente
- Compliance com ADRs 002 e 004 (veja abaixo)

### Consequências
- Mais camadas de indireção (interfaces, factories)
- Setup inicial mais verboso
- Ganho em flexibilidade e manutenção

---

## ADR-002: BullMQ puro + Adapter fino (não @nestjs/bullmq)

**Status**: Aceito  
**Data**: 2026-08-31  
**Context**: Redução de dependências de framework e compatibilidade com NestJS 10  

### Decisão
- **Remover** `@nestjs/bullmq` do projeto
- **Usar** `bullmq@^6.x` puro com `ioredis` para conexão Redis
- **Criar** dois adapters hexagonais:
  1. `BullMQQueueAdapter`: Enfileira jobs (usado por `DocumentIngestionService`)
  2. `BullMQWorkerAdapter`: Consome jobs e delega ao domínio (usado por `OnModuleInit`)

### Rationale
- `@nestjs/bullmq` trazia conflitos de dependências (bullmq ^3/^4/^5 vs ^6)
- Wrapper de framework desnecessário; BullMQ é simples bastante
- Adapter fino permite trocar de fila sem tocar domínio
- Reduz lock-in do NestJS

### Consequências
- Responsabilidade do ciclo de vida do Worker cai no adapter
- Código ligeiramente mais verboso (sem decorators de framework)
- Ganho em independência e clareza arquitetural

---

## ADR-003: NestJS 10.4.8 + CommonJS (não v12 ESM)

**Status**: Aceito  
**Data**: 2026-08-31  
**Context**: Incompatibilidade entre NestJS 12 (ESM nativo) e Jest CommonJS  

### Decisão
- Fixar `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` em `^10.4.8`
- Configurar TypeScript com `"module": "commonjs"` e `"moduleResolution": "node"`
- Jest em CommonJS puro: `preset: "ts-jest"` sem flags ESM

### Rationale
**NestJS 12 vs 10 Conflict**:
- NestJS 12.0.1 é 100% ESM (`"type": "module"` em package.json)
- Jest 29.7 rodando CommonJS não consegue parsear ESM imports
- Erro: `Cannot use import.meta outside a module` (NestJS 12's load-package.util.js)

**Solução**:
- NestJS 10.4.x é CommonJS nativo → compatível com Jest direto
- Sem necessidade de `--experimental-vm-modules` ou `extensionsToTreatAsEsm`
- Build limpo: `TypeScript → CommonJS`

### Quando atualizar
- Quando Jest suportar ESM nativo melhor
- Quando NestJS 12 resolver conflitos de ESM/CommonJS
- Refatoração para "type": "module" em package.json (futuro)

### Consequências
- NestJS 10.4.8 é versão estável (sem breaking changes esperados em 10.x)
- Sem acesso a features de NestJS 12 (observability avançada, etc.)
- CommonJS será padrão indefinidamente até migração coordenada

---

## ADR-004: Erro do Agente e Resolução ESM/CommonJS

**Status**: Documentado  
**Data**: 2026-08-31  
**Context**: Falha do agente em diagnosticar/resolver conflito de módulos  

### O que deu errado
1. **Agente sugeriu downgrade sem validar dependências**
   - Tentou `@nestjs/schematics@10.4.9` (versão não existe)
   - Não verificou registry antes de propor versão fixa

2. **Tentativa de compatibilidade ESM foi incompleta**
   - Configurou Jest para ESM, mas NestJS 12 não era totalmente compatível
   - Recomendou `@nestjs/bullmq@12.0.0` que conflitava com bullmq^6

3. **Não isolou o problema de raiz**
   - Problema real: `@nestjs/common` 12.x usa `import.meta.url` no build
   - Solução verdadeira: downgrade completo para NestJS 10 (CommonJS nativo)

### Lições aprendidas
1. **Verificar registry antes de fixar versões**
   - Usar `npm view @package@major version --json` para listar versões disponíveis

2. **Testar ESM/CommonJS em isolation**
   - Não tentar "hybrid" mode (Jest CommonJS + deps ESM)
   - Escolher um caminho: full ESM ou full CommonJS

3. **Adapters isolam problemas de dependência**
   - Não depender de `@nestjs/bullmq` removeu 80% do conflito

### Como foi resolvido
- ADR-003: Downgrade completo para NestJS 10.4.8 (CommonJS nativo)
- ADR-002: Remover `@nestjs/bullmq`, usar `bullmq` puro + adapter fino
- Validação: 8 testes passando, build clean, zero ESM warnings

---

## ADR-005: Configuração Parametrizada via Variáveis de Ambiente

**Status**: Aceito  
**Data**: 2026-08-31  
**Context**: Necessidade de flexibilidade entre dev, test, prod  

### Decisão
Centralizar config em `src/config.ts`:
```typescript
export const config = {
  redis: { host, port },
  database: { url },
  processing: { maxAttempts, backoffMs, confidenceThreshold },
  worker: { concurrency },
  storage: { uploadDir },
  server: { port, nodeEnv },
};
```

### Rationale
- Sem hardcoded values em módulos
- Override simples via `.env` ou CI/CD
- Consistent defaults (fallback em desenvolvimento)

### Variáveis suportadas
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
DATABASE_URL=postgresql://...
PROCESSING_MAX_ATTEMPTS=3
PROCESSING_BACKOFF_MS=1000
CONFIDENCE_THRESHOLD=0.8
WORKER_CONCURRENCY=1
STORAGE_UPLOAD_DIR=./storage/uploads
PORT=3000
NODE_ENV=development
```

### Consequências
- Configuração não quebra testes (defaults sempre presentes)
- Fácil ajustar retry/confidence em produção
- .env é gitignored; segredos não ficam em repo

---

## ADR-006: Testes de Edge Cases Explícitos

**Status**: Aceito  
**Data**: 2026-08-31  
**Context**: Cobertura de cenários críticos de falha  

### Decisão
Suite separada `test/document-processing-edge-cases.spec.ts` com:
1. **Exhaustion de tentativas**: retry máximo → PENDING_REVIEW (não FAILED)
2. **Erro não-retentável**: sem retry → PENDING_REVIEW (immediate)
3. **Terminal states**: skip processamento se já DONE/PENDING_REVIEW/FAILED
4. **Attempt counter**: incrementa corretamente em cada retry

### Rationale
- Garante spec compliance (SPEC-001 Seção 9 — Falhas)
- Bug fix (ADR-003 linha 80-92) foi validado por esses testes
- Evita regressão em retry logic

### Consequências
- 4 testes adicionais → 8 tests total (workflow + edge cases)
- Cobertura explícita de estado-máquina
- Fácil adicionar cenários futuros

---

## Índice de ADRs
| # | Título | Status | Data |
|---|--------|--------|------|
| 001 | Arquitetura Hexagonal | Aceito | 2026-08-31 |
| 002 | BullMQ puro + Adapter fino | Aceito | 2026-08-31 |
| 003 | NestJS 10.4.8 + CommonJS | Aceito | 2026-08-31 |
| 004 | Erro do Agente (ESM/CommonJS) | Documentado | 2026-08-31 |
| 005 | Configuração Parametrizada | Aceito | 2026-08-31 |
| 006 | Testes de Edge Cases | Aceito | 2026-08-31 |
