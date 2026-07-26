# WallHub Windows EXE 与 Portable 发布设计

## 用户交付物

Windows x64 发布同时生成：

- `WallHub-Setup-win-x64.exe`：中英双语图形安装器。
- `WallHub-Portable-win-x64.zip`：解压后双击 `WallHub.exe` 使用。
- 两个产物各自对应的 `.sha256` 校验文件。

Windows 用户不需要安装 Git、Node、npm、Python、pip、.NET SDK 或 Visual Studio Build Tools。

## 根目录数据约束

程序和用户数据不拆分。无论安装版还是 Portable，以下内容始终位于所选 WallHub 根目录内：

```text
<WallHub 根目录>/
├─ WallHub.exe
├─ runtime/
├─ public/
├─ src/
├─ node_modules/
├─ Downloads/
├─ SteamKit/
├─ logs/
├─ cache-settings.json
└─ launcher-settings.json
```

安装版新安装的默认根目录为 `%LOCALAPPDATA%\WallHub2.0`，安装向导允许修改。旧版本原位升级时沿用原安装路径，不会擅自迁移用户数据。该路径只是项目根目录，不会把设置、缓存或下载再分散到其他系统目录。

升级覆盖程序和内置运行时，但保留 `Downloads`、`SteamKit/account`、`logs`、`cache-settings.json` 和 `launcher-settings.json`。图形卸载器会显示一个默认不勾选的选项，让用户决定是否一并删除整个项目根目录。未勾选时只删除程序并保留数据目录；勾选后删除所选安装根目录中的全部文件及根目录本身。自定义到安装根目录之外的下载位置不会被删除。

无人值守卸载默认保留数据；部署维护场景可显式传入 `/PURGEDATA` 执行彻底清理：

```powershell
unins000.exe /VERYSILENT /PURGEDATA
```

## 启动器行为

`WallHub.exe` 是无控制台窗口的 WinForms 托盘启动器：

1. 从相对路径验证内置 Node、Python、四个 MPKG 模块、.NET 9 和两套 SteamKit。
2. 设置子进程使用的 `PYTHON`、`DOTNET_ROOT` 和 `PATH`，不读取系统同名运行时。
3. 隐藏启动 Node supervisor，轮询 `/health`，成功后打开默认浏览器。
4. 将服务输出直接追加到 `logs/WallHub.log`，超过 10 MiB 时保留一份旧日志。
5. 托盘菜单提供“启动参数...”输入窗口，不提供预设参数。用户输入按 Windows 命令行规则拆分，并原子写入根目录的 `launcher-settings.json`；保存后优雅重启 Node 服务并重新打开页面。
6. 托盘菜单同时提供打开页面、打开根目录、查看日志、重新启动和退出。
7. 重启及退出调用现有后端接口，等待优雅关闭；超时才终止进程树。
8. `WallHub.exe --smoke-test` 执行运行时探测、启动、健康检查和优雅关闭，用于 CI，不打开浏览器。

## 内置版本

版本由 `tools/windows/runtime-versions.json` 固定：

| 组件 | 当前版本 |
|---|---:|
| Node.js | 24.13.0 |
| Python Embedded | 3.11.9 |
| .NET Desktop Runtime | 9.0.17 |
| MPKG 模块 | `tools/mpkg/requirements.txt` |

SteamKit JSON 进度下载器和分块在线播放下载器在发布阶段使用 .NET 9 SDK 构建。客户端只携带共享 Runtime，不携带 SDK、NuGet 缓存或构建源码。

## 本地构建

构建机要求 Windows x64、PowerShell、Python 3.11 和 .NET 9 SDK。生成安装器还需要 Inno Setup 6。

```powershell
./tools/windows/build-portable.ps1
./tools/windows/build-portable.ps1 -BuildInstaller
```

本机已经安装清单中完全相同的 .NET Desktop Runtime 时，可避免重复下载：

```powershell
./tools/windows/build-portable.ps1 -UseInstalledDotnetRuntime -BuildInstaller
```

构建目录为 `build/windows-x64/WallHub`，交付物位于 `dist/`。脚本从白名单复制应用文件，不会复制开发机现有的 `Downloads`、`SteamKit/account`、设置、日志或 NuGet 缓存。

## 发布验证

每个正式产物至少执行：

1. Launcher C# 零警告编译。
2. Node 单元测试、TypeScript 检查和 Vite 构建。
3. 四个 MPKG 模块导入及关键 API 探测。
4. 两套 SteamKit 从干净目录构建。
5. 隐藏系统 Node/Python/.NET 后执行 `WallHub.exe --smoke-test`。
6. 从 ZIP 重新解压后再次 smoke test。
7. 安装版静默安装、smoke test、重复安装和卸载。
8. 对比升级及默认卸载前后的设置、下载和 SteamKit 账号测试文件哈希。
9. 使用 `/PURGEDATA` 卸载并确认设置、Downloads、完整 SteamKit、logs、其他残留文件及安装根目录本身均被删除。

`.github/workflows/windows-package.yml` 自动执行源码门禁、打包和 smoke test，并上传四个交付文件。

## 当前限制

- 当前只发布 Windows x64。Windows ARM64 需要四个 Python 原生模块及 SteamKit 的独立 ARM64 产物验证。
- 本地测试产物没有 Authenticode 签名，Windows SmartScreen 可能显示未知发布者。正式公开发布前应配置受信任代码签名证书，并对 `WallHub.exe` 和 Setup 文件签名。
