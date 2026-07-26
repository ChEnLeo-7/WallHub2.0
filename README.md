<p align="center">
  <img src="public/favicon.svg" width="112" height="112" alt="WallHub logo">
</p>

<h1 align="center">WallHub</h1>

<p align="center"><strong>把 Wallpaper Engine 创意工坊带到本地：浏览、下载、播放与移动端转换，一站完成。</strong></p>

<p align="center">
  <a href="https://github.com/ChEnLeo-7/WallHub2.0/releases">下载 Windows 版本</a> ·
  <a href="README.en.md">English</a> ·
  <a href="LICENSE">MIT License</a>
</p>

WallHub 是一个本地运行的 Wallpaper Engine 创意工坊管理工具。它在浏览器中提供完整界面，所有下载、缓存和设置均由你自己掌控；Windows 用户可以直接使用免依赖的安装版或便携版。

> 本项目与 Steam、Valve Corporation、Wallpaper Engine 及其开发者 Kristjan Skutta 均无隶属或合作关系。

## 核心功能

- **探索创意工坊**：按关键词、项目 ID、作者 ID 或精确短语搜索；查看预览、评论、订阅量、文件大小和更新时间。
- **灵活筛选**：按壁纸类型、年龄评级和 Genre 缩小范围；默认开启安全模式，需要时再通过 `--NSFW` 显示成人内容选项。
- **可靠下载管理**：支持下载队列、真实进度、暂停、继续、删除及优先级调整。
- **本地播放体验**：视频壁纸可后台下载、保存到本地或在浏览器播放，并提供实验性的 SteamKit 分块在线播放。
- **场景壁纸转移动端**：将场景壁纸转换为 MPKG，保留 `sounds/` 音频；可在无损快速模式和更小体积的压缩模式之间选择。
- **Steam 登录方式齐全**：支持账号密码、Steam Guard 与二维码登录。
- **跨平台部署**：可运行于 Windows、Linux、Android Termux/Proot 与 Docker；Windows 发布包内置 Node.js、Python、.NET 和所需运行时。
- **数据由你掌握**：下载、SteamKit 状态、设置、缓存及日志均存放在选择的 WallHub 根目录，可随时备份或迁移。

## 快速开始

### Windows

从 [Releases](https://github.com/ChEnLeo-7/WallHub2.0/releases) 下载适合你的 x64 包：

- `WallHub-Setup-win-x64.exe`：图形安装向导，适合长期使用。
- `WallHub-Portable-win-x64.zip`：解压后运行 `WallHub.exe`，适合免安装或移动存储设备。

两种版本均不要求预装 Node.js、Python 或 .NET。启动后，WallHub 会在通知区域运行并自动打开 `http://localhost:3090`。可通过托盘菜单打开页面、查看日志、设置启动参数、重启或退出。

### Docker

```bash
docker compose up -d --build
```

访问 `http://localhost:3090`。运行数据默认保存于 `./wallhub-data`；停止服务使用 `docker compose down`。

### 源码运行与开发环境

完整功能需要 Node.js 16.17+、Python 3.11、.NET 9 SDK/Runtime，以及 `curl`、`unzip` 和 `zip`。安装依赖后运行：

```bash
python -m pip install -r tools/mpkg/requirements.txt
npm ci
npm run build:ui
npm start
```

打开 `http://localhost:3090`。前端开发可执行 `npm run dev:ui`，服务端保持运行以处理 `/api` 请求。

常用命令：

```bash
npm test
npx tsc --noEmit
npm run build:ui
npm run build:windows:installer # 仅 Windows，生成便携版和安装版
```

Windows 打包要求 Windows x64、Python 3.11、.NET 9 SDK 与 Inno Setup 6。完整的打包、验证与数据保留规则请见 [Windows 打包说明](docs/windows-packaging.md)。

## 参考与鸣谢

- [Wallpaper Engine](https://www.wallpaperengine.io/)：优秀的动态壁纸平台与创作社区。
- [Steam](https://store.steampowered.com/) 与 [Steam Workshop](https://steamcommunity.com/workshop/)：创意工坊服务。
- [SteamKit2](https://github.com/SteamRE/SteamKit)：Steam 协议与服务集成基础。
- [DepotDownloader](https://github.com/SteamRE/DepotDownloader)：Steam 内容下载能力。
- [React](https://react.dev/)、[Vite](https://vite.dev/)、[Node.js](https://nodejs.org/)：WallHub 的应用基础。
- 所有分享创意、制作壁纸和维护开源依赖的创作者与贡献者。

## 免责声明

- WallHub 仅供个人学习、研究和本地管理用途，不提供或托管任何创意工坊内容。
- 使用下载功能通常需要登录一个合法拥有 Wallpaper Engine 的 Steam 账号。请遵守 Steam、Wallpaper Engine、创意工坊及内容作者的服务条款、许可和地区法律。
- 创意工坊内容的版权、授权和使用限制归原作者或权利人所有。请勿将通过本工具取得的内容用于侵权分发、商业用途或其他未经授权的用途。
- 本软件按 [MIT License](LICENSE) “按现状”提供，不提供任何明示或默示担保。使用本软件产生的风险、账号安全责任及法律责任由使用者自行承担。
