#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

INSTALLER_VERSION="0.1.0"
STATE_VERSION="1"
DEFAULT_REPO="https://github.com/ChEnLeo-7/WallHub2.0.git"
DEFAULT_BRANCH="main"
DEFAULT_PORT="3090"
MIN_NODE_VERSION="16.17.0"
MIN_PYTHON_VERSION="3.7.0"

EXIT_USAGE=2
EXIT_UNSUPPORTED=10
EXIT_DEPENDENCY=20
EXIT_SOURCE=30
EXIT_SERVICE=40
EXIT_HEALTH=50

COMMAND="install"
TARGET="auto"
PROOT_DISTRO="debian"
MIRROR=""
LAYOUT=""
REPO="$DEFAULT_REPO"
BRANCH="$DEFAULT_BRANCH"
INSTALL_DIR=""
DATA_DIR=""
BUILD_UI=0
SC302_DEPS=""
NON_INTERACTIVE=0
ASSUME_YES=0
LANGUAGE=""
VERBOSE=0
DRY_RUN=0
PURGE=0

CURRENT_STAGE="bootstrap"
TEMP_DIR=""
LOG_FILE=""
CONFIG_DIR=""
STATE_FILE=""
MIRROR_MANIFEST=""
OS_RELEASE_FILE="${WALLHUB_OS_RELEASE_FILE:-/etc/os-release}"
OS_ID=""
OS_ID_LIKE=""
OS_CODENAME=""
OS_FAMILY=""
PKG_MANAGER=""
ARCH=""
ENVIRONMENT=""
SERVICE_KIND=""
SERVICE_USER=""
SERVICE_GROUP=""
NODE_BIN=""
NPM_BIN=""
PYTHON_BIN=""
DOTNET_BIN=""
DOTNET_ROOT_DIR=""
TOOLCHAIN_DIR=""
SOURCE_DIR=""
ROLLBACK_DIR=""
FORCE_REMOTE_SOURCE=0
UPDATE_IN_PROGRESS=0
UPDATE_SERVICE_STOPPED=0
GOOGLE_REACHABLE="unknown"
PACKAGE_INDEX_UPDATED=0

declare -a ROOT_PREFIX=()
declare -a TEMP_PATHS=()

usage() {
  cat <<'EOF'
WallHub cross-platform installer

Usage:
  install.sh [install|check|repair|update|uninstall|restore-mirrors] [options]

Options:
  --target auto|linux|termux|proot
  --proot-distro debian|ubuntu
  --mirror official|china
  --layout isolated|in-place
  --repo URL
  --branch NAME
  --install-dir PATH
  --data-dir PATH
  --build-ui
  --sc302-deps yes|no
  --non-interactive
  --yes
  --lang zh|en
  --verbose
  --dry-run
  --purge                 Remove installer-managed data during uninstall.
  --help
EOF
}

is_command() {
  case "${1:-}" in
    install|check|repair|update|uninstall|restore-mirrors) return 0 ;;
    *) return 1 ;;
  esac
}

require_value() {
  local option="$1" value="${2:-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    printf 'Missing value for %s\n' "$option" >&2
    exit "$EXIT_USAGE"
  fi
}

parse_args() {
  if (($# > 0)) && is_command "$1"; then
    COMMAND="$1"
    shift
  fi
  while (($# > 0)); do
    case "$1" in
      --target) require_value "$1" "${2:-}"; TARGET="$2"; shift 2 ;;
      --proot-distro) require_value "$1" "${2:-}"; PROOT_DISTRO="$2"; shift 2 ;;
      --mirror) require_value "$1" "${2:-}"; MIRROR="$2"; shift 2 ;;
      --layout) require_value "$1" "${2:-}"; LAYOUT="$2"; shift 2 ;;
      --repo) require_value "$1" "${2:-}"; REPO="$2"; shift 2 ;;
      --branch) require_value "$1" "${2:-}"; BRANCH="$2"; shift 2 ;;
      --install-dir) require_value "$1" "${2:-}"; INSTALL_DIR="$2"; shift 2 ;;
      --data-dir) require_value "$1" "${2:-}"; DATA_DIR="$2"; shift 2 ;;
      --build-ui) BUILD_UI=1; shift ;;
      --sc302-deps) require_value "$1" "${2:-}"; SC302_DEPS="$2"; shift 2 ;;
      --non-interactive) NON_INTERACTIVE=1; shift ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      --lang) require_value "$1" "${2:-}"; LANGUAGE="$2"; shift 2 ;;
      --verbose) VERBOSE=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --purge) PURGE=1; shift ;;
      --help|-h) usage; exit 0 ;;
      --version) printf '%s\n' "$INSTALLER_VERSION"; exit 0 ;;
      *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit "$EXIT_USAGE" ;;
    esac
  done

  case "$TARGET" in auto|linux|termux|proot) ;; *) usage_error "invalid --target: $TARGET" ;; esac
  case "$PROOT_DISTRO" in debian|ubuntu) ;; *) usage_error "invalid --proot-distro: $PROOT_DISTRO" ;; esac
  if [[ -n "$MIRROR" ]]; then case "$MIRROR" in official|china) ;; *) usage_error "invalid --mirror: $MIRROR" ;; esac; fi
  if [[ -n "$LAYOUT" ]]; then case "$LAYOUT" in isolated|in-place) ;; *) usage_error "invalid --layout: $LAYOUT" ;; esac; fi
  if [[ -n "$SC302_DEPS" ]]; then case "$SC302_DEPS" in yes|no) ;; *) usage_error "invalid --sc302-deps: $SC302_DEPS" ;; esac; fi
  if [[ -n "$LANGUAGE" ]]; then case "$LANGUAGE" in zh|en) ;; *) usage_error "invalid --lang: $LANGUAGE" ;; esac; fi
  if printf '%s\n' "$REPO" | grep -Eqi 'https?://[^/[:space:]]+:[^/@[:space:]]+@|[?&](token|access_token|api_key|signature|sig)='; then
    usage_error "--repo must not contain embedded credentials or signed secret query parameters; use a Git credential helper"
  fi
}

usage_error() {
  printf 'WallHub installer: %s\n' "$1" >&2
  exit "$EXIT_USAGE"
}

select_language() {
  if [[ -n "$LANGUAGE" ]]; then return; fi
  local locale="${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}"
  if [[ "$locale" == zh* || "$locale" == *"_CN"* || "$locale" == *"_TW"* || "$locale" == *"_HK"* ]]; then
    LANGUAGE="zh"
  else
    LANGUAGE="en"
  fi
}

message() {
  local key="$1"
  if [[ "$LANGUAGE" == "zh" ]]; then
    case "$key" in
      start) printf 'WallHub 跨平台安装器 %s' "$INSTALLER_VERSION" ;;
      failure) printf '安装器在阶段“%s”失败' "$CURRENT_STAGE" ;;
      diagnostics) printf '诊断日志：%s' "$LOG_FILE" ;;
      repair_hint) printf '修复后可运行：install.sh repair' ;;
      no_tty) printf '交互模式需要 /dev/tty；请改用 --non-interactive 并明确参数' ;;
      unsupported) printf '不支持当前平台或架构' ;;
      health_ok) printf 'WallHub 健康检查通过' ;;
      install_ok) printf 'WallHub 安装完成' ;;
      dry_run) printf '演练模式' ;;
      prompt_target) printf '目标环境 [auto/linux/termux/proot]' ;;
      prompt_proot) printf 'Proot 发行版 [debian/ubuntu]' ;;
      prompt_mirror) printf '软件源 [official/china]' ;;
      prompt_layout) printf '安装布局 [isolated/in-place]' ;;
      prompt_sc302) printf '仅安装 Steamcommunity_302 的系统依赖 [yes/no]' ;;
      *) printf '%s' "$key" ;;
    esac
  else
    case "$key" in
      start) printf 'WallHub cross-platform installer %s' "$INSTALLER_VERSION" ;;
      failure) printf 'Installer failed during stage "%s"' "$CURRENT_STAGE" ;;
      diagnostics) printf 'Diagnostic log: %s' "$LOG_FILE" ;;
      repair_hint) printf 'After correcting the issue, run: install.sh repair' ;;
      no_tty) printf 'Interactive mode requires /dev/tty; use --non-interactive with explicit options' ;;
      unsupported) printf 'This platform or architecture is unsupported' ;;
      health_ok) printf 'WallHub health check passed' ;;
      install_ok) printf 'WallHub installation completed' ;;
      dry_run) printf 'dry run' ;;
      prompt_target) printf 'Target environment [auto/linux/termux/proot]' ;;
      prompt_proot) printf 'Proot distribution [debian/ubuntu]' ;;
      prompt_mirror) printf 'Package mirror [official/china]' ;;
      prompt_layout) printf 'Installation layout [isolated/in-place]' ;;
      prompt_sc302) printf 'Install Steamcommunity_302 system dependencies only [yes/no]' ;;
      *) printf '%s' "$key" ;;
    esac
  fi
}

redact() {
  sed -E \
    -e 's#(https?://)[^/@[:space:]]+:[^/@[:space:]]+@#\1[redacted]@#g' \
    -e 's#((password|passwd|token|secret|api[_-]?key)[=:])[[:graph:]]+#\1[redacted]#Ig'
}

log() {
  local level="$1"; shift
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*"
  printf '%s\n' "$line" | redact >&2
  if [[ -n "$LOG_FILE" ]]; then printf '%s\n' "$line" | redact >>"$LOG_FILE"; fi
}

debug() {
  if ((VERBOSE)); then log DEBUG "$*"; fi
}

stage() {
  CURRENT_STAGE="$1"
  log STAGE "$CURRENT_STAGE"
}

die() {
  local code="$1"; shift
  log ERROR "$*"
  recover_failed_update
  log ERROR "$(message failure)"
  [[ -n "$LOG_FILE" ]] && log ERROR "$(message diagnostics)"
  log ERROR "$(message repair_hint)"
  exit "$code"
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  local path
  for path in "${TEMP_PATHS[@]:-}"; do
    if [[ -n "$path" && -d "$path" && "$path" == "${TMPDIR:-/tmp}"/wallhub-installer.* ]]; then
      rm -rf -- "$path" 2>/dev/null || true
    fi
  done
  exit "$code"
}

on_signal() {
  log WARN "Interrupted"
  exit 130
}

on_error() {
  local original_code="$1" line="$2" mapped="$EXIT_DEPENDENCY"
  trap - ERR
  case "$CURRENT_STAGE" in
    source-*|npm-*|public-*) mapped="$EXIT_SOURCE" ;;
    service-*|runtime-environment) mapped="$EXIT_SERVICE" ;;
    health-check) mapped="$EXIT_HEALTH" ;;
  esac
  log ERROR "Unexpected command failure at line $line (status $original_code)"
  recover_failed_update
  log ERROR "$(message failure)"
  [[ -n "$LOG_FILE" ]] && log ERROR "$(message diagnostics)"
  log ERROR "$(message repair_hint)"
  exit "$mapped"
}

recover_failed_update() {
  ((UPDATE_IN_PROGRESS && UPDATE_SERVICE_STOPPED)) || return 0
  set +e
  if [[ "$LAYOUT" == "isolated" && -n "$ROLLBACK_DIR" && -d "$ROLLBACK_DIR" ]]; then
    log WARN "Update failed; restoring the previous installer-managed source"
    rollback_source
  else
    log WARN "Update failed; restarting the existing service"
    service_action start
  fi
  set -e
  UPDATE_IN_PROGRESS=0
  UPDATE_SERVICE_STOPPED=0
}

trap cleanup EXIT
trap on_signal INT TERM
trap 'on_error $? $LINENO' ERR

