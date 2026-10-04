/** Resolución de CNAME con tiempo máximo; "no existe" devuelve una lista vacía, no un error. */
import { Resolver } from 'node:dns/promises';
import type { CnameResolver } from '@/core/tenants/tracking-domain';

const NO_RECORD_CODES = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN']);

export class NodeCnameResolver implements CnameResolver {
  private readonly resolver = new Resolver({ timeout: 4000, tries: 2 });

  async resolveCname(domain: string): Promise<string[]> {
    try {
      return await this.resolver.resolveCname(domain);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
      if (typeof code === 'string' && NO_RECORD_CODES.has(code)) return [];
      throw error;
    }
  }
}
