FROM node:24.19.0-bookworm-slim AS build
WORKDIR /build
RUN npm install --global pnpm@12.5.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY apps/server/src apps/server/src
COPY apps/server/scripts apps/server/scripts
COPY apps/web apps/web
COPY packages/contracts/src packages/contracts/src
RUN pnpm --filter @agent4novel/server build && pnpm --filter @agent4novel/web build
RUN pnpm --filter @agent4novel/server deploy --prod /production/server

FROM node:24.19.0-bookworm-slim AS runtime
ENV NODE_ENV=production A4N_HOST=0.0.0.0 A4N_PORT=8787 A4N_DATA_DIR=/data A4N_SERVE_WEB=1 A4N_SEED_DEMO=0
WORKDIR /app/apps/server
COPY --from=build --chown=node:node /production/server ./
COPY --from=build --chown=node:node /build/apps/web/dist /app/apps/web/dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(async r => {if (!r.ok || (await r.json()).status !== 'ok') process.exit(1)}).catch(() => process.exit(1))"
CMD ["node", "dist/start.js"]