init_temp() {
  local base="${TMPDIR:-/tmp}"
  TEMP_DIR="$(mktemp -d "$base/wallhub-installer.XXXXXXXX")" || exit "$EXIT_DEPENDENCY"
  TEMP_PATHS+=("$TEMP_DIR")
  LOG_FILE="$TEMP_DIR/install.log"
  : >"$LOG_FILE"
  chmod 600 "$LOG_FILE" 2>/dev/null || true
}

open_tty() {
  if ((NON_INTERACTIVE)); then return; fi
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then die "$EXIT_USAGE" "$(message no_tty)"; fi
  exec 3<>/dev/tty
}

ask_choice() {
  local variable="$1" prompt="$2" default="$3" allowed="$4" value=""
  if ((NON_INTERACTIVE)); then printf -v "$variable" '%s' "$default"; return; fi
  while true; do
    printf '%s (%s): ' "$prompt" "$default" >&3
    IFS= read -r value <&3 || die "$EXIT_USAGE" "$(message no_tty)"
    value="${value:-$default}"
    if [[ " $allowed " == *" $value "* ]]; then printf -v "$variable" '%s' "$value"; return; fi
    printf 'Invalid value: %s\n' "$value" >&3
  done
}

ask_yes_twice() {
  local prompt="$1" first="" second=""
  if ((ASSUME_YES)); then return 0; fi
  if ((NON_INTERACTIVE)); then return 1; fi
  printf '%s [yes/no]: ' "$prompt" >&3; IFS= read -r first <&3 || return 1
  [[ "$first" == "yes" ]] || return 1
  printf 'Type yes again to confirm: ' >&3; IFS= read -r second <&3 || return 1
  [[ "$second" == "yes" ]]
}

version_ge() {
  local left="${1#v}" right="${2#v}" IFS=.
  local -a a=() b=()
  local i x y
  read -r -a a <<<"$left"
  read -r -a b <<<"$right"
  for i in 0 1 2 3; do
    x="${a[$i]:-0}"; y="${b[$i]:-0}"
    x="${x%%[^0-9]*}"; y="${y%%[^0-9]*}"
    ((10#${x:-0} > 10#${y:-0})) && return 0
    ((10#${x:-0} < 10#${y:-0})) && return 1
  done
  return 0
}

command_path() {
  command -v "$1" 2>/dev/null || true
}

run() {
  if ((DRY_RUN)); then
    log DRYRUN "$(printf '%q ' "$@")"
    return 0
  fi
  debug "run: $(printf '%q ' "$@")"
  "$@" > >(tee -a "$LOG_FILE") 2> >(tee -a "$LOG_FILE" >&2)
}

run_quiet() {
  if ((DRY_RUN)); then log DRYRUN "$(printf '%q ' "$@")"; return 0; fi
  debug "run: $(printf '%q ' "$@")"
  "$@" >>"$LOG_FILE" 2>&1
}

as_root() {
  if ((DRY_RUN)); then log DRYRUN "root: $(printf '%q ' "$@")"; return 0; fi
  if ((${#ROOT_PREFIX[@]})); then run "${ROOT_PREFIX[@]}" "$@"; else run "$@"; fi
}

as_root_quiet() {
  if ((DRY_RUN)); then log DRYRUN "root: $(printf '%q ' "$@")"; return 0; fi
  if ((${#ROOT_PREFIX[@]})); then run_quiet "${ROOT_PREFIX[@]}" "$@"; else run_quiet "$@"; fi
}

read_os_release() {
  [[ -r "$OS_RELEASE_FILE" ]] || return 1
  OS_ID="$(sed -n 's/^ID=//p' "$OS_RELEASE_FILE" | head -n1 | tr -d '"' | tr '[:upper:]' '[:lower:]')"
  OS_ID_LIKE="$(sed -n 's/^ID_LIKE=//p' "$OS_RELEASE_FILE" | head -n1 | tr -d '"' | tr '[:upper:]' '[:lower:]')"
  OS_CODENAME="$(sed -n -e 's/^VERSION_CODENAME=//p' -e 's/^UBUNTU_CODENAME=//p' "$OS_RELEASE_FILE" | head -n1 | tr -d '"')"
  [[ -n "$OS_ID" ]]
}

detect_environment() {
  local machine="${WALLHUB_UNAME_M:-$(uname -m 2>/dev/null || true)}"
  case "$machine" in
    x86_64|amd64) ARCH="x86_64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) die "$EXIT_UNSUPPORTED" "$(message unsupported): architecture=$machine" ;;
  esac

  local native_termux=0 proot_hint=0
  [[ -n "${TERMUX_VERSION:-}" && "${PREFIX:-}" == *"com.termux"* ]] && native_termux=1
  [[ -n "${PROOT_TMP_DIR:-}" || -n "${PROOT_LOADER:-}" || -e /.proot-distro ]] && proot_hint=1
  if ((native_termux && !proot_hint)); then ENVIRONMENT="termux"; else ENVIRONMENT="linux"; fi
  if ((proot_hint)); then ENVIRONMENT="proot"; fi

  if [[ "$TARGET" == "auto" ]]; then TARGET="$ENVIRONMENT"; fi
  if [[ "$TARGET" == "linux" && "$ENVIRONMENT" == "termux" ]]; then
    die "$EXIT_UNSUPPORTED" "Native Termux cannot be treated as glibc Linux"
  fi
  if [[ "$TARGET" == "termux" && "$ENVIRONMENT" != "termux" ]]; then
    die "$EXIT_UNSUPPORTED" "--target termux requires native Termux"
  fi
  if [[ "$TARGET" == "proot" && "$ENVIRONMENT" == "linux" ]]; then ENVIRONMENT="proot"; fi

  if [[ "$ENVIRONMENT" == "termux" ]]; then
    OS_ID="termux"; OS_FAMILY="termux"; PKG_MANAGER="pkg"
    local termux_version="${TERMUX_VERSION:-0}"
    if ! version_ge "$termux_version" "0.118.0"; then
      die "$EXIT_UNSUPPORTED" "Old Google Play Termux detected ($termux_version). Install the current F-Droid or GitHub release."
    fi
  else
    read_os_release || die "$EXIT_UNSUPPORTED" "Cannot read $OS_RELEASE_FILE"
    case " $OS_ID $OS_ID_LIKE " in
      *" debian "*|*" ubuntu "*) OS_FAMILY="debian"; PKG_MANAGER="apt" ;;
      *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*) OS_FAMILY="fedora"; PKG_MANAGER="dnf" ;;
      *" arch "*|*" manjaro "*) OS_FAMILY="arch"; PKG_MANAGER="pacman" ;;
      *" suse "*|*" opensuse "*) OS_FAMILY="suse"; PKG_MANAGER="zypper" ;;
      *) die "$EXIT_UNSUPPORTED" "$(message unsupported): ID=$OS_ID ID_LIKE=$OS_ID_LIKE" ;;
    esac
  fi
  debug "environment=$ENVIRONMENT target=$TARGET os=$OS_ID family=$OS_FAMILY arch=$ARCH package_manager=$PKG_MANAGER"
}

configure_privilege() {
  ROOT_PREFIX=()
  if [[ "$ENVIRONMENT" == "termux" ]]; then return; fi
  if [[ "$(id -u)" == "0" ]]; then return; fi
  if command -v sudo >/dev/null 2>&1; then ROOT_PREFIX=(sudo); return; fi
  die "$EXIT_DEPENDENCY" "Root or sudo is required for system packages and services"
}

interactive_defaults() {
  if [[ -z "$MIRROR" ]]; then MIRROR="official"; fi
  if [[ -z "$LAYOUT" ]]; then LAYOUT="isolated"; fi
  if [[ -z "$SC302_DEPS" ]]; then SC302_DEPS="no"; fi
  if ((NON_INTERACTIVE)); then return; fi

  local selected="$TARGET"
  ask_choice selected "$(message prompt_target)" "$TARGET" "auto linux termux proot"
  TARGET="$selected"
  detect_environment
  if [[ "$TARGET" == "proot" && "$ENVIRONMENT" == "termux" ]]; then
    ask_choice PROOT_DISTRO "$(message prompt_proot)" "$PROOT_DISTRO" "debian ubuntu"
  fi
  ask_choice MIRROR "$(message prompt_mirror)" "$MIRROR" "official china"
  ask_choice LAYOUT "$(message prompt_layout)" "$LAYOUT" "isolated in-place"
  ask_choice SC302_DEPS "$(message prompt_sc302)" "$SC302_DEPS" "yes no"
}

resolve_paths() {
  if [[ "$ENVIRONMENT" == "termux" ]]; then
    CONFIG_DIR="${PREFIX}/etc/wallhub-installer"
    [[ -n "$INSTALL_DIR" ]] || INSTALL_DIR="$HOME/.local/share/wallhub"
    [[ -n "$DATA_DIR" ]] || DATA_DIR="$HOME/.local/state/wallhub"
  elif [[ "$ENVIRONMENT" == "proot" ]]; then
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/wallhub-installer"
    if [[ "$LAYOUT" == "in-place" ]]; then
      [[ -n "$INSTALL_DIR" ]] || INSTALL_DIR="$PWD"
      [[ -n "$DATA_DIR" ]] || DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/wallhub"
    else
      [[ -n "$INSTALL_DIR" ]] || INSTALL_DIR="/opt/wallhub"
      [[ -n "$DATA_DIR" ]] || DATA_DIR="/var/lib/wallhub"
    fi
  else
    CONFIG_DIR="/etc/wallhub-installer"
    if [[ "$LAYOUT" == "in-place" ]]; then
      [[ -n "$INSTALL_DIR" ]] || INSTALL_DIR="$PWD"
      [[ -n "$DATA_DIR" ]] || DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/wallhub"
    else
      [[ -n "$INSTALL_DIR" ]] || INSTALL_DIR="/opt/wallhub"
      [[ -n "$DATA_DIR" ]] || DATA_DIR="/var/lib/wallhub"
    fi
  fi
  TOOLCHAIN_DIR="$DATA_DIR/toolchain"
  STATE_FILE="$CONFIG_DIR/state.env"
  MIRROR_MANIFEST="$CONFIG_DIR/mirrors/manifest.tsv"
}

ensure_config_dir() {
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then
    as_root mkdir -p "$CONFIG_DIR"
    as_root chmod 755 "$CONFIG_DIR"
  else
    run mkdir -p "$CONFIG_DIR"
    run chmod 700 "$CONFIG_DIR"
  fi
  attach_persistent_log
}

attach_persistent_log() {
  ((DRY_RUN)) && return 0
  local persistent_log="$CONFIG_DIR/installer.log" old_log="$LOG_FILE"
  [[ "$old_log" == "$persistent_log" ]] && return 0
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* && "$(id -u)" != "0" ]]; then
    sudo touch "$persistent_log"; sudo chmod 600 "$persistent_log"
    sudo sh -c 'cat "$1" >> "$2"' sh "$old_log" "$persistent_log"
  else
    touch "$persistent_log"; chmod 600 "$persistent_log" 2>/dev/null || true
    cat "$old_log" >>"$persistent_log"
  fi
  LOG_FILE="$persistent_log"
}

pkg_refresh() {
  ((PACKAGE_INDEX_UPDATED)) && return 0
  stage "package-index"
  case "$PKG_MANAGER" in
    apt) as_root env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 update ;;
    dnf) as_root dnf -y makecache ;;
    pacman) as_root pacman -Sy --noconfirm ;;
    zypper) as_root zypper --non-interactive refresh ;;
    pkg) run pkg update -y ;;
  esac || return $?
  PACKAGE_INDEX_UPDATED=1
}

