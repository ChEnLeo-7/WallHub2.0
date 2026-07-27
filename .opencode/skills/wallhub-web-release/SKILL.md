---
name: wallhub-web-release
description: Release WallHub Webview after human approval by preparing bilingual notes, validating the source, pushing main, and publishing a version tag. Use when the user explicitly confirms WallHub Webview is ready to release or asks to publish a WallHub Webview release.
---

# WallHub Web Release

Use this skill only after a human explicitly approves a release and provides a target version in `vMAJOR.MINOR.PATCH` form. If either approval or version is absent, ask for it and do not push, tag, or release.

## Release Gate

1. Confirm the repository is `WallHub for Webview`, the current branch is `main`, and `origin` uses `git@github-wallhub-web:ChEnLeo-7/WallHub2.0.git`.
2. Confirm the target version is greater than the latest `v*` tag and follows `vMAJOR.MINOR.PATCH`.
3. Inspect `git status`, `git diff`, `git log`, and the commits since the latest version tag. Stop if unexpected changes are present or the requested release scope is unclear.
4. Update `package.json` and `package-lock.json` so `version` exactly equals the tag without its `v` prefix. Do not create the tag yet.

Completion criterion: the version, scope, branch, remote, and human approval are explicit and consistent.

## Bilingual Release Notes

Create `docs/release-notes/<tag>.md`. It is the exact GitHub Release body and must contain all four headings below:

```md
# WallHub <tag>

## 中文更新

### 新功能

- 面向用户描述的功能变动；没有时删除本小节。

### 优化

- 面向用户描述的体验、性能或稳定性优化；没有时删除本小节。

### 修复

- 面向用户描述的 bug fix；没有时删除本小节。

## English Release Notes

### Features

- User-facing equivalent of the Chinese notes; omit this subsection when empty.

### Improvements

- User-facing equivalent of the Chinese notes; omit this subsection when empty.

### Fixes

- User-facing equivalent of the Chinese notes; omit this subsection when empty.

## 下载说明

- `WallHub-Setup-win-x64.exe`：Windows 图形安装版。
- `WallHub-Portable-win-x64.zip`：Windows 免安装便携版，解压后运行 `WallHub.exe`。
- 附带 SHA-256 校验文件；GitHub 同时提供 Source code (zip) 和 Source code (tar.gz)。

## Downloads

- `WallHub-Setup-win-x64.exe`: Windows graphical installer.
- `WallHub-Portable-win-x64.zip`: Windows portable package; extract it and run `WallHub.exe`.
- SHA-256 checksum files are included; GitHub also provides Source code (zip) and Source code (tar.gz).
```

Write release notes from the observable user impact of commits and changed code, not a raw commit list. Include every meaningful new feature, improvement, and fix since the prior tag. Keep Chinese and English sections semantically equivalent. State `无` / `None` only when a whole release category truly has no user-visible changes.

Completion criterion: the committed notes file has all required headings, accurate bilingual content, and the target tag in its title.

## Verify

Run these commands from the repository root before committing:

```bash
npm ci
npm test
npx tsc --noEmit
npm run build:ui
python -m unittest tools/mpkg/test_mobile_mpkg.py
```

If a command fails, diagnose and fix the release-blocking problem before continuing. Do not publish a release with an unacknowledged verification failure.

Completion criterion: every command succeeds, or the human explicitly accepts a documented exception before any push or tag.

## Publish

1. Inspect `git status`, `git diff --check`, and the staged diff. Stage only intended release changes.
2. Commit with a concise versioned message such as `release v2.0.2`.
3. Push `main` with `git push origin main`.
4. Create an annotated tag: `git tag -a <tag> -m "release <tag>"`.
5. Push only that tag: `git push origin <tag>`.
6. Verify the remote branch and tag with `git ls-remote --heads origin main` and `git ls-remote --tags origin <tag>`.

Pushing the tag triggers `.github/workflows/release.yml`. The workflow verifies the tag/version match and the required bilingual notes file, builds and smoke-tests Windows packages, then publishes the installer, portable ZIP, SHA-256 files, and GitHub-generated source archives.

Completion criterion: `main` and the annotated tag exist on `origin`; report the Release workflow URL and its final status when available.
