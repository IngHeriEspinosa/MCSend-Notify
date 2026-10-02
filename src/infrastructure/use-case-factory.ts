/**
 * Construcción de los casos de uso con sus adaptadores (inyección por constructor).
 * La presentación (Server Actions, route handlers) y el worker solo dependen de este módulo.
 */
import { AuthenticateApiKeyUseCase, ManageApiKeysUseCase } from '@/core/api-keys/api-keys';
import { ListAuditLogUseCase } from '@/core/audit/audit-log';
import {
  ManageContactFieldsUseCase,
  ManageContactListsUseCase,
  ManageSegmentsUseCase,
  ManageTagsUseCase,
  ManageTopicsUseCase,
} from '@/core/contacts/use-cases/audience.use-cases';
import {
  CreateContactUseCase,
  DeleteContactUseCase,
  GetContactUseCase,
  ListContactsUseCase,
  UpdateContactUseCase,
  UpsertContactUseCase,
  type ContactUseCaseDeps,
} from '@/core/contacts/use-cases/contacts.use-cases';
import {
  ConfigureContactImportUseCase,
  GetContactImportUseCase,
  ProcessContactImportUseCase,
  UploadContactImportUseCase,
  type ImportUseCaseDeps,
} from '@/core/contacts/use-cases/imports.use-cases';
import {
  AcceptInvitationUseCase,
  GetInvitationUseCase,
  RegisterFromInvitationUseCase,
} from '@/core/identity/use-cases/accept-invitation.use-case';
import { AuthenticateWithCredentialsUseCase } from '@/core/identity/use-cases/authenticate-with-credentials.use-case';
import { GetActiveUserUseCase } from '@/core/identity/use-cases/get-active-user.use-case';
import { InviteMemberUseCase } from '@/core/identity/use-cases/invite-member.use-case';
import {
  ChangeMemberRoleUseCase,
  ListMembersUseCase,
  RemoveMemberUseCase,
  RevokeInvitationUseCase,
} from '@/core/identity/use-cases/manage-members.use-case';
import {
  ManageDocumentsUseCase,
  ProcessDocumentUseCase,
  UploadDocumentUseCase,
  type DocumentUseCaseDeps,
} from '@/core/documents/use-cases/documents.use-cases';
import { ResolvePublicAssetUseCase } from '@/core/documents/use-cases/public-assets.use-case';
import { systemClock } from '@/core/shared/ports';
import {
  ManageTemplatesUseCase,
  PreviewTemplateUseCase,
  type TemplateUseCaseDeps,
} from '@/core/templates/use-cases/templates.use-cases';
import { ManageBrandingUseCase } from '@/core/tenants/branding.use-cases';
import {
  CreateTenantUseCase,
  GetTenantStatsUseCase,
  ListUserTenantsUseCase,
  ResolveTenantAccessUseCase,
  UpdateTenantSettingsUseCase,
} from '@/core/tenants/use-cases';
import {
  getContactImportQueue,
  getDocumentConverter,
  getDocumentQueue,
  getEmailCompiler,
  getFileInspector,
  getImageProcessor,
  getObjectStorage,
  getPdfToolkit,
  getPrisma,
  getPublicAssetLinks,
  getSpreadsheetReader,
  getTenantClients,
  memoize,
} from './container';
import {
  Argon2PasswordHasher,
  cryptoIdGenerator,
  RandomSecretTokenService,
  Sha256ApiKeyCodec,
  sha256ContentHasher,
} from './crypto/crypto-services';
import {
  PrismaApiKeyRepository,
  PrismaAuditLogger,
} from './persistence/prisma/repositories/audit-and-keys.prisma-repositories';
import {
  PrismaContactFieldRepository,
  PrismaContactImportRepository,
  PrismaContactListRepository,
  PrismaSegmentRepository,
  PrismaTagRepository,
  PrismaTopicRepository,
} from './persistence/prisma/repositories/audience.prisma-repositories';
import { PrismaContactRepository } from './persistence/prisma/repositories/contact.prisma-repository';
import { PrismaDocumentRepository } from './persistence/prisma/repositories/document.prisma-repository';
import {
  PrismaInvitationRepository,
  PrismaMembershipRepository,
  PrismaUserRepository,
} from './persistence/prisma/repositories/identity.prisma-repositories';
import { PrismaTemplateRepository } from './persistence/prisma/repositories/template.prisma-repository';
import { PrismaTenantRepository } from './persistence/prisma/repositories/tenant.prisma-repository';

