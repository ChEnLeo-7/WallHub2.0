<p align="center">
  <img src="public/favicon.svg" width="112" height="112" alt="WallHub logo">
</p>

<h1 align="center">WallHub</h1>

<p align="center"><strong>Your local Wallpaper Engine Workshop hub: discover, download, play, and convert wallpapers in one place.</strong></p>

<p align="center">
  <a href="https://github.com/ChEnLeo-7/WallHub2.0/releases">Download for Windows</a> ·
  <a href="README.md">简体中文</a> ·
  <a href="LICENSE">MIT License</a>
</p>

WallHub is a locally run manager for Wallpaper Engine Workshop content. Its browser-based interface keeps downloads, caches, and settings under your control. Windows users can choose a self-contained installer or portable package.

> This project is not affiliated with or endorsed by Steam, Valve Corporation, Wallpaper Engine, or its developer Kristjan Skutta.

## Highlights

- **Explore the Workshop**: Search by keyword, Workshop item ID, author ID, or exact phrase. See previews, comments, subscriptions, file sizes, and update times.
- **Filter precisely**: Narrow results by wallpaper type, age rating, and genre. Safe mode is enabled by default; use `--NSFW` only when you need mature-content options.
- **Manage reliable downloads**: Use a queue with real progress, pause, resume, removal, and priority controls.
- **Play locally**: Download video wallpapers in the background, save them locally, play them in the browser, or try experimental SteamKit chunk streaming.
- **Convert scenes for mobile**: Convert scene wallpapers to MPKG while retaining `sounds/` audio. Choose a lossless fast profile or a smaller compressed profile.
- **Sign in your way**: Password login, Steam Guard, and QR-code login are supported through SteamKit.
- **Run where you need it**: Windows, Linux, Android Termux/Proot, and Docker are supported. Windows packages include Node.js, Python, .NET, and required runtimes.
- **Keep data yours**: Downloads, SteamKit state, settings, caches, and logs stay in the WallHub root you select, ready to back up or move.

## Quick Start

### Windows

Download a Windows x64 package from [Releases](https://github.com/ChEnLeo-7/WallHub2.0/releases):

- `WallHub-Setup-win-x64.exe`: graphical installer for regular use.
- `WallHub-Portable-win-x64.zip`: extract it and run `WallHub.exe` for a no-install setup.

Neither package requires Node.js, Python, or .NET to be installed. WallHub runs in the notification area and opens `http://localhost:3090`. Its tray menu can open the page, logs, root directory, startup arguments, restart, or exit.

### Docker

```bash
docker compose up -d --build
```

Open `http://localhost:3090`. Runtime data is stored in `./wallhub-data`; stop it with `docker compose down`.

### Source And Development Environment

Full functionality requires Node.js 16.17+, Python 3.11, .NET 9 SDK/Runtime, plus `curl`, `unzip`, and `zip`. Install dependencies and start WallHub:

```bash
python -m pip install -r tools/mpkg/requirements.txt
npm ci
npm run build:ui
npm start
```

Open `http://localhost:3090`. For frontend development, run `npm run dev:ui` while keeping the backend running for `/api` requests.

Useful commands:

```bash
npm test
npx tsc --noEmit
npm run build:ui
npm run build:windows:installer # Windows only: portable and installer packages
```

Windows packaging requires Windows x64, Python 3.11, .NET 9 SDK, and Inno Setup 6. See the [Windows packaging guide](docs/windows-packaging.md) for packaging, verification, and data-retention details.

## References And Thanks

- [Wallpaper Engine](https://www.wallpaperengine.io/) for the dynamic-wallpaper platform and creator community.
- [Steam](https://store.steampowered.com/) and [Steam Workshop](https://steamcommunity.com/workshop/) for Workshop services.
- [SteamKit2](https://github.com/SteamRE/SteamKit) for Steam protocol and service integration.
- [DepotDownloader](https://github.com/SteamRE/DepotDownloader) for Steam content download capabilities.
- [React](https://react.dev/), [Vite](https://vite.dev/), and [Node.js](https://nodejs.org/) for the application foundation.
- Every creator, open-source maintainer, and contributor who makes this project possible.

## Disclaimer

- WallHub is for personal learning, research, and local management. It does not provide or host Workshop content.
- Downloading usually requires a Steam account that legitimately owns Wallpaper Engine. Follow the terms, licences, and laws that apply to Steam, Wallpaper Engine, Workshop content, and your region.
- Workshop content remains the property of its authors or rights holders. Do not redistribute it, use it commercially, or otherwise use it without permission.
- This software is provided “as is” under the [MIT License](LICENSE), without express or implied warranty. You are responsible for your account security, legal compliance, and all risks arising from use.
