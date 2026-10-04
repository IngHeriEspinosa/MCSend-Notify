-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "tracking_domain" TEXT,
ADD COLUMN     "tracking_domain_checked_at" TIMESTAMP(3),
ADD COLUMN     "tracking_domain_error" TEXT,
ADD COLUMN     "tracking_domain_verified_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_tracking_domain_key" ON "tenants"("tracking_domain");

