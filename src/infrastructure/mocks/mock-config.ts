/**
 * Mock Configuration
 *
 * Controla se a aplicação deve usar mocks ou conexões reais.
 *
 * Variáveis de Ambiente:
 * - ENABLE_MOCKS=true  : Ativa mocks (padrão em desenvolvimento)
 * - ENABLE_MOCKS=false : Usa conexões reais (produção/testes com infra)
 */

export const isMockEnabled = (): boolean => {
  const enabled = process.env.ENABLE_MOCKS;
  
  // Por padrão, mocks estão habilitados
  if (enabled === undefined) {
    return true;
  }

  return enabled === 'true' || enabled === '1' || enabled === 'yes';
};

export const mockConfig = {
  enabled: isMockEnabled(),
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  database: {
    url: process.env.DATABASE_URL ?? 'mock://in-memory-database',
  },
};
