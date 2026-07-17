#!/usr/bin/env bash
# Globals and test doubles in this harness are consumed indirectly by sourced installer functions.
# shellcheck disable=SC2030,SC2031,SC2034,SC2329

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export WALLHUB_INSTALLER_SOURCE_ONLY=1
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../../install.sh
source "$ROOT/install.sh"
trap - EXIT ERR INT TERM

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wallhub-installer-tests.XXXXXXXX")"
trap 'rm -rf -- "$TEST_TMP"' EXIT
TESTS=0

pass() {
  TESTS=$((TESTS + 1))
  printf 'ok %d - %s\n' "$TESTS" "$1"
}

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  [[ "$expected" == "$actual" ]] || fail "$label (expected=$expected actual=$actual)"
  pass "$label"
}

assert_file_contains() {
  local file="$1" text="$2" label="$3"
  grep -Fq -- "$text" "$file" || fail "$label"
  pass "$label"
}

assert_file_not_contains() {
  local file="$1" text="$2" label="$3"
  if grep -Fq -- "$text" "$file"; then fail "$label"; fi
  pass "$label"
}

write_os_release() {
  local name="$1" id="$2" like="${3:-}" file
  file="$TEST_TMP/$name.os-release"
  printf 'ID=%s\nID_LIKE="%s"\nVERSION_CODENAME=test\n' "$id" "$like" >"$file"
  printf '%s\n' "$file"
}

reset_detection() {
  TARGET="auto"; ENVIRONMENT=""; OS_ID=""; OS_ID_LIKE=""; OS_CODENAME=""; OS_FAMILY=""; PKG_MANAGER=""; ARCH=""
  unset TERMUX_VERSION PREFIX PROOT_TMP_DIR PROOT_LOADER
  WALLHUB_UNAME_M="x86_64"
  LANGUAGE="en"; LOG_FILE="$TEST_TMP/test.log"; : >"$LOG_FILE"
}

version_ge 16.17.0 16.17.0 || fail "equal version"
pass "equal version is accepted"
version_ge 22.1.0 16.17.0 || fail "newer version"
pass "newer version is accepted"
if version_ge 16.16.9 16.17.0; then fail "older version"; fi
pass "older version is rejected"

dependency_shims="$TEST_TMP/dependency-shims"
mkdir -p "$dependency_shims"
cat >"$dependency_shims/node" <<'SHIM'
#!/usr/bin/env bash
case "${1:-}" in
  --version) printf 'v16.17.0\n' ;;
  -p) printf '16\n' ;;
  *) exit 0 ;;
esac
SHIM
cat >"$dependency_shims/npm" <<'SHIM'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then printf '8.15.0\n'; else exit 0; fi
SHIM
cat >"$dependency_shims/dotnet" <<'SHIM'
#!/usr/bin/env bash
case "${1:-}" in
  --info) printf '.NET SDK 9 test\n' ;;
  --list-sdks) printf '9.0.100 [/tmp/dotnet/sdk]\n' ;;
  --list-runtimes) printf 'Microsoft.NETCore.App 9.0.0 [/tmp/dotnet/shared]\n' ;;
  *) exit 1 ;;
esac
SHIM
chmod 700 "$dependency_shims/node" "$dependency_shims/npm" "$dependency_shims/dotnet"
(
  PATH="$dependency_shims:$PATH"; export PATH
  NODE_BIN=""; NPM_BIN=""; TOOLCHAIN_DIR="$TEST_TMP/no-toolchain"
  find_node
  [[ "$NODE_BIN" == "$dependency_shims/node" && "$NPM_BIN" == "$dependency_shims/npm" ]]
  DOTNET_BIN=""; DOTNET_ROOT_DIR=""
  find_dotnet
  [[ "$DOTNET_BIN" == "$dependency_shims/dotnet" && "$DOTNET_ROOT_DIR" == "$dependency_shims" ]]
) || fail "Node and .NET capability shims"
pass "Node minimum version and npm capability probe"
pass ".NET 9 SDK and Runtime capability probe"

cat >"$dependency_shims/dotnet-proot" <<'SHIM'
#!/usr/bin/env bash
[[ "${DOTNET_gcServer:-}" == 0 && "${DOTNET_GCHeapHardLimit:-}" == 10000000 ]] || exit 70
exec "$(dirname "$0")/dotnet" "$@"
SHIM
chmod 700 "$dependency_shims/dotnet-proot"
(
  ENVIRONMENT=proot
  dotnet_capability_probe "$dependency_shims/dotnet-proot"
) || fail "Proot .NET GC compatibility probe"
pass "Proot .NET capability probe uses the bounded GC environment"

node_without_npm="$TEST_TMP/node-without-npm"
mkdir -p "$node_without_npm"
cp "$dependency_shims/node" "$node_without_npm/node"
(
  NODE_BIN=""; NPM_BIN=""; TOOLCHAIN_DIR="$TEST_TMP/no-node-toolchain"
  TEMP_DIR="$TEST_TMP/node-package-temp"; LOG_FILE="$TEST_TMP/node-package.log"
  ENVIRONMENT=linux; PKG_MANAGER=apt; DRY_RUN=0; LANGUAGE=en
  mkdir -p "$TEMP_DIR"; : >"$LOG_FILE"
  command_path() {
    case "$1" in
      node) printf '%s\n' "$node_without_npm/node" ;;
      npm) [[ -x "$node_without_npm/npm" ]] && printf '%s\n' "$node_without_npm/npm" ;;
    esac
  }
  install_first_candidate() {
    [[ "$#" -eq 3 && "$1" == npm && "$2" == npm && "$3" == npm16 ]] || return 1
    cp "$dependency_shims/npm" "$node_without_npm/npm"
    chmod 700 "$node_without_npm/npm"
  }
  install_portable_node() { fail "portable Node used before the independent npm package"; }
  ensure_node
  [[ "$NODE_BIN" == "$node_without_npm/node" && "$NPM_BIN" == "$node_without_npm/npm" ]]
) || fail "system Node with separately packaged npm"
pass "system Node installs and validates a separately packaged npm"

node_without_package="$TEST_TMP/node-without-npm-package"
portable_node="$TEST_TMP/portable-node/bin"
mkdir -p "$node_without_package" "$portable_node"
cp "$dependency_shims/node" "$node_without_package/node"
(
  NODE_BIN=""; NPM_BIN=""; TOOLCHAIN_DIR="$TEST_TMP/portable-toolchain"
  TEMP_DIR="$TEST_TMP/node-fallback-temp"; LOG_FILE="$TEST_TMP/node-fallback.log"
  ENVIRONMENT=linux; PKG_MANAGER=apt; DRY_RUN=0; LANGUAGE=en
  mkdir -p "$TEMP_DIR"; : >"$LOG_FILE"
  command_path() {
    [[ "$1" == node ]] && printf '%s\n' "$node_without_package/node"
  }
  install_first_candidate() { return 1; }
  install_portable_node() {
    cp "$dependency_shims/node" "$portable_node/node"
    cp "$dependency_shims/npm" "$portable_node/npm"
    chmod 700 "$portable_node/node" "$portable_node/npm"
    NODE_BIN="$portable_node/node"
    NPM_BIN="$portable_node/npm"
    : >"$TEST_TMP/portable-node-used"
  }
  ensure_node
  [[ -f "$TEST_TMP/portable-node-used" && "$NODE_BIN" == "$portable_node/node" && "$NPM_BIN" == "$portable_node/npm" ]]
) || fail "portable Node fallback when npm package is unavailable"
pass "missing independent npm package falls back to a complete portable Node"

set +e
WALLHUB_INSTALLER_SOURCE_ONLY=0 bash "$ROOT/install.sh" --target invalid --non-interactive >/dev/null 2>&1
code=$?
set -e
assert_eq 2 "$code" "invalid argument exits with status 2"
set +e
WALLHUB_INSTALLER_SOURCE_ONLY=0 bash "$ROOT/install.sh" --repo 'https://demo:demo@example.invalid/project.git' --non-interactive >/dev/null 2>&1
code=$?
set -e
assert_eq 2 "$code" "repository URL rejects embedded credentials"

for installer_command in install check repair update uninstall restore-mirrors; do
  COMMAND=install; TARGET=auto; NON_INTERACTIVE=0; DRY_RUN=0
  parse_args "$installer_command" --non-interactive --dry-run
  assert_eq "$installer_command" "$COMMAND" "parse subcommand $installer_command"
done

redacted="$(printf '%s\n' 'https://demo-user:demo-pass@example.invalid/path token=demo-token' | redact)"
[[ "$redacted" != *demo-pass* && "$redacted" != *demo-token* ]] || fail "log redaction"
pass "log redaction removes URL credentials and token values"

