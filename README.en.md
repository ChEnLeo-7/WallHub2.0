# WallHub

WallHub is a local web app for browsing, downloading, and playing Wallpaper Engine Workshop items. The backend is Node.js, the frontend is React + TypeScript + Vite, and the downloader path is SteamKit / DepotDownloader only.

> For personal learning and local management. Workshop downloads usually require a Steam account that owns Wallpaper Engine. Follow Steam, Wallpaper Engine, and creator rules.

## Features

- Browse, search, and filter Wallpaper Engine Workshop items by keyword, Workshop ID, author ID, or exact phrase.
- Home filters include type, age rating, and Genre; multi-select can be enabled in Appearance settings.
- View details, previews, comments, subscription counts, file sizes, and update times.
- Download queue with pause, resume, delete, priority controls, and real progress.
- Video wallpapers support background download, browser download, local playback, and experimental SteamKit chunk streaming.
- Scene wallpapers can be converted to mobile MPKG. `sounds/` audio files are kept and packed into the MPKG.
- SteamKit supports password login, Steam Guard, and QR login.
- Safe mode is enabled by default. Use `--NSFW` to show mature-content options.
- Supports Windows, Linux, Android/Termux/proot, and Docker.

## Requirements

- Node.js 16.17+ (minimum for the full app and existing tests; npm 8+ recommended)
- npm
- curl, unzip, zip, and ping
- .NET 9 SDK + Runtime
- Python 3.7+; complete MPKG support requires Pillow, lz4, etcpak, and texture2ddecoder. `tools/mpkg/requirements.txt` pins Python 3.7-compatible versions.

On first start, WallHub downloads and builds a DepotDownloader runtime with JSON progress output.

### MPKG Conversion Modes

- **Fast mode (default)**: uses RGBA + LZ4-HC for lossless texture pixels and lower-latency conversion. Its cache is `Mpkg/<workshopId>.mpkg`.
- **Maximum compression**: uses ETC2 only for textures matched by the safe conversion rules and keeps the rest as RGBA. Files are usually smaller but conversion takes longer, and ETC2 is lossy. Its cache is `Mpkg/<workshopId>.compact.mpkg`, so switching modes never reuses the other mode's cache.
- Choose it in Web **Download settings → MPKG conversion mode**, or override the persisted setting with `WALLHUB_MPKG_TEXTURE_PROFILE=fast|compact`.
- If Maximum compression lacks `etcpak`, WallHub records a warning and safely falls back to Fast mode instead of producing an oversized pseudo-compact package.

> The Docker base image includes Pillow and lz4. To enable ETC2 conversion for Maximum compression, install `etcpak` from `tools/mpkg/requirements.txt` in a derived image. Without it, WallHub safely falls back to Fast mode.

### GitHub Source Download Policy

Before initially downloading and building the SteamKit JSON downloader or chunk-stream downloader, the default `auto` policy pings `www.google.com` once. A successful ping uses the native GitHub URL directly; a failed ping prioritizes `gh-proxy.com`-style accelerator URLs and falls back to the native URL only after they fail. Set `WALLHUB_GITHUB_ACCELERATOR=direct` (or `off` / `0`) to skip the probe and always use GitHub directly.

## Architecture and Verification

- `server.js` is the minimal process entry; HTTP lifecycle startup lives in `src/bootstrap/startWallhubServer.js`.
- Backend boundaries are `src/app/` (HTTP), `src/domains/` (business), `src/infrastructure/` (external I/O), and `src/shared/` (pure utilities).
- Frontend boundaries are `frontend/src/components/`, `hooks/`, and `lib/`; settings constants and presentation primitives live in `components/settings/`.
- SteamKit C# source edits, watchdog/control-plane parsing, Workshop item mapping, and Steam Proxy client injection each have separate modules while old entry points retain compatible exports.

Verification commands:

```bash
npm test
npx tsc --noEmit
node --input-type=module -e "import { build } from 'vite'; await build({ configFile: 'vite.config.ts', build: { outDir: 'C:/Users/Test/AppData/Local/Temp/wallhub-build', emptyOutDir: true } });"
```

The Docker runtime stage copies `server.js`, `src/`, and `public/`; when Docker is available, validate with `docker compose config` and the image healthcheck.

## Quick Start

```bash
npm ci
npm run build:ui
node server.js
```

Open:

```text
http://localhost:3090
```

Common commands:

```bash
npm start
npm run start:nsfw
npm run dev:ui
npm run build:ui
```

Startup flags:

