/**
 * Application Configuration
 *
 * Centraliza configuração baseada em ambiente para o pipeline de processamento de documentos.
 * Sobrescreva via .env ou variáveis de ambiente.
 *
 * Modo Mock (ENABLE_MOCKS=true):
 * - DATABASE_URL é opcional
 * - Usa repositório em memória
 * - Usa Redis mock em memória
 *
 * Modo Real (ENABLE_MOCKS=false):
 * - DATABASE_URL é obrigatório
 * - Usa PostgreSQL real
 * - Usa Redis real
 */

const isMockEnabled = process.env.ENABLE_MOCKS !== 'false';

export const config = {
  // Redis
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },

  // Database
  database: {
    url: isMockEnabled ? (process.env.DATABASE_URL ?? 'mock://in-memory') : requiredEnvironmentVariable('DATABASE_URL'),
  },

  // Processing
  processing: {
    maxAttempts: Number(process.env.PROCESSING_MAX_ATTEMPTS ?? 3),
    backoffMs: Number(process.env.PROCESSING_BACKOFF_MS ?? 1000),
    providerTimeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS ?? 45000),
    confidenceThreshold: Number(process.env.CONFIDENCE_THRESHOLD ?? 0.8),
  },

  // Worker
  worker: {
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
  },

  // Storage
  storage: {
    uploadDir: process.env.STORAGE_UPLOAD_DIR ?? './storage/uploads',
  },

  // Server
  server: {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
  },

  // Mock
  mock: {
    enabled: isMockEnabled,
  },
};

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
