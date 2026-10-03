/** Dependencias de ManageCampaignsUseCase sobre dobles en memoria (flujos de automatización). */
import type { ContactFieldRepository } from '@/core/contacts/ports';
import type { CampaignUseCaseDeps } from '@/core/campaigns/use-cases/campaigns.use-cases';
import type { TenantContext } from '@/core/shared/tenant-context';
import { EmailComposer } from '@/core/templates/email-composer';
import {
  fakeAssetLinks,
  InMemoryBrandingRepository,
  InMemoryDocumentRepository,
  InMemoryTemplateRepository,
} from './content.fakes';
import { FakeClock, RecordingAuditLogger } from './identity.fakes';
import {
  FakeAudience,
  FakeGateway,
  InMemoryCampaignRepository,
  InMemoryDeliveryRepository,
  InMemoryProviderRepository,
  InMemorySenderRepository,
  RecordingCampaignQueue,
  RecordingCompiler,
} from './sending.fakes';

const fields: ContactFieldRepository = {
  list: async () => [],
  create: async () => {
    throw new Error('no usado');
  },
  delete: async () => false,
};
const countAll = {
  countExisting: async (_context: TenantContext, ids: readonly string[]) => ids.length,
};

export type CampaignTestDeps = CampaignUseCaseDeps & {
  campaigns: InMemoryCampaignRepository;
  queue: RecordingCampaignQueue;
  audience: FakeAudience;
  templates: InMemoryTemplateRepository;
  audit: RecordingAuditLogger;
  clock: FakeClock;
};

export function campaignTestDeps(clock = new FakeClock()): CampaignTestDeps {
  const compiler = new RecordingCompiler();
  return {
    campaigns: new InMemoryCampaignRepository(),
    deliveries: new InMemoryDeliveryRepository(),
    audience: new FakeAudience([{ contactId: 'c1', email: 'a@b.c' }]),
    queue: new RecordingCampaignQueue(),
    templates: new InMemoryTemplateRepository(),
    senders: new InMemorySenderRepository(),
    providers: new InMemoryProviderRepository(),
    gateway: new FakeGateway(),
    composer: new EmailComposer({
      branding: new InMemoryBrandingRepository(),
      fields,
      documents: new InMemoryDocumentRepository(),
      assets: fakeAssetLinks,
      compiler,
    }),
    compiler,
    contacts: { findById: async () => null },
    lists: countAll,
    segments: { findById: async () => null },
    topics: countAll,
    audit: new RecordingAuditLogger(),
    clock,
  };
}
