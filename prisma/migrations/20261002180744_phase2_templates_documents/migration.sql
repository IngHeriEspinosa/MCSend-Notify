-- CreateEnum
CREATE TYPE "TemplateFormat" AS ENUM ('BLOCKS', 'MARKDOWN', 'HTML');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PDF', 'PRESENTATION', 'DOCUMENT', 'SPREADSHEET', 'IMAGE', 'HTML', 'MARKDOWN', 'TEXT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "format" "TemplateFormat" NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "content" JSONB NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "format" "TemplateFormat" NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "content" JSONB NOT NULL,
    "locale" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "pdf_key" TEXT,
    "thumbnail_key" TEXT,
    "thumbnail_width" INTEGER,
    "thumbnail_height" INTEGER,
    "page_count" INTEGER,
    "extracted_text" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "templates_tenant_id_updated_at_idx" ON "templates"("tenant_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "templates_tenant_id_name_key" ON "templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "template_versions_tenant_id_template_id_idx" ON "template_versions"("tenant_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_versions_template_id_version_key" ON "template_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "documents_tenant_id_created_at_idx" ON "documents"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_tenant_id_sha256_idx" ON "documents"("tenant_id", "sha256");

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las versiones de plantilla son instantáneas inmutables: solo se insertan
-- (se eliminan en cascada con su plantilla).
CREATE FUNCTION template_versions_prevent_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'template_versions es inmutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_versions_immutable
  BEFORE UPDATE ON "template_versions"
  FOR EACH ROW EXECUTE FUNCTION template_versions_prevent_update();
