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
COPY tools/mpkg ./tools/mpkg
RUN node server.js --build-depot-runtime \
    && npm prune --omit=dev

FROM mcr.microsoft.com/dotnet/runtime:9.0-bookworm-slim

ARG TARGETARCH
ARG WALLHUB_VERSION=dev
ARG WALLHUB_REVISION=unknown
ARG WALLHUB_UID=10001
ARG WALLHUB_GID=10001

ENV NODE_ENV=production \
    WALLHUB_VERSION=${WALLHUB_VERSION} \
    PATH=/opt/wallhub-python/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PYTHON=/opt/wallhub-python/bin/python \
    PYTHON3=/opt/wallhub-python/bin/python3 \
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

LABEL org.opencontainers.image.title="WallHub" \
      org.opencontainers.image.description="Local web app for Wallpaper Engine Workshop content" \
      org.opencontainers.image.source="https://github.com/ChEnLeo-7/WallHub2.0" \
      org.opencontainers.image.version="${WALLHUB_VERSION}" \
      org.opencontainers.image.revision="${WALLHUB_REVISION}"

WORKDIR /app

# Install MPKG packages in an isolated environment so Bookworm's PEP 668
# protection cannot redirect them away from the Python selected by WallHub.
COPY tools/mpkg/requirements.txt /tmp/wallhub-mpkg-requirements.txt

# Runtime dependencies for SteamKit, MPKG conversion, and reachability probes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        gosu \
        iputils-ping \
        nodejs \
        python3 \
        python3-venv \
        tar \
        unzip \
        zip \
        libnetfilter-queue1 \
        libnss3-tools \
    && python3 -m venv /opt/wallhub-python \
    && /opt/wallhub-python/bin/python -m pip install \
        --disable-pip-version-check \
        --no-cache-dir \
        --only-binary=:all: \
        -r /tmp/wallhub-mpkg-requirements.txt \
    && /opt/wallhub-python/bin/python -c "from PIL import Image; import etcpak, lz4.block, texture2ddecoder; image = Image.new('RGBA', (4, 4), (12, 34, 56, 255)); assert image.size == (4, 4); payload = b'wallhub-lz4-capability' * 4; assert lz4.block.decompress(lz4.block.compress(payload, store_size=True)) == payload; rgba = bytes([12, 34, 56, 255]) * 16; assert len(etcpak.compress_etc2_rgba(rgba, 4, 4)) > 0; assert len(texture2ddecoder.decode_bc1(bytes(8), 4, 4)) == 64; assert len(texture2ddecoder.decode_bc3(bytes(16), 4, 4)) == 64; print('MPKG Python capability probe passed')" \
    && command -v unzip \
    && unzip -v >/dev/null \
    && cp -L "$(command -v unzip)" /usr/local/bin/unzip \
    && chmod 0755 /usr/local/bin/unzip \
    && /usr/local/bin/unzip -v >/dev/null \
    && /opt/wallhub-python/bin/python -c "import zipfile; print('python zipfile ok')" \
    && rm -f /tmp/wallhub-mpkg-requirements.txt \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 wallhub \
    && useradd --system --uid 10001 --gid wallhub --home-dir /home/wallhub --create-home wallhub \
    && mkdir -p /data /app /opt/steamcommunity_302 \
    && chown -R wallhub:wallhub /data /app /home/wallhub /opt/steamcommunity_302

COPY --from=depot-build --chown=wallhub:wallhub /app/package.json ./package.json
COPY --from=depot-build --chown=wallhub:wallhub /app/node_modules ./node_modules
COPY --from=depot-build --chown=wallhub:wallhub /app/server.js ./server.js
COPY --from=depot-build --chown=wallhub:wallhub /app/src ./src
COPY --from=frontend-build --chown=wallhub:wallhub /app/public ./public
COPY --from=depot-build --chown=wallhub:wallhub /app/tools/mpkg ./tools/mpkg
COPY --chown=wallhub:wallhub tools/update ./tools/update
COPY --from=depot-build --chown=wallhub:wallhub /opt/wallhub-depot/DepotDownloader /opt/wallhub-depot/DepotDownloader
COPY --from=depot-build --chown=wallhub:wallhub /opt/wallhub-depot/DepotDownloaderStream /opt/wallhub-depot/DepotDownloaderStream

# Persist web settings in the same /data mount as runtimes and downloads.
RUN rm -f /app/cache-settings.json \
    && ln -s /data/cache-settings.json /app/cache-settings.json \
    && chown -h wallhub:wallhub /app/cache-settings.json

COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/wallhub-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/wallhub-entrypoint \
    && chmod +x /usr/local/bin/wallhub-entrypoint

EXPOSE 3090

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["wallhub-entrypoint"]
CMD ["node", "server.js"]