for row in \
  "debian:debian::debian:apt" \
  "ubuntu:ubuntu:debian:debian:apt" \
  "fedora:fedora::fedora:dnf" \
  "rocky:rocky:rhel fedora:fedora:dnf" \
  "arch:arch::arch:pacman" \
  "opensuse:opensuse-leap:suse opensuse:suse:zypper"; do
  IFS=: read -r name id like family manager <<<"$row"
  reset_detection
  OS_RELEASE_FILE="$(write_os_release "$name" "$id" "$like")"
  detect_environment
  assert_eq "$family" "$OS_FAMILY" "$name family detection"
  assert_eq "$manager" "$PKG_MANAGER" "$name package manager detection"
done

reset_detection
OS_RELEASE_FILE="$(write_os_release arm64 debian debian)"
WALLHUB_UNAME_M="aarch64"
detect_environment
assert_eq arm64 "$ARCH" "aarch64 normalizes to arm64"

reset_detection
TERMUX_VERSION="0.118.1"; PREFIX="/data/data/com.termux/files/usr"
detect_environment
assert_eq termux "$ENVIRONMENT" "native Termux detection"
assert_eq pkg "$PKG_MANAGER" "native Termux package manager"

reset_detection
TARGET="proot"; OS_RELEASE_FILE="$(write_os_release proot debian debian)"
detect_environment
assert_eq proot "$ENVIRONMENT" "explicit Proot detection"

set +e
WALLHUB_INSTALLER_SOURCE_ONLY=0 WALLHUB_UNAME_M=armv7l bash "$ROOT/install.sh" install --target linux --non-interactive --dry-run >/dev/null 2>&1
code=$?
set -e
assert_eq 10 "$code" "unsupported architecture exits with status 10"

LANGUAGE=zh
assert_eq "演练模式" "$(message dry_run)" "Chinese message table"
LANGUAGE=en
assert_eq "dry run" "$(message dry_run)" "English message table"

reset_detection
ENVIRONMENT=linux; LAYOUT=isolated; INSTALL_DIR=""; DATA_DIR=""
resolve_paths
assert_eq /opt/wallhub "$INSTALL_DIR" "isolated Linux code path"
assert_eq /var/lib/wallhub "$DATA_DIR" "isolated Linux data path"

ENVIRONMENT=termux; PREFIX="$TEST_TMP/termux-prefix"; HOME="$TEST_TMP/termux-home"; LAYOUT=isolated; INSTALL_DIR=""; DATA_DIR=""
resolve_paths
assert_eq "$HOME/.local/share/wallhub" "$INSTALL_DIR" "Termux code path"
assert_eq "$HOME/.local/state/wallhub" "$DATA_DIR" "Termux state path"

google_reachable() { return 1; }
mapfile -t routes < <(github_candidates "https://github.com/example/project/archive/main.tar.gz")
assert_eq 3 "${#routes[@]}" "GitHub fallback includes two proxies and direct"
assert_eq "https://gh-proxy.com/https://github.com/example/project/archive/main.tar.gz" "${routes[0]}" "first GitHub proxy order"
mapfile -t routes < <(github_candidates "https://nodejs.org/dist/index.json")
assert_eq 1 "${#routes[@]}" "non-GitHub download bypasses GitHub proxies"

shim_dir="$TEST_TMP/shims"; shim_log="$TEST_TMP/shims.log"
mkdir -p "$shim_dir"
cat >"$shim_dir/package-shim" <<'SHIM'
#!/usr/bin/env bash
printf '%s %s\n' "$(basename "$0")" "$*" >>"$WALLHUB_SHIM_LOG"
exit 0
SHIM
chmod 700 "$shim_dir/package-shim"
for shim in apt-get apt-cache dnf pacman zypper pkg dpkg proot-distro; do ln -s package-shim "$shim_dir/$shim"; done
cat >"$shim_dir/uname" <<'SHIM'
#!/usr/bin/env bash
printf 'aarch64\n'
SHIM
chmod 700 "$shim_dir/uname"
cat >"$shim_dir/ping" <<'SHIM'
#!/usr/bin/env bash
printf 'ping\n' >>"$WALLHUB_PING_LOG"
exit 1
SHIM
cat >"$shim_dir/curl" <<'SHIM'
#!/usr/bin/env bash
output="" url="${*: -1}"
while (($#)); do
  if [[ "$1" == -o ]]; then output="$2"; shift 2; else shift; fi
done
printf '%s\n' "$url" >>"$WALLHUB_CURL_LOG"
case "$url" in
  https://github.com/*) printf 'direct-ok\n' >"$output"; exit 0 ;;
  *) exit 22 ;;
esac
SHIM
chmod 700 "$shim_dir/ping" "$shim_dir/curl"

curl_log="$TEST_TMP/curl.log"; ping_log="$TEST_TMP/ping.log"
WALLHUB_INSTALLER_SOURCE_ONLY=1 PATH="$shim_dir:$PATH" WALLHUB_CURL_LOG="$curl_log" WALLHUB_PING_LOG="$ping_log" bash -c '
  source "$1"
  trap - EXIT ERR INT TERM
  LANGUAGE=en; GOOGLE_REACHABLE=unknown; TEMP_DIR="$2"; LOG_FILE="$3"; DRY_RUN=0
  mkdir -p "$TEMP_DIR"; : >"$LOG_FILE"
  download_file "https://github.com/example/project/archive/main.tar.gz" "$4"
  github_candidates "https://github.com/example/project/archive/main.tar.gz" >/dev/null
' bash "$ROOT/install.sh" "$TEST_TMP/download-temp" "$TEST_TMP/download.log" "$TEST_TMP/download.out"
assert_eq 3 "$(wc -l <"$curl_log" | tr -d ' ')" "two failed GitHub proxies fall back to direct"
assert_eq 1 "$(wc -l <"$ping_log" | tr -d ' ')" "Google reachability is probed once"
assert_eq direct-ok "$(tr -d '\n' <"$TEST_TMP/download.out")" "direct GitHub fallback writes requested file"
(
  export PATH="$shim_dir:$PATH" WALLHUB_SHIM_LOG="$shim_log"
  unset WALLHUB_UNAME_M
  reset_detection
  unset WALLHUB_UNAME_M
  OS_RELEASE_FILE="$(write_os_release shim-arch debian debian)"
  detect_environment
  [[ "$ARCH" == arm64 ]]
  as_root() { command "$@"; }
  run() { command "$@"; }
  DRY_RUN=0
  PACMAN_KEYRING_READY=1
  for manager in apt dnf pacman zypper pkg; do
    PKG_MANAGER="$manager"; PACKAGE_INDEX_UPDATED=0
    pkg_refresh
    pkg_install wallhub-test-package
  done
)
assert_file_contains "$shim_log" 'apt-get -o Acquire::Retries=3 -o APT::Update::Error-Mode=any update' "apt command shim"
assert_file_contains "$shim_log" 'dnf -y makecache' "dnf command shim"
assert_file_contains "$shim_log" 'pacman -Syu --noconfirm' "pacman command shim"
assert_file_contains "$shim_log" 'zypper --non-interactive refresh' "zypper command shim"
assert_file_contains "$shim_log" 'pkg update -y' "Termux pkg command shim"
pass "uname command shim drives arm64 detection"

proot_apt_log="$TEST_TMP/proot-apt.log"
proot_bootstrap_ca="$TEST_TMP/proot-bootstrap-ca.pem"
printf 'test-ca\n' >"$proot_bootstrap_ca"
(
  export PATH="$shim_dir:$PATH" WALLHUB_SHIM_LOG="$proot_apt_log"
  export WALLHUB_PROOT_BOOTSTRAP_CA="$proot_bootstrap_ca"
  ENVIRONMENT=proot; PKG_MANAGER=apt; PACKAGE_INDEX_UPDATED=0; DRY_RUN=0
  as_root() { command "$@"; }
  pkg_refresh
  pkg_install wallhub-test-package
)
assert_file_contains "$proot_apt_log" "Acquire::https::CaInfo=$proot_bootstrap_ca" "Proot apt uses the read-only bootstrap CA"
assert_file_not_contains "$proot_apt_log" 'Acquire::ForceIPv4=true' "Proot apt preserves the detected IPv4 and IPv6 routes"

pacman_sandbox_log="$TEST_TMP/pacman-sandbox.log"
(
  PKG_MANAGER=pacman; PACKAGE_INDEX_UPDATED=0; PACMAN_DISABLE_SANDBOX=0; PACMAN_KEYRING_READY=1; DRY_RUN=0
  LOG_FILE="$TEST_TMP/pacman-sandbox-installer.log"; : >"$LOG_FILE"
  pacman() {
    printf '%q ' "$@" >>"$pacman_sandbox_log"; printf '\n' >>"$pacman_sandbox_log"
    if [[ "$*" == "-Sh" ]]; then
      printf '%s\n' 'pacman options:' '  --disable-sandbox' '  --verbose' '  --version'
      return 0
    fi
    [[ "$*" == *--disable-sandbox* ]]
  }
  as_root() { "$@"; }
  pkg_refresh
  pkg_install wallhub-test-package
)
assert_file_contains "$pacman_sandbox_log" '-Syu --noconfirm' "pacman attempts its default sandbox first"
assert_file_contains "$pacman_sandbox_log" '-Syu --noconfirm --disable-sandbox' "pacman upgrade retries without an unavailable sandbox"
assert_file_contains "$pacman_sandbox_log" '-S --needed --noconfirm wallhub-test-package --disable-sandbox' "pacman install retains the compatibility flag"
pass "pacman sandbox compatibility fallback"

pacman_keyring_dir="$TEST_TMP/pacman-keyrings"
pacman_keyring_log="$TEST_TMP/pacman-keyring.log"
pacman_keyring_ready_marker="$TEST_TMP/pacman-keyring.ready"
mkdir -p "$pacman_keyring_dir"
: >"$pacman_keyring_dir/archlinux-trusted"
: >"$pacman_keyring_dir/vendor-trusted"
(
  PACMAN_KEYRING_READY=0; PACMAN_KEYRING_SOURCE_DIR="$pacman_keyring_dir"; DRY_RUN=0
  LOG_FILE="$TEST_TMP/pacman-keyring-installer.log"; : >"$LOG_FILE"
  # Invoked indirectly through the as_root wrappers used by the installer.
  # shellcheck disable=SC2317,SC2329
  pacman-key() {
    printf '%q ' "$@" >>"$pacman_keyring_log"; printf '\n' >>"$pacman_keyring_log"
    case "$1" in
      --list-keys) [[ -f "$pacman_keyring_ready_marker" ]] ;;
      --init) : ;;
      --populate) touch "$pacman_keyring_ready_marker" ;;
      *) return 1 ;;
    esac
  }
  as_root() { "$@"; }
  as_root_quiet() { "$@"; }
  ensure_pacman_keyring
  ((PACMAN_KEYRING_READY == 1))
)
assert_file_contains "$pacman_keyring_log" '--init' "missing pacman keyring is initialized"
assert_file_contains "$pacman_keyring_log" '--populate archlinux vendor' "all installed pacman keyrings are populated"
pass "pacman keyring initialization fallback"