```bash
node server.js
node server.js --NSFW
node --use-system-ca server.js
```

## Platform Setup

### One-command Linux / Termux installer

Interactive installation:

```bash
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash
```

Unattended examples:

```bash
# Standard Linux: detects Debian/Ubuntu, Fedora/RHEL, Arch, or openSUSE
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash -s -- install --target linux --non-interactive --yes

# Native Termux
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash -s -- install --target termux --non-interactive --yes

# Create and enter a Debian Proot from Termux (use ubuntu for Ubuntu)
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash -s -- install --target proot --proot-distro debian --non-interactive --yes
```

The installer supports `x86_64` and `ARM64`. Defaults are official mirrors, an isolated layout, safe mode, and port `3090`. `--mirror china` persistently configures TUNA system/PyPI mirrors and npmmirror while retaining hash-protected backups. It does not modify firewalls or download Steamcommunity_302 itself.

Maintenance commands:

```bash
./install.sh check
./install.sh repair
./install.sh update
./install.sh restore-mirrors
./install.sh uninstall
./install.sh uninstall --purge --yes
```

Main options:

```text
--target auto|linux|termux|proot
--proot-distro debian|ubuntu
--mirror official|china
--layout isolated|in-place
--repo <Git or tar.gz/tgz/zip URL>
--branch <branch-or-tag>
--install-dir <path>  --data-dir <path>
--build-ui  --sc302-deps yes|no
--non-interactive  --yes  --lang zh|en  --verbose  --dry-run
```

When committed `public` assets are complete, only production npm dependencies are installed. The UI is rebuilt only for missing/broken assets or `--build-ui`. Success requires real capability probes for Node, the Python venv, .NET 9 SDK+Runtime, all four MPKG modules, and `/health`; it does not wait for the two SteamKit runtimes to finish background builds. Steam login, Steam Guard, real downloads, and streaming remain manual UI checks.

> Native Termux uses Android bionic. If its repositories have no runnable native `.NET 9`, Microsoft's glibc build cannot execute either; the installer fails with diagnostics and never silently switches to Proot. Prefer Debian/Ubuntu Proot for complete functionality. Old Google Play Termux, Alpine/musl, and ARMv7 are unsupported.

### Windows

Install Node.js LTS and .NET 9 SDK/Runtime. For MPKG conversion:

```powershell
py -m pip install -r tools/mpkg/requirements.txt
npm ci
npm run build:ui
node server.js
```

### Linux

Debian/Ubuntu basics:

```bash
sudo apt update
sudo apt install -y nodejs npm curl unzip zip ca-certificates python3 python3-pil python3-lz4 python3-pip
python3 -m pip install --user -r tools/mpkg/requirements.txt
```

After installing .NET 9 SDK/Runtime:

```bash
npm ci
npm run build:ui
node server.js
```

### Android / Termux

Native Termux can run the Node server and frontend, but .NET 9 support depends on your device and package source. Termux + proot Debian/Ubuntu is usually more reliable.

Native Termux:

```bash
pkg update
pkg install nodejs-lts git curl unzip zip python
python -m pip install -r tools/mpkg/requirements.txt
npm ci
npm run build:ui
node server.js
```

proot Debian/Ubuntu:

```bash
pkg install proot-distro
proot-distro install ubuntu
proot-distro login ubuntu
apt update
apt install -y nodejs npm curl unzip zip ca-certificates python3 python3-pil python3-lz4 python3-pip
python3 -m pip install --user -r tools/mpkg/requirements.txt
```

Then install .NET 9 SDK/Runtime and run the same `npm ci`, `npm run build:ui`, and `node server.js` commands.

> `texture2ddecoder` provides native DXT1/DXT5 decoding for texture-heavy wallpapers. Conversion remains compatible without it, but the server logs a performance warning. Set
> `WALLHUB_MPKG_AUTO_RGBA_TEXTURE_THRESHOLD=0` to disable the automatic RGBA fast path for large texture batches.
> The high-texture RGBA fast path then applies lossless parallel LZ4-HC7 compression to reduce output size. Set
> `WALLHUB_MPKG_AUTO_RGBA_LZ4_COMPRESSION_LEVEL=0` to return to faster but larger LZ4 fast output.
>
> MPKG conversion has two texture profiles: **Fast** is the default and keeps the existing lossless RGBA + LZ4-HC7 path for texture-heavy projects; **Compact** uses ETC2 only for the existing safe DXT/static-image candidates, so it can be slower and mildly lossy. Compact output is cached separately as `<itemId>.compact.mpkg`; Fast keeps `<itemId>.mpkg`. If `etcpak` is unavailable, Compact safely falls back to Fast and records the reason in the conversion report/logs. The Docker base image includes Pillow and lz4; install `etcpak` from `tools/mpkg/requirements.txt` in a derived image before expecting Compact to transcode textures.

