# Kontekst budowania: katalog główny repozytorium (monorepo).
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root --omit=optional

FROM deps AS build
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npx prisma generate --schema prisma/schema.prisma \
  && npm run build -w @syjonevent/shared \
  && npm run build -w @syjonevent/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Katalog na wgrywane grafiki tła — musi istnieć i być zapisywalny przez usera node
# zanim zamontujemy na nim wolumen (patrz docker-compose.prod.yml).
RUN mkdir -p apps/api/uploads && chown -R node:node apps/api/uploads

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migracje uruchamiamy przy starcie kontenera — Dokploy nie ma osobnego kroku release.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node apps/api/dist/server.js"]