if (
  PKG_MANAGER=apt; PACKAGE_INDEX_UPDATED=0; DRY_RUN=0; LOG_FILE="$TEST_TMP/package-refresh-failure.log"
  as_root() { return 23; }
  pkg_refresh
); then
  fail "package index refresh failure was ignored"
fi
pass "package index refresh failure propagates"

candidate_refresh_log="$TEST_TMP/package-candidate-refresh.log"
(
  DRY_RUN=0; PACKAGE_INDEX_UPDATED=0
  pkg_refresh() { printf 'refresh\n' >>"$candidate_refresh_log"; PACKAGE_INDEX_UPDATED=1; }
  pkg_candidate_exists() { [[ "$PACKAGE_INDEX_UPDATED" == 1 && "$1" == curl ]]; }
  pkg_install() { printf 'install %s\n' "$1" >>"$candidate_refresh_log"; }
  install_first_candidate curl curl
)
assert_eq $'refresh\ninstall curl' "$(cat "$candidate_refresh_log")" "package index refresh precedes candidate lookup"

if (
  DRY_RUN=0; LOG_FILE="$TEST_TMP/package-install-failure.log"
  pkg_refresh() { :; }
  pkg_candidate_exists() { return 0; }
  pkg_install() { return 24; }
  pkg_search_diagnostic() { :; }
  install_first_candidate curl curl
); then
  fail "package candidate install failure was ignored"
fi
pass "package candidate install failure propagates"

partial_toolchain="$TEST_TMP/partial-python-toolchain"
fake_system_python="$TEST_TMP/fake-system-python"
healthy_venv_python="$TEST_TMP/healthy-venv-python"
mkdir -p "$partial_toolchain/python-venv/bin"
printf '#!/bin/sh\nexit 1\n' >"$partial_toolchain/python-venv/bin/python"
printf '#!/bin/sh\nexit 0\n' >"$fake_system_python"
cat >"$healthy_venv_python" <<'SHIM'
#!/bin/sh
[ "$1" = -m ] && [ "$2" = pip ]
SHIM
chmod 700 "$partial_toolchain/python-venv/bin/python" "$fake_system_python" "$healthy_venv_python"
(
  TOOLCHAIN_DIR="$partial_toolchain"; DRY_RUN=0; OS_FAMILY=debian; LOG_FILE="$TEST_TMP/partial-python.log"
  find_python() { printf '%s\n' "$fake_system_python"; }
  as_root() { command "$@"; }
  as_root_quiet() {
    if [[ "$1" == "$fake_system_python" && "$2" == -m && "$3" == venv ]]; then
      local target="${*: -1}"
      mkdir -p "$target/bin"
      cp "$healthy_venv_python" "$target/bin/python"
      chmod 700 "$target/bin/python"
      return 0
    fi
    command "$@"
  }
  ensure_python_runtime
  "$PYTHON_BIN" -m pip --version
) || fail "incomplete Python venv was not rebuilt"
pass "incomplete Python venv is rebuilt"

delegate_log="$TEST_TMP/delegate.log"
(
  export PATH="$shim_dir:$PATH" WALLHUB_SHIM_LOG="$shim_log"
  ENVIRONMENT=termux; TARGET=proot; COMMAND=repair; PROOT_DISTRO=ubuntu
  PREFIX="$TEST_TMP/com.termux/files/usr"; TEMP_DIR="$TEST_TMP/delegate-temp"; LOG_FILE="$TEST_TMP/delegate-installer.log"
  MIRROR=china; LAYOUT=isolated; REPO="$DEFAULT_REPO"; BRANCH="installer-validation"; SC302_DEPS=no; LANGUAGE=en
  NON_INTERACTIVE=1; ASSUME_YES=1; BUILD_UI=0; VERBOSE=0; DRY_RUN=0; PURGE=0; INSTALL_DIR=""; DATA_DIR=""
  mkdir -p "$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs" "$PREFIX/etc/tls" "$TEMP_DIR"
  printf 'test-ca\n' >"$PREFIX/etc/tls/cert.pem"
  ensure_command_package() { :; }
  prepare_proot_resolver() { PROOT_RESOLVER_FILE="$TEST_TMP/managed-resolver"; PROOT_HOST_CTL="$TEST_TMP/hostctl"; PROOT_HOST_CA_FILE="$PREFIX/etc/tls/cert.pem"; }
  run() { printf '%q ' "$@" >>"$delegate_log"; printf '\n' >>"$delegate_log"; }
  run_proot_installer() { shift; printf '%q ' "$@" >>"$delegate_log"; printf '\n' >>"$delegate_log"; }
  delegate_to_proot
)
assert_file_contains "$delegate_log" 'proot-distro login --redirect-ports --isolated --bind' "Termux delegates through an isolated Proot session"
assert_file_not_contains "$delegate_log" 'proot-distro install ubuntu' "current Proot storage layout is recognized"
assert_file_contains "$delegate_log" '/usr/bin/env -i HOME=/root USER=root LOGNAME=root SHELL=/bin/bash PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' "Proot delegation starts with an isolated runtime environment"
assert_file_contains "$delegate_log" '/bin/bash -s -- repair --target proot' "Proot delegation uses the container Bash"
assert_file_not_contains "$delegate_log" "$PREFIX/bin" "Proot runtime command does not contain the Termux executable path"
assert_file_contains "$delegate_log" '--isolated --bind' "Proot delegation disables implicit host filesystem bindings"
assert_file_contains "$delegate_log" 'managed-resolver:/etc/resolv.conf' "Proot delegation binds the managed resolver"
assert_file_contains "$delegate_log" 'cert.pem:/run/wallhub-bootstrap-ca.pem' "Proot delegation binds the native Termux CA bundle"
assert_file_contains "$delegate_log" 'WALLHUB_PROOT_BOOTSTRAP_CA=/run/wallhub-bootstrap-ca.pem' "Proot delegation exposes only the guest CA path"
assert_file_contains "$delegate_log" 'login --redirect-ports --isolated' "Proot delegation redirects privileged DNS traffic to the host bridge"
assert_file_contains "$delegate_log" 'hostctl session-stop' "Proot repair stops the previous detached service session"
assert_file_contains "$delegate_log" 'hostctl start' "Proot repair restarts the detached service session"
assert_file_contains "$delegate_log" 'repair --target proot' "Proot delegation preserves maintenance subcommand"
assert_file_contains "$delegate_log" '--branch installer-validation' "Proot delegation preserves branch"

(
  PREFIX="$TEST_TMP/legacy-proot"; PROOT_DISTRO=debian
  mkdir -p "$PREFIX/var/lib/proot-distro/installed-rootfs/debian"
  proot_distro_is_installed
) || fail "legacy Proot storage layout recognition"
pass "legacy Proot storage layout is recognized"