## Docker

Docker uses SteamKit by default and stores runtime data under `./wallhub-data`. The image includes Python, Pillow, and lz4 for MPKG conversion.

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3090
```

Useful commands:

```bash
docker compose logs -f wallhub
docker compose down
WALLHUB_PORT=8080 docker compose up -d --build
```

Container data paths:

- `/data/SteamKit`
- `/data/Downloads`
- `/data/cache-settings.json`

Steamcommunity_302 support is controlled by `WALLHUB_STEAMCOMMUNITY_302` in `docker-compose.yml`. Set it to `"1"` and rebuild/start the container when needed.

ARM64 / Termux-proot uses the same `Dockerfile` and `docker-compose.yml`:

```bash
docker compose up -d --build
```

The image detects arm64 at startup and lowers SteamKit/.NET memory pressure automatically. Keep `./wallhub-data` inside the proot/Linux filesystem when possible; Android shared storage can be slower and stricter about file operations.

## Directories

| Path | Purpose |
| --- | --- |
| `frontend/` | React frontend source |
| `public/` | built frontend |
| `server.js` | Node backend |
| `tools/mpkg/` | bundled MPKG converter |
| `docs/` | runtime notes |
| `SteamKit/` | SteamKit/DepotDownloader runtime files, account sessions, and temporary data |
| `SteamKit/account/depot-stream-cache/` | SteamKit chunk-stream playback cache |
| `Downloads/` | downloaded wallpaper projects |
| `Downloads/<itemId>/Mpkg/` | converted MPKG files for scene wallpapers |
| `cache-settings.json` | web settings cache |

Runtime data directories should not be committed or included in release packages.

## Environment Variables

| Variable | Description |
| --- | --- |
| `PORT` | server port, default `3090` |
| `WALLHUB_DOWNLOADS_DIR` | completed download directory |
| `STEAMKIT_DIR` | SteamKit runtime directory |
| `DEPOTDOWNLOADER_DIR` | DepotDownloader runtime directory |
| `DEPOTDOWNLOADER_CONFIG_DIR` | DepotDownloader account/session directory |
| `DEPOTDOWNLOADER_MAX_DOWNLOADS` | SteamKit per-item download concurrency |
| `WALLHUB_MAX_CONCURRENT_DOWNLOADS` | max parallel queue downloads |
| `WALLHUB_DEPOT_STREAM_CACHE_MAX_MB` | SteamKit chunk-stream cache limit in MB; overrides the web setting when set |
| `WALLHUB_MPKG_AUTO_RGBA_TEXTURE_THRESHOLD` | When the TEX count reaches this value, `auto` uses faster but larger RGBA output; default `600`, set `0` to disable |
| `WALLHUB_MPKG_AUTO_RGBA_LZ4_COMPRESSION_LEVEL` | Lossless LZ4-HC level for high-texture auto RGBA output; default `7`, range `1`–`12`, set `0` for faster but larger LZ4 fast output |
| `WALLHUB_MPKG_AUTO_RGBA_LZ4_WORKERS` | Maximum high-texture RGBA LZ4-HC worker threads; default `min(16, logical CPU count)`, lower it on memory/thermal-constrained devices |
| `WALLHUB_MPKG_TEXTURE_PROFILE` | Deployment override for the web setting: `fast` (default) or `compact` |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` | general network proxy; download CDN policy can be controlled separately in Settings |
| `STEAM_API_KEY` | Steam Web API Key |
| `WALLHUB_GITHUB_ACCELERATOR` | GitHub source-download policy; default `auto` pings `www.google.com`, uses GitHub directly when reachable, and prioritizes accelerator URLs when it is not; `direct` / `off` / `0` force direct GitHub |

## Release Checks

```bash
npm ci
npm run build:ui
npx tsc --noEmit
node --check server.js
python -m py_compile tools/mpkg/mobile_mpkg.py tools/mpkg/wallpaper_engine_toolkit.py
docker compose config
```

Before release, exclude:

- `node_modules/`
- `SteamKit/`
- `Downloads/`
- `cache-settings.json`
- `wallhub-data/`
- `Steamcommunity_302/`
