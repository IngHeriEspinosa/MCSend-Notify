# syntax=docker/dockerfile:1.7
# =============================================================================
# MC Send Notify: imagen multi-target. Autor: Ing. Heri Espinosa
#   app     → servidor Next.js (salida standalone)
#   worker  → procesador de colas BullMQ (con poppler para miniaturas de PDF)
#   migrate → aplica las migraciones de Prisma y termina
#
# Todas las etapas usan Debian (glibc): las dependencias nativas se instalan y se
# ejecutan sobre la misma libc.
# =============================================================================
ARG NODE_IMAGE=node:24-bookworm-slim

# ----- Base de ejecución: almacén de CA del sistema -----------------------------
# Los certificados *.crt de docker/certs/ se añaden como CA de confianza. Sirve para redes
# corporativas con inspección TLS; nunca se desactiva la verificación de certificados.
FROM ${NODE_IMAGE} AS runtime-base
COPY docker/certs/ /usr/local/share/ca-certificates/extra/
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_OPTIONS=--use-system-ca

FROM runtime-base AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.20.0 && npm cache clean --force
WORKDIR /app

# ----- Dependencias completas (build y migraciones) ---------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ----- Build de Next.js y del worker ------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm build

# ----- Dependencias de producción para el worker ------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts

# ----- Migraciones ------------------------------------------------------------
FROM deps AS migrate
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ----- App web ----------------------------------------------------------------
FROM runtime-base AS app
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# ----- Worker -----------------------------------------------------------------
FROM runtime-base AS worker
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       poppler-utils fonts-liberation fonts-dejavu-core fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 9464
CMD ["node", "dist/worker/index.mjs"]
