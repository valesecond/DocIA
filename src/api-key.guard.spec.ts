import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';

const context = (headers: Record<string, string | undefined>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as ExecutionContext;

describe('ApiKeyGuard', () => {
  const originalKey = process.env.API_KEY_PLACEHOLDER;

  afterEach(() => {
    process.env.API_KEY_PLACEHOLDER = originalKey;
  });

  it('rejects requests without the API key', () => {
    process.env.API_KEY_PLACEHOLDER = 'test-key';
    expect(() => new ApiKeyGuard().canActivate(context({}))).toThrow(UnauthorizedException);
  });

  it('allows requests with the configured API key', () => {
    process.env.API_KEY_PLACEHOLDER = 'test-key';
    expect(new ApiKeyGuard().canActivate(context({ 'x-api-key': 'test-key' }))).toBe(true);
  });
});