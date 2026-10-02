-- CreateEnum
CREATE TYPE "EmailProviderKind" AS ENUM ('SMTP', 'MICROSOFT_GRAPH', 'RESEND', 'SES');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'DISPATCHING', 'SENDING', 'PAUSED', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SUPPRESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryEventType" AS ENUM ('SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'DOWNLOADED', 'BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED', 'FAILED');

-- CreateTable
CREATE TABLE "email_provider_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EmailProviderKind" NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "credentials_enc" TEXT,
    "endpoint_token" TEXT NOT NULL,
    "rate_limit_per_second" INTEGER NOT NULL DEFAULT 10,
    "max_per_day" INTEGER,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_error" TEXT,
    "last_verified_at" TIMESTAMP(3),
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sender_identities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider_config_id" UUID NOT NULL,
    "from_name" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "reply_to" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "dns_check" JSONB,
    "dns_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "template_id" UUID,
    "template_version" INTEGER,
    "body" JSONB,
    "subject_b" TEXT,
    "compiled_subject" TEXT,
    "compiled_html" TEXT,
    "compiled_text" TEXT,
    "sender_identity_id" UUID,
    "topic_id" UUID,
    "audience" JSONB NOT NULL DEFAULT '{}',
    "scheduled_at" TIMESTAMP(3),
    "throttle_per_hour" INTEGER,
    "track_opens" BOOLEAN NOT NULL DEFAULT true,
    "track_clicks" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "dispatch_cursor" UUID,
    "dispatched_at" TIMESTAMP(3),
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "variant" TEXT,
    "provider_config_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "claimed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "first_opened_at" TIMESTAMP(3),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "machine_open_only" BOOLEAN NOT NULL DEFAULT false,
    "first_clicked_at" TIMESTAMP(3),
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "unsubscribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "type" "DeliveryEventType" NOT NULL,
    "source" TEXT NOT NULL,
    "link_id" UUID,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhook_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider_config_id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_provider_configs_endpoint_token_key" ON "email_provider_configs"("endpoint_token");

-- CreateIndex
CREATE UNIQUE INDEX "email_provider_configs_tenant_id_name_key" ON "email_provider_configs"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sender_identities_tenant_id_from_email_key" ON "sender_identities"("tenant_id", "from_email");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_created_at_idx" ON "campaigns"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_links_campaign_id_position_key" ON "campaign_links"("campaign_id", "position");

-- CreateIndex
CREATE INDEX "deliveries_campaign_id_status_idx" ON "deliveries"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "deliveries_provider_config_id_provider_message_id_idx" ON "deliveries"("provider_config_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "deliveries_status_claimed_at_idx" ON "deliveries"("status", "claimed_at");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_campaign_id_contact_id_key" ON "deliveries"("campaign_id", "contact_id");

-- CreateIndex
CREATE INDEX "delivery_events_campaign_id_type_idx" ON "delivery_events"("campaign_id", "type");

-- CreateIndex
CREATE INDEX "delivery_events_tenant_id_occurred_at_idx" ON "delivery_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inbound_webhook_events_tenant_id_received_at_idx" ON "inbound_webhook_events"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhook_events_provider_config_id_provider_event_id_key" ON "inbound_webhook_events"("provider_config_id", "provider_event_id");

-- AddForeignKey
ALTER TABLE "email_provider_configs" ADD CONSTRAINT "email_provider_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_provider_config_id_fkey" FOREIGN KEY ("provider_config_id") REFERENCES "email_provider_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_identity_id_fkey" FOREIGN KEY ("sender_identity_id") REFERENCES "sender_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
