# WallHub 更新机制

WallHub 使用 GitHub Releases 作为稳定更新通道。服务端启动后检查 `ChEnLeo-7/WallHub2.0` 的最新正式 Release；默认仅提示，用户在设置中启用“自动更新”后，WallHub 才会自动下载、校验和安装。

## 运行模式

| 模式 | 更新资产 | 应用方式 |
| --- | --- | --- |
| Windows 安装版/便携版 | `WallHub-Portable-win-<arch>.zip` | 外部更新器等待 Node 与托盘启动器退出，再覆盖程序文件并重启 `WallHub.exe` |
| Windows、Linux 等源码运行 | `WallHub-Source.zip` | 外部更新器安装生产 Node 依赖、覆盖源码与已构建 UI，然后重启服务 |
| Docker `linux/amd64`、`linux/arm64` | `ghcr.io/chenleo-7/wallhub:<tag>` | 独立 Watchtower 容器拉取镜像并重建 WallHub 容器 |

更新不会覆盖 `Downloads/`、`SteamKit/account/`、`logs/`、`cache-settings.json`、`launcher-settings.json` 或 `updates/`。文件覆盖前会保存一份 `updates/backup-previous/`；持久恢复请求和事务记录分别写入 `updates/update-request.json`、`updates/update-transaction.json`，最近一次结果写入 `updates/last-update.json`。Windows Launcher 和源码入口都会在异常中断后的下一次启动先调用外部更新器恢复事务。连续健康检查成功后，helper 会先原子地把事务标记为 committed；此后即使清理阶段中断，下次启动也只完成清理，不会错误回滚已经健康的新版本。

外部更新器使用带随机 owner token 和进程启动身份的 `updates/update-lock.json`，阻止多个 helper 同时修改 staging、备份和事务文件，并在锁所属进程退出后恢复。成功安装后，`updates/installed-files.json` 会记录由 WallHub 安装的程序文件；后续版本只会删除该 manifest 中已登记但新版不再包含的文件。manifest 和 transaction journal 中的路径都会重新执行严格规范化与保护目录检查。首次没有 manifest 时不会推测或删除未知本地文件，回滚也会恢复旧 manifest 和被删除的旧文件。

浏览器更新操作必须来自当前 WallHub origin。没有 `Origin` 的非浏览器 mutation 只接受回环地址，避免局域网客户端直接触发下载、覆盖或重启。源码更新执行 `npm ci` 时会通过 helper 进程环境继承 WallHub 的下载代理；代理值不会写入更新 request、journal 或日志。

## Release 资产契约

正式 Release 必须同时发布：

```text
WallHub-Setup-win-x64.exe
WallHub-Setup-win-x64.exe.sha256
WallHub-Portable-win-x64.zip
WallHub-Portable-win-x64.zip.sha256
WallHub-Source.zip
WallHub-Source.zip.sha256
```

更新器只接受 SemVer 标签（例如 `v2.0.2`）和精确平台资产。下载完成后，文件必须通过同一 Release 中 `.sha256` 文件声明的 SHA-256 校验，否则会删除更新包并停止安装。

## Docker 自动更新

正常启动固定或手工管理的容器：

```bash
docker compose up -d
```

显式启用自动更新：

```bash
WALLHUB_DOCKER_AUTO_UPDATE=1 docker compose --profile auto-update up -d
```

`wallhub-auto-update` 使用仍在维护的 `nickfedor/watchtower`，是唯一挂载 `/var/run/docker.sock` 的服务，并通过 label 只更新 WallHub。主应用容器不接触 Docker Socket。Docker Socket 允许容器完整控制宿主机 Docker Engine，通常等同于宿主机 root 权限；label 只限制 Watchtower 的更新目标，不限制其 Docker API 权限。若不接受该权限边界，请不要启用此 profile，改用：

```bash
docker compose pull wallhub
docker compose up -d wallhub
```

Watchtower 不会改写 `docker-compose.yml`。更新时它根据当前容器已经生效的 Docker 配置重建容器，环境变量、端口映射、volume、restart policy、labels、hostname 和启动命令会被复制到新容器。已保存到 Compose 文件但尚未执行 `docker compose up -d` 的修改还没有进入当前容器，因此不会参与本次重建。容器可写层和本地自定义镜像层会随旧容器或旧镜像移除；需要保留的设置、账号和下载内容必须放在 `/data` volume 中，自定义部署参数应保存在 Compose 文件、override 文件或环境文件中。

## Docker 实测边界

2026-07-27 在 Debian 12 x86_64、Docker Engine 28.5.2、Compose 2.40.3 和 Buildx 0.29.1 上完成了隔离验证：当前 Dockerfile 原生 amd64 构建成功；通过临时 QEMU binfmt 构建并实际启动的 `linux/arm64` 镜像也通过验证，runtime 正确报告 `arch=arm64`。两种架构的容器 `/health` 均正常，SteamKit runtime 为 ready，Node 进程以 UID/GID `10001:10001` 运行，数据目录权限正确；amd64 的 `/data` 数据在容器重启后保留。带临时 override 的项目 Compose 文件也实际启动成功，自定义端口、环境变量、volume、restart policy、label 和命令均进入容器配置。

`nickfedor/watchtower:1.20.1` 的 scope、enable label 和容器名组合只扫描到指定 WallHub 测试容器。另用隔离的旧版 Alpine 容器触发了真实镜像更新和容器重建；重建前后的环境变量、端口、volume、restart policy、labels、hostname、命令及 volume 标记一致。测试同时修复了 Windows CRLF 构建上下文导致 entrypoint shebang 无法执行，以及新 volume 顶层归属正确但 `SteamKit`、`Downloads` 子目录仍由 root 创建的问题。所有远端测试容器、volume、network、临时镜像标签和源码目录均已清理。

`v2.0.2` 已于 2026-07-27 发布为正式 GitHub Release。首次 GHCR package 已设为 Public；Release workflow 的匿名拉取门禁通过，远程 Docker 主机也已匿名拉取 `ghcr.io/chenleo-7/wallhub:v2.0.2`，并确认 `v2.0.2` 与 `latest` 都提供 `linux/amd64`、`linux/arm64` manifest。后续正式版本仍需保持同一匿名拉取门禁。

## 配置

- `WALLHUB_UPDATE_REPOSITORY`：覆盖检查的 GitHub 仓库，格式为 `owner/repository`。
- `GITHUB_TOKEN`：可选，用于提高 GitHub API 速率限制；不要写入仓库。
- `WALLHUB_DOCKER_AUTO_UPDATE=1`：标记当前 Docker 部署由独立更新容器管理。

自动安装只会在下载队列、MPKG 转换、文件传输和其他 HTTP 操作均空闲时开始。更新过程会重启 WallHub；helper 会在覆盖前重新校验归档，并要求新进程连续三次返回匹配的一次性 health token，避免把占用同一端口的其他 HTTP 服务误判为新版本。新版本无法通过健康检查时会回滚。SHA-256 文件和更新包来自同一 GitHub Release，可发现传输损坏，但不能替代 Release 签名或抵抗发布账号失陷。

GHCR 首次创建 Container package 时默认是 Private，GitHub 当前不提供修改 package visibility 的 REST API。首次镜像 push 后，仓库所有者需要在 GitHub Packages 中把 `wallhub` 一次性设为 Public，再重新运行 Release workflow。工作流会在创建 GitHub Release 前执行匿名 `docker pull`；镜像未公开时会停止发布，避免产生 Docker 用户无法拉取的正式版本。