pkg_candidate_exists() {
  local package="$1"
  case "$PKG_MANAGER" in
    apt) apt-cache show "$package" >/dev/null 2>&1 ;;
    dnf) dnf -q list --available "$package" >/dev/null 2>&1 || dnf -q list --installed "$package" >/dev/null 2>&1 ;;
    pacman) pacman -Si "$package" >/dev/null 2>&1 || pacman -Qi "$package" >/dev/null 2>&1 ;;
    zypper) zypper --non-interactive search --match-exact "$package" 2>/dev/null | grep -Eq "(^|[[:space:]|])${package}([[:space:]|]|$)" ;;
    pkg) apt-cache show "$package" >/dev/null 2>&1 || pkg search -x "^${package}(/|$)" >/dev/null 2>&1 || dpkg -s "$package" >/dev/null 2>&1 ;;
  esac
}

pkg_install() {
  (($#)) || return 0
  pkg_refresh || return $?
  case "$PKG_MANAGER" in
    apt) as_root env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y --no-install-recommends "$@" ;;
    dnf) as_root dnf install -y "$@" ;;
    pacman) as_root pacman -S --needed --noconfirm "$@" ;;
    zypper) as_root zypper --non-interactive install -y "$@" ;;
    pkg) run pkg install -y "$@" ;;
  esac
}

pkg_search_diagnostic() {
  local term="$1"
  log WARN "No known package candidate provides $term; querying package metadata"
  case "$PKG_MANAGER" in
    apt) apt-cache search "$term" 2>/dev/null | head -n 20 >>"$LOG_FILE" || true ;;
    dnf) dnf -q provides "*/$term" 2>/dev/null | head -n 30 >>"$LOG_FILE" || dnf -q search "$term" >>"$LOG_FILE" 2>&1 || true ;;
    pacman) pacman -Ss "$term" 2>/dev/null | head -n 30 >>"$LOG_FILE" || true ;;
    zypper) zypper --non-interactive what-provides "$term" >>"$LOG_FILE" 2>&1 || true ;;
    pkg) pkg search "$term" 2>/dev/null | head -n 30 >>"$LOG_FILE" || true ;;
  esac
}

install_first_candidate() {
  local capability="$1"; shift
  local candidate
  if ((DRY_RUN)); then pkg_install "$1"; return 0; fi
  for candidate in "$@"; do
    if pkg_candidate_exists "$candidate"; then
      if pkg_install "$candidate"; then return 0; fi
      log WARN "Package installation failed for candidate: $candidate"
    fi
  done
  pkg_search_diagnostic "$capability"
  return 1
}

ensure_command_package() {
  local command="$1"; shift
  command -v "$command" >/dev/null 2>&1 && return 0
  install_first_candidate "$command" "$@" || die "$EXIT_DEPENDENCY" "Cannot install command: $command"
  ((DRY_RUN)) || command -v "$command" >/dev/null 2>&1 || die "$EXIT_DEPENDENCY" "Package installed but command is unavailable: $command"
}