missing_delegate_log="$TEST_TMP/missing-delegate.log"
(
  export PATH="$shim_dir:$PATH" WALLHUB_SHIM_LOG="$shim_log"
  ENVIRONMENT=termux; TARGET=proot; COMMAND=install; PROOT_DISTRO=debian
  PREFIX="$TEST_TMP/missing-proot"; TEMP_DIR="$TEST_TMP/missing-delegate-temp"; LOG_FILE="$TEST_TMP/missing-delegate-installer.log"
  MIRROR=official; LAYOUT=isolated; REPO="$DEFAULT_REPO"; BRANCH=main; SC302_DEPS=no; LANGUAGE=en
  NON_INTERACTIVE=1; ASSUME_YES=1; BUILD_UI=0; VERBOSE=0; DRY_RUN=0; PURGE=0; INSTALL_DIR=""; DATA_DIR=""
  mkdir -p "$PREFIX/etc/tls" "$TEMP_DIR"
  printf 'test-ca\n' >"$PREFIX/etc/tls/cert.pem"
  ensure_command_package() { :; }
  prepare_proot_resolver() { PROOT_RESOLVER_FILE="$TEST_TMP/managed-resolver"; PROOT_HOST_CTL="$TEST_TMP/hostctl"; PROOT_HOST_CA_FILE="$PREFIX/etc/tls/cert.pem"; }
  run() { printf '%q ' "$@" >>"$missing_delegate_log"; printf '\n' >>"$missing_delegate_log"; }
  run_proot_installer() { shift; printf '%q ' "$@" >>"$missing_delegate_log"; printf '\n' >>"$missing_delegate_log"; }
  delegate_to_proot
)
assert_file_contains "$missing_delegate_log" 'proot-distro install debian' "missing Proot distribution is installed"

resolver_root="$TEST_TMP/proot-resolver-selection"
(
  PREFIX="$resolver_root/prefix"; PROOT_DISTRO=debian; TEMP_DIR="$resolver_root/temp"; LOG_FILE="$resolver_root/installer.log"
  DRY_RUN=0; mkdir -p "$PREFIX/etc/tls" "$TEMP_DIR"; printf 'test-ca\n' >"$PREFIX/etc/tls/cert.pem"; : >"$LOG_FILE"
  host_python="$(command -v python3 || command -v python)"
  ensure_command_package() { :; }
  command_path() {
    case "$1" in
      python3|python) printf '%s\n' "$host_python" ;;
      proot-distro) printf '/test/bin/proot-distro\n' ;;
      curl) printf '/test/bin/curl\n' ;;
    esac
  }
  run() {
    if [[ "$1" == "$PROOT_HOST_CTL" && "${2:-}" == dns-start ]]; then return 0; fi
    command "$@"
  }
  proot_resolver_works() { grep -Fq 'nameserver 127.0.0.1' "$1"; }
  prepare_proot_resolver
  grep -Fq 'nameserver 127.0.0.1' "$PROOT_RESOLVER_FILE"
  grep -Fq 'query_type in (1, 28)' "$PROOT_HOST_CONFIG/dns_bridge.py"
  [[ "$PROOT_HOST_CA_FILE" == "$PREFIX/etc/tls/cert.pem" ]]
  "$host_python" -m py_compile "$PROOT_HOST_CONFIG/dns_bridge.py"
  bash -n "$PROOT_HOST_CTL"
  grep -Fq 'login --detach --no-kill-on-exit' "$PROOT_HOST_CTL"
  grep -Fq -- '--redirect-ports --isolated' "$PROOT_HOST_CTL"
) || fail "managed Proot host runtime generation"
pass "Proot resolver uses the loopback DNS bridge"
pass "generated Proot DNS bridge passes Python compilation"
pass "generated Proot host controller passes Bash syntax and detached-session checks"

proot_runner_input="$TEST_TMP/proot-runner-input"
proot_runner_log="$TEST_TMP/proot-runner.log"
printf 'candidate input\n' >"$proot_runner_input"
set +e
(
  DRY_RUN=0; LOG_FILE="$proot_runner_log"; : >"$LOG_FILE"
  run_proot_installer "$proot_runner_input" bash -c 'cat; exit 23'
)
code=$?
set -e
assert_eq 23 "$code" "Proot logging pipeline propagates delegated exit status"
assert_file_contains "$proot_runner_log" 'candidate input' "Proot logging pipeline records delegated output"

sc302_log="$TEST_TMP/sc302.log"
(
  SC302_DEPS=yes; ENVIRONMENT=linux; DRY_RUN=0; LOG_FILE="$TEST_TMP/sc302-installer.log"
  install_first_candidate() { printf '%q ' "$@" >>"$sc302_log"; printf '\n' >>"$sc302_log"; }
  for OS_FAMILY in debian fedora arch suse; do ensure_sc302_dependencies; done
)
assert_file_contains "$sc302_log" 'libnss3-tools libnss3-tools' "Debian SC302 NSS candidate"
assert_file_contains "$sc302_log" 'libnetfilter_queue libnetfilter_queue' "Fedora/Arch SC302 netfilter candidate"
assert_file_contains "$sc302_log" 'mozilla-nss-tools mozilla-nss-tools' "openSUSE SC302 NSS candidate"

make_source_fixture() {
  local root="$1" version="$2"
  mkdir -p "$root/src/domains/downloads" "$root/frontend" "$root/tools/mpkg" "$root/public/assets" "$root/Downloads" "$root/downloads" "$root/SteamKit"
  printf '{}\n' >"$root/package.json"; printf '{"lockfileVersion":2}\n' >"$root/package-lock.json"
  printf '// server\n' >"$root/server.js"; printf '%s\n' "$version" >"$root/version.txt"
  printf '<script src="/assets/app.js"></script>\n' >"$root/public/index.html"; printf 'ok\n' >"$root/public/assets/app.js"
  printf 'module.exports = {};\n' >"$root/src/domains/downloads/preparedDownloads.js"
  printf 'runtime\n' >"$root/Downloads/private.txt"; printf 'runtime\n' >"$root/downloads/private.txt"; printf 'session\n' >"$root/SteamKit/account.txt"
}
source_one="$TEST_TMP/source-one"; source_two="$TEST_TMP/source-two"
make_source_fixture "$source_one" one; make_source_fixture "$source_two" two
tar -czf "$TEST_TMP/source.tar.gz" -C "$source_one" .
if command -v zip >/dev/null 2>&1; then
  (cd "$source_one" && zip -qr "$TEST_TMP/source.zip" .)
else
  (cd "$TEST_TMP" && python3 -m zipfile -c "$TEST_TMP/source.zip" source-one)
fi
archive_path="$PATH"
if ! command -v unzip >/dev/null 2>&1; then
  archive_shims="$TEST_TMP/archive-shims"; mkdir -p "$archive_shims"
  cat >"$archive_shims/unzip" <<'SHIM'
#!/usr/bin/env bash
case "$1" in
  -tqq) python3 - "$2" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
PY
    ;;
  -Z1) python3 - "$2" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    print("\n".join(archive.namelist()))
PY
    ;;
  -q) python3 - "$2" "$4" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2])
PY
    ;;
  *) exit 2 ;;
esac
SHIM
  chmod 700 "$archive_shims/unzip"
  PATH="$archive_shims:$PATH"
fi
archive_members_are_safe "$TEST_TMP/source.tar.gz" tar || fail "safe tar archive validation"
pass "safe tar archive validation"
archive_members_are_safe "$TEST_TMP/source.zip" zip || fail "safe ZIP archive validation"
pass "safe ZIP archive validation"
mkdir -p "$TEST_TMP/unsafe-source"; printf 'unsafe\n' >"$TEST_TMP/unsafe-source/payload"
tar -czf "$TEST_TMP/unsafe.tar.gz" --transform='s#payload#../escape#' -C "$TEST_TMP/unsafe-source" payload
if archive_members_are_safe "$TEST_TMP/unsafe.tar.gz" tar; then fail "unsafe archive member validation"; fi
pass "archive traversal member is rejected"

