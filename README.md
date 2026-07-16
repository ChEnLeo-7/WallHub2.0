# WallHub

WallHub 是一个本地运行的 Wallpaper Engine 创意工坊浏览、下载和播放工具。后端使用 Node.js，前端使用 React + TypeScript + Vite，下载链路只保留 SteamKit / DepotDownloader。

> 仅用于个人学习和本地管理。下载创意工坊内容通常需要登录拥有 Wallpaper Engine 的 Steam 账号，请遵守 Steam、Wallpaper Engine 和创作者规则。

## 功能

- 浏览、搜索和筛选 Wallpaper Engine 创意工坊项目，支持关键词、项目 ID、作者 ID、精确短语搜索。
- 首页支持类型、年龄评级、Genre 等筛选；外观设置中可开启首页筛选多选。
- 查看详情、预览图、评论、订阅量、文件大小、更新时间。
- 下载队列支持暂停、继续、删除、优先级调整和真实进度显示。
- 视频壁纸支持后台下载、下载到本地、本地播放，以及实验性 SteamKit 分块在线播放。
- 场景壁纸支持转换为移动端 MPKG；转换时会保留并打包 `sounds/` 音频文件。
- SteamKit 支持账号密码登录、Steam Guard 和 QR 扫码登录。
- 默认安全模式隐藏成人内容，使用 `--NSFW` 才显示成人评级选项。
- 支持 Windows、Linux、Android/Termux/proot 和 Docker。

## 要求

- Node.js 16.17+（完整运行与现有测试的最低版本；建议使用 npm 8+）
- npm
- curl、unzip、zip、ping
- .NET 9 SDK + Runtime
- Python 3.7+；完整 MPKG 功能需要 Pillow、lz4、etcpak、texture2ddecoder。`tools/mpkg/requirements.txt` 已锁定支持 Python 3.7 的版本。

首次启动时，WallHub 会下载并构建带 JSON 真实进度输出的 DepotDownloader。

### MPKG 文件转换方式

- **快速模式（默认）**：使用 RGBA + LZ4-HC，保持纹理像素无损，面向低延迟转换。缓存文件为 `Mpkg/<workshopId>.mpkg`。
- **最大压缩**：只对已有安全筛选规则命中的纹理使用 ETC2，其余保持 RGBA；文件通常更小，但转换更慢，且 ETC2 为有损编码。缓存文件为 `Mpkg/<workshopId>.compact.mpkg`，因此切换方式不会误复用另一种缓存。
- 可在 Web「下载设置 → MPKG 文件转换方式」中选择，也可用 `WALLHUB_MPKG_TEXTURE_PROFILE=fast|compact` 覆盖持久化设置。
- 若最大压缩缺少 `etcpak`，转换会记录 warning 并安全回退快速模式，不会生成一个更大的伪紧凑包。

> Docker 基础镜像内置 Pillow 与 lz4；若要让最大压缩实际转码 ETC2，请在派生镜像中安装 `tools/mpkg/requirements.txt` 的 `etcpak`。缺失时不会生成不兼容文件，而是按上述规则安全回退快速模式。

### GitHub 源码下载策略

首次下载并构建 SteamKit JSON 下载器或分块在线播放下载器前，默认 `auto` 策略会先 `ping www.google.com` 一次：连通时直接下载 GitHub 原生链接；不通时优先尝试 `gh-proxy.com` 等加速地址，全部加速地址失败后才回退原生链接。设置 `WALLHUB_GITHUB_ACCELERATOR=direct`（或 `off` / `0`）可跳过探测并始终直连 GitHub。

## 架构与验证

- `server.js` 是最小进程入口；HTTP 生命周期启动已位于 `src/bootstrap/startWallhubServer.js`。
- 服务端按 `src/app/`（HTTP）、`src/domains/`（业务）、`src/infrastructure/`（外部 I/O）、`src/shared/`（纯工具）组织。
- 前端按 `frontend/src/components/`、`hooks/`、`lib/` 组织；设置常量与展示基础组件位于 `components/settings/`。
- SteamKit C# 源编辑、watchdog/控制面解析、Workshop item mapping、Steam Proxy 客户端注入脚本均有独立模块，旧入口保留兼容导出。

验证命令：

```bash
npm test
npx tsc --noEmit
node --input-type=module -e "import { build } from 'vite'; await build({ configFile: 'vite.config.ts', build: { outDir: 'C:/Users/Test/AppData/Local/Temp/wallhub-build', emptyOutDir: true } });"
```

