# API — Departamento Pessoal / REGISTROS XML-PDF
# Build a partir da RAIZ do repositório:  docker build -f apps/api/Dockerfile -t gestao-xml-api .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/xml-parser/package.json packages/xml-parser/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
COPY apps/windows-agent/package.json apps/windows-agent/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @gestao/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/xml-parser/package.json packages/xml-parser/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
COPY apps/windows-agent/package.json apps/windows-agent/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @gestao/api && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