ensure_base_tools() {
  stage "base-tools"
  ensure_command_package bash bash
  ensure_command_package curl curl
  ensure_command_package git git
  ensure_command_package tar tar
  ensure_command_package xz xz-utils xz
  ensure_command_package find findutils
  ensure_command_package unzip unzip
  ensure_command_package zip zip
  ensure_command_package ping iputils-ping iputils inetutils
  ensure_command_package ps procps procps-ng
  ensure_command_package sha256sum coreutils
  if [[ ! -r /etc/ssl/certs/ca-certificates.crt && "$ENVIRONMENT" != "termux" ]]; then
    install_first_candidate ca-certificates ca-certificates || die "$EXIT_DEPENDENCY" "Cannot install CA certificates"
  fi
  if ((!DRY_RUN)); then
    curl --version | grep -qiE 'https|openssl|gnutls|schannel' || die "$EXIT_DEPENDENCY" "curl lacks HTTPS support"
    tar --version >/dev/null 2>&1 || die "$EXIT_DEPENDENCY" "tar capability probe failed"
    unzip -v >/dev/null 2>&1 || die "$EXIT_DEPENDENCY" "unzip capability probe failed"
    ps -p "$$" >/dev/null 2>&1 || die "$EXIT_DEPENDENCY" "process management capability probe failed"
  fi
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

managed_file_exists() {
  local path="$1"
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* && ${#ROOT_PREFIX[@]} -gt 0 ]]; then sudo test -f "$path"; else [[ -f "$path" ]]; fi
}

mirror_backup_file() {
  local path="$1"
  [[ -e "$path" ]] || return 0
  local backup_dir="$CONFIG_DIR/mirrors/files" index backup original_hash mode owner
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then as_root mkdir -p "$backup_dir"; else run mkdir -p "$backup_dir"; fi
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then as_root chmod 755 "$CONFIG_DIR/mirrors"; as_root chmod 700 "$backup_dir"; else run chmod 700 "$CONFIG_DIR/mirrors" "$backup_dir"; fi
  index="$(printf '%s' "$path" | sha256sum | awk '{print $1}')"
  backup="$backup_dir/$index.original"
  original_hash="$(sha256_file "$path")"
  mode="$(stat -c '%a' "$path" 2>/dev/null || printf '644')"
  owner="$(stat -c '%u:%g' "$path" 2>/dev/null || printf '0:0')"
  if managed_file_exists "$backup"; then return 0; fi
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then
    as_root cp -a "$path" "$backup"
    if ((!DRY_RUN)); then
      if ((${#ROOT_PREFIX[@]})); then
        printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "$backup" "$original_hash" "pending" "$mode" "$owner" | sudo tee -a "$MIRROR_MANIFEST" >/dev/null
      else
        printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "$backup" "$original_hash" "pending" "$mode" "$owner" >>"$MIRROR_MANIFEST"
      fi
      as_root chmod 644 "$MIRROR_MANIFEST"
    fi
  else
    run cp -a "$path" "$backup"
    if ((!DRY_RUN)); then printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "$backup" "$original_hash" "pending" "$mode" "$owner" >>"$MIRROR_MANIFEST"; fi
  fi
}

mirror_register_created_file() {
  local path="$1" backup_dir="$CONFIG_DIR/mirrors/files" owner
  ((DRY_RUN)) && return 0
  [[ -f "$MIRROR_MANIFEST" ]] && awk -F '\t' -v p="$path" '$1==p {found=1} END {exit !found}' "$MIRROR_MANIFEST" && return 0
  owner="$(id -u):$(id -g)"
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then
    as_root mkdir -p "$backup_dir"
    as_root chmod 755 "$CONFIG_DIR/mirrors"
    as_root chmod 700 "$backup_dir"
    if ((${#ROOT_PREFIX[@]})); then
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "-" "missing" "pending" "600" "$owner" | sudo tee -a "$MIRROR_MANIFEST" >/dev/null
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "-" "missing" "pending" "600" "$owner" >>"$MIRROR_MANIFEST"
    fi
    as_root chmod 644 "$MIRROR_MANIFEST"
  else
    mkdir -p "$backup_dir"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "-" "missing" "pending" "600" "$owner" >>"$MIRROR_MANIFEST"
  fi
}

mirror_install_owned_file() {
  local path="$1" source="$2"
  mirror_assert_unmodified "$path"
  if [[ -f "$MIRROR_MANIFEST" ]] && awk -F '\t' -v p="$path" '$1==p {found=1} END {exit !found}' "$MIRROR_MANIFEST"; then
    :
  elif [[ -e "$path" ]]; then
    mirror_backup_file "$path"
  else
    mirror_register_created_file "$path"
  fi
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then
    as_root cp "$source" "$path"; as_root chmod 600 "$path"
  else
    run cp "$source" "$path"; run chmod 600 "$path"
  fi
  mirror_record_modified_hash "$path"
}

mirror_record_modified_hash() {
  local path="$1" modified_hash
  ((DRY_RUN)) && return 0
  modified_hash="$(sha256_file "$path")"
  local temp="$TEMP_DIR/mirror-manifest.tsv"
  awk -F '\t' -v OFS='\t' -v p="$path" -v h="$modified_hash" '$1==p {$4=h} {print}' "$MIRROR_MANIFEST" >"$temp"
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then as_root cp "$temp" "$MIRROR_MANIFEST"; as_root chmod 644 "$MIRROR_MANIFEST"; else run cp "$temp" "$MIRROR_MANIFEST"; fi
}

mirror_assert_unmodified() {
  local path="$1" row original modified current
  [[ -f "$MIRROR_MANIFEST" ]] || return 0
  row="$(awk -F '\t' -v p="$path" '$1==p {print; exit}' "$MIRROR_MANIFEST")"
  [[ -n "$row" ]] || return 0
  original="$(printf '%s\n' "$row" | awk -F '\t' '{print $3}')"
  modified="$(printf '%s\n' "$row" | awk -F '\t' '{print $4}')"
  current="missing"
  [[ -f "$path" ]] && current="$(sha256_file "$path")"
  if [[ "$modified" == "pending" || "$current" == "$modified" || "$current" == "$original" || ("$original" == "missing" && "$current" == "missing") ]]; then return 0; fi
  die "$EXIT_DEPENDENCY" "Mirror file was changed after WallHub configured it; refusing to overwrite: $path"
}

replace_in_file() {
  local path="$1"; shift
  mirror_assert_unmodified "$path"
  mirror_backup_file "$path"
  local temp
  temp="$TEMP_DIR/$(basename "$path").modified"
  cp "$path" "$temp"
  local expression
  for expression in "$@"; do sed -E -i "$expression" "$temp"; done
  if cmp -s "$path" "$temp"; then return 0; fi
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then as_root cp "$temp" "$path"; else run cp "$temp" "$path"; fi
  mirror_record_modified_hash "$path"
}

configure_china_mirrors() {
  [[ "$MIRROR" == "china" ]] || return 0
  stage "china-mirrors"
  local file
  if [[ "$ENVIRONMENT" == "termux" ]]; then
    for file in "$PREFIX/etc/apt/sources.list" "$PREFIX/etc/apt/sources.list.d"/*.list; do
      [[ -f "$file" ]] || continue
      replace_in_file "$file" \
        's#https?://packages\.termux\.dev/apt/#https://mirrors.tuna.tsinghua.edu.cn/termux/apt/#g' \
        's#https?://termux\.net/#https://mirrors.tuna.tsinghua.edu.cn/termux/#g'
    done
  elif [[ "$OS_FAMILY" == "debian" ]]; then
    for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
      [[ -f "$file" ]] || continue
      replace_in_file "$file" \
        's#https?://(deb|ftp)\.debian\.org/debian#https://mirrors.tuna.tsinghua.edu.cn/debian#g' \
        's#https?://security\.debian\.org/debian-security#https://mirrors.tuna.tsinghua.edu.cn/debian-security#g' \
        's#https?://([a-z]{2}\.)?archive\.ubuntu\.com/ubuntu#https://mirrors.tuna.tsinghua.edu.cn/ubuntu#g' \
        's#https?://security\.ubuntu\.com/ubuntu#https://mirrors.tuna.tsinghua.edu.cn/ubuntu#g' \
        's#https?://ports\.ubuntu\.com/ubuntu-ports#https://mirrors.tuna.tsinghua.edu.cn/ubuntu-ports#g'
    done
  elif [[ "$OS_FAMILY" == "fedora" ]]; then
    for file in /etc/yum.repos.d/*.repo; do
      [[ -f "$file" ]] || continue
      # DNF expands $contentdir at runtime; keep it literal in this sed expression.
      # shellcheck disable=SC2016
      replace_in_file "$file" \
        's#https?://download\.fedoraproject\.org/pub/fedora#https://mirrors.tuna.tsinghua.edu.cn/fedora#g' \
        's#https?://download\.example/pub/fedora#https://mirrors.tuna.tsinghua.edu.cn/fedora#g' \
        's#https?://download\.example/pub/epel#https://mirrors.tuna.tsinghua.edu.cn/epel#g' \
        's#https?://dl\.fedoraproject\.org/pub/fedora#https://mirrors.tuna.tsinghua.edu.cn/fedora#g' \
        's#https?://download\.rockylinux\.org/pub/rocky#https://mirrors.tuna.tsinghua.edu.cn/rocky#g' \
        's#https?://dl\.rockylinux\.org/\$contentdir#https://mirrors.tuna.tsinghua.edu.cn/rocky#g' \
        's#https?://repo\.almalinux\.org/almalinux#https://mirrors.tuna.tsinghua.edu.cn/almalinux#g' \
        's#https?://mirror\.stream\.centos\.org#https://mirrors.tuna.tsinghua.edu.cn/centos-stream#g'
      if grep -Eq '^[[:space:]]*#?baseurl=https://mirrors\.tuna\.tsinghua\.edu\.cn/' "$file"; then
        replace_in_file "$file" \
          's|^([[:space:]]*)#?baseurl=(https://mirrors\.tuna\.tsinghua\.edu\.cn/.*)|\1baseurl=\2|' \
          's|^([[:space:]]*)(metalink|mirrorlist)=|\1#\2=|'
      fi
    done
  elif [[ "$OS_FAMILY" == "arch" && -f /etc/pacman.d/mirrorlist ]]; then
    mirror_backup_file /etc/pacman.d/mirrorlist
    local temp="$TEMP_DIR/mirrorlist"
    { printf '%s\n' "Server = https://mirrors.tuna.tsinghua.edu.cn/archlinux/\$repo/os/\$arch"; cat /etc/pacman.d/mirrorlist; } >"$temp"
    as_root cp "$temp" /etc/pacman.d/mirrorlist
    mirror_record_modified_hash /etc/pacman.d/mirrorlist
  elif [[ "$OS_FAMILY" == "suse" ]]; then
    for file in /etc/zypp/repos.d/*.repo; do
      [[ -f "$file" ]] || continue
      replace_in_file "$file" 's#https?://download\.opensuse\.org#https://mirrors.tuna.tsinghua.edu.cn/opensuse#g'
    done
  fi

  local pip_config="$TEMP_DIR/pip.conf" npm_config="$TEMP_DIR/npmrc"
  cat >"$pip_config" <<'EOF'
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
EOF
  cat >"$npm_config" <<'EOF'
registry=https://registry.npmmirror.com
EOF
  mirror_install_owned_file "$CONFIG_DIR/pip.conf" "$pip_config"
  mirror_install_owned_file "$CONFIG_DIR/npmrc" "$npm_config"

  if ! pkg_refresh; then
    log ERROR "Mirror metadata refresh failed; restoring installer-managed backups"
    restore_mirrors_internal force
    die "$EXIT_DEPENDENCY" "China mirror refresh failed and original configuration was restored"
  fi
}

restore_mirrors_internal() {
  local mode="${1:-safe}" conflicts=0 path backup original_hash modified_hash permissions owner current
  [[ -f "$MIRROR_MANIFEST" ]] || { log INFO "No installer-managed mirror backups"; return 0; }
  while IFS=$'\t' read -r path backup original_hash modified_hash permissions owner; do
    [[ -n "$path" ]] || continue
    current="missing"
    [[ -f "$path" ]] && current="$(sha256_file "$path")"
    if [[ "$original_hash" == "missing" && "$current" == "missing" ]]; then continue; fi
    if [[ "$original_hash" != "missing" && "$current" == "$original_hash" ]]; then continue; fi
    if [[ "$mode" != "force" && "$modified_hash" != "pending" && "$current" != "$modified_hash" ]]; then
      log WARN "Mirror file changed after WallHub installation; not overwriting: $path"
      conflicts=$((conflicts + 1)); continue
    fi
    if [[ "$original_hash" == "missing" ]]; then
      if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then as_root rm -f "$path"; else run rm -f "$path"; fi
      continue
    fi
    managed_file_exists "$backup" || { log WARN "Mirror backup is missing: $path"; conflicts=$((conflicts + 1)); continue; }
    if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then
      as_root cp -a "$backup" "$path"
      as_root chmod "$permissions" "$path"
      as_root chown "$owner" "$path" 2>/dev/null || true
    else
      run cp -a "$backup" "$path"
      run chmod "$permissions" "$path"
    fi
  done <"$MIRROR_MANIFEST"
  ((conflicts == 0)) || return 1
}

google_reachable() {
  if [[ "$GOOGLE_REACHABLE" == "yes" ]]; then return 0; fi
  if [[ "$GOOGLE_REACHABLE" == "no" ]]; then return 1; fi
  if ping -c 1 -W 3 www.google.com >/dev/null 2>&1; then GOOGLE_REACHABLE="yes"; return 0; fi
  GOOGLE_REACHABLE="no"; return 1
}

github_candidates() {
  local url="$1"
  case "$url" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://*.githubusercontent.com/*) ;;
    *) printf '%s\n' "$url"; return ;;
  esac
  if google_reachable; then printf '%s\n' "$url"; return; fi
  printf '%s\n' "https://gh-proxy.com/$url" "https://ghproxy.net/$url" "$url"
}

download_file() {
  local url="$1" output="$2" candidate last_error=""
  case "$url" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://*.githubusercontent.com/*)
      if [[ "$GOOGLE_REACHABLE" == "unknown" ]]; then google_reachable || true; fi ;;
  esac
  while IFS= read -r candidate; do
    log INFO "Downloading via $(printf '%s' "$candidate" | sed -E 's#(https?://[^/]+).*#\1#')"
    if ((DRY_RUN)); then return 0; fi
    if curl --proto '=https' --tlsv1.2 -fL --retry 2 --connect-timeout 15 --max-time 300 -o "$output" "$candidate" >>"$LOG_FILE" 2>&1; then return 0; fi
    last_error="route failed"
    log WARN "Download route failed; trying next route"
  done < <(github_candidates "$url")
  log ERROR "$last_error"
  return 1
}

find_node() {
  local candidate version
  for candidate in "${NODE_BIN:-}" "$(command_path node)" "$TOOLCHAIN_DIR/node/bin/node"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    version="$($candidate --version 2>/dev/null || true)"
    if version_ge "$version" "$MIN_NODE_VERSION"; then NODE_BIN="$candidate"; NPM_BIN="$(dirname "$candidate")/npm"; [[ -x "$NPM_BIN" ]] || NPM_BIN="$(command_path npm)"; return 0; fi
  done
  return 1
}

npm_usable_for_node() {
  local npm="${NPM_BIN:-}"
  [[ -n "$npm" && -x "$npm" && -n "${NODE_BIN:-}" ]] || return 1
  env "PATH=$(dirname "$NODE_BIN"):$PATH" "$npm" --version >/dev/null 2>&1
}

ensure_npm_for_node() {
  if npm_usable_for_node; then return 0; fi
  NPM_BIN="$(command_path npm)"
  if npm_usable_for_node; then return 0; fi
  if ((DRY_RUN)); then NPM_BIN="npm"; return 0; fi
  install_first_candidate npm npm || return 1
  NPM_BIN="$(command_path npm)"
  npm_usable_for_node
}

install_portable_node() {
  [[ "$ENVIRONMENT" != "termux" ]] || return 1
  stage "node-portable"
  local index="$TEMP_DIR/node-index.json" version archive_arch archive expected actual extract root
  download_file "https://nodejs.org/dist/index.json" "$index" || return 1
  if ((DRY_RUN)); then NODE_BIN="$TOOLCHAIN_DIR/node/bin/node"; NPM_BIN="$TOOLCHAIN_DIR/node/bin/npm"; return 0; fi
  version="$(python3 - "$index" "$ARCH" <<'PY'
import json, sys
rows=json.load(open(sys.argv[1], encoding='utf-8'))
needle='linux-x64' if sys.argv[2]=='x86_64' else 'linux-arm64'
for row in rows:
    if row.get('lts') and needle in row.get('files', []):
        print(row['version']); break
PY
)"
  [[ -n "$version" ]] || return 1
  [[ "$ARCH" == "x86_64" ]] && archive_arch="x64" || archive_arch="arm64"
  archive="node-${version}-linux-${archive_arch}.tar.xz"
  download_file "https://nodejs.org/dist/${version}/${archive}" "$TEMP_DIR/$archive" || return 1
  download_file "https://nodejs.org/dist/${version}/SHASUMS256.txt" "$TEMP_DIR/SHASUMS256.txt" || return 1
  expected="$(awk -v f="$archive" '$2==f {print $1}' "$TEMP_DIR/SHASUMS256.txt")"
  actual="$(sha256_file "$TEMP_DIR/$archive")"
  [[ -n "$expected" && "$expected" == "$actual" ]] || die "$EXIT_DEPENDENCY" "Node archive SHA-256 verification failed"
  extract="$TEMP_DIR/node-extract"; mkdir -p "$extract"; tar -xJf "$TEMP_DIR/$archive" -C "$extract"
  root="$extract/node-${version}-linux-${archive_arch}"
  as_root mkdir -p "$TOOLCHAIN_DIR"
  [[ -e "$TOOLCHAIN_DIR/node" ]] && as_root rm -rf "$TOOLCHAIN_DIR/node"
  as_root mv "$root" "$TOOLCHAIN_DIR/node"
  NODE_BIN="$TOOLCHAIN_DIR/node/bin/node"; NPM_BIN="$TOOLCHAIN_DIR/node/bin/npm"
}

ensure_node() {
  stage "node"
  if find_node; then log INFO "Using Node $($NODE_BIN --version) at $NODE_BIN"; else
    case "$PKG_MANAGER" in
      apt|dnf|pacman|zypper) install_first_candidate node nodejs node || true ;;
      pkg) install_first_candidate node nodejs-lts nodejs || true ;;
    esac
    if ((DRY_RUN)); then NODE_BIN="node"; NPM_BIN="npm"; return; fi
    if ! find_node; then install_portable_node || die "$EXIT_DEPENDENCY" "Node >= $MIN_NODE_VERSION could not be installed"; fi
  fi
  if ! ensure_npm_for_node; then
    if [[ "$ENVIRONMENT" != "termux" ]]; then
      install_portable_node || die "$EXIT_DEPENDENCY" "npm is unavailable and the complete portable Node fallback failed"
      find_node || die "$EXIT_DEPENDENCY" "Portable Node was installed but did not pass its version probe"
    else
      die "$EXIT_DEPENDENCY" "The selected native Termux Node package does not provide npm"
    fi
  fi
  npm_usable_for_node || die "$EXIT_DEPENDENCY" "npm is unavailable or cannot run with the selected Node"
  "$NODE_BIN" -e "const p=require('./package-lock.json');if(p.lockfileVersion!==2)process.exit(1)" 2>/dev/null || {
    local lock_probe="$TEMP_DIR/lockfile-v2.json"; printf '{"lockfileVersion":2}\n' >"$lock_probe"
    "$NODE_BIN" -e "const p=require(process.argv[1]);if(p.lockfileVersion!==2)process.exit(1)" "$lock_probe" || die "$EXIT_DEPENDENCY" "Node cannot read lockfile v2"
  }
  log INFO "Node=$($NODE_BIN --version) npm=$(env "PATH=$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" --version)"
}

find_python() {
  local candidate version
  for candidate in "$(command_path python3)" "$(command_path python)"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    version="$($candidate -c 'import sys; print(".".join(map(str, sys.version_info[:3])))' 2>/dev/null || true)"
    if version_ge "$version" "$MIN_PYTHON_VERSION"; then printf '%s\n' "$candidate"; return 0; fi
  done
  return 1
}

ensure_python_runtime() {
  stage "python-runtime"
  local system_python=""
  system_python="$(find_python || true)"
  if [[ -z "$system_python" ]]; then
    install_first_candidate python python3 python || die "$EXIT_DEPENDENCY" "Python >= $MIN_PYTHON_VERSION could not be installed"
    ((DRY_RUN)) || system_python="$(find_python || true)"
  fi
  if ((DRY_RUN)); then PYTHON_BIN="$TOOLCHAIN_DIR/python-venv/bin/python"; return; fi
  [[ -n "$system_python" ]] || die "$EXIT_DEPENDENCY" "Python >= $MIN_PYTHON_VERSION is unavailable"
  as_root mkdir -p "$TOOLCHAIN_DIR"
  if [[ ! -x "$TOOLCHAIN_DIR/python-venv/bin/python" ]]; then
    if ! as_root_quiet "$system_python" -m venv --system-site-packages "$TOOLCHAIN_DIR/python-venv"; then
      local python_minor
      python_minor="$($system_python -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')"
      case "$OS_FAMILY" in
        debian) install_first_candidate python-venv python3-venv "python${python_minor}-venv" || true ;;
        fedora) install_first_candidate python-venv python3 python3-libs || true ;;
        arch) install_first_candidate python-venv python || true ;;
        suse) install_first_candidate python-venv python3-virtualenv "python${python_minor/./}-virtualenv" || true ;;
        termux) install_first_candidate python-venv python || true ;;
      esac
      safe_remove_tree "$TOOLCHAIN_DIR/python-venv" "$TOOLCHAIN_DIR"
      as_root_quiet "$system_python" -m venv --system-site-packages "$TOOLCHAIN_DIR/python-venv" || die "$EXIT_DEPENDENCY" "Python venv creation failed"
    fi
  fi
  PYTHON_BIN="$TOOLCHAIN_DIR/python-venv/bin/python"
  "$PYTHON_BIN" -m pip --version >/dev/null 2>&1 || die "$EXIT_DEPENDENCY" "pip is unavailable in WallHub venv"
}

install_python_build_deps() {
  stage "python-build-dependencies"
  case "$OS_FAMILY" in
    debian) pkg_install build-essential cmake pkg-config python3-dev libjpeg-dev zlib1g-dev libpng-dev ;;
    fedora) pkg_install gcc gcc-c++ make cmake pkgconf-pkg-config python3-devel libjpeg-turbo-devel zlib-devel libpng-devel ;;
    arch) pkg_install base-devel cmake pkgconf python libjpeg-turbo zlib libpng ;;
    suse) pkg_install -t pattern devel_basis || true; pkg_install gcc gcc-c++ make cmake pkg-config python3-devel libjpeg8-devel zlib-devel libpng16-devel ;;
    termux) pkg_install clang make cmake pkg-config libjpeg-turbo libpng zlib ;;
  esac
}

python_capability_probe() {
  "$PYTHON_BIN" - <<'PY'
from io import BytesIO
from PIL import Image
import etcpak
import lz4.block
import texture2ddecoder

image = Image.new("RGBA", (4, 4), (12, 34, 56, 255))
buffer = BytesIO()
image.save(buffer, format="PNG")
buffer.seek(0)
assert Image.open(buffer).convert("RGBA").size == (4, 4)
payload = b"wallhub-lz4-capability" * 4
packed = lz4.block.compress(payload, store_size=True)
assert lz4.block.decompress(packed) == payload
rgba = bytes([12, 34, 56, 255]) * 16
assert len(etcpak.compress_etc2_rgba(rgba, 4, 4)) > 0
assert callable(texture2ddecoder.decode_bc1)
assert callable(texture2ddecoder.decode_bc3)
assert len(texture2ddecoder.decode_bc1(bytes(8), 4, 4)) == 64
assert len(texture2ddecoder.decode_bc3(bytes(16), 4, 4)) == 64
print("Pillow/lz4/etcpak/texture2ddecoder capability probe passed")
PY
}

ensure_python_modules() {
  stage "python-mpkg-modules"
  ((DRY_RUN)) && { log DRYRUN "install and probe Pillow/lz4/etcpak/texture2ddecoder"; return; }
  local py_version requirements=()
  py_version="$($PYTHON_BIN -c 'import sys; print(".".join(map(str,sys.version_info[:2])))')"
  if [[ "$py_version" == "3.7" ]]; then
    requirements=("Pillow==9.5.0" "lz4==4.3.2" "etcpak==0.9.15" "texture2ddecoder==1.0.6")
    as_root_quiet "$PYTHON_BIN" -m pip install --disable-pip-version-check "pip<24.1" || true
  else
    requirements=("Pillow>=9.5.0" "lz4>=4.3.2" "etcpak>=0.9.15" "texture2ddecoder>=1.0.6")
  fi
  local pip_args=(install --disable-pip-version-check)
  if [[ "$MIRROR" == "china" ]]; then pip_args+=(--index-url https://pypi.tuna.tsinghua.edu.cn/simple); fi
  if ! as_root_quiet "$PYTHON_BIN" -m pip "${pip_args[@]}" "${requirements[@]}"; then
    log WARN "Python wheel/default build failed; installing native build dependencies and retrying once"
    install_python_build_deps
    as_root_quiet "$PYTHON_BIN" -m pip "${pip_args[@]}" "${requirements[@]}" || die "$EXIT_DEPENDENCY" "MPKG Python packages failed after source-build retry"
  fi
  python_capability_probe >>"$LOG_FILE" 2>&1 || die "$EXIT_DEPENDENCY" "MPKG Python capability probe failed"
  if [[ -d "$INSTALL_DIR/tools/mpkg" ]]; then
    as_root_quiet env PYTHONPATH='' "$PYTHON_BIN" -m unittest discover -s "$INSTALL_DIR/tools/mpkg" -p 'test_mobile_mpkg.py' || die "$EXIT_DEPENDENCY" "MPKG Python tests failed"
    as_root_quiet env PYTHONPATH='' "$PYTHON_BIN" -m py_compile "$INSTALL_DIR/tools/mpkg/mobile_mpkg.py" "$INSTALL_DIR/tools/mpkg/wallpaper_engine_toolkit.py" || die "$EXIT_DEPENDENCY" "MPKG Python syntax check failed"
  fi
}

dotnet_capability_probe() {
  local command="$1"
  "$command" --info >/dev/null 2>&1 || return 1
  "$command" --list-sdks 2>/dev/null | grep -Eq '^9\.' || return 1
  "$command" --list-runtimes 2>/dev/null | grep -Eq '^Microsoft\.NETCore\.App 9\.' || return 1
}

find_dotnet() {
  local candidate
  for candidate in "${DOTNET_BIN:-}" "$(command_path dotnet)" "$TOOLCHAIN_DIR/dotnet/dotnet"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    if dotnet_capability_probe "$candidate"; then DOTNET_BIN="$candidate"; DOTNET_ROOT_DIR="$(dirname "$candidate")"; return 0; fi
  done
  return 1
}

install_dotnet_official() {
  stage "dotnet-official"
  local installer="$TEMP_DIR/dotnet-install.sh"
  download_file "https://dot.net/v1/dotnet-install.sh" "$installer" || return 1
  ((DRY_RUN)) && { DOTNET_BIN="$TOOLCHAIN_DIR/dotnet/dotnet"; DOTNET_ROOT_DIR="$TOOLCHAIN_DIR/dotnet"; return 0; }
  chmod 700 "$installer"
  as_root mkdir -p "$TOOLCHAIN_DIR/dotnet"
  local dotnet_arch="$ARCH"; [[ "$dotnet_arch" == "x86_64" ]] && dotnet_arch="x64" || dotnet_arch="arm64"
  if ! as_root bash "$installer" --channel 9.0 --quality GA --architecture "$dotnet_arch" --install-dir "$TOOLCHAIN_DIR/dotnet" --no-path; then return 1; fi
  DOTNET_BIN="$TOOLCHAIN_DIR/dotnet/dotnet"; DOTNET_ROOT_DIR="$TOOLCHAIN_DIR/dotnet"
}

ensure_dotnet() {
  stage "dotnet-9"
  if find_dotnet; then log INFO "Using .NET 9 at $DOTNET_BIN"; return; fi
  local installed=0
  case "$PKG_MANAGER" in
    apt|dnf|zypper) if install_first_candidate dotnet-sdk-9.0 dotnet-sdk-9.0 dotnet-sdk-9; then installed=1; fi ;;
    pacman) if install_first_candidate dotnet-sdk dotnet-sdk-9.0 dotnet-sdk; then installed=1; fi ;;
    pkg)
      if install_first_candidate dotnet-sdk dotnet-sdk-9.0 dotnet-sdk-9 dotnet-sdk; then
        installed=1
      elif install_first_candidate tur-repo tur-repo; then
        PACKAGE_INDEX_UPDATED=0; pkg_refresh
        if install_first_candidate dotnet-sdk dotnet-sdk-9.0 dotnet-sdk-9 dotnet-sdk; then installed=1; fi
      fi ;;
  esac
  if ((DRY_RUN)); then DOTNET_BIN="dotnet"; DOTNET_ROOT_DIR="$TOOLCHAIN_DIR/dotnet"; return; fi
  if ((installed)) && find_dotnet; then return; fi
  if ! install_dotnet_official; then
    if [[ "$ENVIRONMENT" == "termux" ]]; then
      die "$EXIT_DEPENDENCY" "No runnable native Termux .NET 9 package was found, and Microsoft's glibc installer failed on Android bionic; use Debian/Ubuntu Proot"
    fi
    die "$EXIT_DEPENDENCY" ".NET 9 SDK/runtime installation failed"
  fi
  if ! find_dotnet; then
    if [[ "$ENVIRONMENT" == "termux" ]]; then
      { file "$DOTNET_BIN" 2>/dev/null || true; "$DOTNET_BIN" --info 2>&1 || true; } >>"$LOG_FILE"
      die "$EXIT_DEPENDENCY" "Microsoft .NET 9 glibc build cannot execute on Android bionic; use a Debian/Ubuntu Proot environment"
    fi
    die "$EXIT_DEPENDENCY" ".NET 9 SDK and Runtime capability probe failed"
  fi
}

ensure_sc302_dependencies() {
  [[ "$SC302_DEPS" == "yes" ]] || return 0
  stage "steamcommunity-302-dependencies"
  if [[ "$ENVIRONMENT" == "termux" || "$ENVIRONMENT" == "proot" ]]; then
    log WARN "Only dependencies are installed. Android/Proot kernel, privileged-port and netfilter limitations still apply; SC302 itself is not installed."
  fi
  local packages=() candidate
  case "$OS_FAMILY" in
    debian) packages=(libnss3-tools libnetfilter-queue1 libuuid1) ;;
    fedora) packages=(nss-tools libnetfilter_queue libuuid) ;;
    arch) packages=(nss libnetfilter_queue util-linux-libs) ;;
    suse) packages=(mozilla-nss-tools libnetfilter_queue1 libuuid1) ;;
    termux) log WARN "Native Termux has no supported SC302 netfilter dependency set"; return 0 ;;
  esac
  for candidate in "${packages[@]}"; do install_first_candidate "$candidate" "$candidate" || die "$EXIT_DEPENDENCY" "SC302 dependency unavailable: $candidate"; done
  log INFO "SC302 dependencies installed; this does not mean SC302 can run"
}

valid_source_tree() {
  local root="$1"
  [[ -f "$root/package.json" && -f "$root/package-lock.json" && -f "$root/server.js" && -d "$root/src" && -d "$root/frontend" && -d "$root/tools/mpkg" ]]
}

github_repo_slug() {
  local repo="$REPO" slug
  slug="${repo#https://github.com/}"; slug="${slug%.git}"; slug="${slug%/}"
  if [[ "$slug" != */* || "$slug" == http* ]]; then return 1; fi
  printf '%s\n' "$slug"
}

archive_members_are_safe() {
  local archive="$1" kind="$2" member
  if [[ "$kind" == "zip" ]]; then
    unzip -tqq "$archive" >/dev/null 2>&1 || return 1
    while IFS= read -r member; do
      [[ "$member" != /* && "$member" != ../* && "$member" != */../* && "$member" != *"/.." ]] || return 1
    done < <(unzip -Z1 "$archive")
  else
    tar -tzf "$archive" >/dev/null 2>&1 || return 1
    while IFS= read -r member; do
      member="${member#./}"
      [[ "$member" != /* && "$member" != ../* && "$member" != */../* && "$member" != *"/.." ]] || return 1
    done < <(tar -tzf "$archive")
  fi
}

extract_source_archive() {
  local archive="$1" kind="$2" extract="$3"
  archive_members_are_safe "$archive" "$kind" || die "$EXIT_SOURCE" "Source archive contains an unsafe path"
  mkdir -p "$extract"
  if [[ "$kind" == "zip" ]]; then
    unzip -q "$archive" -d "$extract" >>"$LOG_FILE" 2>&1 || die "$EXIT_SOURCE" "WallHub ZIP extraction failed"
  else
    tar -xzf "$archive" -C "$extract" >>"$LOG_FILE" 2>&1 || die "$EXIT_SOURCE" "WallHub source archive extraction failed"
  fi
}

locate_source_root() {
  local extract="$1" candidate
  if valid_source_tree "$extract"; then printf '%s\n' "$extract"; return 0; fi
  while IFS= read -r candidate; do
    if valid_source_tree "$candidate"; then printf '%s\n' "$candidate"; return 0; fi
  done < <(find "$extract" -mindepth 1 -maxdepth 1 -type d)
  return 1
}

acquire_source() {
  stage "source-acquisition"
  if ((!FORCE_REMOTE_SOURCE)) && valid_source_tree "$PWD"; then SOURCE_DIR="$PWD"; log INFO "Using current WallHub source tree"; return; fi
  if ((DRY_RUN)); then SOURCE_DIR="$TEMP_DIR/source"; log DRYRUN "download $REPO branch $BRANCH"; return; fi
  local archive_url archive extract first kind="tar" slug=""
  archive="$TEMP_DIR/source.archive"; extract="$TEMP_DIR/source-extract"
  if [[ "$REPO" =~ \.zip([?].*)?$ ]]; then
    kind="zip"
    download_file "$REPO" "$archive" || die "$EXIT_SOURCE" "WallHub source ZIP download failed"
  elif [[ "$REPO" =~ \.(tar\.gz|tgz)([?].*)?$ ]]; then
    download_file "$REPO" "$archive" || die "$EXIT_SOURCE" "WallHub source archive download failed"
  else
    slug="$(github_repo_slug || true)"
    if [[ -n "$slug" ]]; then
      archive_url="https://github.com/$slug/archive/refs/heads/$BRANCH.tar.gz"
      if ! download_file "$archive_url" "$archive"; then
        archive_url="https://github.com/$slug/archive/refs/tags/$BRANCH.tar.gz"
        download_file "$archive_url" "$archive" || die "$EXIT_SOURCE" "WallHub branch or tag download failed"
      fi
    fi
  fi
  if [[ -s "$archive" ]]; then
    extract_source_archive "$archive" "$kind" "$extract"
    first="$(locate_source_root "$extract" || true)"
    [[ -n "$first" ]] || die "$EXIT_SOURCE" "Downloaded archive is not a valid WallHub source tree"
    SOURCE_DIR="$first"; return
  fi
  SOURCE_DIR="$TEMP_DIR/source-git"
  run git clone --depth 1 --branch "$BRANCH" "$REPO" "$SOURCE_DIR" || die "$EXIT_SOURCE" "WallHub git clone failed"
  valid_source_tree "$SOURCE_DIR" || die "$EXIT_SOURCE" "Cloned repository is not a valid WallHub source tree"
}

safe_remove_tree() {
  local path="$1" parent="$2"
  [[ -n "$path" && "$path" != "/" && "$path" == "$parent"/* ]] || die "$EXIT_SOURCE" "Refusing unsafe removal path: $path"
  [[ -e "$path" ]] || return 0
  as_root rm -rf -- "$path"
}

copy_source_tree() {
  local source="$1" target="$2"
  as_root mkdir -p "$target"
  if ((DRY_RUN)); then log DRYRUN "copy approved source files from $source to $target"; return; fi
  tar -C "$source" \
    --exclude=.git --exclude=.agents --exclude=.claude --exclude=.codex --exclude=.hermes --exclude=NuGet \
    --exclude=node_modules --exclude=frontend/node_modules --exclude=frontend/dist \
    --exclude='./Downloads' --exclude='./downloads' --exclude='./SteamKit' --exclude='./cache-settings.json' \
    --exclude='./wallhub-data' --exclude='./docker-data' --exclude='./Steamcommunity_302' --exclude=.env --exclude='.env.*' --exclude='*.log' \
    -cf - . | if ((${#ROOT_PREFIX[@]})); then sudo tar -C "$target" -xf -; else tar -C "$target" -xf -; fi
}

deploy_source() {
  stage "source-deployment"
  if [[ "$LAYOUT" == "in-place" ]]; then
    valid_source_tree "$INSTALL_DIR" || die "$EXIT_SOURCE" "In-place directory is not a WallHub source tree: $INSTALL_DIR"
    SOURCE_DIR="$INSTALL_DIR"; return
  fi
  local parent stage_dir previous
  parent="$(dirname "$INSTALL_DIR")"
  stage_dir="$parent/.wallhub-stage-$$"
  previous="$parent/.wallhub-previous"
  safe_remove_tree "$stage_dir" "$parent"
  copy_source_tree "$SOURCE_DIR" "$stage_dir"
  if ((!DRY_RUN)); then
    valid_source_tree "$stage_dir" || die "$EXIT_SOURCE" "Staged source validation failed"
    as_root touch "$stage_dir/.wallhub-installer-managed"
    if [[ -e "$previous" && ! -f "$previous/.wallhub-installer-managed" ]]; then die "$EXIT_SOURCE" "Refusing to remove an unowned rollback directory: $previous"; fi
    if [[ -e "$INSTALL_DIR" && ! -f "$INSTALL_DIR/.wallhub-installer-managed" ]]; then
      die "$EXIT_SOURCE" "Existing install directory is not installer-managed; choose --layout in-place or a different --install-dir"
    fi
  fi
  safe_remove_tree "$previous" "$parent"
  if [[ -e "$INSTALL_DIR" ]]; then as_root mv "$INSTALL_DIR" "$previous"; ROLLBACK_DIR="$previous"; fi
  as_root mv "$stage_dir" "$INSTALL_DIR"
  SOURCE_DIR="$INSTALL_DIR"
}

public_integrity() {
  local root="$1"
  [[ -f "$root/public/index.html" ]] || return 1
  "$NODE_BIN" - "$root" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1]).filter((value) => value.startsWith('/'));
if (!refs.length) process.exit(2);
for (const ref of refs) {
  const file = path.join(root, 'public', ref.replace(/^\//, ''));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) process.exit(3);
}
console.log(`public references verified: ${refs.length}`);
NODE
}

install_node_dependencies() {
  stage "npm-and-public"
  ((DRY_RUN)) && { log DRYRUN "npm ci and public integrity verification"; return; }
  local rebuild="$BUILD_UI"
  public_integrity "$INSTALL_DIR" >>"$LOG_FILE" 2>&1 || rebuild=1
  local npm_env=(env "PATH=$(dirname "$NODE_BIN"):$PATH" npm_config_fund=false npm_config_audit=false)
  if [[ "$MIRROR" == "china" ]]; then npm_env+=(npm_config_registry=https://registry.npmmirror.com); fi
  if ((rebuild)); then
    as_root_quiet "${npm_env[@]}" "$NPM_BIN" --prefix "$INSTALL_DIR" ci || die "$EXIT_SOURCE" "npm install failed"
    as_root_quiet "${npm_env[@]}" "$NPM_BIN" --prefix "$INSTALL_DIR" run build:ui || die "$EXIT_SOURCE" "frontend build failed"
    as_root_quiet "${npm_env[@]}" "$NPM_BIN" --prefix "$INSTALL_DIR" prune --omit=dev || die "$EXIT_SOURCE" "npm production prune failed"
  else
    as_root_quiet "${npm_env[@]}" "$NPM_BIN" --prefix "$INSTALL_DIR" ci --omit=dev || die "$EXIT_SOURCE" "npm production dependency installation failed"
  fi
  public_integrity "$INSTALL_DIR" >>"$LOG_FILE" 2>&1 || die "$EXIT_SOURCE" "public asset integrity check failed"
}

node_runtime_dependencies_ready() {
  public_integrity "$INSTALL_DIR" >/dev/null 2>&1 || return 1
  (cd "$INSTALL_DIR" && "$NODE_BIN" -e "require('qrcode'); require('jsqr')") >/dev/null 2>&1
}

repair_node_dependencies() {
  if node_runtime_dependencies_ready; then log INFO "npm runtime dependencies and public assets are already valid"; return 0; fi
  install_node_dependencies
}

repair_python_modules() {
  if python_capability_probe >>"$LOG_FILE" 2>&1; then log INFO "MPKG Python dependencies already pass capability probes"; return 0; fi
  ensure_python_modules
}

prepare_runtime_layout() {
  stage "runtime-layout"
  if [[ "$ENVIRONMENT" == "linux" && "$LAYOUT" == "isolated" ]]; then
    ensure_command_package useradd passwd shadow-utils shadow
    ensure_command_package groupadd passwd shadow-utils shadow
    if ! { command -v getent >/dev/null 2>&1 && getent group wallhub >/dev/null 2>&1; } && ! grep -q '^wallhub:' /etc/group 2>/dev/null; then as_root groupadd --system wallhub; fi
    if ! id wallhub >/dev/null 2>&1; then
      local nologin
      nologin="$(command -v nologin || printf '/usr/sbin/nologin')"
      as_root useradd --system --gid wallhub --home-dir "$DATA_DIR" --shell "$nologin" wallhub
    fi
    SERVICE_USER="wallhub"; SERVICE_GROUP="wallhub"
  else
    SERVICE_USER="$(id -un)"; SERVICE_GROUP="$(id -gn)"
  fi
  as_root mkdir -p "$DATA_DIR" "$DATA_DIR/Downloads" "$DATA_DIR/SteamKit" "$TOOLCHAIN_DIR"
  if [[ "$ENVIRONMENT" == "linux" && "$LAYOUT" == "isolated" ]]; then
    as_root chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR"
    as_root chown -R root:"$SERVICE_GROUP" "$INSTALL_DIR"
    as_root chmod -R g+rX "$INSTALL_DIR"
  fi
  if [[ "$LAYOUT" == "isolated" ]]; then
    if [[ -e "$INSTALL_DIR/cache-settings.json" && ! -L "$INSTALL_DIR/cache-settings.json" ]]; then
      as_root mv "$INSTALL_DIR/cache-settings.json" "$DATA_DIR/cache-settings.json"
    fi
    if [[ ! -e "$DATA_DIR/cache-settings.json" ]]; then as_root touch "$DATA_DIR/cache-settings.json"; fi
    if [[ -e "$INSTALL_DIR/cache-settings.json" || -L "$INSTALL_DIR/cache-settings.json" ]]; then as_root rm -f "$INSTALL_DIR/cache-settings.json"; fi
    as_root ln -s "$DATA_DIR/cache-settings.json" "$INSTALL_DIR/cache-settings.json"
    as_root chown "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR/cache-settings.json"
  fi
}

write_runtime_env() {
  stage "runtime-environment"
  local env_file="$CONFIG_DIR/runtime.env" temp="$TEMP_DIR/runtime.env"
  {
    printf 'NODE_ENV=%q\n' production
    printf 'PORT=%q\n' "$DEFAULT_PORT"
    printf 'WALLHUB_SUPERVISOR=%q\n' 0
    printf 'WALLHUB_DOWNLOADS_DIR=%q\n' "$DATA_DIR/Downloads"
    printf 'STEAMKIT_DIR=%q\n' "$DATA_DIR/SteamKit"
    printf 'DEPOTDOWNLOADER_CONFIG_DIR=%q\n' "$DATA_DIR/SteamKit/account"
    printf 'PYTHON=%q\n' "$PYTHON_BIN"
    printf 'PYTHON3=%q\n' "$PYTHON_BIN"
    printf 'DOTNET_ROOT=%q\n' "$DOTNET_ROOT_DIR"
    printf 'DOTNET_ROOT_ARM64=%q\n' "$DOTNET_ROOT_DIR"
    printf 'DOTNET_CLI_TELEMETRY_OPTOUT=%q\n' 1
    printf 'DOTNET_SKIP_FIRST_TIME_EXPERIENCE=%q\n' 1
    printf 'PATH=%q\n' "$(dirname "$NODE_BIN"):$(dirname "$DOTNET_BIN"):$PATH"
  } >"$temp"
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then as_root cp "$temp" "$env_file"; as_root chmod 640 "$env_file"; else run cp "$temp" "$env_file"; run chmod 600 "$env_file"; fi
}

write_state() {
  stage "installer-state"
  local temp="$TEMP_DIR/state.env"
  {
    printf 'STATE_VERSION=%q\n' "$STATE_VERSION"
    printf 'INSTALLER_VERSION=%q\n' "$INSTALLER_VERSION"
    printf 'ENVIRONMENT=%q\n' "$ENVIRONMENT"
    printf 'TARGET=%q\n' "$TARGET"
    printf 'OS_ID=%q\n' "$OS_ID"
    printf 'OS_CODENAME=%q\n' "$OS_CODENAME"
    printf 'OS_FAMILY=%q\n' "$OS_FAMILY"
    printf 'PKG_MANAGER=%q\n' "$PKG_MANAGER"
    printf 'ARCH=%q\n' "$ARCH"
    printf 'LAYOUT=%q\n' "$LAYOUT"
    printf 'MIRROR=%q\n' "$MIRROR"
    printf 'REPO=%q\n' "$REPO"
    printf 'BRANCH=%q\n' "$BRANCH"
    printf 'INSTALL_DIR=%q\n' "$INSTALL_DIR"
    printf 'DATA_DIR=%q\n' "$DATA_DIR"
    printf 'CONFIG_DIR=%q\n' "$CONFIG_DIR"
    printf 'TOOLCHAIN_DIR=%q\n' "$TOOLCHAIN_DIR"
    printf 'NODE_BIN=%q\n' "$NODE_BIN"
    printf 'NPM_BIN=%q\n' "$NPM_BIN"
    printf 'PYTHON_BIN=%q\n' "$PYTHON_BIN"
    printf 'DOTNET_BIN=%q\n' "$DOTNET_BIN"
    printf 'DOTNET_ROOT_DIR=%q\n' "$DOTNET_ROOT_DIR"
    printf 'SERVICE_KIND=%q\n' "$SERVICE_KIND"
    printf 'SERVICE_USER=%q\n' "$SERVICE_USER"
    printf 'SERVICE_GROUP=%q\n' "$SERVICE_GROUP"
    printf 'PORT=%q\n' "$DEFAULT_PORT"
  } >"$temp"
  if [[ "$ENVIRONMENT" == "linux" && "$CONFIG_DIR" == /etc/* ]]; then as_root cp "$temp" "$STATE_FILE"; as_root chmod 644 "$STATE_FILE"; else run cp "$temp" "$STATE_FILE"; run chmod 600 "$STATE_FILE"; fi
}

load_state() {
  local candidates=()
  [[ -n "$STATE_FILE" ]] && candidates+=("$STATE_FILE")
  [[ -n "${PREFIX:-}" ]] && candidates+=("${PREFIX}/etc/wallhub-installer/state.env")
  candidates+=("/etc/wallhub-installer/state.env" "${XDG_CONFIG_HOME:-$HOME/.config}/wallhub-installer/state.env")
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -r "$candidate" ]]; then
      # State is installer-owned, mode 0600, and values were emitted with printf %q.
      # shellcheck disable=SC1090
      source "$candidate"
      STATE_FILE="$candidate"; CONFIG_DIR="$(dirname "$candidate")"; MIRROR_MANIFEST="$CONFIG_DIR/mirrors/manifest.tsv"
      attach_persistent_log
      return 0
    fi
  done
  die "$EXIT_USAGE" "No WallHub installer state found"
}

systemd_available() {
  command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]] && systemctl show-environment >/dev/null 2>&1
}

install_systemd_service() {
  systemd_available || die "$EXIT_SERVICE" "systemd is not running; ordinary Linux installation requires systemd"
  SERVICE_KIND="systemd"
  local unit="$TEMP_DIR/wallhub.service" unit_target="${WALLHUB_SYSTEMD_UNIT_PATH:-/etc/systemd/system/wallhub.service}" quoted_install quoted_config quoted_node quoted_server
  quoted_install="${INSTALL_DIR//\\/\\\\}"; quoted_install="${quoted_install//\"/\\\"}"
  quoted_config="${CONFIG_DIR//\\/\\\\}"; quoted_config="${quoted_config//\"/\\\"}"
  quoted_node="${NODE_BIN//\\/\\\\}"; quoted_node="${quoted_node//\"/\\\"}"
  quoted_server="${INSTALL_DIR//\\/\\\\}/server.js"; quoted_server="${quoted_server//\"/\\\"}"
  cat >"$unit" <<EOF
[Unit]
Description=WallHub Workshop service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$quoted_install
EnvironmentFile=$quoted_config/runtime.env
ExecStart="$quoted_node" "$quoted_server" --no-supervisor
Restart=on-failure
RestartSec=3
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF
  as_root cp "$unit" "$unit_target"
  as_root chmod 644 "$unit_target"
  as_root systemctl daemon-reload
  as_root systemctl enable --now wallhub.service
}

install_termux_service() {
  SERVICE_KIND="runit"
  command -v sv >/dev/null 2>&1 || install_first_candidate termux-services termux-services || die "$EXIT_SERVICE" "termux-services is unavailable"
  local service_dir="$PREFIX/var/service/wallhub" run_file="$TEMP_DIR/run" log_run="$TEMP_DIR/log-run"
  cat >"$run_file" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec 2>&1
cd $(printf '%q' "$INSTALL_DIR")
. $(printf '%q' "$CONFIG_DIR/runtime.env")
export NODE_ENV PORT WALLHUB_SUPERVISOR WALLHUB_DOWNLOADS_DIR STEAMKIT_DIR DEPOTDOWNLOADER_CONFIG_DIR PYTHON PYTHON3 DOTNET_ROOT DOTNET_ROOT_ARM64 DOTNET_CLI_TELEMETRY_OPTOUT DOTNET_SKIP_FIRST_TIME_EXPERIENCE PATH
exec $(printf '%q' "$NODE_BIN") $(printf '%q' "$INSTALL_DIR/server.js") --no-supervisor
EOF
  cat >"$log_run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
mkdir -p $(printf '%q' "$DATA_DIR/log")
exec svlogd -tt $(printf '%q' "$DATA_DIR/log")
EOF
  run mkdir -p "$service_dir/log"
  run cp "$run_file" "$service_dir/run"
  run cp "$log_run" "$service_dir/log/run"
  run chmod 700 "$service_dir/run" "$service_dir/log/run"
  ensure_termux_runsvdir
  if command -v sv-enable >/dev/null 2>&1; then run sv-enable wallhub; fi
  run sv up wallhub
}

ensure_termux_runsvdir() {
  if pgrep -f "${PREFIX}/bin/runsvdir.*${PREFIX}/var/service" >/dev/null 2>&1; then return 0; fi
  if [[ -r "$PREFIX/etc/profile.d/start-services.sh" ]]; then
    if ((DRY_RUN)); then log DRYRUN "source $PREFIX/etc/profile.d/start-services.sh"; return 0; fi
    # This profile is supplied by termux-services at runtime.
    # shellcheck disable=SC1090,SC1091
    . "$PREFIX/etc/profile.d/start-services.sh"
  elif command -v runsvdir >/dev/null 2>&1; then
    if ((DRY_RUN)); then log DRYRUN "runsvdir $PREFIX/var/service"; return 0; fi
    nohup runsvdir "$PREFIX/var/service" >/dev/null 2>&1 </dev/null &
  else
    die "$EXIT_SERVICE" "termux-services installed without a runnable runsvdir"
  fi
  local _
  for _ in {1..10}; do
    pgrep -f "${PREFIX}/bin/runsvdir.*${PREFIX}/var/service" >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "$EXIT_SERVICE" "Termux runit supervisor did not start"
}

install_proot_manager() {
  SERVICE_KIND="pid"
  local manager="$TEMP_DIR/wallhubctl" target="$CONFIG_DIR/wallhubctl"
  {
    cat <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
EOF
    printf 'INSTALL_DIR=%q\n' "$INSTALL_DIR"
    printf 'DATA_DIR=%q\n' "$DATA_DIR"
    printf 'ENV_FILE=%q\n' "$CONFIG_DIR/runtime.env"
    printf 'NODE_BIN=%q\n' "$NODE_BIN"
    cat <<'EOF'
PID_FILE="$DATA_DIR/wallhub.pid"
LOG_FILE="$DATA_DIR/wallhub.log"
is_running() { [[ -s "$PID_FILE" ]] || return 1; local p; p="$(cat "$PID_FILE")"; kill -0 "$p" 2>/dev/null && tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null | grep -Fq "$INSTALL_DIR/server.js"; }
start() {
  if is_running; then echo "WallHub already running (pid $(cat "$PID_FILE"))"; return 0; fi
  [[ -s "$PID_FILE" ]] && rm -f "$PID_FILE"
  mkdir -p "$DATA_DIR"
  if [[ -f "$LOG_FILE" ]] && [[ $(stat -c %s "$LOG_FILE") -gt 10485760 ]]; then mv -f "$LOG_FILE" "$LOG_FILE.1"; fi
  set -a; . "$ENV_FILE"; set +a
  cd "$INSTALL_DIR"
  nohup "$NODE_BIN" "$INSTALL_DIR/server.js" --no-supervisor >>"$LOG_FILE" 2>&1 </dev/null &
  echo $! >"$PID_FILE"
  sleep 1
  is_running || { echo "WallHub failed to start; see $LOG_FILE" >&2; return 1; }
}
stop() {
  is_running || { rm -f "$PID_FILE"; echo "WallHub is not running"; return 0; }
  local p; p="$(cat "$PID_FILE")"; kill -TERM "$p" 2>/dev/null || true
  for _ in {1..20}; do kill -0 "$p" 2>/dev/null || break; sleep 1; done
  kill -0 "$p" 2>/dev/null && kill -KILL "$p" 2>/dev/null || true
  rm -f "$PID_FILE"
}
status() { if is_running; then echo "WallHub running (pid $(cat "$PID_FILE"))"; else echo "WallHub stopped"; return 1; fi; }
logs() { touch "$LOG_FILE"; tail -n 100 -f "$LOG_FILE"; }
case "${1:-status}" in start) start;; stop) stop;; restart) stop; start;; status) status;; logs) logs;; *) echo "Usage: wallhubctl {start|stop|restart|status|logs}" >&2; exit 2;; esac
EOF
  } >"$manager"
  run cp "$manager" "$target"
  run chmod 700 "$target"
  run "$target" start
}

install_service() {
  stage "service-installation"
  if ((DRY_RUN)); then
    if [[ "$ENVIRONMENT" == "termux" ]]; then SERVICE_KIND="runit"; elif [[ "$ENVIRONMENT" == "proot" ]]; then SERVICE_KIND="pid"; else SERVICE_KIND="systemd"; fi
    log DRYRUN "install $SERVICE_KIND service"; return
  fi
  case "$ENVIRONMENT" in
    termux) install_termux_service ;;
    proot) install_proot_manager ;;
    linux) install_systemd_service ;;
  esac
}

service_action() {
  local action="$1"
  case "$SERVICE_KIND" in
    systemd) as_root systemctl "$action" wallhub.service ;;
    runit)
      case "$action" in
        start) run sv up wallhub ;;
        stop) run sv down wallhub ;;
        restart) run sv restart wallhub ;;
        status)
          local status_output
          status_output="$(sv status wallhub 2>&1)" || return 1
          printf '%s\n' "$status_output"
          [[ "$status_output" == run:* ]] ;;
      esac ;;
    pid) run "$CONFIG_DIR/wallhubctl" "$action" ;;
    *) return 1 ;;
  esac
}

health_check() {
  stage "health-check"
  ((DRY_RUN)) && { log DRYRUN "curl http://127.0.0.1:$DEFAULT_PORT/health"; return 0; }
  local _
  for _ in {1..60}; do
    if [[ "$(curl -fsS --max-time 3 "http://127.0.0.1:$DEFAULT_PORT/health" 2>/dev/null || true)" == "ok" ]]; then log INFO "$(message health_ok)"; return 0; fi
    sleep 1
  done
  case "$SERVICE_KIND" in
    systemd) journalctl -u wallhub.service -n 100 --no-pager >>"$LOG_FILE" 2>&1 || true ;;
    runit) find "$DATA_DIR/log" -type f -maxdepth 1 -print -exec tail -n 50 {} \; >>"$LOG_FILE" 2>&1 || true ;;
    pid) tail -n 100 "$DATA_DIR/wallhub.log" >>"$LOG_FILE" 2>&1 || true ;;
  esac
  return 1
}

rollback_source() {
  [[ -n "$ROLLBACK_DIR" && -d "$ROLLBACK_DIR" ]] || return 1
  local failed
  failed="$(dirname "$INSTALL_DIR")/.wallhub-failed-$$"
  as_root mv "$INSTALL_DIR" "$failed"
  as_root mv "$ROLLBACK_DIR" "$INSTALL_DIR"
  service_action restart || true
  safe_remove_tree "$failed" "$(dirname "$INSTALL_DIR")"
}

run_install() {
  ensure_base_tools
  configure_china_mirrors
  ensure_python_runtime
  ensure_node
  ensure_dotnet
  ensure_sc302_dependencies
  acquire_source
  deploy_source
  install_node_dependencies
  prepare_runtime_layout
  ensure_python_modules
  write_runtime_env
  install_service
  write_state
  health_check || die "$EXIT_HEALTH" "WallHub /health did not become ready"
  log INFO "$(message install_ok): http://127.0.0.1:$DEFAULT_PORT"
  log INFO "Steam login, Steam Guard, real downloads and streaming must be validated manually in the UI."
}

check_dependencies() {
  local failed=0
  if find_node; then log INFO "Node: $($NODE_BIN --version)"; else log ERROR "Node >= $MIN_NODE_VERSION: missing"; failed=1; fi
  if [[ -x "$PYTHON_BIN" ]] && python_capability_probe >>"$LOG_FILE" 2>&1; then log INFO "Python MPKG modules: ready ($($PYTHON_BIN --version 2>&1))"; else log ERROR "Python MPKG modules: failed"; failed=1; fi
  if find_dotnet; then log INFO ".NET 9 SDK/runtime: ready"; else log ERROR ".NET 9 SDK/runtime: failed"; failed=1; fi
  public_integrity "$INSTALL_DIR" >>"$LOG_FILE" 2>&1 || { log ERROR "public assets: invalid"; failed=1; }
  return "$failed"
}

run_check() {
  stage "check"
  load_state
  log INFO "Platform: environment=$ENVIRONMENT os=$OS_ID family=$OS_FAMILY arch=$ARCH"
  log INFO "Install: layout=$LAYOUT code=$INSTALL_DIR data=$DATA_DIR service=$SERVICE_KIND"
  check_dependencies || die "$EXIT_DEPENDENCY" "One or more WallHub dependencies failed"
  service_action status >>"$LOG_FILE" 2>&1 || die "$EXIT_SERVICE" "WallHub service is not running"
  health_check || die "$EXIT_HEALTH" "WallHub health check failed"
}

run_repair() {
  stage "repair"
  load_state
  configure_privilege
  ensure_base_tools
  configure_china_mirrors
  ensure_python_runtime
  ensure_node
  ensure_dotnet
  repair_node_dependencies
  prepare_runtime_layout
  repair_python_modules
  write_runtime_env
  install_service
  write_state
  health_check || die "$EXIT_HEALTH" "Repair completed but /health failed"
}

ensure_clean_in_place() {
  [[ -d "$INSTALL_DIR/.git" ]] || die "$EXIT_SOURCE" "In-place update requires a Git working tree"
  [[ -z "$(git -C "$INSTALL_DIR" status --porcelain)" ]] || {
    git -C "$INSTALL_DIR" status --short >&2
    die "$EXIT_SOURCE" "In-place source has local changes; update stopped without overwriting them"
  }
}

run_update() {
  stage "update"
  load_state
  configure_privilege
  UPDATE_IN_PROGRESS=1
  if [[ "$LAYOUT" == "in-place" ]]; then
    ensure_clean_in_place
    run git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    service_action stop || die "$EXIT_SERVICE" "Could not stop WallHub before update"
    UPDATE_SERVICE_STOPPED=1
    run git -C "$INSTALL_DIR" merge --ff-only FETCH_HEAD || die "$EXIT_SOURCE" "In-place update is not a fast-forward"
  else
    FORCE_REMOTE_SOURCE=1
    acquire_source
    service_action stop || die "$EXIT_SERVICE" "Could not stop WallHub before update"
    UPDATE_SERVICE_STOPPED=1
    deploy_source
  fi
  install_node_dependencies
  prepare_runtime_layout
  repair_python_modules
  write_runtime_env
  service_action start || install_service
  write_state
  if ! health_check; then
    if [[ "$LAYOUT" == "isolated" ]] && rollback_source && health_check; then
      UPDATE_IN_PROGRESS=0; UPDATE_SERVICE_STOPPED=0
      die "$EXIT_HEALTH" "Updated version failed health check; previous code was restored"
    fi
    die "$EXIT_HEALTH" "Updated version failed health check"
  fi
  UPDATE_IN_PROGRESS=0
  UPDATE_SERVICE_STOPPED=0
}

stop_and_remove_service() {
  case "$SERVICE_KIND" in
    systemd)
      as_root systemctl disable --now wallhub.service 2>/dev/null || true
      as_root rm -f /etc/systemd/system/wallhub.service
      as_root systemctl daemon-reload ;;
    runit)
      run sv down wallhub 2>/dev/null || true
      if [[ "$PREFIX/var/service/wallhub" == "$PREFIX"/* ]]; then run rm -rf "$PREFIX/var/service/wallhub"; fi ;;
    pid) run "$CONFIG_DIR/wallhubctl" stop 2>/dev/null || true ;;
  esac
}

run_uninstall() {
  stage "uninstall"
  load_state
  configure_privilege
  stop_and_remove_service
  if [[ "$LAYOUT" == "isolated" ]]; then safe_remove_tree "$INSTALL_DIR" "$(dirname "$INSTALL_DIR")"; fi
  if ((PURGE)); then
    ask_yes_twice "Permanently remove WallHub data, settings and installer state" || die "$EXIT_USAGE" "Purge confirmation was not completed"
    restore_mirrors_internal safe || log WARN "Some mirror files were kept because the user changed them"
    safe_remove_tree "$DATA_DIR" "$(dirname "$DATA_DIR")"
    if [[ "$CONFIG_DIR" != "/" && "$CONFIG_DIR" == */wallhub-installer ]]; then safe_remove_tree "$CONFIG_DIR" "$(dirname "$CONFIG_DIR")"; fi
  else
    log INFO "WallHub code/service removed; data, settings and mirror backups were preserved at $DATA_DIR and $CONFIG_DIR"
  fi
}

run_restore_mirrors() {
  load_state
  configure_privilege
  stage "restore-mirrors"
  restore_mirrors_internal safe || die "$EXIT_DEPENDENCY" "Mirror restoration found user-modified conflicts; no conflicting file was overwritten"
  pkg_refresh || die "$EXIT_DEPENDENCY" "Original mirrors were restored but metadata refresh failed"
}

derive_raw_installer_url() {
  local slug="${REPO#https://github.com/}"; slug="${slug%.git}"; slug="${slug%/}"
  [[ "$slug" == */* && "$slug" != http* ]] || return 1
  printf 'https://raw.githubusercontent.com/%s/%s/install.sh\n' "$slug" "$BRANCH"
}

delegate_to_proot() {
  [[ "$ENVIRONMENT" == "termux" && "$TARGET" == "proot" ]] || return 1
  stage "proot-bootstrap"
  ensure_command_package proot-distro proot-distro
  local rootfs="$PREFIX/var/lib/proot-distro/installed-rootfs/$PROOT_DISTRO"
  if [[ ! -d "$rootfs" ]]; then run proot-distro install "$PROOT_DISTRO"; fi
  local installer="$TEMP_DIR/install.sh" raw
  if [[ -r "${BASH_SOURCE[0]}" && "${BASH_SOURCE[0]}" != /dev/* ]]; then cp "${BASH_SOURCE[0]}" "$installer"
  else
    raw="$(derive_raw_installer_url || true)"; [[ -n "$raw" ]] || die "$EXIT_SOURCE" "Cannot derive installer URL for Proot delegation"
    download_file "$raw" "$installer" || die "$EXIT_SOURCE" "Cannot download installer for Proot"
  fi
  local -a args=("$COMMAND" --target proot --proot-distro "$PROOT_DISTRO" --mirror "$MIRROR" --layout "$LAYOUT" --repo "$REPO" --branch "$BRANCH" --sc302-deps "$SC302_DEPS" --lang "$LANGUAGE")
  [[ -n "$INSTALL_DIR" ]] && args+=(--install-dir "$INSTALL_DIR")
  [[ -n "$DATA_DIR" ]] && args+=(--data-dir "$DATA_DIR")
  ((NON_INTERACTIVE)) && args+=(--non-interactive)
  ((ASSUME_YES)) && args+=(--yes)
  ((BUILD_UI)) && args+=(--build-ui)
  ((VERBOSE)) && args+=(--verbose)
  ((DRY_RUN)) && args+=(--dry-run)
  ((PURGE)) && args+=(--purge)
  run proot-distro login "$PROOT_DISTRO" -- bash -s -- "${args[@]}" <"$installer"
}

main() {
  parse_args "$@"
  select_language
  init_temp
  log INFO "$(message start)"
  open_tty
  detect_environment
  interactive_defaults
  if [[ "$ENVIRONMENT" == "termux" && "$TARGET" == "proot" ]]; then
    configure_privilege
    ensure_base_tools
    delegate_to_proot
    return
  fi
  resolve_paths
  configure_privilege
  if [[ "$COMMAND" == "install" ]]; then ensure_config_dir; fi
  case "$COMMAND" in
    install) run_install ;;
    check) run_check ;;
    repair) run_repair ;;
    update) run_update ;;
    uninstall) run_uninstall ;;
    restore-mirrors) run_restore_mirrors ;;
  esac
}

if [[ "${WALLHUB_INSTALLER_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
