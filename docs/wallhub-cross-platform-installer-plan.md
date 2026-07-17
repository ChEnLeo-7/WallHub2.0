# WallHub Linux / Termux 一键部署开发与验证计划

> 状态：开发与验证进行中
> 目标仓库：`ChEnLeo-7/WallHub2.0`
> 默认分支：`main`
> 安装器入口：仓库根目录 `install.sh`

## 当前进度

- [x] 设计文档已创建，已记录确认过的设计、阶段任务、远程验证边界和最终验收清单。

## 进度维护规则

- [ ] 每完成一个最小任务节点，立即将对应的 `- [ ]` 改为 `- [x]`，不得等整个阶段结束后批量勾选。
- [ ] 每次勾选时，在“进度记录”表中追加日期、节点、验证命令和结果证据。
- [ ] 只有实现和该节点要求的验证都通过后才允许勾选。
- [ ] 失败或阻塞的节点保持未勾选，并在节点下方记录 `阻塞原因`、已尝试方案和下一步。
- [ ] 远程测试必须先登记资源，清理后再更新清理状态；禁止根据模糊名称批量删除资源。
- [ ] 任何阶段不得把密码、Token、Steam 账号、Cookie、私网地址或设备信息写入本文档、源码、Git 提交或测试日志。
- [ ] 修改既有用户设置、下载数据、Steam 登录状态或镜像源前，必须先创建可验证备份。

### 状态说明

- `- [ ]`：未完成或仍需验证。
- `- [x]`：实现和验证均已完成。
- 阻塞任务：保持 `- [ ]`，在任务下追加引用块说明阻塞原因。

## 一、已确认设计

### 1.1 支持范围

- [ ] 支持普通 Linux、原生 Termux、Termux Proot 三种目标环境。
- [ ] Linux 支持 Debian/Ubuntu、Fedora/RHEL、Arch、openSUSE 四类 glibc 发行版。
- [ ] 支持 `x86_64` 与 `ARM64/aarch64`。
- [ ] 原生 Termux 只支持当前 F-Droid/GitHub 版本；检测到旧 Google Play 版本时停止并给出迁移说明。
- [ ] Proot 安装时允许选择 Debian 稳定版或 Ubuntu LTS；无人值守默认 Debian。
- [ ] 不承诺 Alpine/musl、ARMv7 或其他上游缺少运行时的架构。

### 1.2 安装体验

- [ ] 用户可通过 GitHub Raw URL 执行一个 `install.sh` 完成部署。
- [ ] 脚本默认使用交互向导，同时支持完整无人值守参数。
- [ ] `curl | bash` 模式下所有交互从 `/dev/tty` 读取，不从脚本管道读取。
- [ ] 根据 locale 自动选择中文或英文，并支持 `--lang zh|en` 覆盖。
- [ ] 安装时询问使用隔离安装还是当前目录原地安装。
- [ ] 普通 Linux 自动识别目标；Termux 中明确询问原生环境或 Proot。
- [ ] 默认端口固定为 `3090`，默认安全模式，不在安装阶段询问 NSFW。
- [ ] 不修改防火墙，只输出访问地址和用户自行放行的提示。

### 1.3 版本与完整功能原则

- [ ] 使用“能力检测优先”策略，不因发行版包名或版本号不同直接判定失败。
- [ ] Node 复用任何满足 `>=16.17.0` 且通过实际运行探测的版本。
- [ ] Python 复用任何满足 `>=3.7` 且能创建 venv 的版本。
- [ ] `.NET` 必须同时具备主版本为 `9` 的 SDK 和 Runtime。
- [ ] Pillow、lz4、etcpak、texture2ddecoder 必须全部安装并通过功能探测；任一失败则安装严格失败。
- [ ] 目标机已有更高但兼容的依赖版本时允许复用，不强制降级。
- [ ] 包管理器无法提供合适版本时，依次使用官方仓库、官方便携包或源码构建回退。

### 1.4 服务与运行时

- [ ] 普通 Linux 使用 systemd；隔离安装使用专用 `wallhub` 用户。
- [ ] 原生 Termux 使用 `termux-services`/runit。
- [ ] 无 systemd 的 Proot 使用 PID、日志及 start/stop/status 管理逻辑。
- [ ] 安装完成后立即启动服务。
- [ ] 安装成功只要求依赖验证通过且 `/health` 成功，不等待两个 SteamKit 运行时完成后台构建。
- [ ] Steam 登录、Steam Guard、真实下载与在线播放由用户在 UI 中手动验收。

### 1.5 GitHub 与发布

- [ ] 安装器与 WallHub 源码位于同一 GitHub 仓库。
- [ ] 默认安装 `main` 最新代码，并允许 `--repo`、`--branch` 覆盖。
- [ ] 先推送 `installer-validation` 测试分支，远程验证通过后再正常合并到 `main`。
- [ ] 不改写远端历史。
- [ ] 恢复并保留现有 MIT LICENSE。
- [ ] GitHub 只上传最少必要源码、测试、README、必要文档、Docker 文件、`install.sh` 和 `public` 构建产物。
- [ ] 排除 `.hermes/`、NuGet 本地状态、缓存、运行数据、账号数据、日志、秘密及个人文件。

## 二、安装器公共接口

### 2.1 远程入口

```bash
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/main/install.sh | bash
```

测试分支验证时使用：

```bash
curl -fsSL https://raw.githubusercontent.com/ChEnLeo-7/WallHub2.0/installer-validation/install.sh | bash -s -- install --branch installer-validation
```

### 2.2 子命令

```text
install
check
repair
update
uninstall
restore-mirrors
```

### 2.3 参数

```text
--target auto|linux|termux|proot
--proot-distro debian|ubuntu
--mirror official|china
--layout isolated|in-place
--repo <Git URL或压缩包URL>
--branch <branch-or-tag>
--install-dir <path>
--data-dir <path>
--build-ui
--sc302-deps yes|no
--non-interactive
--yes
--lang zh|en
--verbose
--dry-run
```

### 2.4 默认值和退出语义

- [ ] 交互模式：询问目标环境、Proot 发行版、镜像源、安装布局和 SC302 依赖。
- [ ] 无人值守模式：官方源、隔离安装、Proot Debian、不开启 SC302 依赖。
- [ ] `0`：命令成功。
- [ ] `2`：参数或交互输入错误。
- [ ] `10`：不支持的平台、架构或 Termux 版本。
- [ ] `20`：系统、Node、Python 或 MPKG 依赖失败。
- [ ] `30`：源码、npm 或前端构建失败。
- [ ] `40`：服务安装或启动失败。
- [ ] `50`：健康检查失败。
- [ ] 所有非零退出必须打印失败阶段、诊断路径和 `repair` 建议。

## 三、依赖与平台策略

### 3.1 平台识别

- [ ] 读取 `/etc/os-release` 的 `ID` 与 `ID_LIKE`，识别 apt、dnf、pacman、zypper。
- [ ] 规范化 `x86_64/amd64` 与 `aarch64/arm64`。
- [ ] 通过 `TERMUX_VERSION`、`PREFIX`、`ANDROID_ROOT` 和 Proot 特征区分原生 Termux 与 Proot。
- [ ] 检测系统是否存在 systemd，仅在实际可用时生成 systemd 服务。
- [ ] 检测 sudo/root；只有系统包、系统用户、`/opt`、`/var/lib` 和 systemd 操作请求提权。

### 3.2 基础工具

- [ ] 用包候选列表安装或验证：bash、curl、git、ca-certificates、tar、unzip、zip、ping、procps。
- [ ] 用能力探测确认 `curl` HTTPS、ZIP 解压、tar、证书链和进程管理可用。
- [ ] 只有 Python 原生扩展需要源码构建时才安装编译器、make、cmake、pkg-config 和图像库开发包。
- [ ] 包名不存在时先使用包管理器 search/provides 查找能力提供者，不立即失败。

### 3.3 Node

- [ ] 检测 `node` 与 `npm`，解析实际 Node 版本并验证 `>=16.17.0`。
- [ ] 满足要求时复用系统 Node，不替换用户版本。
- [ ] 不满足要求时先尝试发行版或 Termux 仓库提供的合适版本。
- [ ] 普通 Linux 仓库版本不足时，从 nodejs.org 选择对应架构的当前活跃 LTS 便携包，并校验官方 SHA-256。
- [ ] 原生 Termux 只使用 Termux 原生 Node 包，不安装 glibc Linux Node 压缩包。
- [ ] 验证 npm 能读取 lockfile v2，并记录最终 Node/npm 版本。

### 3.4 Python 与 MPKG

- [ ] 检测 Python `>=3.7`、pip 和 venv 能力。
- [ ] 为 WallHub 创建独立 venv；系统包可通过 `--system-site-packages` 复用。
- [ ] 优先探测发行版 Pillow/lz4，再按当前 Python 版本安装兼容 PyPI 包。
- [ ] Python 3.7 优先使用项目已确认的兼容组合：Pillow 9.5.0、lz4 4.3.2、etcpak 0.9.15、texture2ddecoder 1.0.6。
- [ ] 新版 Python 无法安装旧固定版本时，使用对应包的最低版本约束选择当前解释器可安装版本，不强制降级解释器。
- [ ] 首次 wheel 安装失败后补装编译依赖，再尝试源码构建一次。
- [ ] 分别验证四个模块导入，并执行最小 Pillow 图像、LZ4 往返、etcpak API、texture2ddecoder API 探测。
- [ ] 执行 MPKG Python 单测和语法编译检查。
- [ ] 任一模块最终失败时保持诊断文件并以依赖失败退出，不宣称降级安装成功。

### 3.5 .NET 9

- [ ] 检测 `dotnet --info`、`--list-sdks` 和 `--list-runtimes`。
- [ ] 普通 Linux 优先使用现有安装或发行版/Microsoft官方仓库。
- [ ] 包管理器找不到 SDK 9 时，使用微软官方 `dotnet-install.sh --channel 9.0` 安装到隔离工具链目录。
- [ ] 根据 x86_64/ARM64 选择正确架构，并把 DOTNET_ROOT/PATH 写入 WallHub 服务环境。
- [ ] 原生 Termux 先搜索 Termux 仓库的 SDK/Runtime 9 包。
- [ ] 原生 Termux 找不到时，按已确认要求调用微软官方脚本，再进行真实执行探测。
- [ ] 官方 glibc 构建在 Android bionic 下无法执行时，输出动态加载器/ABI诊断并停止，不自动切换 Proot。
- [ ] Proot 按其 Debian/Ubuntu 用户空间执行普通 Linux 安装流程。

