FROM mcr.microsoft.com/dotnet/sdk:9.0-bookworm-slim AS dependencies

ARG TARGETARCH

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    npm_config_fund=false \
    npm_config_audit=false \
    DOCKER_CONTAINER=1 \
    STEAMKIT_DIR=/opt/wallhub-depot \
    DEPOTDOWNLOADER_DIR=/opt/wallhub-depot/DepotDownloader \
    DEPOTDOWNLOADER_CONFIG_DIR=/opt/wallhub-depot/account \
    WALLHUB_DEPOT_STREAM_DIR=/opt/wallhub-depot/DepotDownloaderStream

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        iputils-ping \
        nodejs \
        npm \
        python3 \
        unzip \
        zip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS frontend-build

# The UI imports a few shared browser helpers from the root source tree, but
# does not need server domains or DepotDownloader sources to produce assets.
COPY vite.config.ts tailwind.config.ts postcss.config.cjs tsconfig.json ./
COPY frontend ./frontend
COPY src/shared ./src/shared
RUN npm run build:ui

FROM dependencies AS depot-build

# Keep the expensive DepotDownloader build independent from frontend assets.
COPY server.js ./server.js
COPY src ./src
COPY tools ./tools
RUN node server.js --build-depot-runtime \
    && npm prune --omit=dev

FROM mcr.microsoft.com/dotnet/runtime:9.0-bookworm-slim

ARG TARGETARCH
ARG WALLHUB_UID=10001
ARG WALLHUB_GID=10001

ENV NODE_ENV=production \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PORT=3090 \
    WALLHUB_UID=${WALLHUB_UID} \
    WALLHUB_GID=${WALLHUB_GID} \
    WALLHUB_SUPERVISOR=0 \
    WALLHUB_STEAMCOMMUNITY_302_DIR=/opt/steamcommunity_302 \
    DOCKER_CONTAINER=1 \
    STEAMKIT_DIR=/data/SteamKit \
    WALLHUB_DOWNLOADS_DIR=/data/Downloads \
    DEPOTDOWNLOADER_DIR=/data/SteamKit/DepotDownloader \
    WALLHUB_DEPOT_JSON_PROGRESS_PATH=/opt/wallhub-depot/DepotDownloader/DepotDownloader \
    WALLHUB_DEPOT_STREAM_DIR=/opt/wallhub-depot/DepotDownloaderStream \
    WALLHUB_DEPOT_STREAM_PATH=/opt/wallhub-depot/DepotDownloaderStream/DepotDownloader \
    DEPOTDOWNLOADER_CONFIG_DIR=/data/SteamKit/account \
    WALLHUB_DEPOT_HOME_DIR=/data/SteamKit/account/home \
    WALLHUB_DEPOT_DOTNET_CLI_HOME=/data/SteamKit/account/dotnet-home \
    WALLHUB_DEPOT_XDG_DATA_HOME=/data/SteamKit/account/xdg-data \
    WALLHUB_DEPOT_XDG_CONFIG_HOME=/data/SteamKit/account/xdg-config \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

WORKDIR /app

# Runtime dependencies for SteamKit mode and GitHub reachability probes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        gosu \
        iputils-ping \
        nodejs \
        python-is-python3 \
        python3 \
        python3-lz4 \
        python3-pil \
        tar \
        unzip \
        zip \
        libnetfilter-queue1 \
        libnss3-tools \
    && command -v unzip \
    && unzip -v >/dev/null \
    && cp -L "$(command -v unzip)" /usr/local/bin/unzip \
    && chmod 0755 /usr/local/bin/unzip \
    && /usr/local/bin/unzip -v >/dev/null \
    && python3 -c "import zipfile; print('python zipfile ok')" \
    && apt-get purge -y --auto-remove \
        python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 wallhub \
    && useradd --system --uid 10001 --gid wallhub --home-dir /home/wallhub --create-home wallhub \
    && mkdir -p /data /app /opt/steamcommunity_302 \
    && chown -R wallhub:wallhub /data /app /home/wallhub /opt/steamcommunity_302

COPY --from=depot-build --chown=wallhub:wallhub /app/package.json /app/package-lock.json ./
COPY --from=depot-build --chown=wallhub:wallhub /app/node_modules ./node_modules
COPY --from=depot-build --chown=wallhub:wallhub /app/server.js ./server.js
COPY --from=depot-build --chown=wallhub:wallhub /app/src ./src
COPY --from=frontend-build --chown=wallhub:wallhub /app/public ./public
COPY --from=depot-build --chown=wallhub:wallhub /app/tools ./tools
COPY --chown=wallhub:wallhub docs ./docs
COPY --chown=wallhub:wallhub README.md README.en.md ./
COPY --from=depot-build --chown=wallhub:wallhub /opt/wallhub-depot/DepotDownloader /opt/wallhub-depot/DepotDownloader
COPY --from=depot-build --chown=wallhub:wallhub /opt/wallhub-depot/DepotDownloaderStream /opt/wallhub-depot/DepotDownloaderStream

# Persist web settings in the same /data mount as runtimes and downloads.
RUN rm -f /app/cache-settings.json \
    && ln -s /data/cache-settings.json /app/cache-settings.json \
    && chown -h wallhub:wallhub /app/cache-settings.json

COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/wallhub-entrypoint
RUN chmod +x /usr/local/bin/wallhub-entrypoint

EXPOSE 3090

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["wallhub-entrypoint"]
CMD ["node", "server.js"]
