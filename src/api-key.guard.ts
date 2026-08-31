// Placeholder nao-produtivo - ver SPEC-001 Secao 2.2. Autenticacao real esta fora do escopo desta fatia vertical.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedKey = process.env.API_KEY_PLACEHOLDER ?? 'dev-key';
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const providedKey = request.headers['x-api-key'];

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