### 3.6 国内镜像与 GitHub 加速

- [ ] 脚本开始时询问是否启用国内源；无人值守默认官方源。
- [ ] 修改任何源前备份原配置并记录文件哈希、权限和所有者。
- [ ] Debian/Ubuntu、Fedora/RHEL、Arch、openSUSE、Termux/Proot 使用对应清华镜像配置。
- [ ] PyPI 使用清华镜像；npm 使用 npmmirror；NuGet 保持微软官方源。
- [ ] 镜像元数据刷新失败时立即恢复原配置并停止该镜像流程。
- [ ] `restore-mirrors` 只恢复本脚本登记的备份，不覆盖之后由用户修改的文件。
- [ ] GitHub 下载前执行一次 Google ping 探测；不通时优先项目现有 GitHub 加速代理候选。
- [ ] 所有加速地址失败后回退 GitHub 直连，并保存每次尝试的脱敏错误。

### 3.7 Steamcommunity_302 依赖

- [ ] 安装向导询问是否安装依赖，默认关闭，不下载或运行 SC302 本体。
- [ ] Debian/Ubuntu 候选：NSS 工具、`libnetfilter-queue1`、`libuuid1`。
- [ ] Fedora/RHEL 候选：`nss-tools`、`libnetfilter_queue`、`libuuid`。
- [ ] Arch 候选：`nss`、`libnetfilter_queue`、`util-linux-libs`。
- [ ] openSUSE 候选：`mozilla-nss-tools`、`libnetfilter_queue1`、`libuuid1`。
- [ ] 固定包名不存在时使用 provides/search 查找对应共享库提供者。
- [ ] 明确提示原生 Termux/Proot 的 glibc、特权端口和内核 netfilter 限制。
- [ ] 不把“依赖已安装”表述为“SC302 已可运行”。

## 四、安装目录与服务设计

### 4.1 隔离安装

- [ ] 普通 Linux 默认代码目录候选：`/opt/wallhub`。
- [ ] 普通 Linux 默认数据目录候选：`/var/lib/wallhub`。
- [ ] 创建无登录 shell 的专用 `wallhub` 用户，并只授予必要目录权限。
- [ ] Termux 默认代码目录：`$HOME/.local/share/wallhub`。
- [ ] Termux 默认状态目录：`$HOME/.local/state/wallhub`。
- [ ] 安装器状态分别写入系统或用户配置目录，不写入项目源码。

### 4.2 原地安装

- [ ] 确认当前目录包含 WallHub package.json、server.js、src 和 public。
- [ ] 不移动源码，不覆盖脏 Git 工作树。
- [ ] 将运行数据保持在用户配置路径或现有环境变量指定路径。
- [ ] update 遇到本地修改时停止并显示差异，不使用 reset/checkout 覆盖。

### 4.3 源码与 public

- [ ] 当前目录是有效 WallHub 源码时直接复用。
- [ ] 否则从同一 GitHub 仓库获取 `main` 或 `--branch` 指定版本。
- [ ] 下载到临时目录，验证必要文件后再移动到目标位置。
- [ ] 校验 `public/index.html` 存在且引用的所有静态资源可读取。
- [ ] public 有效时执行 `npm ci --omit=dev`，复用提交的构建资源。
- [ ] public 缺失、引用损坏或指定 `--build-ui` 时执行完整 `npm ci` 和 Vite build。
- [ ] 重建后执行 `npm prune --omit=dev`，避免运行环境保留开发依赖。

### 4.4 服务

- [ ] systemd 服务写入独立环境文件，设置 Node、Python venv、DOTNET_ROOT、数据目录和端口。
- [ ] Termux runit 服务包含启动、日志、状态检查和优雅停止。
- [ ] Proot 管理逻辑防止重复启动、过期 PID 和日志无限增长。
- [ ] 服务固定以安全模式、端口3090启动。
- [ ] 服务启动后轮询 `/health`，超时打印日志尾部并返回健康检查失败。
- [ ] 不等待 SteamKit 双运行时构建，不把 healthcheck 描述为 SteamKit ready。
- [ ] 不自动修改 ufw、firewalld、nftables 或云平台防火墙。

## 五、阶段任务清单

## 阶段 0：发布前基线与备份

- [x] 阶段 0 完成。
- [x] 在工作区外创建源码归档、文件清单和 SHA-256 校验。
- [x] 验证归档可解压，且不包含账号、下载、缓存、日志或秘密。
- [x] 记录当前 Git 状态、分支、远程与初始提交。
- [x] 恢复 MIT LICENSE。
- [x] 更新 `.gitignore` 排除 `.hermes/`、NuGet 本地状态和所有个人/运行文件。
- [x] 审核将要提交的最小文件清单，保留 public，排除非必要文档和个人文件。
- [x] 执行秘密与私网信息扫描。
- [x] 运行现有 npm、TypeScript、前端构建和 Python 基线测试。

## 阶段 1：单文件安装器骨架

- [x] 阶段 1 完成。
- [x] 创建根目录 `install.sh`，采用严格 Bash 模式和统一错误处理。
- [x] 实现子命令和参数解析。
- [x] 实现 `/dev/tty` 交互读取及无人值守模式。
- [x] 实现中英文本表和 locale 自动选择。
- [x] 实现分阶段日志、脱敏、临时目录及 trap 清理。
- [x] 实现 `--dry-run`，保证不执行包安装、源修改、服务修改和删除。
- [x] 实现状态文件格式和退出码。
- [x] 通过 `bash -n` 与 ShellCheck。

## 阶段 2：平台、架构和包管理器抽象

- [x] 阶段 2 完成。
- [x] 实现 Linux 四系、原生 Termux、Proot 识别。
- [x] 实现 x86_64/ARM64 规范化和拒绝路径。
- [x] 实现 apt、dnf、pacman、zypper、pkg 的 search/install/update 能力接口。
- [x] 实现 sudo/root 和 systemd 能力检测。
- [x] 实现 Proot Debian/Ubuntu 交互选择及参数传递。
- [x] 使用伪造 os-release 和命令 shim 覆盖所有识别分支。

## 阶段 3：镜像源与网络回退

- [x] 阶段 3 完成。
- [x] 实现系统源、PyPI、npm 的持久国内源配置。
- [x] 实现备份清单、哈希保护和 `restore-mirrors`。
- [x] 实现镜像刷新失败自动恢复。
- [x] 实现 Google ping 与 GitHub 加速代理顺序。
- [x] 验证代理失败后仍会回退直连。
- [x] 验证日志不包含代理认证信息或其他秘密。

## 阶段 4：Node、Python、.NET 与 SC302 依赖

- [x] 阶段 4 完成。
- [x] 实现 Node 版本探测、仓库安装和官方 LTS 便携包回退。
- [x] 实现 Python venv、系统包复用、wheel/源码构建回退。
- [x] 实现四个 MPKG 模块的严格功能门禁。
- [x] 实现普通 Linux `.NET 9` 仓库与官方脚本回退。
- [x] 实现原生 Termux `.NET 9` 仓库查找、官方脚本尝试和 bionic 失败诊断。
- [x] 实现 SC302 依赖询问及四类发行版包候选。
- [x] 验证所有依赖探测基于实际命令或 import，而不是安装命令退出码。

## 阶段 5：源码获取、安装布局与前端

- [x] 阶段 5 完成。
- [x] 实现当前目录源码识别。
- [x] 实现 GitHub main/指定分支下载和代理回退。
- [x] 实现隔离安装与原地安装。
- [x] 实现 public 完整性检查。
- [x] 实现默认生产依赖安装和按需前端重建。
- [x] 实现重复安装幂等性和用户数据保护。
- [x] 隔离安装使用暂存目录和原子切换，失败时保留旧版本。

## 阶段 6：服务托管与健康检查

- [x] 阶段 6 完成。
- [x] 实现 systemd 服务、环境文件和专用用户权限。
- [x] 实现原生 Termux runit 服务。
- [x] 实现 Proot start/stop/status/logs 与 PID 管理。
- [x] 实现服务启动、停止、重启和日志边界。
- [x] 实现 `/health` 轮询和失败日志输出。
- [x] 验证安装成功不会错误等待 SteamKit 双运行时。
- [x] 验证脚本不修改防火墙。

## 阶段 7：维护子命令

- [x] 阶段 7 完成。
- [x] `check` 输出平台、架构、版本、Python模块、服务和健康状态。
- [x] `repair` 只修复失败或缺失项目，不重置用户设置。
- [x] `update` 支持 main/指定分支并保留数据与环境配置。
- [x] 隔离 update 健康检查失败时自动回滚代码版本。
- [x] 原地 update 遇到脏工作树时停止。
- [x] `uninstall` 默认保留数据、设置和镜像备份。
- [x] `--purge` 仅删除安装器登记的路径，并要求二次确认。
- [x] `restore-mirrors` 正确处理用户在安装后又修改配置的冲突。

## 阶段 8：本地完整验证与public更新

- [x] 阶段 8 完成。
- [x] `bash -n install.sh` 通过。
- [x] ShellCheck 无必须修复的问题。
- [x] 所有平台模拟、参数、退出码和 dry-run 测试通过。
- [x] `npm test` 通过。
- [x] `npx tsc --noEmit` 通过。
- [x] `npm run build:ui` 通过并生成最终 public。
- [x] Python MPKG 单测和 py_compile 通过。
- [x] public index 引用完整性检查通过。
- [x] 重复 install、repair、update、uninstall、restore-mirrors 测试通过。
- [x] 最终提交候选再次通过秘密扫描和最小文件清单审计。

## 阶段 9：GitHub测试分支发布

- [x] 阶段 9 完成。
- [x] 创建 `installer-validation` 分支，不改写远端历史。
- [x] 提交 MIT LICENSE、最小源码、public、文档和 install.sh。
- [x] 确认提交不包含 `.hermes/`、NuGet 本地状态、个人文件或秘密。
- [x] 推送验证分支并验证 Raw install.sh 可访问。
- [x] 在全新临时目录执行远程脚本 dry-run。
- [x] 记录验证分支 commit SHA，所有远程测试固定使用该 SHA 或分支。

## 阶段 10：PVE x86_64 LXC验证

