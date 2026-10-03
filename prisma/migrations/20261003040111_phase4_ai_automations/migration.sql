-- Fase 4: configuración y uso de IA, buzón de novedades, automatizaciones y aprobaciones.
-- Solo añade tipos, tablas e índices; el estado PENDING_APPROVAL se añade al enum de campañas.
-- CreateEnum
CREATE TYPE "AiSource" AS ENUM ('PLATFORM', 'OWN');

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('ANTHROPIC', 'OPENAI', 'OPENAI_COMPATIBLE');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('OK', 'ERROR', 'REFUSED');

-- CreateEnum
CREATE TYPE "ChangelogCategory" AS ENUM ('FEATURE', 'IMPROVEMENT', 'FIX', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'AWAITING_APPROVAL', 'SCHEDULED', 'SKIPPED', 'REJECTED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "CampaignStatus" ADD VALUE 'PENDING_APPROVAL';

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" "AiSource" NOT NULL,
    "kind" "AiProviderKind" NOT NULL,
    "credentials_enc" TEXT,
    "base_url" TEXT,
    "default_model" TEXT NOT NULL,
    "fast_model" TEXT,
    "monthly_budget_usd" DOUBLE PRECISION NOT NULL,
    "input_price_per_mtok" DOUBLE PRECISION,
    "output_price_per_mtok" DOUBLE PRECISION,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_error" TEXT,
    "last_verified_at" TIMESTAMP(3),
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "status" "AiUsageStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changelog_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "external_id" TEXT,
    "version" TEXT,
    "title" TEXT NOT NULL,
    "body_md" TEXT NOT NULL,
    "category" "ChangelogCategory" NOT NULL DEFAULT 'OTHER',
    "published_at" TIMESTAMP(3) NOT NULL,
    "consumed_by_run_id" UUID,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "changelog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule" JSONB NOT NULL,
    "timezone" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "campaign_id" UUID,
    "template_id" UUID,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "removed_links" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "approver_user_ids" UUID[],
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "on_timeout" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_tenant_id_key" ON "ai_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_usage_tenant_id_created_at_idx" ON "ai_usage"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "changelog_entries_tenant_id_published_at_idx" ON "changelog_entries"("tenant_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "changelog_entries_tenant_id_external_id_key" ON "changelog_entries"("tenant_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "automations_tenant_id_name_key" ON "automations"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "automation_runs_tenant_id_started_at_idx" ON "automation_runs"("tenant_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_automation_id_idempotency_key_key" ON "automation_runs"("automation_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_run_id_key" ON "approval_requests"("run_id");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_status_idx" ON "approval_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_status_expires_at_idx" ON "approval_requests"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changelog_entries" ADD CONSTRAINT "changelog_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
