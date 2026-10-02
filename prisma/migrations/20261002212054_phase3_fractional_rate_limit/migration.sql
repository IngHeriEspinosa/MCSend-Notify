-- Ritmo de envío con decimales (p. ej. 0,5/s = 30 por minuto en Microsoft 365). Conversión sin pérdida.
-- AlterTable
ALTER TABLE "email_provider_configs" ALTER COLUMN "rate_limit_per_second" SET DEFAULT 10,
ALTER COLUMN "rate_limit_per_second" SET DATA TYPE DOUBLE PRECISION;