const repositories = {
  users: () => memoize('repo.users', () => new PrismaUserRepository(getPrisma())),
  memberships: () =>
    memoize('repo.memberships', () => new PrismaMembershipRepository(getTenantClients())),
  invitations: () =>
    memoize(
      'repo.invitations',
      () => new PrismaInvitationRepository(getPrisma(), getTenantClients()),
    ),
  tenants: () =>
    memoize('repo.tenants', () => new PrismaTenantRepository(getPrisma(), getTenantClients())),
  audit: () => memoize('repo.audit', () => new PrismaAuditLogger(getPrisma(), getTenantClients())),
  apiKeys: () =>
    memoize('repo.apiKeys', () => new PrismaApiKeyRepository(getPrisma(), getTenantClients())),
  contacts: () =>
    memoize('repo.contacts', () => new PrismaContactRepository(getPrisma(), getTenantClients())),
  lists: () => memoize('repo.lists', () => new PrismaContactListRepository(getTenantClients())),
  tags: () => memoize('repo.tags', () => new PrismaTagRepository(getTenantClients())),
  segments: () => memoize('repo.segments', () => new PrismaSegmentRepository(getTenantClients())),
  fields: () => memoize('repo.fields', () => new PrismaContactFieldRepository(getTenantClients())),
  topics: () => memoize('repo.topics', () => new PrismaTopicRepository(getTenantClients())),
  imports: () =>
    memoize('repo.imports', () => new PrismaContactImportRepository(getTenantClients())),
  templates: () =>
    memoize('repo.templates', () => new PrismaTemplateRepository(getPrisma(), getTenantClients())),
  documents: () =>
    memoize('repo.documents', () => new PrismaDocumentRepository(getTenantClients())),
};

const services = {
  hasher: () => memoize('svc.hasher', () => new Argon2PasswordHasher()),
  tokens: () => memoize('svc.tokens', () => new RandomSecretTokenService()),
  apiKeyCodec: () => memoize('svc.apiKeyCodec', () => new Sha256ApiKeyCodec()),
};

function contactDeps(): ContactUseCaseDeps {
  return {
    contacts: repositories.contacts(),
    fields: repositories.fields(),
    lists: repositories.lists(),
    tags: repositories.tags(),
    topics: repositories.topics(),
    segments: repositories.segments(),
    audit: repositories.audit(),
    clock: systemClock,
  };
}

function importDeps(): ImportUseCaseDeps {
  return {
    imports: repositories.imports(),
    contacts: repositories.contacts(),
    lists: repositories.lists(),
    fields: repositories.fields(),
    storage: getObjectStorage(),
    reader: getSpreadsheetReader(),
    queue: getContactImportQueue(),
    audit: repositories.audit(),
    clock: systemClock,
    ids: cryptoIdGenerator,
  };
}

function documentDeps(): DocumentUseCaseDeps {
  return {
    documents: repositories.documents(),
    storage: getObjectStorage(),
    inspector: getFileInspector(),
    converter: getDocumentConverter(),
    pdf: getPdfToolkit(),
    images: getImageProcessor(),
    queue: getDocumentQueue(),
    hasher: sha256ContentHasher,
    audit: repositories.audit(),
    clock: systemClock,
    ids: cryptoIdGenerator,
  };
}

function templateDeps(): TemplateUseCaseDeps {
  return {
    templates: repositories.templates(),
    documents: repositories.documents(),
    contacts: repositories.contacts(),
    fields: repositories.fields(),
    branding: repositories.tenants(),
    assets: getPublicAssetLinks(),
    compiler: getEmailCompiler(),
    audit: repositories.audit(),
    clock: systemClock,
  };
}