Docker runtime stage 会复制 `server.js`、`src/` 与 `public/`；Docker 可用时使用 `docker compose config` 和镜像 healthcheck 验证。

## 快速开始

```bash
npm ci
npm run build:ui
node server.js
```

打开：

```text
http://localhost:3090
```

常用命令：

```bash
npm start
npm run start:nsfw
npm run dev:ui
npm run build:ui
```

启动参数：

```bash
node server.js
node server.js --NSFW
node --use-system-ca server.js
```

## 平台安装

### Linux / Termux 一键安装

交互安装：

```bash
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash
```

无人值守示例：

```bash
# 普通 Linux：自动识别 Debian/Ubuntu、Fedora/RHEL、Arch 或 openSUSE
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash -s -- install --target linux --non-interactive --yes

# 原生 Termux
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash -s -- install --target termux --non-interactive --yes

# 从 Termux 创建并进入 Debian Proot（Ubuntu 可改为 ubuntu）
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash -s -- install --target proot --proot-distro debian --non-interactive --yes
```

安装器支持 `x86_64` 和 `ARM64`。默认使用官方源、隔离安装、安全模式和端口 `3090`；传入 `--mirror china` 会持久配置清华系统/PyPI 源及 npmmirror，并保留可校验恢复的原配置。安装器不修改防火墙，也不下载 Steamcommunity_302 本体。

常用维护命令：

```bash
./install.sh check
./install.sh repair
./install.sh update
./install.sh restore-mirrors
./install.sh uninstall
./install.sh uninstall --purge --yes
```

主要参数：

```text
--target auto|linux|termux|proot
--proot-distro debian|ubuntu
--mirror official|china
--layout isolated|in-place
--repo <Git 或 tar.gz/tgz/zip URL>
--branch <branch-or-tag>
--install-dir <path>  --data-dir <path>
--build-ui  --sc302-deps yes|no
--non-interactive  --yes  --lang zh|en  --verbose  --dry-run
```

提交的 `public` 完整时只安装生产 npm 依赖；静态资源缺失、损坏或指定 `--build-ui` 时才重建前端。安装成功要求 Node、Python venv、.NET 9 SDK+Runtime、四个 MPKG 模块的真实能力探测及 `/health` 全部通过；不等待 SteamKit 双运行时后台构建。Steam 登录、Steam Guard、真实下载和在线播放仍需在 UI 中手动验收。

> 原生 Termux 使用 Android bionic。若仓库没有可运行的原生 `.NET 9`，微软官方 glibc 构建也无法执行，安装器会明确失败且不会自动改用 Proot。完整功能优先使用 Debian/Ubuntu Proot。旧 Google Play Termux、Alpine/musl 和 ARMv7 不在支持范围内。

### Windows

安装 Node.js LTS、.NET 9 SDK/Runtime。若要使用 MPKG 转换：

```powershell
py -m pip install -r tools/mpkg/requirements.txt
npm ci
npm run build:ui
node server.js
```

### Linux

Debian/Ubuntu 基础依赖：

```bash
sudo apt update
sudo apt install -y nodejs npm curl unzip zip ca-certificates python3 python3-pil python3-lz4 python3-pip
python3 -m pip install --user -r tools/mpkg/requirements.txt
```

安装 .NET 9 SDK/Runtime 后：

```bash
npm ci
npm run build:ui
node server.js
```

### Android / Termux

原生 Termux 可运行 Node 服务和前端，.NET 9 支持取决于设备和软件源。更稳定的方式是 Termux + proot Debian/Ubuntu。

原生 Termux：

```bash
pkg update
pkg install nodejs-lts git curl unzip zip python
python -m pip install -r tools/mpkg/requirements.txt
npm ci
npm run build:ui
node server.js
```

proot Debian/Ubuntu：

```bash
pkg install proot-distro
proot-distro install ubuntu
proot-distro login ubuntu
apt update
apt install -y nodejs npm curl unzip zip ca-certificates python3 python3-pil python3-lz4 python3-pip
python3 -m pip install --user -r tools/mpkg/requirements.txt
```

随后安装 .NET 9 SDK/Runtime，并执行同样的 `npm ci`、`npm run build:ui`、`node server.js`。

> `texture2ddecoder` 是大型 DXT1/DXT5 壁纸的原生解码加速依赖。缺失时转换仍会兼容回退，但服务日志会提示性能下降。将
> `WALLHUB_MPKG_AUTO_RGBA_TEXTURE_THRESHOLD` 设为 `0` 可关闭大型纹理项目的自动 RGBA 快速路径。
> 高纹理 RGBA 快速路径默认再使用并行 LZ4-HC7 无损压缩，以降低文件体积；将
> `WALLHUB_MPKG_AUTO_RGBA_LZ4_COMPRESSION_LEVEL` 设为 `0` 可回到体积更大但稍快的 LZ4 fast 模式。

