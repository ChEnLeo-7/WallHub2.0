#!/usr/bin/env bash
# Globals in this harness are inputs consumed dynamically by sourced installer functions.
# shellcheck disable=SC2030,SC2031,SC2034

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
if [[ "${1:-}" == --version ]]; then printf 'v16.17.0\n'; else exit 0; fi
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
    [[ "$#" -eq 2 && "$1" == npm && "$2" == npm ]] || return 1
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
  for manager in apt dnf pacman zypper pkg; do
    PKG_MANAGER="$manager"; PACKAGE_INDEX_UPDATED=0
    pkg_refresh
    pkg_install wallhub-test-package
  done
)
assert_file_contains "$shim_log" 'apt-get -o Acquire::Retries=3 update' "apt command shim"
assert_file_contains "$shim_log" 'dnf -y makecache' "dnf command shim"
assert_file_contains "$shim_log" 'pacman -Sy --noconfirm' "pacman command shim"
assert_file_contains "$shim_log" 'zypper --non-interactive refresh' "zypper command shim"
assert_file_contains "$shim_log" 'pkg update -y' "Termux pkg command shim"
pass "uname command shim drives arm64 detection"

if (
  PKG_MANAGER=apt; PACKAGE_INDEX_UPDATED=0; DRY_RUN=0; LOG_FILE="$TEST_TMP/package-refresh-failure.log"
  as_root() { return 23; }
  pkg_refresh
); then
  fail "package index refresh failure was ignored"
fi
pass "package index refresh failure propagates"

if (
  DRY_RUN=0; LOG_FILE="$TEST_TMP/package-install-failure.log"
  pkg_candidate_exists() { return 0; }
  pkg_install() { return 24; }
  pkg_search_diagnostic() { :; }
  install_first_candidate curl curl
); then
  fail "package candidate install failure was ignored"
fi
pass "package candidate install failure propagates"

delegate_log="$TEST_TMP/delegate.log"
(
  export PATH="$shim_dir:$PATH" WALLHUB_SHIM_LOG="$shim_log"
  ENVIRONMENT=termux; TARGET=proot; COMMAND=repair; PROOT_DISTRO=ubuntu
  PREFIX="$TEST_TMP/com.termux/files/usr"; TEMP_DIR="$TEST_TMP/delegate-temp"; LOG_FILE="$TEST_TMP/delegate-installer.log"
  MIRROR=china; LAYOUT=isolated; REPO="$DEFAULT_REPO"; BRANCH="installer-validation"; SC302_DEPS=no; LANGUAGE=en
  NON_INTERACTIVE=1; ASSUME_YES=1; BUILD_UI=0; VERBOSE=0; DRY_RUN=0; PURGE=0; INSTALL_DIR=""; DATA_DIR=""
  mkdir -p "$PREFIX/var/lib/proot-distro/installed-rootfs/ubuntu" "$TEMP_DIR"
  ensure_command_package() { :; }
  run() { printf '%q ' "$@" >"$delegate_log"; }
  delegate_to_proot
)
assert_file_contains "$delegate_log" 'proot-distro login ubuntu' "Termux delegates to selected Proot distribution"
assert_file_contains "$delegate_log" 'repair --target proot' "Proot delegation preserves maintenance subcommand"
assert_file_contains "$delegate_log" '--branch installer-validation' "Proot delegation preserves branch"

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

purge_root="$TEST_TMP/uninstall-purge"; purge_code="$purge_root/code"; purge_data="$purge_root/data"; purge_config="$purge_root/wallhub-installer"
mkdir -p "$purge_code" "$purge_data" "$purge_config" "$purge_root/unrelated"; touch "$purge_code/.wallhub-installer-managed"; printf 'keep\n' >"$purge_root/unrelated/file"
(
  INSTALL_DIR="$purge_code"; DATA_DIR="$purge_data"; CONFIG_DIR="$purge_config"; MIRROR_MANIFEST="$purge_config/mirrors/manifest.tsv"; LAYOUT=isolated; PURGE=1; ASSUME_YES=1; NON_INTERACTIVE=1; LOG_FILE="$TEST_TMP/uninstall-purge.log"; ENVIRONMENT=proot; ROOT_PREFIX=()
  load_state() { :; }; configure_privilege() { :; }; stop_and_remove_service() { :; }; as_root() { command "$@"; }
  run_uninstall
)
[[ ! -e "$purge_code" && ! -e "$purge_data" && ! -e "$purge_config" && -f "$purge_root/unrelated/file" ]] || fail "purge path ownership"
pass "purge removes only installer-registered paths"

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
if [ "$(basename "$0")" = sv ] && [ "${1:-}" = status ]; then
  printf '%s\n' "${WALLHUB_SV_STATUS:-down: wallhub: 0s, normally up}"
fi
exit 0
SHIM
  chmod 700 "$service_shims/$service_command"
done
old_path="$PATH"; PATH="$service_shims:$PATH"
PREFIX="$TEST_TMP/termux-service/com.termux/files/usr"; CONFIG_DIR="$TEST_TMP/termux-service/config"; INSTALL_DIR="$TEST_TMP/termux-service/code"; DATA_DIR="$TEST_TMP/termux-service/data"; NODE_BIN=/usr/bin/node
mkdir -p "$CONFIG_DIR" "$INSTALL_DIR" "$DATA_DIR"
ensure_termux_runsvdir() { :; }
install_termux_service
sh -n "$PREFIX/var/service/wallhub/run" "$PREFIX/var/service/wallhub/log/run"
pass "generated Termux runit service passes sh -n"
assert_file_contains "$PREFIX/var/service/wallhub/log/run" 'svlogd -tt' "Termux service enables bounded svlogd logging"
SERVICE_KIND=runit; export WALLHUB_SV_STATUS='down: wallhub: 0s, normally up'
if service_action status >/dev/null 2>&1; then fail "runit down status"; fi
pass "runit down status is not treated as healthy"
export WALLHUB_SV_STATUS='run: wallhub: (pid 123) 1s'
service_action status >/dev/null
pass "runit running status is accepted"
unset WALLHUB_SV_STATUS
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