/** Casos de uso listos para usar. Cada uno se construye una sola vez por proceso. */
export const useCases = {
  // Identidad y acceso
  authenticate: () =>
    memoize(
      'uc.authenticate',
      () =>
        new AuthenticateWithCredentialsUseCase(
          repositories.users(),
          services.hasher(),
          systemClock,
        ),
    ),
  resolveTenantAccess: () =>
    memoize('uc.resolveTenant', () => new ResolveTenantAccessUseCase(repositories.tenants())),
  listUserTenants: () =>
    memoize('uc.listUserTenants', () => new ListUserTenantsUseCase(repositories.tenants())),
  getActiveUser: () =>
    memoize('uc.getActiveUser', () => new GetActiveUserUseCase(repositories.users())),
  inviteMember: () =>
    memoize(
      'uc.invite',
      () =>
        new InviteMemberUseCase(
          repositories.invitations(),
          repositories.memberships(),
          repositories.users(),
          services.tokens(),
          repositories.audit(),
          systemClock,
        ),
    ),
  getInvitation: () =>
    memoize(
      'uc.getInvitation',
      () =>
        new GetInvitationUseCase(
          repositories.invitations(),
          repositories.users(),
          services.tokens(),
          systemClock,
        ),
    ),
  acceptInvitation: () =>
    memoize(
      'uc.acceptInvitation',
      () =>
        new AcceptInvitationUseCase(
          repositories.invitations(),
          services.tokens(),
          repositories.audit(),
          systemClock,
        ),
    ),
  registerFromInvitation: () =>
    memoize(
      'uc.registerFromInvitation',
      () =>
        new RegisterFromInvitationUseCase(
          repositories.invitations(),
          repositories.users(),
          services.hasher(),
          services.tokens(),
          repositories.audit(),
          systemClock,
        ),
    ),
  listMembers: () =>
    memoize(
      'uc.listMembers',
      () =>
        new ListMembersUseCase(repositories.memberships(), repositories.invitations(), systemClock),
    ),
  changeMemberRole: () =>
    memoize(
      'uc.changeRole',
      () => new ChangeMemberRoleUseCase(repositories.memberships(), repositories.audit()),
    ),
  removeMember: () =>
    memoize(
      'uc.removeMember',
      () => new RemoveMemberUseCase(repositories.memberships(), repositories.audit()),
    ),
  revokeInvitation: () =>
    memoize(
      'uc.revokeInvitation',
      () =>
        new RevokeInvitationUseCase(repositories.invitations(), repositories.audit(), systemClock),
    ),

  // Tenants
  createTenant: () =>
    memoize(
      'uc.createTenant',
      () => new CreateTenantUseCase(repositories.tenants(), repositories.audit()),
    ),
  updateTenantSettings: () =>
    memoize(
      'uc.updateTenant',
      () => new UpdateTenantSettingsUseCase(repositories.tenants(), repositories.audit()),
    ),
  tenantStats: () =>
    memoize('uc.tenantStats', () => new GetTenantStatsUseCase(repositories.tenants())),
  auditLog: () => memoize('uc.auditLog', () => new ListAuditLogUseCase(repositories.audit())),

  // Contactos y audiencias
  listContacts: () => memoize('uc.listContacts', () => new ListContactsUseCase(contactDeps())),
  getContact: () => memoize('uc.getContact', () => new GetContactUseCase(repositories.contacts())),
  createContact: () => memoize('uc.createContact', () => new CreateContactUseCase(contactDeps())),
  updateContact: () => memoize('uc.updateContact', () => new UpdateContactUseCase(contactDeps())),
  upsertContact: () => memoize('uc.upsertContact', () => new UpsertContactUseCase(contactDeps())),
  deleteContact: () =>
    memoize(
      'uc.deleteContact',
      () => new DeleteContactUseCase(repositories.contacts(), repositories.audit()),
    ),
  lists: () =>
    memoize(
      'uc.lists',
      () => new ManageContactListsUseCase(repositories.lists(), repositories.audit()),
    ),
  tags: () =>
    memoize('uc.tags', () => new ManageTagsUseCase(repositories.tags(), repositories.audit())),
  segments: () =>
    memoize(
      'uc.segments',
      () =>
        new ManageSegmentsUseCase(
          repositories.segments(),
          repositories.contacts(),
          repositories.fields(),
          repositories.audit(),
          systemClock,
        ),
    ),
  contactFields: () =>
    memoize(
      'uc.fields',
      () => new ManageContactFieldsUseCase(repositories.fields(), repositories.audit()),
    ),
  topics: () =>
    memoize(
      'uc.topics',
      () => new ManageTopicsUseCase(repositories.topics(), repositories.audit()),
    ),

  // Importaciones
  uploadImport: () =>
    memoize('uc.uploadImport', () => new UploadContactImportUseCase(importDeps())),
  configureImport: () =>
    memoize('uc.configureImport', () => new ConfigureContactImportUseCase(importDeps())),
  getImport: () => memoize('uc.getImport', () => new GetContactImportUseCase(importDeps())),
  processImport: () =>
    memoize('uc.processImport', () => new ProcessContactImportUseCase(importDeps())),

  // Plantillas, documentos y branding
  templates: () => memoize('uc.templates', () => new ManageTemplatesUseCase(templateDeps())),
  previewTemplate: () =>
    memoize('uc.previewTemplate', () => new PreviewTemplateUseCase(templateDeps())),
  uploadDocument: () =>
    memoize('uc.uploadDocument', () => new UploadDocumentUseCase(documentDeps())),
  processDocument: () =>
    memoize('uc.processDocument', () => new ProcessDocumentUseCase(documentDeps())),
  documents: () => memoize('uc.documents', () => new ManageDocumentsUseCase(documentDeps())),
  publicAssets: () =>
    memoize(
      'uc.publicAssets',
      () => new ResolvePublicAssetUseCase(repositories.documents(), getObjectStorage()),
    ),
  branding: () =>
    memoize(
      'uc.branding',
      () =>
        new ManageBrandingUseCase({
          branding: repositories.tenants(),
          storage: getObjectStorage(),
          inspector: getFileInspector(),
          images: getImageProcessor(),
          assets: getPublicAssetLinks(),
          audit: repositories.audit(),
          ids: cryptoIdGenerator,
        }),
    ),

  // Claves de API
  apiKeys: () =>
    memoize(
      'uc.apiKeys',
      () =>
        new ManageApiKeysUseCase(
          repositories.apiKeys(),
          services.apiKeyCodec(),
          repositories.audit(),
          systemClock,
        ),
    ),
  authenticateApiKey: () =>
    memoize(
      'uc.authApiKey',
      () =>
        new AuthenticateApiKeyUseCase(repositories.apiKeys(), services.apiKeyCodec(), systemClock),
    ),
};