(
  FORCE_REMOTE_SOURCE=1; REPO="$DEFAULT_REPO"; BRANCH=v-test; TEMP_DIR="$TEST_TMP/tag-acquire"; LOG_FILE="$TEST_TMP/tag-acquire.log"; DRY_RUN=0
  mkdir -p "$TEMP_DIR"; : >"$LOG_FILE"
  download_file() {
    printf '%s\n' "$1" >>"$TEST_TMP/tag-routes.log"
    [[ "$1" == */refs/tags/* ]] || return 1
    cp "$TEST_TMP/source.tar.gz" "$2"
  }
  acquire_source
  [[ -f "$SOURCE_DIR/version.txt" ]]
)
assert_file_contains "$TEST_TMP/tag-routes.log" '/refs/heads/v-test.tar.gz' "GitHub branch archive attempted first"
assert_file_contains "$TEST_TMP/tag-routes.log" '/refs/tags/v-test.tar.gz' "GitHub tag archive fallback"
(
  FORCE_REMOTE_SOURCE=1; REPO="https://example.invalid/wallhub.zip"; BRANCH=ignored; TEMP_DIR="$TEST_TMP/zip-acquire"; LOG_FILE="$TEST_TMP/zip-acquire.log"; DRY_RUN=0
  mkdir -p "$TEMP_DIR"; : >"$LOG_FILE"
  download_file() { cp "$TEST_TMP/source.zip" "$2"; }
  acquire_source
  [[ -f "$SOURCE_DIR/version.txt" ]]
) || fail "ZIP repository URL acquisition"
pass "ZIP repository URL acquisition"
PATH="$archive_path"

ENVIRONMENT=proot; LAYOUT=isolated; INSTALL_DIR="$TEST_TMP/atomic/wallhub"; DATA_DIR="$TEST_TMP/atomic-data"; LOG_FILE="$TEST_TMP/atomic.log"; TEMP_DIR="$TEST_TMP/atomic-temp"; DRY_RUN=0; ROOT_PREFIX=(); ROLLBACK_DIR=""
mkdir -p "$TEMP_DIR"
SOURCE_DIR="$source_one"; deploy_source
assert_eq one "$(tr -d '\n' <"$INSTALL_DIR/version.txt")" "initial isolated source deployment"
[[ ! -e "$INSTALL_DIR/Downloads" && ! -e "$INSTALL_DIR/downloads" && ! -e "$INSTALL_DIR/SteamKit" ]] || fail "runtime data copied into source deployment"
pass "source deployment excludes runtime and account data"
[[ -f "$INSTALL_DIR/src/domains/downloads/preparedDownloads.js" ]] || fail "nested downloads source directory was excluded"
pass "source deployment preserves nested downloads modules"
SOURCE_DIR="$source_two"; deploy_source
assert_eq two "$(tr -d '\n' <"$INSTALL_DIR/version.txt")" "atomic source switch"
assert_eq one "$(tr -d '\n' <"$ROLLBACK_DIR/version.txt")" "previous source retained for rollback"
rollback_source
assert_eq one "$(tr -d '\n' <"$INSTALL_DIR/version.txt")" "failed update source rollback"

update_root="$TEST_TMP/update-transaction"; update_install="$update_root/wallhub"; update_new="$TEST_TMP/update-new"
make_source_fixture "$update_install" old; touch "$update_install/.wallhub-installer-managed"; make_source_fixture "$update_new" new
set +e
(
  INSTALL_DIR="$update_install"; DATA_DIR="$TEST_TMP/update-data"; CONFIG_DIR="$TEST_TMP/update-config"; LAYOUT=isolated; LOG_FILE="$TEST_TMP/update.log"; TEMP_DIR="$TEST_TMP/update-temp"; ENVIRONMENT=proot; ROOT_PREFIX=(); ROLLBACK_DIR=""; UPDATE_IN_PROGRESS=0; UPDATE_SERVICE_STOPPED=0
  mkdir -p "$TEMP_DIR"; : >"$LOG_FILE"
  load_state() { :; }; configure_privilege() { :; }; acquire_source() { SOURCE_DIR="$update_new"; }
  service_action() { printf '%s\n' "$1" >>"$TEST_TMP/update-service-actions"; return 0; }
  install_node_dependencies() { :; }; prepare_runtime_layout() { :; }; repair_python_modules() { :; }; write_runtime_env() { :; }; write_state() { :; }
  health_calls=0
  health_check() { health_calls=$((health_calls + 1)); ((health_calls >= 2)); }
  as_root() { command "$@"; }
  run_update
)
code=$?
set -e
assert_eq 50 "$code" "failed isolated update reports health status"
assert_eq old "$(tr -d '\n' <"$update_install/version.txt")" "failed isolated update restores prior version"
assert_file_contains "$TEST_TMP/update-service-actions" restart "rollback restarts prior service"

TEMP_DIR="$TEST_TMP/mirror-temp"; CONFIG_DIR="$TEST_TMP/config"; MIRROR_MANIFEST="$CONFIG_DIR/mirrors/manifest.tsv"
LOG_FILE="$TEST_TMP/mirror.log"; ENVIRONMENT=proot; DRY_RUN=0; ROOT_PREFIX=()
mkdir -p "$TEMP_DIR" "$CONFIG_DIR"
source_file="$TEST_TMP/sources.list"
printf 'official\n' >"$source_file"
replace_in_file "$source_file" 's/official/tuna/'
assert_eq tuna "$(tr -d '\n' <"$source_file")" "mirror replacement"

(
  TEMP_DIR="$TEST_TMP/termux-mirror-temp"; CONFIG_DIR="$TEST_TMP/termux-mirror-config"; MIRROR_MANIFEST="$CONFIG_DIR/mirrors/manifest.tsv"
  ENVIRONMENT=termux; DRY_RUN=0; ROOT_PREFIX=()
  mkdir -p "$TEMP_DIR" "$CONFIG_DIR"
  termux_sources="$TEST_TMP/termux-sources.list"; termux_original="$TEST_TMP/termux-sources.original"
  cat >"$termux_sources" <<'SOURCES'
deb https://grimler.se/termux/termux-main stable main
deb-src [trusted=yes] https://mirror.example.invalid/custom-main stable main
deb https://mirror.example.invalid/custom-root root stable
deb [arch=arm64] https://mirror.example.invalid/custom-x11 x11 main
deb https://termux-user-repository.github.io tur stable
SOURCES
  cp "$termux_sources" "$termux_original"
  rewrite_tuna_termux_source_file "$termux_sources"
  [[ "$(grep -Fc 'https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main' "$termux_sources")" == 2 ]] || fail "Termux main mirror rewrite"
  grep -Fq 'https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-root root stable' "$termux_sources" || fail "Termux root mirror rewrite"
  grep -Fq 'https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-x11 x11 main' "$termux_sources" || fail "Termux x11 mirror rewrite"
  grep -Fq 'https://termux-user-repository.github.io tur stable' "$termux_sources" || fail "Termux unrelated repository preservation"
  restore_mirrors_internal safe
  cmp -s "$termux_sources" "$termux_original" || fail "Termux mirror restoration"
) || fail "Termux mirror rewrite from arbitrary providers"
pass "Termux mirror rewrite handles arbitrary current providers"
pass "Termux mirror rewrite preserves unrelated repositories"
pass "Termux arbitrary mirror backup restores byte-for-byte"

dnf_repo_file="$TEST_TMP/rocky.repo"
cat >"$dnf_repo_file" <<'REPO'
[baseos]
mirrorlist=https://mirrors.example.invalid/mirrorlist
#baseurl=https://mirrors.tuna.tsinghua.edu.cn/rocky/$releasever/BaseOS/$basearch/os/
REPO
enable_tuna_dnf_repo_file "$dnf_repo_file"
assert_file_contains "$dnf_repo_file" 'baseurl=https://mirrors.tuna.tsinghua.edu.cn/rocky/' "DNF mirror baseurl enabled"
assert_file_contains "$dnf_repo_file" '#mirrorlist=' "DNF mirrorlist disabled"
pass "DNF mirror rewrite uses a valid sed expression"

suse_repo_file="$TEST_TMP/opensuse.repo"
cat >"$suse_repo_file" <<'REPO'
[current]
baseurl=http://cdn.opensuse.org/distribution/leap/$releasever/repo/oss/$basearch
[legacy]
baseurl=https://download.opensuse.org/distribution/leap/$releasever/repo/oss/$basearch
REPO
rewrite_tuna_suse_source_file "$suse_repo_file"
assert_eq 2 "$(grep -Fc 'baseurl=https://mirrors.tuna.tsinghua.edu.cn/opensuse/' "$suse_repo_file")" "current and legacy openSUSE mirror hosts are rewritten"
suse_service_file="$TEST_TMP/opensuse-repoindex.xml"
printf '%s\n' '<repoindex disturl="http://cdn.opensuse.org">' >"$suse_service_file"
rewrite_tuna_suse_source_file "$suse_service_file"
assert_file_contains "$suse_service_file" 'disturl="https://mirrors.tuna.tsinghua.edu.cn/opensuse"' "Leap 16 repository service source is rewritten"
suse_link_target="$TEST_TMP/opensuse-link-target.xml"
suse_service_link="$TEST_TMP/opensuse-service-link.xml"
printf '%s\n' '<repoindex disturl="http://cdn.opensuse.org">' >"$suse_link_target"
ln -s "$suse_link_target" "$suse_service_link"
rewrite_tuna_suse_source_file "$suse_service_link"
assert_file_contains "$suse_link_target" 'disturl="http://cdn.opensuse.org"' "openSUSE service symlink is not registered twice"
if grep -Fq -- "$suse_service_link" "$MIRROR_MANIFEST"; then fail "openSUSE service symlink was registered"; fi
pass "openSUSE mirror rewrite supports Leap 16 repositories and services"

printf 'user-change\n' >"$source_file"
if restore_mirrors_internal safe; then fail "user mirror conflict was overwritten"; fi
assert_eq user-change "$(tr -d '\n' <"$source_file")" "user mirror edit is preserved"
printf 'tuna\n' >"$source_file"
restore_mirrors_internal safe
assert_eq official "$(tr -d '\n' <"$source_file")" "mirror backup restoration"

owned_source="$TEST_TMP/npmrc.source"; owned_target="$CONFIG_DIR/npmrc"
printf 'registry=https://registry.npmmirror.com\n' >"$owned_source"
mirror_install_owned_file "$owned_target" "$owned_source"
[[ -f "$owned_target" ]] || fail "installer-owned mirror file creation"
pass "installer-owned mirror file creation"
restore_mirrors_internal safe
[[ ! -e "$owned_target" ]] || fail "installer-owned mirror file restoration"
pass "restore removes installer-created mirror file"

refresh_marker="$TEST_TMP/mirror-refresh-state"
(
  TEMP_DIR="$TEST_TMP/refresh-success-temp"; CONFIG_DIR="$TEST_TMP/refresh-success-config"
  MIRROR_MANIFEST="$CONFIG_DIR/mirrors/manifest.tsv"; LOG_FILE="$TEST_TMP/refresh-success.log"
  ENVIRONMENT=proot; OS_FAMILY=unknown; MIRROR=china; DRY_RUN=0; ROOT_PREFIX=(); PACKAGE_INDEX_UPDATED=1
  mkdir -p "$TEMP_DIR" "$CONFIG_DIR"; : >"$LOG_FILE"
  pkg_refresh() {
    printf '%s\n' "$PACKAGE_INDEX_UPDATED" >"$refresh_marker"
    [[ "$PACKAGE_INDEX_UPDATED" == 0 ]]
  }
  configure_china_mirrors
)
assert_eq 0 "$(tr -d '\n' <"$refresh_marker")" "mirror switch invalidates cached package metadata"
pass "mirror switch refreshes package metadata"

proot_official_root="$TEST_TMP/proot-official-https"
proot_official_apt="$proot_official_root/apt"
proot_official_config="$proot_official_root/config"
proot_official_temp="$proot_official_root/temp"
proot_official_refresh="$proot_official_root/refresh-state"
mkdir -p "$proot_official_apt/sources.list.d" "$proot_official_config" "$proot_official_temp"
cat >"$proot_official_apt/sources.list.d/debian.sources" <<'SOURCES'
Types: deb
URIs: http://deb.debian.org/debian http://deb.debian.org/debian-security
Suites: stable stable-security
Components: main
SOURCES
(
  TEMP_DIR="$proot_official_temp"; CONFIG_DIR="$proot_official_config"
  MIRROR_MANIFEST="$CONFIG_DIR/mirrors/manifest.tsv"; LOG_FILE="$proot_official_root/installer.log"
  ENVIRONMENT=proot; OS_FAMILY=debian; MIRROR=official; DRY_RUN=0; ROOT_PREFIX=(); PACKAGE_INDEX_UPDATED=1
  WALLHUB_APT_ETC_DIR="$proot_official_apt"; : >"$LOG_FILE"
  pkg_refresh() {
    printf '%s\n' "$PACKAGE_INDEX_UPDATED" >"$proot_official_refresh"
    [[ "$PACKAGE_INDEX_UPDATED" == 0 ]]
  }
  configure_proot_official_https_sources
)
assert_file_not_contains "$proot_official_apt/sources.list.d/debian.sources" 'http://deb.debian.org' "Proot official bootstrap removes HTTP Debian sources"
assert_file_contains "$proot_official_apt/sources.list.d/debian.sources" 'https://deb.debian.org/debian-security' "Proot official bootstrap enables HTTPS security metadata"
assert_eq 0 "$(tr -d '\n' <"$proot_official_refresh")" "Proot official HTTPS switch refreshes package metadata"
(
  TEMP_DIR="$proot_official_temp"; CONFIG_DIR="$proot_official_config"
  MIRROR_MANIFEST="$CONFIG_DIR/mirrors/manifest.tsv"; LOG_FILE="$proot_official_root/restore.log"
  ENVIRONMENT=proot; DRY_RUN=0; ROOT_PREFIX=(); : >"$LOG_FILE"
  restore_mirrors_internal force
)
assert_file_contains "$proot_official_apt/sources.list.d/debian.sources" 'http://deb.debian.org/debian' "Proot official HTTPS source change is restorable"

proot_install_order="$TEST_TMP/proot-install-order"
(
  ENVIRONMENT=proot
  configure_package_sources() { printf 'sources\n' >>"$proot_install_order"; }
  ensure_base_tools() { printf 'base-tools\n' >>"$proot_install_order"; }
  ensure_python_runtime() { :; }; ensure_node() { :; }; ensure_dotnet() { :; }
  ensure_sc302_dependencies() { :; }; acquire_source() { :; }; deploy_source() { :; }
  install_node_dependencies() { :; }; prepare_runtime_layout() { :; }; ensure_python_modules() { :; }
  write_runtime_env() { :; }; install_service() { :; }; write_state() { :; }; health_check() { return 0; }
  log() { :; }; message() { printf 'test'; }
  run_install
)
assert_eq $'sources\nbase-tools' "$(head -n 2 "$proot_install_order")" "Proot configures reachable package sources before base tools"

refresh_config="$TEST_TMP/refresh-config"; refresh_temp="$TEST_TMP/refresh-temp"
mkdir -p "$refresh_config" "$refresh_temp"
set +e
WALLHUB_INSTALLER_SOURCE_ONLY=1 bash -c '
  source "$1"
  trap - EXIT ERR INT TERM
  LANGUAGE=en; LOG_FILE="$2/failure.log"; TEMP_DIR="$3"; CONFIG_DIR="$2"; MIRROR_MANIFEST="$2/mirrors/manifest.tsv"
  ENVIRONMENT=proot; OS_FAMILY=unknown; MIRROR=china; DRY_RUN=0; ROOT_PREFIX=()
  : >"$LOG_FILE"
  pkg_refresh() { return 1; }
  configure_china_mirrors
' bash "$ROOT/install.sh" "$refresh_config" "$refresh_temp" >/dev/null 2>&1
code=$?
set -e
assert_eq 20 "$code" "mirror refresh failure exits with dependency status"
[[ ! -e "$refresh_config/pip.conf" && ! -e "$refresh_config/npmrc" ]] || fail "mirror refresh rollback"
pass "mirror refresh failure restores installer-created configuration"

dirty_repo="$TEST_TMP/dirty-repo"
mkdir -p "$dirty_repo"; git -C "$dirty_repo" init -q; git -C "$dirty_repo" config user.email test@example.invalid; git -C "$dirty_repo" config user.name WallHub-Test
printf 'clean\n' >"$dirty_repo/file.txt"; git -C "$dirty_repo" add file.txt; git -C "$dirty_repo" commit -qm initial; printf 'dirty\n' >>"$dirty_repo/file.txt"
set +e
WALLHUB_INSTALLER_SOURCE_ONLY=1 bash -c '
  source "$1"; trap - EXIT ERR INT TERM
  LANGUAGE=en; LOG_FILE="$3"; : >"$LOG_FILE"; INSTALL_DIR="$2"; LAYOUT=in-place; stop_marker="$4"
  load_state() { :; }
  configure_privilege() { :; }
  service_action() { touch "$stop_marker"; }
  run_update
' bash "$ROOT/install.sh" "$dirty_repo" "$TEST_TMP/dirty.log" "$TEST_TMP/dirty-service-stopped" >/dev/null 2>&1
code=$?
set -e
assert_eq 30 "$code" "dirty in-place update exits with source status"
[[ ! -e "$TEST_TMP/dirty-service-stopped" ]] || fail "dirty update stopped service before validation"
pass "dirty in-place update leaves the running service untouched"

(
  INSTALL_DIR="$source_one"; NODE_BIN="$dependency_shims/node"; LOG_FILE="$TEST_TMP/repair-skip.log"
  install_node_dependencies() { fail "repair reinstalled valid npm dependencies"; }
  repair_node_dependencies
  python_capability_probe() { return 0; }
  ensure_python_modules() { fail "repair reinstalled valid Python dependencies"; }
  repair_python_modules
) || fail "repair capability-first skip"
pass "repair skips dependencies that already pass capability probes"

uninstall_root="$TEST_TMP/uninstall-default"; uninstall_code="$uninstall_root/code"; uninstall_data="$uninstall_root/data"; uninstall_config="$uninstall_root/wallhub-installer"
mkdir -p "$uninstall_code" "$uninstall_data" "$uninstall_config"; touch "$uninstall_code/.wallhub-installer-managed"; printf 'setting\n' >"$uninstall_data/user-setting"
(
  INSTALL_DIR="$uninstall_code"; DATA_DIR="$uninstall_data"; CONFIG_DIR="$uninstall_config"; LAYOUT=isolated; PURGE=0; LOG_FILE="$TEST_TMP/uninstall-default.log"; ENVIRONMENT=proot; ROOT_PREFIX=()
  load_state() { :; }; configure_privilege() { :; }; stop_and_remove_service() { :; }; as_root() { command "$@"; }
  run_uninstall
)
[[ ! -e "$uninstall_code" && -f "$uninstall_data/user-setting" && -d "$uninstall_config" ]] || fail "default uninstall preservation"
pass "default uninstall removes code and preserves user data/settings"

in_place_root="$TEST_TMP/uninstall-in-place"; in_place_code="$in_place_root/code"; in_place_data="$in_place_root/data"; in_place_config="$in_place_root/wallhub-installer"
mkdir -p "$in_place_code" "$in_place_data" "$in_place_config"; printf 'source\n' >"$in_place_code/server.js"
(
  INSTALL_DIR="$in_place_code"; DATA_DIR="$in_place_data"; CONFIG_DIR="$in_place_config"; LAYOUT=in-place; PURGE=0; LOG_FILE="$TEST_TMP/uninstall-in-place.log"; ENVIRONMENT=proot; ROOT_PREFIX=()
  load_state() { :; }; configure_privilege() { :; }; stop_and_remove_service() { :; }
  run_uninstall
)
[[ -f "$in_place_code/server.js" && -d "$in_place_data" && -d "$in_place_config" ]] || fail "in-place uninstall preservation"
assert_file_contains "$TEST_TMP/uninstall-in-place.log" 'in-place source was preserved' "in-place uninstall message"
pass "in-place uninstall preserves source and reports it accurately"

purge_root="$TEST_TMP/uninstall-purge"; purge_code="$purge_root/code"; purge_data="$purge_root/data"; purge_config="$purge_root/wallhub-installer"
mkdir -p "$purge_code" "$purge_data" "$purge_config" "$purge_root/unrelated"; touch "$purge_code/.wallhub-installer-managed"; printf 'keep\n' >"$purge_root/unrelated/file"
(
  INSTALL_DIR="$purge_code"; DATA_DIR="$purge_data"; CONFIG_DIR="$purge_config"; MIRROR_MANIFEST="$purge_config/mirrors/manifest.tsv"; LAYOUT=isolated; PURGE=1; ASSUME_YES=1; NON_INTERACTIVE=1; LOG_FILE="$TEST_TMP/uninstall-purge.log"; ENVIRONMENT=proot; ROOT_PREFIX=()
  load_state() { :; }; configure_privilege() { :; }; stop_and_remove_service() { :; }; as_root() { command "$@"; }
  run_uninstall
)
[[ ! -e "$purge_code" && ! -e "$purge_data" && ! -e "$purge_config" && -f "$purge_root/unrelated/file" ]] || fail "purge path ownership"
pass "purge removes only installer-registered paths"

purge_log_root="$TEST_TMP/uninstall-purge-live-log"; purge_log_code="$purge_log_root/code"; purge_log_data="$purge_log_root/data"; purge_log_config="$purge_log_root/wallhub-installer"
mkdir -p "$purge_log_code" "$purge_log_data" "$purge_log_config" "$purge_log_root/temp"
touch "$purge_log_code/.wallhub-installer-managed"; printf 'persistent log\n' >"$purge_log_config/installer.log"
(
  TEMP_DIR="$purge_log_root/temp"; INSTALL_DIR="$purge_log_code"; DATA_DIR="$purge_log_data"; CONFIG_DIR="$purge_log_config"; MIRROR_MANIFEST="$purge_log_config/mirrors/manifest.tsv"
  LAYOUT=isolated; PURGE=1; ASSUME_YES=1; NON_INTERACTIVE=1; LOG_FILE="$purge_log_config/installer.log"; ENVIRONMENT=proot; ROOT_PREFIX=(); DRY_RUN=0
  load_state() { :; }; configure_privilege() { :; }; stop_and_remove_service() { :; }
  run_uninstall
  [[ "$LOG_FILE" == "$purge_log_root/temp/uninstall-purge.log" ]] || fail "purge log relocation"
)
[[ ! -e "$purge_log_code" && ! -e "$purge_log_data" && ! -e "$purge_log_config" ]] || fail "live log purge cleanup"
pass "purge relocates a persistent log before deleting its config directory"

runtime_root="$TEST_TMP/runtime-settings"
(
  TEMP_DIR="$runtime_root/temp"; CONFIG_DIR="$runtime_root/config"; INSTALL_DIR="$runtime_root/code"; DATA_DIR="$runtime_root/data"; TOOLCHAIN_DIR="$runtime_root/data/toolchain"
  ENVIRONMENT=termux; LAYOUT=isolated; LOG_FILE="$runtime_root/runtime.log"; DRY_RUN=0; ROOT_PREFIX=()
  mkdir -p "$TEMP_DIR" "$CONFIG_DIR" "$INSTALL_DIR"; : >"$LOG_FILE"
  as_root() { if [[ "$1" == chown ]]; then return 0; fi; command "$@"; }
  prepare_runtime_layout
  [[ "$(cat "$DATA_DIR/cache-settings.json")" == "{}" ]] || fail "new cache settings JSON"
  [[ -L "$INSTALL_DIR/cache-settings.json" && "$(readlink "$INSTALL_DIR/cache-settings.json")" == "$DATA_DIR/cache-settings.json" ]] || fail "cache settings link"
  printf '{"custom":"preserved"}\n' >"$DATA_DIR/cache-settings.json"
  prepare_runtime_layout
  [[ "$(cat "$DATA_DIR/cache-settings.json")" == '{"custom":"preserved"}' ]] || fail "non-empty cache settings preservation"
  : >"$DATA_DIR/cache-settings.json"
  prepare_runtime_layout
  [[ "$(cat "$DATA_DIR/cache-settings.json")" == "{}" ]] || fail "empty cache settings repair"
) || fail "runtime cache settings initialization"
pass "new isolated installs create valid cache settings JSON"
pass "runtime layout preserves non-empty cache settings"
pass "runtime layout repairs only zero-length cache settings"

TEMP_DIR="$TEST_TMP/state-temp"; CONFIG_DIR="$TEST_TMP/state config"; STATE_FILE="$CONFIG_DIR/state.env"; MIRROR_MANIFEST="$CONFIG_DIR/mirrors/manifest.tsv"
mkdir -p "$TEMP_DIR" "$CONFIG_DIR"
ENVIRONMENT=proot; TARGET=proot; OS_ID=debian; OS_CODENAME=bookworm; OS_FAMILY=debian; PKG_MANAGER=apt; ARCH=arm64
LAYOUT=isolated; MIRROR=official; REPO="$DEFAULT_REPO"; BRANCH=main; INSTALL_DIR="$TEST_TMP/code path"; DATA_DIR="$TEST_TMP/data path"
TOOLCHAIN_DIR="$DATA_DIR/toolchain"; NODE_BIN=/usr/bin/node; NPM_BIN=/usr/bin/npm; PYTHON_BIN=/usr/bin/python3; DOTNET_BIN=/usr/bin/dotnet; DOTNET_ROOT_DIR=/usr/lib/dotnet
SERVICE_KIND=pid; SERVICE_USER=tester; SERVICE_GROUP=tester; LOG_FILE="$TEST_TMP/state.log"; DRY_RUN=0; ROOT_PREFIX=()
write_state
bash -c 'set -u; source "$1"; [[ "$INSTALL_DIR" == "$2" && "$DATA_DIR" == "$3" && "$ARCH" == arm64 ]]' bash "$STATE_FILE" "$INSTALL_DIR" "$DATA_DIR" || fail "state file round trip"
pass "state file round trip preserves quoted paths"

TEMP_DIR="$TEST_TMP/service-temp"; CONFIG_DIR="$TEST_TMP/service config"; INSTALL_DIR="$TEST_TMP/code path"; DATA_DIR="$TEST_TMP/data path"; NODE_BIN=/usr/bin/node
mkdir -p "$TEMP_DIR" "$CONFIG_DIR" "$INSTALL_DIR" "$DATA_DIR"
WALLHUB_SYSTEMD_UNIT_PATH="$TEST_TMP/wallhub.service"
systemd_available() { return 0; }
as_root() {
  case "$1" in
    cp|chmod) command "$@" ;;
    systemctl) return 0 ;;
    *) fail "unexpected systemd test command: $*" ;;
  esac
}
SERVICE_USER=tester; SERVICE_GROUP=tester
install_systemd_service
assert_file_contains "$WALLHUB_SYSTEMD_UNIT_PATH" "WorkingDirectory=$INSTALL_DIR" "systemd preserves a working directory containing spaces"
if grep -Fq 'WorkingDirectory="' "$WALLHUB_SYSTEMD_UNIT_PATH"; then fail "systemd working directory has unsupported outer quotes"; fi
pass "systemd working directory omits unsupported outer quotes"
assert_file_contains "$WALLHUB_SYSTEMD_UNIT_PATH" "EnvironmentFile=$CONFIG_DIR/runtime.env" "systemd preserves an environment file path containing spaces"
if grep -Fq 'EnvironmentFile="' "$WALLHUB_SYSTEMD_UNIT_PATH"; then fail "systemd environment file has unsupported outer quotes"; fi
pass "systemd environment file omits unsupported outer quotes"
assert_file_contains "$WALLHUB_SYSTEMD_UNIT_PATH" "ExecStart=\"$NODE_BIN\" \"$INSTALL_DIR/server.js\" --no-supervisor" "systemd quotes executable paths"

run() { command "$@"; }

service_shims="$TEST_TMP/service-shims"; mkdir -p "$service_shims"
for service_command in sv sv-enable; do
  cat >"$service_shims/$service_command" <<'SHIM'
#!/usr/bin/env sh
if [ -n "${WALLHUB_SV_CALLS:-}" ]; then
  printf '%s %s\n' "$(basename "$0")" "$*" >>"$WALLHUB_SV_CALLS"
fi
if [ "$(basename "$0")" = sv ] && [ "${1:-}" = status ]; then
  printf '%s\n' "${WALLHUB_SV_STATUS:-down: wallhub: 0s, normally up}"
fi
exit 0
SHIM
  chmod 700 "$service_shims/$service_command"
done
old_path="$PATH"; PATH="$service_shims:$PATH"
PREFIX="$TEST_TMP/termux-service/com.termux/files/usr"; CONFIG_DIR="$TEST_TMP/termux-service/config"; INSTALL_DIR="$TEST_TMP/termux-service/code"; DATA_DIR="$TEST_TMP/termux-service/data"; NODE_BIN=/usr/bin/node
export WALLHUB_SV_CALLS="$TEST_TMP/termux-sv-calls"; : >"$WALLHUB_SV_CALLS"
mkdir -p "$CONFIG_DIR" "$INSTALL_DIR" "$DATA_DIR"
ensure_termux_runsvdir() { mkdir -p "$PREFIX/var/service/wallhub/supervise"; : >"$PREFIX/var/service/wallhub/supervise/ok"; }
install_termux_service
sh -n "$PREFIX/var/service/wallhub/run" "$PREFIX/var/service/wallhub/log/run"
pass "generated Termux runit service passes sh -n"
assert_file_contains "$PREFIX/var/service/wallhub/log/run" 'svlogd -tt' "Termux service enables bounded svlogd logging"
assert_file_contains "$WALLHUB_SV_CALLS" "sv up $PREFIX/var/service/wallhub" "Termux install starts runit service by absolute path"
[[ ! -e "$PREFIX/var/service/wallhub/down" ]] || fail "Termux service down marker was retained"
if grep -Fq 'sv-enable' "$WALLHUB_SV_CALLS"; then fail "Termux install depended on sv-enable before supervision"; fi
pass "Termux install waits for runsv supervision before enabling the service"
export WALLHUB_SV_STATUS='run: wallhub: (pid 123) 1s'
install_termux_service
assert_file_contains "$WALLHUB_SV_CALLS" "sv restart $PREFIX/var/service/wallhub" "Termux reinstall restarts an already-running service"
unset SVDIR
SERVICE_KIND=runit; export WALLHUB_SV_STATUS='down: wallhub: 0s, normally up'
if service_action status >/dev/null 2>&1; then fail "runit down status"; fi
pass "runit down status is not treated as healthy"
export WALLHUB_SV_STATUS='run: wallhub: (pid 123) 1s'
service_action status >/dev/null
pass "runit running status is accepted"
assert_file_contains "$WALLHUB_SV_CALLS" "sv status $PREFIX/var/service/wallhub" "Termux maintenance resolves runit service without SVDIR"
service_action restart >/dev/null
service_action stop >/dev/null
assert_file_contains "$WALLHUB_SV_CALLS" "sv restart $PREFIX/var/service/wallhub" "Termux restart uses the absolute runit service path"
assert_file_contains "$WALLHUB_SV_CALLS" "sv down $PREFIX/var/service/wallhub" "Termux stop uses the absolute runit service path"
unset WALLHUB_SV_STATUS
unset WALLHUB_SV_CALLS
PATH="$old_path"

TEMP_DIR="$TEST_TMP/proot-service-temp"; CONFIG_DIR="$TEST_TMP/proot config"; INSTALL_DIR="$TEST_TMP/proot code"; DATA_DIR="$TEST_TMP/proot data"; NODE_BIN="$TEST_TMP/fake-node"
mkdir -p "$TEMP_DIR" "$CONFIG_DIR" "$INSTALL_DIR" "$DATA_DIR"
cat >"$NODE_BIN" <<'SHIM'
#!/usr/bin/env sh
exec bash "$@"
SHIM
cat >"$INSTALL_DIR/server.js" <<'SHIM'
#!/usr/bin/env bash
trap 'exit 0' TERM INT
while :; do sleep 1; done
SHIM
chmod 700 "$NODE_BIN" "$INSTALL_DIR/server.js"
printf 'PORT=3090\n' >"$CONFIG_DIR/runtime.env"
truncate -s 10485761 "$DATA_DIR/wallhub.log"
install_proot_manager
bash -n "$CONFIG_DIR/wallhubctl"
pass "generated Proot manager passes bash -n"
assert_file_contains "$CONFIG_DIR/wallhubctl" "PID_FILE=\"\$DATA_DIR/wallhub.pid\"" "Proot PID path has no literal quote corruption"
"$CONFIG_DIR/wallhubctl" status >/dev/null
pass "Proot PID manager reports running process"
[[ -f "$DATA_DIR/wallhub.log.1" ]] || fail "Proot log rotation"
pass "Proot PID manager rotates oversized log"
"$CONFIG_DIR/wallhubctl" stop >/dev/null
if "$CONFIG_DIR/wallhubctl" status >/dev/null 2>&1; then fail "Proot PID manager stop"; fi
pass "Proot PID manager stops process and removes stale PID"

health_shims="$TEST_TMP/health-shims"; mkdir -p "$health_shims"
cat >"$health_shims/curl" <<'SHIM'
#!/usr/bin/env bash
count=0; [[ -f "$WALLHUB_HEALTH_COUNT" ]] && count="$(cat "$WALLHUB_HEALTH_COUNT")"
count=$((count + 1)); printf '%s\n' "$count" >"$WALLHUB_HEALTH_COUNT"
printf '%s\n' "$*" >>"$WALLHUB_HEALTH_ARGS"
if [[ "$WALLHUB_HEALTH_MODE" == eventual && "$count" -ge 3 ]]; then printf 'ok'; exit 0; fi
exit 22
SHIM
chmod 700 "$health_shims/curl"
(
  PATH="$health_shims:$PATH"; export PATH
  export WALLHUB_HEALTH_COUNT="$TEST_TMP/health-count" WALLHUB_HEALTH_ARGS="$TEST_TMP/health-args" WALLHUB_HEALTH_MODE=eventual
  LOG_FILE="$TEST_TMP/health.log"; DEFAULT_PORT=3090; DRY_RUN=0; SERVICE_KIND=pid; DATA_DIR="$TEST_TMP/health-data"; mkdir -p "$DATA_DIR"; : >"$LOG_FILE"
  sleep() { :; }
  health_check
)
assert_eq 3 "$(tr -d '\n' <"$TEST_TMP/health-count")" "health polling stops immediately after success"
if grep -Fv 'http://127.0.0.1:3090/health' "$TEST_TMP/health-args" | grep -q .; then fail "health endpoint scope"; fi
pass "health polling requests only the lightweight endpoint"
(
  PATH="$health_shims:$PATH"; export PATH
  export WALLHUB_HEALTH_COUNT="$TEST_TMP/health-fail-count" WALLHUB_HEALTH_ARGS="$TEST_TMP/health-fail-args" WALLHUB_HEALTH_MODE=fail
  LOG_FILE="$TEST_TMP/health-fail.log"; DEFAULT_PORT=3090; DRY_RUN=0; SERVICE_KIND=pid; DATA_DIR="$TEST_TMP/health-fail-data"; mkdir -p "$DATA_DIR"; printf 'service-tail-evidence\n' >"$DATA_DIR/wallhub.log"; : >"$LOG_FILE"
  sleep() { :; }
  if health_check; then exit 1; fi
  grep -q service-tail-evidence "$LOG_FILE"
)
pass "failed health check appends bounded service log evidence"

if grep -Eq '(^|[[:space:]])(ufw|firewall-cmd|nft|iptables)([[:space:]]|$)' "$ROOT/install.sh"; then fail "firewall command found"; fi
pass "installer contains no firewall mutation command"

if command -v node >/dev/null 2>&1 && [[ -f "$ROOT/public/index.html" ]]; then
  NODE_BIN="$(command -v node)"
  public_integrity "$ROOT" >/dev/null
  pass "committed public asset references are complete"
fi

printf '1..%d\n' "$TESTS"