- [x] 阶段 10 完成。
- [x] 使用临时受限 askpass 连接；密码不进入仓库、命令参数和日志。
- [x] 只读记录现有节点、存储、网络桥、模板和 VM/CT ID。
- [x] 明确登记现有 ID `100`、`101`、`102` 为禁止操作资源。
- [x] 修复 Debian 13 系统 Node 满足最低版本但 npm 为独立包时安装提前失败的问题，并完成本地门禁。
- [x] 从干净 Debian 13 容器复测独立 npm 安装分支和完整部署。
- [x] 修复 Debian 13 对 systemd 单值路径字段外层引号的兼容问题，并覆盖带空格路径。
- [x] 修复源码复制规则误删嵌套 `src/domains/downloads` 目录的问题，确保仅排除仓库根运行数据目录。
- [x] 修复 Debian 12 完整安装后服务未通过 `/health` 的问题，并从干净 Debian 12 容器复测。
- [x] 修复 Ubuntu 26.04 安装 curl 包后命令仍不可用的问题，并从干净 Ubuntu 26.04 容器复测。
- [x] 修复 Ubuntu 22.04 切换国内源后无法安装Python venv候选的问题，并复测镜像恢复与原地安装。
- [x] 修复 Rocky Linux 9 国内源repo重写失败，并从干净容器复测。
- [x] 修复 Arch Linux pacman 7 沙箱、空keyring及滚动发行版部分升级问题，并从干净容器复测。
- [x] 修复 openSUSE Leap 16.0 版本化运行时包名和RIS服务镜像覆盖问题，并从干净容器复测。
- [x] 每个测试 LXC 使用唯一新 ID 和 `wallhub-installer-validation` 标记。
- [x] 每次只运行一个 LXC，资源为2 vCPU、2GB内存、8GB磁盘。
- [x] 验证当前稳定 Debian 和 Debian 12 旧基线。
- [x] 验证当前 Ubuntu LTS 和 Ubuntu 22.04 旧基线。
- [x] 验证当前 Fedora。
- [x] 验证当前 RHEL兼容发行版和9系旧基线。
- [x] 验证当前 Arch。
- [x] 验证当前 openSUSE Leap。
- [x] 覆盖官方源与国内源。
- [x] 覆盖隔离安装与原地安装。
- [x] 验证服务、health、check、repair、update、uninstall和源恢复。
- [x] 保存脱敏日志、版本和最低成功资源记录。
- [x] 只销毁资源登记表中本次创建的 LXC，并确认禁止操作资源未改变。

## 阶段 11：Android ARM64 Termux验证

- [ ] 阶段 11 完成。
- [x] 使用临时受限 askpass 连接，不记录密码和私网地址。
- [x] 记录测试前 Termux 版本、仓库、架构、已安装包和现有 Proot 列表。
- [x] 固定验证提交分别完成原生 Termux 官方源、国内源无副作用 dry-run，并核对前后状态哈希。
- [x] 校验并备份测试前清华源，临时切换 Termux 官方源且确认 ARM64 运行时候选可用。
- [x] 完成原生 Termux 官方源隔离安装，验证四模块、runit 与 `/health` 成功。
- [x] 在原生 Termux 实际编译并运行 `.NET 9` console，确认 SDK/runtime 不只是版本探测通过。
- [x] 在原生 Termux 构建并真实启动 JSON 进度与分块在线播放两套 DepotDownloader 运行时。
- [ ] 验证官方 F-Droid/GitHub Termux 环境识别。
- [x] 验证原生 Termux 官方源和国内源路径。
- [x] 验证原生 `.NET 9` 包搜索及微软官方脚本回退。
- [x] 若 bionic 下不可运行，确认脚本严格失败且诊断准确，不标记完整安装成功。
- [ ] 验证 Debian Proot ARM64 完整安装和服务健康。
- [ ] 验证 Ubuntu Proot 参数、镜像和依赖分支；至少完成 dry-run和静态检查。
- [ ] 验证 Termux runit 与 Proot PID 服务管理。
- [ ] 验证 Python四模块和public复用/重建路径。
- [ ] 只清理本次创建的安装目录或 Proot；不删除测试前已存在的环境和用户数据。
- [ ] 恢复本脚本修改的镜像配置并核对测试前后差异。

## 阶段 12：修复循环、main发布与最终验收

- [ ] 阶段 12 完成。
- [ ] 每个远程失败建立独立未勾选修复节点，记录平台、阶段和脱敏证据。
- [x] 修复原生 Termux 新进程缺少 `SVDIR` 时 `check` 误报 runit 服务未运行的问题，并完成真机复测。
- [x] 修复首次隔离安装创建空 `cache-settings.json` 导致运行时 JSON 解析告警的问题，确保不覆盖非空用户设置。
- [x] 修复 Termux 已自动选择任意第三方镜像时 `--mirror china` 未真正切换清华源的问题，并完成备份恢复真机复测。
- [ ] 修复默认卸载后继续 purge 时缺失 runit 服务噪声与持久日志重建配置目录的竞态，并从失败现场复测。
- [ ] 修复后先跑本地门禁，再更新验证分支。
- [ ] 受影响平台重新从干净环境执行远程一键安装。
- [ ] 所有必需验证通过后，将 `installer-validation` 正常合并到 `main`。
- [ ] 推送 main，不 force push、不改写历史。
- [ ] 验证 main Raw install.sh、README命令和public资源可访问。
- [ ] 在一个全新 Linux LXC 和一个全新 ARM64 Proot 做最终 main URL 冒烟部署。
- [ ] 汇总最终支持矩阵、实际依赖版本和已知限制。
- [ ] 由用户在 UI 手动完成 Steam登录、Steam Guard、真实下载和在线播放验收。

## 六、最终验收清单

- [ ] GitHub main 只包含已批准的最小文件集和public，不包含个人文件或秘密。
- [ ] 一条 GitHub Raw 命令可启动交互安装。
- [ ] 无人值守参数可在 PVE 中稳定复现安装。
- [ ] Linux四类发行版的包名差异由能力搜索处理。
- [ ] x86_64 与 ARM64 路径均经过真实设备或容器验证。
- [ ] Node、Python、.NET 使用实际版本和功能探测。
- [ ] 四个 MPKG Python 依赖全部可用，否则安装严格失败。
- [ ] public 默认复用，损坏或显式要求时可重建。
- [ ] systemd、Termux runit、Proot服务管理均可启动、停止和查看日志。
- [ ] `/health` 成功后安装返回，且不错误宣称 SteamKit运行时已全部就绪。
- [ ] 镜像源可备份、持久启用、失败恢复和手动恢复。
- [ ] update 不覆盖脏工作树，隔离更新失败可回滚。
- [ ] uninstall 默认保留用户数据，purge只删除登记路径。
- [ ] 脚本不修改防火墙，不下载SC302本体。
- [ ] 原生 Termux `.NET 9` 不兼容时给出准确失败诊断。
- [ ] PVE既有虚拟机/容器和手机既有数据均未被修改或删除。
- [ ] README中英文部署说明、参数和限制与实际脚本一致。

## 七、进度记录

每次勾选任务后立即追加一行。证据应使用命令、测试数量、commit SHA或脱敏日志路径，不记录秘密和私网信息。

