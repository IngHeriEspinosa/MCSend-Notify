/** Casos de uso de la identidad visual del tenant (colores, pie y logotipo de los correos). */
import type { AuditLogger } from '@/core/audit/audit-log';
import { DocumentProcessingError } from '@/core/documents/document';
import type { FileInspector, ImageProcessor, PublicAssetLinks } from '@/core/documents/ports';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { IdGenerator, ObjectStorage } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { BrandingRepository, TenantBranding, UpdateBrandingInput } from './branding';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_KEY = /^tenants\/([0-9a-f-]{36})\/branding\/logo-[0-9a-f-]{36}\.png$/;

/** Comprueba que la clave del logotipo pertenece al tenant (las URL firmadas la incluyen). */
export function isTenantLogoKey(tenantId: string, key: string): boolean {
  return LOGO_KEY.exec(key)?.[1] === tenantId;
}

export interface BrandingUseCaseDeps {
  branding: BrandingRepository;
  storage: ObjectStorage;
  inspector: FileInspector;
  images: ImageProcessor;
  assets: PublicAssetLinks;
  audit: AuditLogger;
  ids: IdGenerator;
}

export class ManageBrandingUseCase {
  constructor(private readonly deps: BrandingUseCaseDeps) {}

  async get(context: TenantContext) {
    assertCan(context, 'tenant:read');
    const profile = await this.deps.branding.getEmailProfile(context);
    return {
      ...profile,
      logoUrl: profile.branding.logoKey
        ? this.deps.assets.tenantLogo(context.tenantId, profile.branding.logoKey)
        : null,
    };
  }

  async update(context: TenantContext, input: UpdateBrandingInput): Promise<TenantBranding> {
    assertCan(context, 'tenant:update');
    const { branding } = await this.deps.branding.getEmailProfile(context);
    const next: TenantBranding = { ...branding, ...input };
    await this.deps.branding.saveBranding(context, next);
    await this.deps.audit.record(context, {
      action: 'branding.updated',
      entityType: 'tenant',
      entityId: context.tenantId,
      metadata: { primary: next.primary, accent: next.accent },
    });
    return next;
  }

  /**
   * Sube un logotipo (PNG, JPEG o WebP) y lo normaliza a PNG sin metadatos. Los logotipos
   * anteriores se conservan: los correos ya enviados siguen mostrándolos.
   */
  async uploadLogo(context: TenantContext, input: { fileName: string; bytes: Uint8Array }) {
    assertCan(context, 'tenant:update');
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_LOGO_BYTES) {
      throw new DomainError('VALIDATION', 'Tamaño de logotipo no permitido', {
        reason: 'FILE_SIZE',
      });
    }
    const inspected = await this.deps.inspector.inspect(input.fileName, input.bytes);
    if (inspected?.kind !== 'IMAGE' || inspected.extension === 'gif') {
      throw new DomainError('VALIDATION', 'El logotipo debe ser PNG, JPEG o WebP', {
        reason: 'FILE_TYPE',
      });
    }
    const logo = await this.deps.images.normalizeLogo(input.bytes).catch((error: unknown) => {
      if (error instanceof DocumentProcessingError) {
        throw new DomainError('VALIDATION', 'Imagen ilegible', { reason: 'FILE_TYPE' });
      }
      throw error;
    });
    const logoKey = `tenants/${context.tenantId}/branding/logo-${this.deps.ids.uuid()}.png`;
    await this.deps.storage.put(logoKey, logo.bytes, logo.contentType);
    const { branding } = await this.deps.branding.getEmailProfile(context);
    await this.deps.branding.saveBranding(context, { ...branding, logoKey });
    await this.deps.audit.record(context, {
      action: 'branding.logo_uploaded',
      entityType: 'tenant',
      entityId: context.tenantId,
      metadata: { width: logo.width, height: logo.height },
    });
    return { logoUrl: this.deps.assets.tenantLogo(context.tenantId, logoKey) };
  }

  async removeLogo(context: TenantContext) {
    assertCan(context, 'tenant:update');
    const { branding } = await this.deps.branding.getEmailProfile(context);
    await this.deps.branding.saveBranding(context, { ...branding, logoKey: null });
    await this.deps.audit.record(context, {
      action: 'branding.logo_removed',
      entityType: 'tenant',
      entityId: context.tenantId,
    });
  }
}
