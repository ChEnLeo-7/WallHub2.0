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

- [ ] 阶段 9 完成。
- [x] 创建 `installer-validation` 分支，不改写远端历史。
- [ ] 提交 MIT LICENSE、最小源码、public、文档和 install.sh。
- [ ] 确认提交不包含 `.hermes/`、NuGet 本地状态、个人文件或秘密。
- [ ] 推送验证分支并验证 Raw install.sh 可访问。
- [ ] 在全新临时目录执行远程脚本 dry-run。
- [ ] 记录验证分支 commit SHA，所有远程测试固定使用该 SHA 或分支。

## 阶段 10：PVE x86_64 LXC验证

- [ ] 阶段 10 完成。
- [ ] 使用临时受限 askpass 连接；密码不进入仓库、命令参数和日志。
- [ ] 只读记录现有节点、存储、网络桥、模板和 VM/CT ID。
- [ ] 明确登记现有 ID `100`、`101`、`102` 为禁止操作资源。
- [ ] 每个测试 LXC 使用唯一新 ID 和 `wallhub-installer-validation` 标记。
- [ ] 每次只运行一个 LXC，资源为2 vCPU、2GB内存、8GB磁盘。
- [ ] 验证当前稳定 Debian 和 Debian 12 旧基线。
- [ ] 验证当前 Ubuntu LTS 和 Ubuntu 22.04 旧基线。
- [ ] 验证当前 Fedora。
- [ ] 验证当前 RHEL兼容发行版和9系旧基线。
- [ ] 验证当前 Arch。
- [ ] 验证当前 openSUSE Leap。
- [ ] 覆盖官方源与国内源。
- [ ] 覆盖隔离安装与原地安装。
- [ ] 验证服务、health、check、repair、update、uninstall和源恢复。
- [ ] 保存脱敏日志、版本和最低成功资源记录。
- [ ] 只销毁资源登记表中本次创建的 LXC，并确认禁止操作资源未改变。

## 阶段 11：Android ARM64 Termux验证

- [ ] 阶段 11 完成。
- [ ] 使用临时受限 askpass 连接，不记录密码和私网地址。
- [ ] 记录测试前 Termux 版本、仓库、架构、已安装包和现有 Proot 列表。
- [ ] 验证官方 F-Droid/GitHub Termux 环境识别。
- [ ] 验证原生 Termux 官方源和国内源路径。
- [ ] 验证原生 `.NET 9` 包搜索及微软官方脚本回退。
- [ ] 若 bionic 下不可运行，确认脚本严格失败且诊断准确，不标记完整安装成功。
- [ ] 验证 Debian Proot ARM64 完整安装和服务健康。
- [ ] 验证 Ubuntu Proot 参数、镜像和依赖分支；至少完成 dry-run和静态检查。
- [ ] 验证 Termux runit 与 Proot PID 服务管理。
- [ ] 验证 Python四模块和public复用/重建路径。
- [ ] 只清理本次创建的安装目录或 Proot；不删除测试前已存在的环境和用户数据。
- [ ] 恢复本脚本修改的镜像配置并核对测试前后差异。

## 阶段 12：修复循环、main发布与最终验收

- [ ] 阶段 12 完成。
- [ ] 每个远程失败建立独立未勾选修复节点，记录平台、阶段和脱敏证据。
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

## 八、远程测试资源登记

不得在公开文档中记录真实主机地址、SSH端口、用户名或密码。使用会话内临时配置连接。

| 平台 | 资源标识 | 测试前已存在 | 本次创建 | 所有者标记 | 清理状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| PVE | 待填写 | - | - | `wallhub-installer-validation` | 待填写 | 禁止操作既有ID 100/101/102 |
| Termux | 原生环境 | 是 | 否 | - | 不删除 | 只清理本次WallHub安装内容 |
| Termux Proot | 待填写 | 待检查 | 待检查 | `wallhub-installer-validation` | 待填写 | 不删除测试前已有Proot |

## 九、已知限制与失败原则

- [ ] 微软官方 Linux `.NET` 构建依赖 glibc，原生 Termux 使用 Android bionic；官方脚本下载成功不代表可运行。
- [ ] 某些 Python/架构组合可能没有预编译 wheel；源码构建仍失败时完整功能门禁必须失败。
- [ ] GitHub第三方加速地址可能失效；必须保留直连回退和明确诊断。
- [ ] SC302需要证书、端口和内核能力；本脚本只安装依赖，不保证其在Termux/Proot中可运行。
- [ ] `/health` 只表示WallHub HTTP服务健康，不表示Steam登录、DepotDownloader或在线播放运行时已就绪。
- [ ] 无Steam测试账号时，自动验证不覆盖真实账号登录和付费内容下载。