| 日期 | 阶段 | 任务节点 | 状态 | 验证证据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 2026-07-17 | 文档 | 设计文档创建 | 完成 | `docs/wallhub-cross-platform-installer-plan.md` | 已建立阶段及节点复选框 |
| 2026-07-17 | 阶段 0 | 创建工作区外源码备份 | 完成 | 250 个文件；`wallhub-source.tar.gz` SHA-256 `55eaeb30a4ad21209b8b31116d1e7fcca80b47bbdcabf23d4eea311c60ea5fd1` | 同目录保存逐文件 SHA-256 清单 |
| 2026-07-17 | 阶段 0 | 验证备份可恢复且无运行数据或秘密 | 完成 | 解压后逐文件哈希完全一致；禁止项 0；敏感候选人工复核 8/8 为文案、占位符或测试数据 | 排除 Downloads、SteamKit、NuGet、`.hermes`、缓存、日志及账号状态 |
| 2026-07-17 | 阶段 0 | 记录 Git 发布基线 | 完成 | `main` / `origin/main` 均位于 `74f563d`；除已删除 LICENSE 外项目文件尚未跟踪 | 远端为已确认的同名 GitHub 仓库，未改写历史 |
| 2026-07-17 | 阶段 0 | 恢复 MIT LICENSE | 完成 | `git diff --exit-code HEAD -- LICENSE` | 内容与初始提交完全一致 |
| 2026-07-17 | 阶段 0 | 收紧 Git 忽略规则 | 完成 | `git check-ignore -v` 验证运行目录均被忽略；`docs/`、`public/` 均未忽略 | 新增 `.agents`、`.hermes`、NuGet、会话/下载/缓存及临时文件规则 |
| 2026-07-17 | 阶段 0 | 审核最小发布文件集 | 完成 | `git ls-files --cached --others --exclude-standard`：251 个文件 | 仅包含 LICENSE、根配置/README、安装计划、前后端源码与测试、MPKG 工具和 public；同时修复 Docker 上下文误排除 docs |
| 2026-07-17 | 阶段 0 | 扫描秘密与私网信息 | 完成 | 私钥 0、凭据 URL 0、已知 Token 0、禁止路径 0；8 个候选逐项复核 | 候选仅为环境变量名、登录文案、public 同源构建文案和单测保留地址/假令牌 |
| 2026-07-17 | 阶段 0 | 运行发布前基线测试 | 完成 | `npm test` 255/255；`npx tsc --noEmit`；Vite 4.5.14 build；Python 17 项通过/2 项跳过；`py_compile`；public 3/3 引用存在 | 未启动 WallHub 服务；本机 Python 3.11 缺少部分可选原生模块，因此对应 2 项按测试设计跳过 |
| 2026-07-17 | 阶段 0 | 阶段验收 | 完成 | 阶段 0 所有 8 个子节点均通过 | 外部可恢复备份已就绪，发布基线已锁定 |
| 2026-07-17 | 阶段 1 | 严格 Bash 骨架与统一错误处理 | 完成 | `bash -n install.sh`；ShellCheck 0.11.0 | 启用 `set -Eeuo pipefail`、阶段错误映射和统一诊断提示 |
| 2026-07-17 | 阶段 1 | 子命令与参数解析 | 完成 | 安装器自测：6 个子命令逐一解析；非法参数退出 2 | 包含 install/check/repair/update/uninstall/restore-mirrors 及 purge |
| 2026-07-17 | 阶段 1 | TTY 交互与无人值守 | 完成 | 伪终端执行 `cat install.sh \| bash`，4 项提示均从 `/dev/tty` 完成；非交互矩阵通过 | 验证脚本正文占用 stdin 时交互仍可用 |
| 2026-07-17 | 阶段 1 | 中英文本与 locale | 完成 | 自测中英消息表；`--lang` 参数验证 | locale 自动选择，显式参数可覆盖 |
| 2026-07-17 | 阶段 1 | 日志、脱敏与 trap | 完成 | URL 凭据/Token 脱敏自测；伪终端结束后临时目录为空 | 日志按阶段记录，临时认证信息不进入项目日志 |
| 2026-07-17 | 阶段 1 | 无副作用 dry-run | 完成 | Debian/Fedora/Arch/openSUSE/Proot/Termux 六路径通过；代码、数据和 `/etc/wallhub-installer` 前后不变 | 覆盖 x86_64 与模拟 ARM64 |
| 2026-07-17 | 阶段 1 | 状态格式与退出码 | 完成 | 含空格路径状态往返；非法参数 2、拒绝架构 10；阶段错误统一映射 | 状态值由 `printf %q` 生成并以 0600 保存 |
| 2026-07-17 | 阶段 1 | Bash 与 ShellCheck 门禁 | 完成 | 两个脚本 `bash -n`；ShellCheck 0.11.0 零告警 | 检查 `install.sh` 与 `tools/installer/test_install.sh` |
| 2026-07-17 | 阶段 1 | 阶段验收 | 完成 | 安装器自测 56/56，交互管道和 dry-run 矩阵通过 | 未启动本地 WallHub 服务 |
| 2026-07-17 | 阶段 2 | 六类环境识别 | 完成 | 伪造 os-release 覆盖 Debian、Ubuntu、Fedora、Rocky、Arch、openSUSE；另测 Termux 与 Proot | 对应 apt/dnf/pacman/zypper/pkg 正确 |
| 2026-07-17 | 阶段 2 | 架构规范化与拒绝 | 完成 | x86_64、aarch64/arm64 通过；armv7l 退出 10 | 仅承诺 x86_64 与 ARM64 |
| 2026-07-17 | 阶段 2 | 包管理器能力接口 | 完成 | PATH shim 实际覆盖 apt-get、dnf、pacman、zypper、pkg 的 refresh/install 调用 | 包候选失败会执行 search/provides 诊断 |
| 2026-07-17 | 阶段 2 | root/sudo 与 systemd 检测 | 完成 | PVE root dry-run；systemd 生成单测含用户、环境文件和带空格路径 | 非 root 路径保留 sudo 前缀，远程发行版阶段继续实机验证 |
| 2026-07-17 | 阶段 2 | Proot 选择和参数透传 | 完成 | 自测验证 Ubuntu、repair 子命令及 installer-validation 分支透传 | 无人值守默认 Debian |
| 2026-07-17 | 阶段 2 | os-release 与命令 shim 覆盖 | 完成 | 安装器自测 56/56，其中 uname shim 驱动 ARM64，五种包命令 shim 均有调用证据 | 所有识别分支已覆盖 |
| 2026-07-17 | 阶段 2 | 阶段验收 | 完成 | 六平台 dry-run 矩阵和 56 项单测通过 | 后续阶段在真实容器复核包名差异 |
| 2026-07-17 | 阶段 3 | 持久国内源配置 | 完成 | Debian/Ubuntu、Fedora/RHEL、Arch、openSUSE、Termux 替换逻辑；安装器自有 `pip.conf`/`npmrc` | TUNA + npmmirror；NuGet 保持官方源 |
| 2026-07-17 | 阶段 3 | 镜像备份和哈希保护 | 完成 | 原配置恢复、自建配置删除、安装后用户修改保留，相关单测 5 项 | 清单记录原始/修改后 SHA-256、权限和所有者 |
| 2026-07-17 | 阶段 3 | 刷新失败自动恢复 | 完成 | 强制刷新失败退出 20；PyPI/npm 新配置均自动撤销 | 系统源使用同一事务恢复路径 |
| 2026-07-17 | 阶段 3 | Google 与 GitHub 路由 | 完成 | ping shim 断网；顺序为 gh-proxy.com、ghproxy.net、direct | 修复进程替换导致重复 ping，现单进程只探测一次 |
| 2026-07-17 | 阶段 3 | 代理失败直连回退 | 完成 | 前两路 curl shim 返回 22，第三路直连写入预期文件 | 三次请求顺序已断言 |
| 2026-07-17 | 阶段 3 | 镜像与代理日志脱敏 | 完成 | URL 用户名/密码及 token 值脱敏单测；秘密扫描无真实凭据 | 路由日志只保留协议和主机 |
| 2026-07-17 | 阶段 3 | 阶段验收 | 完成 | 安装器自测 61/61；ShellCheck 零告警 | 国内源实机性能和可用性在发行版矩阵继续复核 |
| 2026-07-17 | 阶段 4 | Node 探测与回退 | 完成 | Node 16.17.0/npm shim；动态 LTS 索引、架构选择及官方 SHA-256 代码路径 | 系统版本满足时复用；Termux 禁止 glibc Node 包 |
| 2026-07-17 | 阶段 4 | Python venv 与安装回退 | 完成 | Python 版本/venv 能力检查；系统 site-packages；wheel 失败后一次构建依赖重试 | Debian 支持版本化 venv 包候选 |
| 2026-07-17 | 阶段 4 | MPKG 四模块严格门禁 | 完成 | Pillow 图像、LZ4 往返、etcpak ETC2、texture2ddecoder BC1/BC3 实际 API 探测代码 | 任一 import/API 失败均退出 20 |
| 2026-07-17 | 阶段 4 | 普通 Linux .NET 9 | 完成 | `.NET 9` SDK/Runtime 双输出 shim；仓库候选及微软 channel 9.0 回退 | x64/arm64 架构参数明确 |
| 2026-07-17 | 阶段 4 | 原生 Termux .NET 9 | 完成 | Termux/TUR 包候选、官方脚本回退、bionic 专用失败信息 | 不自动切换 Proot |
| 2026-07-17 | 阶段 4 | SC302 依赖候选 | 完成 | Debian、Fedora/RHEL、Arch、openSUSE 候选断言 | 明确仅安装依赖，不下载本体或宣称可运行 |
| 2026-07-17 | 阶段 4 | 依赖能力验证原则 | 完成 | Node/npm 版本命令、Python import/API、dotnet SDK/runtime 均有独立门禁 | 不以包安装退出码作为成功依据 |
| 2026-07-17 | 阶段 4 | 阶段验收 | 完成 | 安装器自测中的依赖分支通过 | 实际 wheel/包组合继续由阶段 10/11 干净环境复核 |
| 2026-07-17 | 阶段 5 | 当前源码识别 | 完成 | `valid_source_tree` fixture 验证 package/lock/server/src/frontend/tools | 无效目录不被采用 |
| 2026-07-17 | 阶段 5 | GitHub 与压缩包获取 | 完成 | 分支优先、标签回退、ZIP URL、两代理后直连单测 | tar/ZIP 路径穿越成员被拒绝 |
| 2026-07-17 | 阶段 5 | 两种安装布局 | 完成 | 隔离部署两次；原地脏 Git 拒绝 | 原地模式不移动源码 |
| 2026-07-17 | 阶段 5 | public 完整性 | 完成 | Node 解析 index 的 src/href；当前 public 3/3 引用存在 | 空引用或缺失文件均失败 |
| 2026-07-17 | 阶段 5 | npm 生产安装与按需构建 | 完成 | public 有效走 `npm ci --omit=dev`；无效或 `--build-ui` 走 ci/build/prune | 本地 Vite 生产构建已通过 |
| 2026-07-17 | 阶段 5 | 幂等与用户数据保护 | 完成 | 两次隔离切换；Downloads/SteamKit/账号文件未复制 | cache 设置通过数据目录符号链接持久化 |
| 2026-07-17 | 阶段 5 | 原子切换与旧版保留 | 完成 | stage marker、previous 版本和 rollback 断言 | 未标记目录拒绝覆盖/删除 |
| 2026-07-17 | 阶段 5 | 阶段验收 | 完成 | 源码/归档/原子部署相关测试全部通过 | 真实 GitHub archive 在阶段 9 验证 |
| 2026-07-17 | 阶段 6 | systemd 服务 | 完成 | unit 生成测试：专用用户、环境文件、含空格路径引用 | 隔离 Linux 创建无登录 wallhub 用户 |
| 2026-07-17 | 阶段 6 | Termux runit | 完成 | run/log 脚本 `sh -n`；svlogd；down/run 状态判定 | 显式启动并确认 runsvdir，无需重开 shell |
| 2026-07-17 | 阶段 6 | Proot PID 管理 | 完成 | 临时进程真实 start/status/stop；过期 PID 判定 | 管理器脚本独立 `bash -n` |
| 2026-07-17 | 阶段 6 | 生命周期与日志边界 | 完成 | Proot 10 MiB 日志轮转；Termux svlogd；systemd journal | 支持 start/stop/restart/status/logs |
| 2026-07-17 | 阶段 6 | 健康轮询与诊断 | 完成 | 第 3 次成功即返回；持续失败附加服务日志尾部 | 只访问 `127.0.0.1:3090/health` |
| 2026-07-17 | 阶段 6 | 不等待 SteamKit 构建 | 完成 | 成功条件仅依赖 `/health`；无 SteamKit ready 轮询 | UI 后台构建继续独立进行 |
| 2026-07-17 | 阶段 6 | 不修改防火墙 | 完成 | 安装器静态命令扫描 | 无 ufw/firewall-cmd/nft/iptables 调用 |
| 2026-07-17 | 阶段 6 | 阶段验收 | 完成 | 安装器服务与健康测试通过，累计 97/97 | systemd/runit 真机启动在阶段 10/11 复核 |
| 2026-07-17 | 阶段 7 | check 诊断 | 完成 | 平台/架构/路径、Node、Python 四模块、.NET、public、服务及 health 独立检查 | 失败按 20/40/50 分类 |
| 2026-07-17 | 阶段 7 | repair 最小修复 | 完成 | 已通过 npm/Python 能力探测时不重装测试 | 不修改 cache-settings、下载或登录数据 |
| 2026-07-17 | 阶段 7 | update 分支与数据保留 | 完成 | branch/tag 获取、数据目录独立、环境重写 | 下载及会话目录不参与代码切换 |
| 2026-07-17 | 阶段 7 | 隔离更新自动回滚 | 完成 | 模拟新版 health 失败，退出 50、旧版本恢复并重启 | 更新事务失败也会恢复服务 |
| 2026-07-17 | 阶段 7 | 原地脏树保护 | 完成 | 脏 Git update 退出 30，服务停止标记未产生 | fetch/merge 前先验证工作树 |
| 2026-07-17 | 阶段 7 | 默认卸载保留数据 | 完成 | 代码删除，设置/数据/镜像备份仍存在 | 原地源码不会删除 |
| 2026-07-17 | 阶段 7 | purge 路径约束 | 完成 | 仅登记 code/data/config 删除，相邻 unrelated 文件保留 | 交互要求两次 yes；`--yes` 可供无人值守 |
| 2026-07-17 | 阶段 7 | 镜像恢复冲突 | 完成 | 安装后用户修改文件保持不变并返回冲突 | 安装器自建配置可安全删除 |
| 2026-07-17 | 阶段 7 | 阶段验收 | 完成 | 安装器自测 97/97；ShellCheck 零告警 | 全维护命令在真实安装后继续端到端验证 |
| 2026-07-17 | 阶段 8 | Bash 语法 | 完成 | `bash -n install.sh tools/installer/test_install.sh` | PVE 宿主临时只读检查，脚本随后清理 |
| 2026-07-17 | 阶段 8 | ShellCheck | 完成 | ShellCheck 0.11.0，两个 Bash 文件零告警 | 仅两处运行时字面量有局部说明性抑制 |
| 2026-07-17 | 阶段 8 | 平台/参数/dry-run | 完成 | 安装器自测 97/97；六环境矩阵；curl-pipe TTY；退出码 2/10/20/30/50 | dry-run 前后系统配置与目标目录均不变 |
| 2026-07-17 | 阶段 8 | Node 测试 | 完成 | `npm test`：255/255 | 无失败、取消或跳过 |
| 2026-07-17 | 阶段 8 | TypeScript | 完成 | `npx tsc --noEmit` | 零诊断 |
| 2026-07-17 | 阶段 8 | 前端生产构建 | 完成 | Vite 4.5.14，2031 modules transformed | 最终 public 已生成 |
| 2026-07-17 | 阶段 8 | Python MPKG | 完成 | 17 项通过、2 项按本机缺少原生模块跳过；`py_compile` 通过 | 四模块严格成功路径在阶段 10/11 真实环境验证 |
| 2026-07-17 | 阶段 8 | public 引用 | 完成 | index 中 3 个根引用，缺失 0 | public 共 10 个发布文件 |
| 2026-07-17 | 阶段 8 | 维护流程重复测试 | 完成 | 两次 install 原子切换、repair 跳过、update 回滚、两种 uninstall、restore 冲突 | 用户数据与相邻目录保护断言通过 |
| 2026-07-17 | 阶段 8 | 最终候选审计 | 完成 | 253 文件；禁止路径 0；>2 MiB 文件 0；真实秘密 0 | 10 个模式候选均为文案、占位符、保留测试地址或假凭据负测 |
| 2026-07-17 | 阶段 8 | 阶段验收 | 完成 | 全部本地及模拟门禁通过 | 未启动本地 WallHub 服务 |
| 2026-07-17 | 阶段 9 | 发布前候选备份 | 完成 | 253 文件；归档 SHA-256 `b2498d30c39270a79019a9d3ed1865b17adbd79a84836d0bfe69eff5f2e7fe4b`；恢复哈希一致 | 工作区外保存，禁止运行目录 0 |
| 2026-07-17 | 阶段 9 | 创建验证分支 | 完成 | `git switch -c installer-validation`；起点 `74f563d` | 远端当时仅有 main，未改写历史 |
| 2026-07-17 | 阶段 9 | 提交发布候选 | 完成 | `edb7d283534df2c173f121b95f49fa03c7488a28`；仓库 253 文件 | MIT LICENSE、源码/测试、public、README、Docker、文档和 install.sh |
| 2026-07-17 | 阶段 9 | 提交内容复核 | 完成 | `git diff --cached --check`；禁止路径 0；未暂存 0；真实秘密 0 | `.hermes`、NuGet、SteamKit、Downloads、node_modules 均保持忽略 |
| 2026-07-17 | 阶段 9 | 推送与 Raw 验证 | 完成 | origin/installer-validation 指向 `edb7d28`；分支/固定 SHA Raw 与本地字节一致 | install.sh 文本 SHA-256 `705796939abbea38181e400c7c49ee867bb5e5835d0df5219460f5de76cb33c7` |
| 2026-07-17 | 阶段 9 | 全新目录 Raw dry-run | 完成 | 固定 SHA Raw URL，PVE `/tmp` 新目录；退出 0 | 目标代码/数据未创建，`/etc/wallhub-installer` 前后不变 |
| 2026-07-17 | 阶段 9 | 固定验证提交 | 完成 | `edb7d283534df2c173f121b95f49fa03c7488a28` | 阶段 10/11 使用该 SHA；出现修复时另记新 SHA |
| 2026-07-17 | 阶段 9 | 阶段验收 | 完成 | 分支、提交、Raw、dry-run 全部通过 | 无 force push、main 未改变 |
| 2026-07-17 | 阶段 10 | PVE 临时认证 | 完成 | 无秘密通用 askpass helper + 会话环境变量；每次调用后清空变量 | helper 受本用户 ACL 限制，不含密码 |
| 2026-07-17 | 阶段 10 | PVE 只读资源清单 | 完成 | PVE 8.4；存储/桥/模板/CT/VM 列表只读命令 | 可用模板覆盖计划中的 x86_64 发行版矩阵 |
| 2026-07-17 | 阶段 10 | 禁止资源登记 | 完成 | 测试前 100/101/102 均运行 | 后续所有 create/start/exec/destroy 仅允许新登记 ID |
| 2026-07-17 | 阶段 10 | Debian 13 独立 npm 修复 | 完成 | 安装器能力探测与便携 Node 回退；自测 100/100；Node 255/255；TypeScript、Bash语法和diff检查通过 | 干净容器完整复测保持未勾选；本机未启动服务 |
| 2026-07-17 | 阶段 10 | npm修复验证提交与ShellCheck | 完成 | 固定提交 `a44182e77fc5dad53740679478f7dbc3e5f19889`；Raw SHA-256 `6ad33377f39b3d7d725018e0144cfff18cffd7b67c7e7674974d9262da59c578`；ShellCheck 0告警 | PVE仅操作登记CT 9100；未改写远端历史 |
| 2026-07-17 | 阶段 10 | Debian 13 首次续跑 | 失败待修复 | npm 9.2.0、.NET SDK 9.0.316、SC302依赖、源码、npm资源和Python四模块均通过；systemd退出40 | `WorkingDirectory= path is not absolute: \"/opt/wallhub\"`；建立独立未勾选修复节点 |
| 2026-07-17 | 阶段 10 | Debian 13 systemd修复续跑 | 失败待修复 | unit语法继续到health，退出50；服务失败后已停止重启 | `EnvironmentFile`因外层引号被忽略；根级排除模式误删 `src/domains/downloads`；分别建立修复节点 |
| 2026-07-17 | 阶段 10 | systemd与嵌套源码修复 | 完成 | 安装器自测104/104；Node 255/255；TypeScript、Bash、ShellCheck通过；CT安装退出0且health通过 | 固定代码提交 `c7c30f099c4e59aea5951faedc915f8057dd3bb0`；干净容器复测仍未勾选 |
| 2026-07-17 | 阶段 10 | Debian 13 故障发现容器生命周期 | 完成 | install/check/repair/update/restore-mirrors/uninstall均退出0；更新与维护后health通过 | 默认卸载确认代码/unit删除，数据与state保留；准备销毁登记CT 9100 |
| 2026-07-17 | 阶段 10 | Debian 13 干净复测 | 完成 | CT 9101从官方模板安装退出0；独立check、systemd verify、is-active和health均通过 | Node 20.19.2、npm 9.2.0、Python 3.13.5、.NET SDK 9.0.316；8GB磁盘最终占用2.0GB |
| 2026-07-17 | 阶段 10 | Debian 12 首次完整安装 | 失败待修复 | CT 9102依赖、源码与systemd安装完成；`/health` 轮询60秒后退出50 | 保留容器用于只读诊断，已建立独立未勾选修复节点 |
| 2026-07-17 | 阶段 10 | Debian 12 Node兼容修复 | 实现完成待干净复测 | Node 18测试256/256；安装器自测104/104；ShellCheck通过；systemd active；`/health` 返回`ok` | 根因为Node 20.19新能力掩盖CommonJS加载ESM语法；新增旧CommonJS语义回归门禁 |
| 2026-07-17 | 阶段 10 | Node 16最低版本实测 | 完成 | 官方Node 16.20.2校验通过；测试文件59/59；完整npm ci、Vite build和独立端口health通过 | 测试动态导入改为显式等待Promise，避免依赖Node 18版测试钩子语义；未替换系统Node |
| 2026-07-17 | 阶段 10 | Node兼容修复验证提交 | 完成 | 固定提交`d6a78f8b93378dd7668cca5ce16fda5c4bef0899`；远端分支一致；Raw确认CommonJS导出 | 正常推送验证分支，未改写远端历史 |
| 2026-07-17 | 阶段 10 | Debian 12故障发现容器生命周期 | 完成 | update、check、repair、restore-mirrors、systemd verify、health和默认uninstall均通过 | 卸载保留data/state；精确核对配置后销毁CT 9102；禁止资源销毁前后均运行 |
| 2026-07-17 | 阶段 10 | 创建Debian 12干净复测容器 | 完成 | CT 9103；Debian 12.12官方模板；2 vCPU、2GB、8GB、0 swap、onboot关闭、非特权 | 创建前确认ID在VM/LXC中均未占用；禁止资源创建前后均运行 |
| 2026-07-17 | 阶段 10 | Debian 12干净完整复测 | 完成 | 固定提交`d6a78f8`安装退出0；独立check、systemd verify、源码哈希、四模块和health均通过；日志SHA-256`9f6b2dcb856b864f2182428d881a909060d8861ff464c6d80a3b4663ecb37ef5` | Node 18.20.4、npm 9.2.0、Python 3.11.2、Pillow 12.3.0、lz4 4.4.5、.NET SDK 9.0.316/runtime 9.0.18；磁盘占用2.0GB |
| 2026-07-17 | 阶段 10 | Debian 12干净复测资源清理 | 完成 | 精确核对主机名、标记与资源规格后销毁CT 9103；PVE临时日志已删除 | 工作区外保留通过敏感信息复核的日志副本；禁止资源销毁前后均运行 |
| 2026-07-17 | 阶段 10 | Ubuntu 26.04首次完整安装 | 失败待修复 | 基础工具安装触发后curl命令能力检查失败；退出20 | 源码与服务阶段尚未执行；保留CT 9104做只读诊断并建立独立修复节点 |
| 2026-07-17 | 阶段 10 | Ubuntu 26.04故障诊断与续跑 | 实现完成待干净复测 | `nesting=1`后networkd、DHCP和DNS恢复；修正版安装退出0；安装器自测106/106、Bash和ShellCheck通过 | 安装器显式传播索引刷新/包安装/候选安装失败并为apt启用3次下载重试；Node 22.22.1与health通过 |
| 2026-07-17 | 阶段 10 | 包管理器失败传播验证提交 | 完成 | 固定提交`6ca7489`；本地Node/TypeScript/Vite/Python及远端Bash/ShellCheck门禁通过 | 正常推送验证分支，未改写历史；CT 9104精确核对并销毁，禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | Ubuntu 26.04干净完整复测 | 完成 | 固定提交`6ca7489`安装退出0；独立check、systemd verify、四模块、修复源码标记和health均通过 | Node 22.22.1、npm 9.2.0、Python 3.14.4、Pillow 12.3.0、lz4 4.4.5、.NET SDK 9.0.316/runtime 9.0.18；磁盘占用2.2GB |
| 2026-07-17 | 阶段 10 | Ubuntu 26.04干净复测资源清理 | 完成 | 安装日志SHA-256`058761b6d0f489feb9e355df79346102b3f3f55dcf2748e8aca9251ea7f69cbb`；精确核对后销毁CT 9105 | PVE临时日志已删除；禁止资源销毁前后均运行 |
| 2026-07-17 | 阶段 10 | Ubuntu 22.04国内源原地安装 | 失败待修复 | 国内源配置后Python venv两个候选安装失败；退出20 | 服务与npm阶段尚未执行；保留CT 9106做诊断并建立独立修复节点 |
| 2026-07-17 | 阶段 10 | Ubuntu 22.04镜像索引修复续跑 | 失败待修复 | 强制刷新清华源后venv包可解析；检测到上轮残留venv有Python但无pip并退出20 | 建立受管venv完整性自愈修复，不把半成品当作可复用环境 |
| 2026-07-17 | 阶段 10 | Ubuntu 22.04故障轮完整续跑 | 实现完成待干净复测 | 国内源原地安装、check、systemd verify、health、镜像原哈希恢复、默认卸载保护均通过；自测111/111且ShellCheck通过 | Node仓库版本不足时回退官方Node 24.18.0；Python 3.10.12；.NET SDK 9.0.316；原地源码与数据保留 |
| 2026-07-17 | 阶段 10 | 镜像与venv恢复验证提交 | 完成 | 固定提交`b5a6f20`；本地全门禁、远端安装器自测111/111和ShellCheck通过 | 正常推送验证分支；CT 9106三轮日志保存在工作区外并精确清理容器 |
| 2026-07-17 | 阶段 10 | Ubuntu 22.04干净完整复测 | 完成 | 固定提交`b5a6f20`国内源原地安装退出0；独立check、systemd verify、四模块、health、源原哈希恢复均通过 | Node 24.18.0/npm 11.16.0便携回退；Python 3.10.12；Pillow 12.3.0；lz4 4.4.5；.NET SDK 9.0.316；磁盘占用2.2GB |
| 2026-07-17 | 阶段 10 | Ubuntu 22.04干净复测资源清理 | 完成 | 安装日志SHA-256`18a3420b0921fe678836aa5831dba32052b6313d0d58a78ced2e749d667d4421`；精确核对并销毁CT 9107 | PVE临时日志已删除；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | Fedora 43干净完整验证 | 完成 | 固定提交`b5a6f20`安装退出0；独立check、systemd verify、四模块、SC302三包和health均通过 | Node 22.22.2、npm 10.9.7、Python 3.14.6、Pillow 12.3.0、lz4 4.4.5、.NET SDK 9.0.118/runtime 9.0.17；磁盘占用1.9GB |
| 2026-07-17 | 阶段 10 | Fedora 43资源清理 | 完成 | 安装日志SHA-256`f7486c2097043303341a49b74563bd07b2f5d5208ee64d6d41f39f49b1a62aea`；精确核对并销毁CT 9108 | PVE临时日志已删除；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | Rocky Linux 9国内源安装 | 失败待修复 | repo重写阶段sed返回1；退出20 | 依赖与服务阶段尚未执行；保留CT 9109诊断并建立独立修复节点 |
| 2026-07-17 | 阶段 10 | Rocky Linux 9 DNF repo修复 | 实现完成待干净复测 | 修复sed分隔符冲突；安装器自测114/114、Bash语法和ShellCheck 0.10.0通过；真实国内源切换进入DNF后按预期因上游404退出20 | 失败恢复前后全部repo哈希一致；既有systemd服务与health保持正常；清华Rocky根目录当前不可用，正式完整复测改用官方源 |
| 2026-07-17 | 阶段 10 | Rocky Linux 9故障发现资源清理 | 完成 | 固定修复提交`a5b9d9a`已推送；安装日志SHA-256`bec2fce25d336e637ee189277169ecd605ebc25af3d7f41e4775b477b1cbf363`；精确核对并销毁CT 9109 | 三份证据日志保存在工作区外且敏感信息扫描零命中；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | 创建Rocky Linux 9干净复测容器 | 完成 | CT 9110；Rocky Linux 9.4官方模板；2 vCPU、2GB、8GB、0 swap、onboot关闭、非特权 | 创建前确认ID在VM/LXC中均未占用；DNS能力通过；禁止资源创建前后均运行 |
| 2026-07-17 | 阶段 10 | Rocky Linux 9干净完整复测 | 完成 | 固定提交`a5b9d9a`官方源安装退出0；独立check、systemd verify、SC302三包、四模块、health均通过；安装日志SHA-256`1270f8e0c1c0cf8049b6cb409e33059eb3c8ba7602968d592eda0b1dd0a6d6b9` | Node 16.20.2/npm 8.19.4测试59/59；Python 3.9.18测试17/17；安装器自测114/114；Pillow 11.3.0、lz4 4.4.5、.NET SDK 9.0.118/runtime 9.0.17；磁盘占用1.7GB |
| 2026-07-17 | 阶段 10 | Rocky Linux 9干净复测资源清理 | 完成 | 五份证据日志保存在工作区外且敏感信息扫描零命中；精确核对并销毁CT 9110 | PVE临时日志已删除；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | AlmaLinux 10测试模板准备 | 完成 | Linux Containers 2026-07-16 x86_64 rootfs；签名指纹`E7FB0CAEC8173D669066514CBAEFF88C22F6E216`；SHA-256`929eb95776b8a11b2d3e166f74026bd7f555fd583c710be695254f90f24b69af` | PVE官方目录尚无RHEL兼容10系模板；使用真实AlmaLinux 10而非Fedora替代；测试完成后删除模板 |
| 2026-07-17 | 阶段 10 | AlmaLinux 10首次容器创建 | 失败待调整 | PVE 8.4的CentOS setup插件拒绝尚未识别的AlmaLinux 10.2；创建退出255 | 配置、VMID和磁盘卷均未残留；改用PVE unmanaged模式并显式核对网络/systemd，不修改其他资源 |
| 2026-07-17 | 阶段 10 | 创建AlmaLinux 10 unmanaged容器 | 完成 | CT 9111；AlmaLinux 10.2；2 vCPU、2GB、8GB、0 swap、onboot关闭、非特权；DHCP、DNS、DNF通过 | PVE跳过不支持的发行版setup；systemd初始状态degraded，安装前核对失败单元；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | AlmaLinux 10 LXC宿主适配 | 完成 | 仅屏蔽非特权LXC不可自行挂载的mqueue/configfs/debugfs三个静态mount单元；校正容器主机名 | systemd回到running、失败单元0、DNF makecache通过；不涉及WallHub源码或禁止资源 |
| 2026-07-17 | 阶段 10 | AlmaLinux 10干净完整验证 | 完成 | 固定提交`a5b9d9a`官方源安装退出0；独立check、systemd verify、SC302三包、四模块、源码哈希和health均通过；安装日志SHA-256`f6c444f61b34c4d83b5e0813fc29b74095198e87c48447741cd170e8440747a8` | Node 22.23.1/npm 10.9.8测试256/256；Python 3.12.13测试17/17；安装器自测114/114；Pillow 12.3.0、lz4 4.4.5、.NET SDK 9.0.118/runtime 9.0.17；磁盘占用1.6GB |
| 2026-07-17 | 阶段 10 | AlmaLinux 10资源清理 | 完成 | 五份证据日志保存在工作区外且敏感信息扫描零命中；精确核对并销毁CT 9111；按原SHA-256核对后删除测试模板 | PVE临时日志、容器和本次模板均无残留；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | 创建Arch Linux验证容器 | 完成 | CT 9112；Arch rolling官方模板；2 vCPU、2GB、8GB、0 swap、onboot关闭、非特权、nesting启用 | systemd、pacman 7.1、IPv4/IPv6和DNS通过；禁止资源创建前后均运行 |
| 2026-07-17 | 阶段 10 | Arch Linux首次完整安装 | 失败待修复 | pacman 7默认下载沙箱需要内核Landlock，PVE LXC组合不支持；索引刷新失败并退出20 | 保留CT 9112诊断；不修改pacman.conf，设计进程内兼容参数回退 |
| 2026-07-17 | 阶段 10 | Arch Linux依赖续跑 | 失败待修复 | 沙箱回退生效后发现官方模板未初始化keyring；补齐标准初始化后安装Python时暴露`-Sy`部分升级造成pyexpat ABI不匹配 | 不以补装pip掩盖ABI问题；刷新策略改为先初始化keyring再执行完整`pacman -Syu` |
| 2026-07-17 | 阶段 10 | Arch Linux修复续跑 | 实现完成待干净复测 | 完整系统升级后Python ABI恢复；隔离安装、check、systemd verify、SC302三包、四模块和health通过 | Node 26.4.0/npm 12.0.1测试256/256；Python 3.14.6测试17/17；安装器121/121；ShellCheck 0.11.0通过；磁盘占用1.9GB |
| 2026-07-17 | 阶段 10 | Arch Linux修复验证提交 | 完成 | 固定提交`50f2539`；本地Node、TypeScript、Vite、Python及远端Bash/ShellCheck门禁通过 | 正常推送验证分支，未改写历史 |
| 2026-07-17 | 阶段 10 | Arch Linux故障发现资源清理 | 完成 | 六份证据日志保存在工作区外且敏感信息扫描零命中；成功续跑日志SHA-256`1fe67a35c81d41826f6801c7232c9c0012a482d1bf5395d1d0a902f7f70f7e48`；精确销毁CT 9112 | PVE临时日志已删除；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | 创建Arch Linux干净复测容器 | 完成 | CT 9113；与故障轮相同官方模板；2 vCPU、2GB、8GB、0 swap、onboot关闭、非特权、nesting启用 | 初始keyring目录确认为缺失，systemd与DNS通过；禁止资源创建前后均运行 |
| 2026-07-17 | 阶段 10 | Arch Linux干净完整复测 | 完成 | 固定提交`50f2539`首次安装退出0；日志确认keyring初始化、沙箱回退和完整系统升级；独立check、systemd verify、SC302三包、四模块、源码哈希和health均通过；安装日志SHA-256`50b9a6634d500b828aa87e7b3cfe2b489a7a2342ef7892945a9768f331de3eae` | Node 26.4.0/npm 12.0.1测试256/256；Python 3.14.6测试17/17且pyexpat ABI通过；安装器121/121；.NET SDK 9.0.119/runtime 9.0.18；磁盘占用2.1GB |
| 2026-07-17 | 阶段 10 | Arch Linux干净复测资源清理 | 完成 | 五份证据日志保存在工作区外且敏感信息扫描零命中；精确核对并销毁CT 9113 | PVE临时日志已删除；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0测试模板准备 | 完成 | Linux Containers 2026-07-09 x86_64 rootfs；签名指纹`E7FB0CAEC8173D669066514CBAEFF88C22F6E216`；SHA-256`7963e31d676e837e7a711d99df2ff9ae32fa49ac037db0724d148ea8ef972c19` | PVE官方目录仅有已过时Leap 15.6；验证当前Leap 16.0，测试完成后删除模板 |
| 2026-07-17 | 阶段 10 | 创建openSUSE Leap 16.0容器 | 完成 | CT 9114；unmanaged模式；2 vCPU、2GB、8GB、0 swap、onboot关闭、非特权、nesting启用；DNS与zypper通过 | systemd初始仅有configfs/debugfs两个LXC静态挂载失败；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0 LXC宿主适配 | 完成 | 仅屏蔽非特权LXC不可自行挂载的configfs/debugfs两个静态mount单元；校正主机名 | systemd回到running、失败单元0、官方仓库全部刷新成功；不涉及WallHub源码或禁止资源 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0首次完整安装 | 失败待修复 | Leap 16不再提供无版本`python3`包，默认解释器包名为`python313`；安装器退出20 | 基础工具正常；保留CT 9114实测版本包能力并建立修复节点 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0候选修复 | 实现完成待干净复测 | 实测`python313`提供python3且venv/pip完整；Node/npm按主版本选择；续跑隔离安装、check、systemd verify、SC302三包、四模块和health通过 | nodejs24/npm24 24.18.0/11.16.0；Python 3.13.13；Pillow 12.3.0、lz4 4.4.5；.NET便携SDK 9.0.316/runtime 9.0.18；测试256/256、121/121、17/17；ShellCheck 0.10.0通过 |
| 2026-07-17 | 阶段 10 | PVE外部重启恢复 | 完成 | 宿主在Leap修正版续跑命令建立SSH前发生外部重启；CT 9114因onboot关闭按预期停止，安装日志和退出码均不存在 | 禁止资源重启后全部运行；重新启动已登记CT，systemd/DNS/Python/zypper恢复且无安装半成品 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0修复验证提交 | 完成 | 固定提交`69bcaf8`；本地Node、TypeScript、Vite、Python及远端Bash/ShellCheck 0.10/0.11门禁通过 | 正常推送验证分支，未改写历史 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0故障资源清理 | 完成 | 持久安装日志SHA-256`95f48a960d5c4305d34df6e05459d51485a6b91cbe13e7ba122b019ae2711eb2`；六份有效证据日志敏感信息扫描零命中；精确销毁CT 9114 | PVE临时日志已删除；禁止资源状态未变；测试模板保留至干净复测完成 |
| 2026-07-17 | 阶段 10 | 创建openSUSE Leap 16.0干净复测容器 | 完成 | CT 9115；与故障轮相同签名模板；unmanaged模式、2 vCPU、2GB、8GB、0 swap、onboot关闭、非特权、nesting启用 | systemd适配后running；初始Python和Node均不存在；手工官方源刷新因CDN异常超时后终止，未安装任何包 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0国内源干净安装 | 失败待补强 | 无预装运行时完整安装退出0，版本化Python/Node/npm候选均生效；但Leap 16本地RIS服务在refresh时把repo URL重新生成回官方CDN | 安装功能通过但国内源持久性不成立；建立服务XML同步改写节点，不误记为镜像验证完成 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0 RIS镜像修复 | 实现完成待最终干净复测 | 同时备份改写真实RIS XML和repo，跳过指向同一XML的符号链接；服务刷新后5个repo保持清华URL且8个受管哈希一致 | 公开`restore-mirrors`退出0，7个原文件哈希恢复、2个安装器自有配置删除；测试125/125、256/256、17/17、ShellCheck 0.10.0通过；服务与health正常 |
| 2026-07-17 | 阶段 10 | openSUSE RIS镜像修复验证提交 | 完成 | 固定提交`e73185e`；本地Node、TypeScript、Vite、Python及远端Bash/ShellCheck 0.10门禁通过 | 正常推送验证分支，未改写历史 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0 RIS故障资源清理 | 完成 | 7份证据日志保存在工作区外且敏感信息扫描零命中；国内源重配日志SHA-256`5b4ceb2014431b0b02c719fc47aed27c4431eb54eb57c986852a59e07b734a93`；精确销毁CT 9115 | PVE临时日志已删除；禁止资源状态未变；测试模板保留至最终固定提交复测完成 |
| 2026-07-17 | 阶段 10 | 创建openSUSE Leap 16.0最终复测容器 | 完成 | CT 9116；与前两轮相同签名模板；unmanaged模式、2 vCPU、2GB、8GB、0 swap、onboot关闭、非特权、nesting启用 | systemd适配后running；Python和Node均确认不存在；DNS通过；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0最终干净复测 | 完成 | 固定提交`e73185e`国内源首次安装退出0；RIS XML、5个repo、8个受管哈希、符号链接排除、源码哈希、check、systemd verify、SC302三包、四模块和health均通过；安装日志SHA-256`200e6aa6456099e5e2b38db965e4e4755dfdb3af01d7c427c369e950dd1e23da` | Node/npm 24.18.0/11.16.0测试256/256；Python 3.13.13测试17/17；安装器125/125；.NET SDK 9.0.316/runtime 9.0.18；公开restore退出0并恢复7个原文件、删除2个自有配置；磁盘占用1.5GB |
| 2026-07-17 | 阶段 10 | openSUSE Leap 16.0最终资源清理 | 完成 | 6份证据日志保存在工作区外且敏感信息扫描零命中；精确核对并销毁CT 9116；按原SHA-256核对后删除测试模板 | PVE临时日志、容器和本次模板均无残留；禁止资源状态未变 |
| 2026-07-17 | 阶段 10 | 阶段验收与资源审计 | 完成 | Debian/Ubuntu/Fedora/RHEL兼容9/10、Arch、Leap 16矩阵通过；测试ID 9100至9116全部不存在；两个自建模板及part无残留 | 全程唯一ID、单测试LXC、2 vCPU/2GB/8GB；禁止资源100/101/102最终均运行；脱敏证据保存在工作区外 |
| 2026-07-17 | 阶段 11 | Android Termux临时认证与基线 | 完成 | Android 16、ARM64、Termux 0.118.39、包名com.termux；测试前源为清华Termux镜像；磁盘可用25GB | APK release元数据为UNKNOWN，不猜测F-Droid/GitHub来源；Git/Node/Python/.NET/Proot/termux-services均未安装 |
| 2026-07-17 | 阶段 11 | 手机既有环境登记 | 完成 | 现有Proot 0；WallHub代码、数据、配置三路径均不存在 | 测试结束仅清理本次创建内容并恢复测试前清华源状态 |
| 2026-07-17 | 阶段 11 | 原生Termux双镜像dry-run | 完成 | 固定提交`cf60128`；官方源和国内源参数均退出0；dpkg状态、APT配置、WallHub三路径和Proot列表在前/中/后三次快照SHA-256一致 | 脱敏日志SHA-256：官方`c43f4d33b841b6e310516be02ff2644656f2e4646c5534d3eeff49df9fb61770`，国内`e4924e2e0728a22398f34f318b4e370af8ba325fe24f5e05cc18fbb42b760d6d`；敏感信息扫描零命中 |
| 2026-07-17 | 阶段 11 | 原生Termux官方源准备 | 完成 | 测试前清华源与受限验证目录备份SHA-256一致，权限和所有者已记录；官方源刷新退出0 | ARM64候选：.NET SDK 9.0.18、Node 24.17.0、Python 3.14.6、termux-services 0.13；证据日志SHA-256`48ab87218b92b95160af29c4f8a9a5fb9fb050b7f8e5bfd5a20b1adaf57eaf85` |
| 2026-07-17 | 阶段 11 | 原生Termux官方源完整安装 | 完成 | 固定提交`cf60128`安装退出0；Python wheel失败后源码构建回退成功；runit与health通过 | Node/npm 24.17.0/11.18.0、Python 3.14.6、.NET SDK 9.0.119/runtime 9.0.18；安装日志SHA-256`a4db6b81b152dcb29db884cf624badc663f7138726d9e5d4a4e542e112e35d72`且敏感信息零命中 |
| 2026-07-17 | 阶段 11 | 原生Termux独立能力探测 | 完成 | 四模块由check能力探测通过；绝对路径sv为run、health为ok、public有效；.NET 9 console真实编译运行输出成功 | 能力日志SHA-256`dfdd7e7e9d7f43e9ec2d9b56e69d36849d830bb606d1d2f1ed77715f3123681a`；check同时暴露独立runit路径缺陷并单独登记 |
| 2026-07-17 | 阶段 11/12 | 原生Termux runit维护状态故障 | 失败待修复 | 完整安装和health退出0；独立`check`退出40，但同一时刻绝对路径`sv status`为run且health为ok | 新维护进程无`SVDIR`，`sv status wallhub`无法解析服务；能力探测确认Node 24.17.0、Python 3.14.6、.NET SDK 9.0.119/runtime 9.0.18及真实console编译运行均正常 |
| 2026-07-17 | 阶段 12 | Termux runit绝对路径候选修复 | 实现完成待真机复测 | install/check/update/uninstall统一使用绝对服务路径，`sv-enable`显式传入`SVDIR`；原生Termux Bash语法和安装器测试128/128 | 新增安装、无SVDIR状态、restart、stop路径断言；Node 256/256、TypeScript、Vite 2031模块、Python 17/17及py_compile、ShellCheck 0.11零告警通过；安装器日志SHA-256`4714009d7df4a9844d00f18ee6ba7036d22c347f5ea1075ba8c5780659a7ea30` |
| 2026-07-17 | 阶段 12 | Termux runit修复真机复测 | 完成 | 固定提交`03a0199`执行隔离update退出0并通过health；随后新SSH进程执行check退出0，绝对路径sv状态为run | Raw脚本与本地SHA-256一致；脱敏复测日志SHA-256`68592e81efc35d6edf845982f2e669dda1c59e37ddf34576a2ddefeb67e3960f`，敏感信息扫描零命中 |
| 2026-07-17 | 阶段 11 | Termux runit生命周期与项目测试 | 完成 | restart、stop、health不可达、start、repair、check全通过；安装后Node 256/256、Python 17/17、安装器129/129 | 生命周期日志SHA-256`86a7a66e501e1d696f419d139a85625f4fc5fa3384eb5e41a6630fc5a025d95a`；三份测试日志敏感信息扫描零命中 |
| 2026-07-17 | 阶段 11 | Termux双SteamKit运行时 | 完成 | JSON进度与分块在线播放运行时均成功构建；两个`DepotDownloader.dll -V`均返回3.4.0和.NET 9.0.18 | 脱敏日志SHA-256`84af1436eae7946f41c4ee9bb9d83c978cf090e8bc7f25fd7e7a8a98859b9f1c`；同时发现首次空设置文件告警并建立独立修复节点 |
| 2026-07-17 | 阶段 12 | 初始设置JSON候选修复 | 实现完成待真机复测 | 缺失或零长度普通文件初始化为`{}`，非空文件保持逐字节不变，异常符号链接不跟随覆盖；新增三组回归断言 | 原生Termux安装器131/131、Node 256/256、TypeScript、Vite、Python 17/17、py_compile及ShellCheck 0.11零告警通过；脱敏安装器日志SHA-256`b6db9df23b1da5cab2d90b0d695832e2b4b9515f562410b689f3e69895bbf542` |
| 2026-07-17 | 阶段 12 | 初始设置JSON真机复测 | 完成 | 固定提交`5075be5`更新后设置文件由0字节变为合法`{}`；显式双运行时命令输出设置加载成功且无解析告警 | update、双运行时、check与health均退出0；脱敏日志SHA-256`2e5d82aa9adc65d05efb5355c1efc4e624ac8f3b834af48e660c27ddd85a9d42`，敏感信息扫描零命中 |
| 2026-07-17 | 阶段 11/12 | Termux任意镜像转清华缺陷 | 失败待修复 | 官方源完整安装期间`pkg`因一次可用性探测自动选到其他镜像；现有国内源逻辑只替换固定官方域名 | 直接执行国内源会刷新成功但URL不变；需按Termux仓库suite/component识别主、root和x11仓库并保留其他仓库 |
| 2026-07-17 | 阶段 11 | Termux public重建路径 | 完成 | 固定提交`5075be5`执行`update --build-ui`，完整npm ci、Vite构建、production prune、check和health均退出0 | public 3个根引用全部存在；脱敏日志SHA-256`24e624921c3b2cfecb046cc67ac2cd5ef92916171e369cb9a7c193ea391962df` |
| 2026-07-17 | 阶段 12 | Termux任意镜像候选修复 | 实现完成待真机复测 | 按suite/component识别main、root和x11，不依赖当前镜像域名；TUR等无映射仓库保持不变；备份可逐字节恢复 | 原生Termux安装器134/134、Node 256/256、TypeScript、Vite、Python 17/17、py_compile及ShellCheck 0.11零告警通过；脱敏安装器日志SHA-256`5182795f169e9238fa123e1e6e0fda4211475aa7db4d0f96387be47ab624545b` |
| 2026-07-17 | 阶段 12 | Termux任意镜像真机复测 | 完成 | 固定提交`87106cd`把第三方主镜像切到清华并完成安装/check；主源、pip、npm和受管备份均核验 | 公开restore退出0，源文件SHA-256逐字节恢复、pip/npm自有配置删除、health保持正常；脱敏日志SHA-256`f2b344f4d9ceab4922529bf2e5d51c0dd13f7b8d00f078d00c0bcbb7bd18a5e4` |
| 2026-07-17 | 阶段 11 | Termux微软glibc .NET回退实测 | 完成 | 官方脚本实际下载并解压Linux ARM64 SDK 9.0.316共213232357字节，脚本退出0；其`dotnet --info`在bionic真实退出127并报告缺少所需加载器 | 隔离目录由trap删除；脱敏日志SHA-256`5b445cd1b307c37e5fc9709ea52db168a89958efac910d20cc7ac89536b077d4` |
| 2026-07-17 | 阶段 11 | Termux .NET严格失败分支 | 完成 | 原生包与官方安装均失败、官方安装成功但运行探测失败两条受控分支均退出20；诊断分别指出bionic不兼容和Debian/Ubuntu Proot | 不自动创建或切换Proot；分支证据日志SHA-256`4ddce538eb7462b9126cc09e25a9ba22db8c8bc95ac1b0f01359dd596a4ada80` |
| 2026-07-17 | 阶段 11/12 | Termux连续卸载purge故障 | 失败待修复 | 默认卸载退出0并正确保留data/config；紧接purge在服务已删除时产生sv噪声，并因持久日志与rm并发重建配置目录而退出20 | code、service已删除且data已进入purge清理，config/state仍保留；保留失败现场用于修复后续跑，不手工伪造成功 |
| 2026-07-17 | 阶段 12 | Termux连续purge候选修复 | 实现完成待现场复测 | 缺失runit服务不再调用sv；删除config前把后续日志切到受限临时文件，消除tee重建竞态；真实持久日志回归测试通过 | 原生Termux安装器135/135、Node 256/256、TypeScript、Vite、Python 17/17、py_compile及ShellCheck 0.11零告警通过；脱敏测试日志SHA-256`cc327d05267d059a2068794edd416240195e661602a97208622216daf6af8e7b` |

