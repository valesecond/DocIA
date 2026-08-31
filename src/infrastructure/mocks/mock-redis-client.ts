/**
 * Mock Redis Client
 *
 * Simula o comportamento de um cliente Redis para testes em ambiente
 * de desenvolvimento sem necessidade de Docker.
 *
 * Este mock implementa os métodos essenciais usados pelo BullMQ.
 */

export class MockRedisClient {
  private data: Map<string, string | null> = new Map();
  private expirations: Map<string, number> = new Map();

  async get(key: string): Promise<string | null> {
    this.checkExpiration(key);
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string, options?: any): Promise<void> {
    this.data.set(key, value);

    if (options?.EX) {
      const expiresAt = Date.now() + options.EX * 1000;
      this.expirations.set(key, expiresAt);
    }
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.data.has(key)) {
        this.data.delete(key);
        this.expirations.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.data.has(key)) {
      return 0;
    }
    const expiresAt = Date.now() + seconds * 1000;
    this.expirations.set(key, expiresAt);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    this.checkExpiration(key);
    if (!this.data.has(key)) {
      return -2;
    }
    const expiresAt = this.expirations.get(key);
    if (!expiresAt) {
      return -1;
    }
    return Math.ceil((expiresAt - Date.now()) / 1000);
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    const current = (this.data.get(key) || '[]') as any;
    const list = typeof current === 'string' ? JSON.parse(current) : [];
    list.unshift(...values);
    this.data.set(key, JSON.stringify(list));
    return list.length;
  }

  async rpop(key: string): Promise<string | null> {
    const current = (this.data.get(key) || '[]') as any;
    const list = typeof current === 'string' ? JSON.parse(current) : [];
    if (list.length === 0) {
      return null;
    }
    const value = list.pop();
    this.data.set(key, JSON.stringify(list));
    return value;
  }

  async llen(key: string): Promise<number> {
    const current = (this.data.get(key) || '[]') as any;
    const list = typeof current === 'string' ? JSON.parse(current) : [];
    return list.length;
  }

  async blpop(keys: string[], _timeout: number): Promise<[string, string] | null> {
    for (const key of keys) {
      const value = await this.rpop(key);
      if (value) {
        return [key, value];
      }
    }
    return null;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const current = (this.data.get(key) || '[]') as any;
    const set = typeof current === 'string' ? JSON.parse(current) : [];
    set.push({ score, member });
    this.data.set(key, JSON.stringify(set));
    return 1;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const current = (this.data.get(key) || '[]') as any;
    const set = typeof current === 'string' ? JSON.parse(current) : [];
    const before = set.length;
    const filtered = set.filter((item: any) => !members.includes(item.member));
    this.data.set(key, JSON.stringify(filtered));
    return before - filtered.length;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    const current = (this.data.get(key) || '{}') as any;
    const hash = typeof current === 'string' ? JSON.parse(current) : {};
    hash[field] = value;
    this.data.set(key, JSON.stringify(hash));
    return 1;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const current = (this.data.get(key) || '{}') as any;
    const hash = typeof current === 'string' ? JSON.parse(current) : {};
    return hash[field] ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const current = (this.data.get(key) || '{}') as any;
    return typeof current === 'string' ? JSON.parse(current) : {};
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const current = (this.data.get(key) || '{}') as any;
    const hash = typeof current === 'string' ? JSON.parse(current) : {};
    let deleted = 0;
    for (const field of fields) {
      if (field in hash) {
        delete hash[field];
        deleted++;
      }
    }
    this.data.set(key, JSON.stringify(hash));
    return deleted;
  }

  async flushdb(): Promise<void> {
    this.data.clear();
    this.expirations.clear();
  }

  async quit(): Promise<void> {
    this.data.clear();
    this.expirations.clear();
  }

  private checkExpiration(key: string): void {
    const expiresAt = this.expirations.get(key);
    if (expiresAt && Date.now() > expiresAt) {
      this.data.delete(key);
      this.expirations.delete(key);
    }
  }
}

export const createMockRedisConnection = () => {
  return new MockRedisClient();
};