## Docker

Docker 默认使用 SteamKit，并把运行数据保存到 `./wallhub-data`。镜像包含 Python、Pillow 和 lz4，可直接使用 MPKG 转换。

```bash
docker compose up -d --build
```

访问：

```text
http://localhost:3090
```

常用命令：

```bash
docker compose logs -f wallhub
docker compose down
WALLHUB_PORT=8080 docker compose up -d --build
```

容器内数据路径：

- `/data/SteamKit`
- `/data/Downloads`
- `/data/cache-settings.json`

Steamcommunity_302 由 `docker-compose.yml` 中的 `WALLHUB_STEAMCOMMUNITY_302` 控制；需要时改成 `"1"` 后重建或重启容器。

ARM64 / Termux-proot 也使用同一份 `Dockerfile` 和 `docker-compose.yml`：

```bash
docker compose up -d --build
```

镜像启动时会自动识别 arm64，并降低 SteamKit/.NET 的默认内存压力。建议把 `./wallhub-data` 放在 proot/Linux 文件系统内，避免 Android 共享存储的权限和性能问题。

## 目录

| 路径 | 用途 |
| --- | --- |
| `frontend/` | React 前端源码 |
| `public/` | 前端构建产物 |
| `server.js` | Node 后端 |
| `tools/mpkg/` | 内置 MPKG 转换工具 |
| `docs/` | 运行说明 |
| `SteamKit/` | SteamKit/DepotDownloader 运行文件、账号会话、临时数据 |
| `SteamKit/account/depot-stream-cache/` | SteamKit 分块在线播放缓存 |
| `Downloads/` | 下载完成的壁纸项目 |
| `Downloads/<项目ID>/Mpkg/` | 场景壁纸转换后的 MPKG 文件 |
| `cache-settings.json` | 网页设置缓存 |

运行数据目录不应提交到 Git，也不需要打包发布。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务端口，默认 `3090` |
| `WALLHUB_DOWNLOADS_DIR` | 下载完成目录 |
| `STEAMKIT_DIR` | SteamKit 运行目录 |
| `DEPOTDOWNLOADER_DIR` | DepotDownloader 运行目录 |
| `DEPOTDOWNLOADER_CONFIG_DIR` | DepotDownloader 账号会话目录 |
| `DEPOTDOWNLOADER_MAX_DOWNLOADS` | SteamKit 单项目下载并发 |
| `WALLHUB_MAX_CONCURRENT_DOWNLOADS` | 队列最大同时下载项目数 |
| `WALLHUB_DEPOT_STREAM_CACHE_MAX_MB` | SteamKit 分块在线播放缓存上限，设置后覆盖网页设置 |
| `WALLHUB_MPKG_AUTO_RGBA_TEXTURE_THRESHOLD` | TEX 数达到此阈值时，`auto` 转换改用更快但文件更大的 RGBA；默认 `600`，设为 `0` 关闭 |
| `WALLHUB_MPKG_AUTO_RGBA_LZ4_COMPRESSION_LEVEL` | 高纹理 auto RGBA 输出的无损 LZ4-HC 级别；默认 `7`，范围 `1`–`12`，设为 `0` 使用更快但更大的 LZ4 fast |
| `WALLHUB_MPKG_AUTO_RGBA_LZ4_WORKERS` | 高纹理 RGBA LZ4-HC 的最大并行线程数；默认 `min(16, 逻辑 CPU 数)`，内存/发热受限设备可调低 |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` | 常规网络代理；下载 CDN 路由策略可在设置里单独控制 |
| `STEAM_API_KEY` | Steam Web API Key |
| `WALLHUB_GITHUB_ACCELERATOR` | GitHub 源码下载策略；默认 `auto` 会先 ping `www.google.com`，连通时直连 GitHub，不通时优先使用下载加速地址；`direct` / `off` / `0` 强制直连 |

## 发布检查

```bash
npm ci
npm run build:ui
npx tsc --noEmit
node --check server.js
python -m py_compile tools/mpkg/mobile_mpkg.py tools/mpkg/wallpaper_engine_toolkit.py
docker compose config
```

发布包不要包含：

- `node_modules/`
- `SteamKit/`
- `Downloads/`
- `cache-settings.json`
- `wallhub-data/`
- `Steamcommunity_302/`
