<div align="center">
  <img src="public/favicon.svg" width="112" height="112" alt="WallHub logo">

  # WallHub

  **在浏览器中探索、下载、播放和转换 Wallpaper Engine 创意工坊内容。**

  [![Release](https://img.shields.io/github/v/release/ChEnLeo-7/WallHub2.0?display_name=tag&sort=semver)](https://github.com/ChEnLeo-7/WallHub2.0/releases)
  [![Release build](https://github.com/ChEnLeo-7/WallHub2.0/actions/workflows/release.yml/badge.svg)](https://github.com/ChEnLeo-7/WallHub2.0/actions/workflows/release.yml)
  [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D16.17-339933?logo=node.js&logoColor=white)](package.json)
  [![License](https://img.shields.io/github/license/ChEnLeo-7/WallHub2.0)](LICENSE)

  [下载 Windows 版](https://github.com/ChEnLeo-7/WallHub2.0/releases) · [快速开始](#快速开始) · [使用说明](#基本使用) · [English](README.en.md)
</div>

WallHub 是一个本地运行的 Wallpaper Engine 创意工坊管理工具。它将搜索、筛选、详情、Steam 登录、下载队列、视频播放和移动端 MPKG 转换整合到一个响应式 Web 界面中，下载、缓存与账号会话都保存在你自己的设备上。

> [!NOTE]
> WallHub 与 Steam、Valve Corporation、Wallpaper Engine 及其开发者 Kristjan Skutta 均无隶属、授权或合作关系。

## 核心功能

- **搜索与筛选**：支持关键词、创意工坊项目 ID、作者 ID 和精确短语，可按排序、时间、类型、年龄评级、题材、官方标签与分辨率筛选。
- **完整详情体验**：查看预览、作者、标签、统计数据、说明和评论；可订阅、收藏、复制项目 ID，或从作者与标签继续探索。
- **可控的下载队列**：显示真实进度、速度和阶段，支持并发下载、暂停、继续、取消、排序，以及已完成项目的本地缓存管理。
- **视频播放**：优先播放本地缓存，也可代理远程视频；提供原生与兼容播放器，以及可选的实验性 SteamKit 分块播放。
- **移动端 MPKG**：转换场景和视频项目，可直接下载或仅保留转换结果；场景项目支持快速与最大压缩模式，并保留 `sounds/` 音频。
- **Steam 个人内容**：通过密码、Steam Guard 或二维码登录后，可访问个人订阅、收藏及其他个人来源，并在详情中订阅或收藏项目。
- **个性化界面**：支持简体中文与 English、亮色/暗色/跟随系统主题、强调色、网格/列表模式、响应式列数和两种详情布局。
- **网络与运行设置**：可配置下载目录、并发数、代理、Steam API Key、DNS/Hosts、CDN、分块缓存及实验功能。
- **安全更新**：检查 GitHub Releases，校验 SHA-256 后更新 Windows 包或跨平台源码；Docker 可选用独立更新容器拉取多架构 GHCR 镜像。

## 快速开始

### Windows（推荐）

从 [GitHub Releases](https://github.com/ChEnLeo-7/WallHub2.0/releases) 下载 Windows x64 版本：

| 版本 | 适用场景 |
| --- | --- |
| `WallHub-Setup-win-x64.exe` | 图形安装与卸载，适合长期使用 |
| `WallHub-Portable-win-x64.zip` | 解压后运行 `WallHub.exe`，无需安装 |

两个版本均内置 Node.js、Python、.NET 和 MPKG 依赖。启动后，WallHub 会驻留在通知区域，并自动打开 `http://localhost:3090`。托盘菜单可打开页面、根目录和日志，也可设置启动参数、重启或退出。

> [!TIP]
> Releases 同时提供 `.sha256` 文件，可用于核验下载包完整性。未签名构建可能触发 Windows SmartScreen 的“未知发布者”提示。

### Docker

需要 Docker Engine 与 Docker Compose：

```bash
git clone https://github.com/ChEnLeo-7/WallHub2.0.git
cd WallHub2.0
docker compose up -d --build
```

打开 `http://localhost:3090`。容器数据默认保存到 `./wallhub-data`；查看状态和停止服务：

```bash
docker compose ps
docker compose logs -f wallhub
docker compose down
```

如需更改宿主机端口，可设置 `WALLHUB_PORT`，例如 `WALLHUB_PORT=8080 docker compose up -d --build`。

启用 Docker 自动更新：

```bash
WALLHUB_DOCKER_AUTO_UPDATE=1 docker compose --profile auto-update up -d
```

自动更新容器会定期拉取 `ghcr.io/chenleo-7/wallhub:latest`。它是唯一访问 Docker Socket 的服务；WallHub 主容器不会获得宿主机 Docker 权限。Docker Socket 等同于对宿主机 Docker Engine 的完整控制，只应在接受该权限边界时启用此 profile。

Watchtower 重建容器时会保留当前容器已经生效的环境变量、端口、volume、restart policy、labels、hostname 和启动命令，但不会修改用户的 `docker-compose.yml`。只写入 Compose 文件但尚未通过 `docker compose up -d` 应用的修改不会参与本次重建；需要持久化的文件应放在 `/data` volume 中，不要依赖容器可写层或本地修改过的镜像层。

### 从源码运行

完整功能建议使用以下环境：

- Node.js 16.17 或更高版本
- Python 3.11
- .NET 9 SDK/Runtime
- `curl`、`unzip` 与 `zip`

```bash
git clone https://github.com/ChEnLeo-7/WallHub2.0.git
cd WallHub2.0
python -m pip install -r tools/mpkg/requirements.txt
npm ci
npm run build:ui
npm start
```

打开 `http://localhost:3090`。首次使用 SteamKit 下载或播放能力时，运行时准备可能需要一些时间。

## 基本使用

1. 打开 WallHub，使用关键词、项目 ID、作者 ID 或筛选器浏览创意工坊。
2. 在设置中确认下载目录、并发数和网络选项。安全内容模式默认启用。
3. 下载、订阅或访问个人内容前，使用密码、Steam Guard 或二维码登录 Steam。
4. 从卡片或详情页选择立即下载、后台下载、视频播放或 MPKG 转换。
5. 在队列中查看进度并控制任务；已下载的视频可直接播放，缓存项目可再次导出。

> [!IMPORTANT]
> 下载创意工坊内容通常需要登录一个合法拥有 Wallpaper Engine（Steam App `431960`）的账号。Steam 登录会话保存在本地 `SteamKit` 数据目录中，请像保护其他账号凭据一样保护该目录。

### 成人内容模式

WallHub 默认隐藏成人内容选项。仅在确认符合你的使用环境与当地规则时启用：

```bash
npm run start:nsfw
```

Windows 版可在托盘菜单的“启动参数”中加入 `--NSFW`；Docker 可将 Compose 的 `command` 改为 `['node', 'server.js', '--NSFW']`。安全模式依赖创意工坊标签过滤，不构成绝对的内容安全保证。

## 数据与安全

| 运行方式 | 默认数据位置 |
| --- | --- |
| Windows 安装版 | `%LOCALAPPDATA%\WallHub2.0`，安装时可修改 |
| Windows 便携版 | 解压后的 WallHub 根目录 |
| Docker | 仓库下的 `./wallhub-data`，映射至容器 `/data` |
| 源码运行 | 仓库内的 `Downloads/`、`SteamKit/` 与 `cache-settings.json` |

Windows 升级会保留下载、账号会话、设置和日志；卸载时默认保留数据，只有明确选择清理数据才会删除整个安装根目录。备份或迁移前请先退出 WallHub，避免复制到正在写入的文件。

> [!CAUTION]
> WallHub 默认监听 `0.0.0.0:3090`，自身不提供访问认证。请仅在可信设备或可信局域网中使用，或置于带身份认证的反向代理之后；不要将端口直接暴露到公网。

### 应用更新

WallHub 默认定期检查最新 GitHub Release，但不会未经允许覆盖程序。在“设置 → 服务端”中可以手动检查、下载和安装，也可以显式开启自动更新。更新包通过 SHA-256 校验，并在服务退出后由独立进程覆盖；下载、Steam 登录会话、设置和日志不会被替换。完整的平台行为与发布资产约定见 [更新机制](docs/updates.md)。

## 开发

后端使用 Node.js CommonJS，React/TypeScript 前端由 Vite 构建并输出到已提交的 `public/`。主要目录如下：

```text
frontend/src/       React UI、组件、Hooks 与客户端工具
src/app/            HTTP 生命周期与路由
src/domains/        Workshop、SteamKit、下载、视频与 MPKG 业务逻辑
src/infrastructure/ 进程、网络与归档适配器
src/shared/         前后端共享工具
tools/              MPKG、Windows 打包与维护脚本
docs/               设计与运维文档
```

启动前端开发服务器时，请同时保持后端运行：

```bash
npm start       # 后端与已构建界面：http://localhost:3090
npm run dev:ui  # Vite 开发服务器：http://localhost:5173
```

提交前建议执行：

```bash
npm test
npx tsc --noEmit
npm run build:ui
python -m unittest tools/mpkg/test_mobile_mpkg.py
```

Windows 打包要求 Windows x64、PowerShell、Python 3.11、.NET 9 SDK 和 Inno Setup 6。详见 [Windows 打包说明](docs/windows-packaging.md)。

## 常见问题

### 无法打开页面

确认进程仍在运行，并检查 `3090` 端口是否被占用。Docker 用户可执行 `docker compose ps` 和 `docker compose logs -f wallhub`。

### Steam 登录成功但无法下载

确认该账号拥有 Wallpaper Engine，并检查 WallHub 的 Steam 访问诊断、代理、DNS/Hosts 与系统时间。Steam Guard 或手机确认未完成时，下载不会开始。

### MPKG 转换不可用

Windows 发布包和 Docker 镜像已包含转换依赖。源码运行时请确认 Python 依赖安装成功；最大压缩模式不可用时会自动回退到快速模式。

### 仍然无法解决

请先在 [GitHub Issues](https://github.com/ChEnLeo-7/WallHub2.0/issues) 检查是否已有相同问题。排障时请记录运行平台、WallHub 版本、复现步骤和脱敏后的相关日志；不要公开 Steam 凭据、Cookie 或 API Key。

## 参考与鸣谢

WallHub 基于 [SteamKit2](https://github.com/SteamRE/SteamKit)、[DepotDownloader](https://github.com/SteamRE/DepotDownloader)、[React](https://react.dev/)、[Vite](https://vite.dev/) 与 [Node.js](https://nodejs.org/) 构建。感谢 Wallpaper Engine 与 Steam Workshop 社区中的创作者，以及所有开源依赖的维护者和贡献者。

## 免责声明

WallHub 仅供个人学习、研究和本地内容管理使用，不提供或托管任何创意工坊内容。内容的版权、授权与使用限制归原作者或权利人所有。使用者应遵守 Steam、Wallpaper Engine、创意工坊内容许可及所在地法律，不得进行侵权分发、未经授权的商业使用或其他违规行为。软件按 [MIT License](LICENSE) “按现状”提供，使用者自行承担账号安全、合规与使用风险。
