FROM node:24.19.0-bookworm-slim AS web-build
WORKDIR /build
RUN npm install --global pnpm@12.5.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --filter @agent4novel/web... --frozen-lockfile
COPY apps/web apps/web
COPY packages/contracts/src packages/contracts/src
RUN pnpm --filter @agent4novel/web build

FROM python:3.11-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    A4N_ROOT=/app \
    A4N_HOST=0.0.0.0 \
    A4N_PORT=8787 \
    A4N_DATA_DIR=/data \
    A4N_SERVE_WEB=1 \
    A4N_SEED_DEMO=0 \
    A4N_CONTAINER=1
WORKDIR /app
COPY apps/backend/pyproject.toml apps/backend/requirements.lock apps/backend/
RUN python -m pip install --no-cache-dir -r apps/backend/requirements.lock
COPY apps/backend/src apps/backend/src
RUN python -m pip install --no-cache-dir --no-deps apps/backend
COPY --from=web-build /build/apps/web/dist apps/web/dist
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home app \
    && install -d -m 700 -o app -g app /data
USER app
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import json,urllib.request; response=json.load(urllib.request.urlopen('http://127.0.0.1:8787/api/health', timeout=2)); assert response['status']=='ok'"
CMD ["a4n-api"]