## 八、远程测试资源登记

不得在公开文档中记录真实主机地址、SSH端口、用户名或密码。使用会话内临时配置连接。

| 平台 | 资源标识 | 测试前已存在 | 本次创建 | 所有者标记 | 清理状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| PVE | 新建测试 ID 待逐个登记 | 否 | 待创建 | `wallhub-installer-validation` | 待填写 | 既有ID 100/101/102 已只读确认并禁止操作 |
| PVE | CT 9100 / Debian 13 故障发现轮 | 否 | 是 | `wallhub-installer-validation-debian13` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘；完成故障发现和维护生命周期验证后清理 |
| PVE | CT 9101 / Debian 13 干净复测 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭；完整安装与独立检查通过后清理 |
| PVE | CT 9102 / Debian 12 旧基线故障发现轮 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭；完成兼容修复与维护生命周期验证后清理 |
| PVE | CT 9103 / Debian 12 干净复测 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权；固定验证提交`d6a78f8` |
| PVE | CT 9104 / Ubuntu 26.04 LTS故障发现轮 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权；诊断确认当前PVE组合需`nesting=1` |
| PVE | CT 9105 / Ubuntu 26.04 LTS干净复测 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权、`nesting=1`；固定提交`6ca7489` |
| PVE | CT 9106 / Ubuntu 22.04旧基线故障发现轮 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权；完成国内源、venv自愈与原地卸载验证后清理 |
| PVE | CT 9107 / Ubuntu 22.04旧基线干净复测 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权；国内源原地安装，固定提交`b5a6f20` |
| PVE | CT 9108 / Fedora 43 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权、`nesting=1`；官方源隔离安装 |
| PVE | CT 9109 / Rocky Linux 9旧基线故障发现轮 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权；完成DNF repo修复、官方源完整安装和国内源失败恢复验证后清理 |
| PVE | CT 9110 / Rocky Linux 9旧基线干净复测 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权；固定验证提交`a5b9d9a` |
| PVE | CT 9111 / AlmaLinux 10当前RHEL兼容系 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | unmanaged模式；2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权；固定验证提交`a5b9d9a`；测试模板已删除 |
| PVE | CT 9112 / Arch Linux故障发现轮 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权、nesting启用；完成pacman兼容修复与续跑验证后清理 |
| PVE | CT 9113 / Arch Linux干净复测 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | 2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权、nesting启用；固定验证提交`50f2539` |
| PVE | CT 9114 / openSUSE Leap 16.0故障发现轮 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | unmanaged模式；2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权、nesting启用；完成版本化运行时候选修复后清理 |
| PVE | CT 9115 / openSUSE Leap 16.0干净复测与RIS故障发现轮 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | unmanaged模式、2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权、nesting启用；完成版本化运行时和RIS服务镜像修复后清理 |
| PVE | CT 9116 / openSUSE Leap 16.0最终干净复测 | 否 | 是 | `wallhub-installer-validation` | 已销毁 | unmanaged模式、2 vCPU、2GB RAM、8GB磁盘、0 swap、onboot关闭、非特权、nesting启用；固定验证提交`e73185e`；测试模板已删除 |
| Termux | 原生环境 / ARM64 / 0.118.39 | 是 | 否 | - | 不删除 | 测试前无WallHub；仓库已是清华镜像；仅清理本次安装内容 |
| Termux Proot | 测试前无已安装发行版 | 否 | 待创建 | `wallhub-installer-validation` | 待创建 | 后续仅创建并清理本次Debian/Ubuntu Proot |

## 九、已知限制与失败原则

- [ ] 微软官方 Linux `.NET` 构建依赖 glibc，原生 Termux 使用 Android bionic；官方脚本下载成功不代表可运行。
- [ ] 某些 Python/架构组合可能没有预编译 wheel；源码构建仍失败时完整功能门禁必须失败。
- [ ] GitHub第三方加速地址可能失效；必须保留直连回退和明确诊断。
- [ ] SC302需要证书、端口和内核能力；本脚本只安装依赖，不保证其在Termux/Proot中可运行。
- [ ] `/health` 只表示WallHub HTTP服务健康，不表示Steam登录、DepotDownloader或在线播放运行时已就绪。
- [ ] 无Steam测试账号时，自动验证不覆盖真实账号登录和付费内容下载。
