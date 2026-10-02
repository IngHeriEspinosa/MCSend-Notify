/**
 * Comprobación de autenticación del dominio remitente:
 * - SPF: registro TXT `v=spf1` en el dominio (más de uno es un error).
 * - DMARC: registro TXT `v=DMARC1` en `_dmarc.{dominio}`.
 * - DKIM: se prueban los selectores habituales de Resend, Microsoft 365, Google, SES y otros
 *   (CNAME o TXT `v=DKIM1` / clave `p=`).
 * Gmail y Yahoo exigen SPF, DKIM y DMARC a los remitentes masivos desde 2024.
 */
import { Resolver } from 'node:dns/promises';
import type { DnsChecker } from '@/core/providers/ports';
import type { DnsCheckResult, DnsRecordStatus } from '@/core/providers/provider-config';

const DKIM_SELECTORS = [
  'resend',
  'selector1',
  'selector2',
  'google',
  'default',
  'dkim',
  'mail',
  's1',
  's2',
  'k1',
  'mx',
  'smtp',
];

export class NodeDnsChecker implements DnsChecker {
  private readonly resolver = new Resolver({ timeout: 4000, tries: 2 });

  async check(domain: string): Promise<DnsCheckResult> {
    const [spf, dmarc, dkim] = await Promise.all([
      this.spf(domain),
      this.dmarc(domain),
      this.dkim(domain),
    ]);
    return { domain, spf, dmarc, dkim: dkim.status, dkimSelector: dkim.selector };
  }

  private async txt(name: string): Promise<string[]> {
    try {
      return (await this.resolver.resolveTxt(name)).map((chunks) => chunks.join(''));
    } catch {
      return [];
    }
  }

  private async spf(domain: string): Promise<DnsRecordStatus> {
    const records = (await this.txt(domain)).filter((record) =>
      record.toLowerCase().startsWith('v=spf1'),
    );
    if (records.length === 0) return 'missing';
    return records.length === 1 ? 'pass' : 'fail';
  }

  private async dmarc(domain: string): Promise<DnsRecordStatus> {
    const records = (await this.txt(`_dmarc.${domain}`)).filter((record) =>
      record.toUpperCase().startsWith('V=DMARC1'),
    );
    if (records.length === 0) return 'missing';
    return records.length === 1 ? 'pass' : 'fail';
  }

  private async dkim(
    domain: string,
  ): Promise<{ status: DnsRecordStatus; selector: string | null }> {
    for (const selector of DKIM_SELECTORS) {
      const name = `${selector}._domainkey.${domain}`;
      const records = await this.txt(name);
      if (records.some((record) => /(^|;)\s*p=/.test(record) || record.includes('v=DKIM1'))) {
        return { status: 'pass', selector };
      }
      try {
        if ((await this.resolver.resolveCname(name)).length > 0)
          return { status: 'pass', selector };
      } catch {
        // Selector inexistente: se prueba el siguiente.
      }
    }
    return { status: 'missing', selector: null };
  }
}
