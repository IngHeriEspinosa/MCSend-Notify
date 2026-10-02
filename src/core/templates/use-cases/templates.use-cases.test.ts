import { beforeEach, describe, expect, it } from 'vitest';
import {
  fakeAssetLinks,
  InMemoryBrandingRepository,
  InMemoryDocumentRepository,
  InMemoryTemplateRepository,
} from '@tests/fakes/content.fakes';
import { FakeClock, RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import type { ContactFieldRepository, ContactRepository } from '@/core/contacts/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { TemplateBody } from '../email-content';
import type { EmailCompiler, PrepareEmailInput, PreparedEmail } from '../ports';
import type { RecipientVariables } from '../template-variables';
import {
  ManageTemplatesUseCase,
  PreviewTemplateUseCase,
  type TemplateUseCaseDeps,
} from './templates.use-cases';

const TENANT = '11111111-1111-7111-8111-111111111111';

function context(role: 'EDITOR' | 'VIEWER' = 'EDITOR'): TenantContext {
  return {
    tenantId: TENANT,
    tenantSlug: 'mcsupport',
    actor: { type: 'user', userId: 'user-1', role, isPlatformAdmin: false },
  };
}

const body = (subject: string): TemplateBody => ({
  format: 'MARKDOWN',
  subject,
  preheader: null,
  locale: 'es',
  content: { markdown: 'Hola {{ contact.first_name }}' },
});

/** Compilador que registra lo recibido y "personaliza" sustituyendo el nombre. */
class RecordingCompiler implements EmailCompiler {
  prepared: PrepareEmailInput[] = [];
  personalized = 0;
  issues: PreparedEmail['issues'] = [];
  async prepare(input: PrepareEmailInput): Promise<PreparedEmail> {
    this.prepared.push(input);
    return {
      subject: input.body.subject,
      html: '<p>{{ contact.first_name }}</p>',
      text: '',
      issues: this.issues,
    };
  }
  async personalize(prepared: PreparedEmail, variables: RecipientVariables) {
    this.personalized += 1;
    const html = prepared.html.replace('{{ contact.first_name }}', variables.contact.first_name);
    return { subject: prepared.subject, html, text: '', sizeBytes: html.length };
  }
}

let deps: TemplateUseCaseDeps & {
  templates: InMemoryTemplateRepository;
  compiler: RecordingCompiler;
  audit: RecordingAuditLogger;
};

beforeEach(() => {
  const contacts: Pick<ContactRepository, 'findById'> = {
    findById: async (_context, contactId) =>
      contactId === '33333333-3333-7333-8333-333333333333'
        ? {
            id: contactId,
            email: 'luis@cliente.com',
            firstName: 'Luis',
            lastName: 'Gómez',
            company: 'Cliente',
            status: 'ACTIVE',
            source: 'manual',
            createdAt: new Date(),
            locale: null,
            timezone: null,
            externalId: null,
            attributes: { plan: 'Pro' },
            consentAt: null,
            consentSource: null,
            listIds: [],
            tagIds: [],
            topicSubscriptions: {},
            updatedAt: new Date(),
          }
        : null,
  };
  const fields: Pick<ContactFieldRepository, 'list'> = {
    list: async () => [{ id: 'f1', key: 'plan', label: 'Plan', type: 'STRING', options: [] }],
  };
  deps = {
    templates: new InMemoryTemplateRepository(),
    documents: new InMemoryDocumentRepository(),
    contacts: contacts as ContactRepository,
    fields: fields as ContactFieldRepository,
    branding: new InMemoryBrandingRepository(),
    assets: fakeAssetLinks,
    compiler: new RecordingCompiler(),
    audit: new RecordingAuditLogger(),
    clock: new FakeClock(),
  };
});

describe('ManageTemplatesUseCase', () => {
  it('cada guardado crea una versión nueva', async () => {
    const manage = new ManageTemplatesUseCase(deps);
    const created = await manage.create(context(), {
      name: 'Resumen',
      description: null,
      body: body('v1'),
    });
    const saved = await manage.save(context(), {
      templateId: created.id,
      expectedVersion: 1,
      name: 'Resumen',
      description: null,
      note: 'cambio de asunto',
      body: body('v2'),
    });

    expect(saved.currentVersion).toBe(2);
    expect((await manage.versions(context(), created.id)).map((item) => item.version)).toEqual([
      2, 1,
    ]);
  });

  it('guardar sobre una versión desactualizada devuelve CONFLICT (STALE_VERSION)', async () => {
    const manage = new ManageTemplatesUseCase(deps);
    const created = await manage.create(context(), {
      name: 'R',
      description: null,
      body: body('v1'),
    });
    const input = {
      templateId: created.id,
      expectedVersion: 1,
      name: 'R',
      description: null,
      note: null,
      body: body('v2'),
    };
    await manage.save(context(), input);
    await expect(manage.save(context(), input)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'STALE_VERSION' },
    });
  });

  it('restaurar crea una versión nueva con el contenido antiguo (el historial no se reescribe)', async () => {
    const manage = new ManageTemplatesUseCase(deps);
    const created = await manage.create(context(), {
      name: 'R',
      description: null,
      body: body('v1'),
    });
    await manage.save(context(), {
      templateId: created.id,
      expectedVersion: 1,
      name: 'R',
      description: null,
      note: null,
      body: body('v2'),
    });
    const restored = await manage.restore(context(), created.id, 1);

    expect(restored.currentVersion).toBe(3);
    expect(restored.body.subject).toBe('v1');
    const versions = await manage.versions(context(), created.id);
    expect(versions.map((item) => [item.version, item.note])).toEqual([
      [3, 'restore:1'],
      [2, null],
      [1, null],
    ]);
  });

  it('un VIEWER puede leer pero no crear ni guardar', async () => {
    const manage = new ManageTemplatesUseCase(deps);
    await expect(
      manage.create(context('VIEWER'), { name: 'R', description: null, body: body('x') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(manage.list(context('VIEWER'))).resolves.toEqual([]);
  });
});

describe('PreviewTemplateUseCase', () => {
  it('usa el contacto de ejemplo si no se elige uno y el branding del tenant', async () => {
    const result = await new PreviewTemplateUseCase(deps).execute(context('VIEWER'), {
      body: body('Hola'),
      contactId: null,
      colorScheme: 'dark',
    });
    expect(result.html).toBe('<p>Ana</p>');
    const input = deps.compiler.prepared[0];
    expect(input?.sender.tenantName).toBe('MCSupport');
    expect(input?.forceColorScheme).toBe('dark');
    expect([...(input?.fieldKeys ?? [])]).toEqual(['plan']);
  });

  it('personaliza con un contacto real del tenant', async () => {
    const result = await new PreviewTemplateUseCase(deps).execute(context(), {
      body: body('Hola'),
      contactId: '33333333-3333-7333-8333-333333333333',
      colorScheme: 'light',
    });
    expect(result.html).toBe('<p>Luis</p>');
  });

  it('con errores de sintaxis Liquid no personaliza y devuelve las incidencias', async () => {
    deps.compiler.issues = [{ code: 'LIQUID_SYNTAX', severity: 'error', detail: 'x' }];
    const result = await new PreviewTemplateUseCase(deps).execute(context(), {
      body: body('Hola'),
      contactId: null,
      colorScheme: 'light',
    });
    expect(deps.compiler.personalized).toBe(0);
    expect(result.issues[0]?.code).toBe('LIQUID_SYNTAX');
  });

  it('un contacto de otro tenant (o inexistente) da NOT_FOUND', async () => {
    await expect(
      new PreviewTemplateUseCase(deps).execute(context(), {
        body: body('Hola'),
        contactId: '44444444-4444-7444-8444-444444444444',
        colorScheme: 'light',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
