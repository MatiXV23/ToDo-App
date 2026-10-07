# syntax=docker/dockerfile:1.7
# Una sola imagen para los tres procesos de producción:
#   web     → node server.js            (Next.js standalone)
#   worker  → node dist/worker.cjs      (automatizaciones y tareas programadas)
#   migrate → node dist/migrate.cjs     (migraciones, corre una vez al desplegar)

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Valores de relleno solo para compilar; los reales vienen del .env en runtime.
ENV BETTER_AUTH_SECRET=build-only-placeholder-secret-0123456789 \
    APP_URL=http://localhost:3000 \
    NODE_ENV=production
RUN npm run build \
 && npx esbuild src/worker.ts --bundle --platform=node --target=node24 --format=cjs \
      --outfile=dist/worker.cjs --external:pg-native --log-level=warning \
 && npx esbuild src/server/db/migrate-cli.ts --bundle --platform=node --target=node24 --format=cjs \
      --outfile=dist/migrate.cjs --external:pg-native --log-level=warning

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOADS_DIR=/data/uploads
# Adjuntos: el volumen montado acá hereda el dueño "node".
RUN mkdir -p /data/uploads && chown node:node /data/uploads
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "server.js"]
