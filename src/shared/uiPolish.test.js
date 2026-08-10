'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '..', '..');
const settingsDialogPath = path.join(projectRoot, 'frontend', 'src', 'components', 'settings', 'SettingsDialogContent.tsx');
const settingsPanelsPath = path.join(projectRoot, 'frontend', 'src', 'components', 'settings', 'SettingsPanels.tsx');
const settingsTabsPath = path.join(projectRoot, 'frontend', 'src', 'components', 'settings', 'SettingsTabs.tsx');
const experimentalSettingsPath = path.join(projectRoot, 'frontend', 'src', 'components', 'settings', 'ExperimentalSettingsPanel.tsx');
const steamAccessSettingsPath = path.join(projectRoot, 'frontend', 'src', 'components', 'settings', 'SteamAccessSettings.tsx');
const hostsSourceHintPath = path.join(projectRoot, 'frontend', 'src', 'components', 'HostsSourceHint.tsx');
const downloadSettingsPath = path.join(projectRoot, 'frontend', 'src', 'components', 'settings', 'DownloadSettingsPanel.tsx');
const appearanceSettingsPath = path.join(projectRoot, 'frontend', 'src', 'components', 'settings', 'AppearanceSettingsPanel.tsx');
const detailsDialogPath = path.join(projectRoot, 'frontend', 'src', 'components', 'dialogs', 'DetailsDialog.tsx');
const queueDialogPath = path.join(projectRoot, 'frontend', 'src', 'components', 'dialogs', 'QueueDialog.tsx');
const downloadChoiceDialogPath = path.join(projectRoot, 'frontend', 'src', 'components', 'dialogs', 'DownloadChoiceDialog.tsx');
const dialogPath = path.join(projectRoot, 'frontend', 'src', 'components', 'ui', 'dialog.tsx');
const appPath = path.join(projectRoot, 'frontend', 'src', 'App.tsx');
const homePagePath = path.join(projectRoot, 'frontend', 'src', 'components', 'app', 'HomePage.tsx');
const appDialogsPath = path.join(projectRoot, 'frontend', 'src', 'components', 'app', 'AppDialogs.tsx');
const downloadActionsPath = path.join(projectRoot, 'frontend', 'src', 'features', 'download', 'useDownloadActions.ts');
const authorNavigationPath = path.join(projectRoot, 'frontend', 'src', 'features', 'author', 'useAuthorNavigation.ts');
const homeCoordinatorPath = path.join(projectRoot, 'frontend', 'src', 'features', 'home', 'useHomeCoordinator.ts');
const wallpaperGridPath = path.join(projectRoot, 'frontend', 'src', 'components', 'layout', 'WallpaperGrid.tsx');
const wallpaperCardPath = path.join(projectRoot, 'frontend', 'src', 'components', 'layout', 'WallpaperCard.tsx');
const wallpaperContextMenuPath = path.join(projectRoot, 'frontend', 'src', 'components', 'layout', 'WallpaperContextMenu.tsx');
const motionPath = path.join(projectRoot, 'frontend', 'src', 'lib', 'motion.ts');
const zhTextPath = path.join(projectRoot, 'frontend', 'src', 'lib', 'text', 'zh.ts');
const enTextPath = path.join(projectRoot, 'frontend', 'src', 'lib', 'text', 'en.ts');
const steamControllerPath = path.join(projectRoot, 'frontend', 'src', 'features', 'steam', 'useSteamController.ts');
const overlaysPath = path.join(projectRoot, 'frontend', 'src', 'features', 'overlays', 'useAppOverlays.ts');
const preferencesPath = path.join(projectRoot, 'frontend', 'src', 'features', 'preferences', 'useAppPreferences.ts');
const settingsStatePath = path.join(projectRoot, 'frontend', 'src', 'features', 'settings', 'useSettingsState.ts');
const settingsControlsPath = path.join(projectRoot, 'frontend', 'src', 'features', 'settings', 'useSettingsControls.ts');
const updateControlsPath = path.join(projectRoot, 'frontend', 'src', 'features', 'settings', 'useUpdateControls.ts');

function readSources(paths) {
  return paths.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

const detailsDialogSource = readSources([
  path.join(path.dirname(detailsDialogPath), 'details-dialog', 'useDetailsDialogController.ts'),
  path.join(path.dirname(detailsDialogPath), 'details-dialog', 'DetailsMetadata.tsx'),
  path.join(path.dirname(detailsDialogPath), 'details-dialog', 'DetailsComments.tsx'),
  path.join(path.dirname(detailsDialogPath), 'details-dialog', 'DetailsActions.tsx'),
  path.join(path.dirname(detailsDialogPath), 'details-dialog', 'DetailsHeader.tsx'),
  path.join(path.dirname(detailsDialogPath), 'details-dialog', 'types.ts'),
  detailsDialogPath,
]);
const videoDialogSource = readSources([
  ...fs.readdirSync(path.join(path.dirname(detailsDialogPath), 'video-dialog'))
    .filter((name) => /\.(?:ts|tsx)$/.test(name) && !name.includes('.test.'))
    .map((name) => path.join(path.dirname(detailsDialogPath), 'video-dialog', name)),
  path.join(path.dirname(detailsDialogPath), 'VideoDialog.tsx'),
]);
const wallpaperCardSource = readSources([
  wallpaperCardPath,
  path.join(path.dirname(wallpaperCardPath), 'wallpaper-card', 'WallpaperCardMedia.tsx'),
  path.join(path.dirname(wallpaperCardPath), 'wallpaper-card', 'WallpaperCardMetadata.tsx'),
  path.join(path.dirname(wallpaperCardPath), 'wallpaper-card', 'WallpaperCardActions.tsx'),
  path.join(path.dirname(wallpaperCardPath), 'wallpaper-card', 'useActionButtonScale.ts'),
]);

function textEntry(source, key) {
  const match = source.match(new RegExp(`${key}: '([^']*)'`));
  assert.ok(match, `expected ${key} text entry`);
  return match[1];
}

function itemActionButtonTag(source, handler) {
  const marker = `onClick={() => ${handler}(item)}`;
  const handlerIndex = source.indexOf(marker);
  assert.notEqual(handlerIndex, -1, `expected ${handler} item action`);
  const start = source.lastIndexOf('<Button', handlerIndex);
  const end = source.indexOf('>', handlerIndex + marker.length);
  assert.notEqual(start, -1, `expected ${handler} Button start`);
  assert.notEqual(end, -1, `expected ${handler} Button end`);
  return source.slice(start, end + 1);
}

test('MPKG conversion setting explains the user-facing speed and compression choice without codec jargon', () => {
  const zhText = fs.readFileSync(zhTextPath, 'utf8');
  const enText = fs.readFileSync(enTextPath, 'utf8');
  const zhDescription = textEntry(zhText, 'mpkgTextureProfileDesc');
  const enDescription = textEntry(enText, 'mpkgTextureProfileDesc');

  assert.equal(textEntry(zhText, 'mpkgTextureProfile'), 'MPKG 文件转换方式');
  assert.match(zhDescription, /速度|快速/);
  assert.match(zhDescription, /压缩|文件/);
  assert.doesNotMatch(zhDescription, /RGBA|LZ4|ETC2|etcpak|Python|pip/);
  assert.equal(textEntry(zhText, 'mpkgTextureProfileFast'), '快速模式');
  assert.equal(textEntry(zhText, 'mpkgTextureProfileCompact'), '最大压缩');
  assert.match(enDescription, /fast|compression/i);
});

test('static Steam asset controls identify their two domains and hide the enhancement action when enhanced access is off', () => {
  const settings = fs.readFileSync(steamAccessSettingsPath, 'utf8');
  const text = fs.readFileSync(zhTextPath, 'utf8');
  const start = settings.indexOf('{text.wallhubSteamAccessStaticCdnControl}');
  const end = settings.indexOf('<ExperimentalToggle', start);
  const staticControl = settings.slice(start, end);

  assert.equal(textEntry(text, 'wallhubSteamAccessStaticCdnControl'), 'Steam 图片与静态资源域名控制');
  assert.match(textEntry(text, 'wallhubSteamAccessStaticCdnControlDesc'), /images\.steamusercontent\.com/);
  assert.match(textEntry(text, 'wallhubSteamAccessStaticCdnControlDesc'), /shared\.akamai\.steamstatic\.com/);
  assert.match(staticControl, /\{settings\.wallhubSteamAccessEnhance \? [\s\S]*?<Button[\s\S]*?saveStaticCdnHostControl\(key, \{ enhance:/);
  assert.match(staticControl, /settings\.wallhubSteamAccessEnhance\s*&&\s*'sm:grid-cols-\[1fr_auto_auto\]'/);
});

test('experimental next-page preload clearly warns about its additional loading cost and uses distinct semantic icons', () => {
  const settings = [experimentalSettingsPath, steamAccessSettingsPath, downloadSettingsPath, appearanceSettingsPath]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const text = fs.readFileSync(zhTextPath, 'utf8');

  assert.match(textEntry(text, 'prefetchNextPageDesc'), /可能增加加载负担/);
  assert.match(settings, /Image as ImageIcon/);
  assert.match(settings, /<ImageIcon className="h-4 w-4" \/>\s*\{text\.mpkgTextureProfile\}/);
  assert.match(settings, /<Images className="h-4 w-4" \/>\s*\{text\.wallhubSteamAccessStaticCdnControl\}/);
  assert.match(settings, /icon=\{ChevronsRight\}[\s\S]*?title=\{text\.prefetchNextPage\}/);
  assert.match(settings, /<LayoutTemplate className="h-4 w-4" \/>\s*\{text\.detailsPresentation\}/);
  assert.match(settings, /<Smartphone className="h-4 w-4" \/>\{text\.mobileColumns\}/);
  assert.match(settings, /<Monitor className="h-4 w-4" \/>\{text\.desktopColumns\}/);
  assert.equal((settings.match(/<Grid3X3 className=/g) || []).length, 1, 'keep one grid icon only for the cards-per-page setting');
});

test('only late-loaded redesigned detail sections use the ready reveal while the cover and fact cards stay static', () => {
  const details = detailsDialogSource;

  assert.match(details, /import \{ useReducedMotion \} from 'motion\/react';/);
  assert.match(details, /import \{ AnimatePresence, motion \} from 'motion\/react';/);
  assert.match(details, /const reduceMotion = useReducedMotion\(\);/);
  assert.doesNotMatch(details, /key=\{`details-content-\$\{id\}/);
  assert.match(details, /<div data-testid="details-redesigned-layout"/);
  assert.match(details, /key=\{`details-late-content-\$\{id\}-\$\{loading \? 'loading' : 'ready'\}`\}/);
  assert.match(details, /key=\{`details-comments-\$\{id\}-ready`\}/);
  assert.match(details, /showScrollTop && 'pb-16'/);
  assert.match(details, /sticky bottom-3 z-10 -mt-14 flex justify-end pr-1 pointer-events-none/);
  assert.match(details, /aria-label=\{text\.backToTop\}/);
});

test('home page provides a smooth back-to-top control with a bottom safety lane', () => {
  const homePage = fs.readFileSync(homePagePath, 'utf8');
  const text = fs.readFileSync(zhTextPath, 'utf8');

  assert.equal(textEntry(text, 'backToTop'), '返回顶部');
  assert.match(homePage, /import \{ ArrowUp \} from 'lucide-react';/);
  assert.match(homePage, /const \[showHomeScrollTop, setShowHomeScrollTop\] = React\.useState\(false\);/);
  assert.match(homePage, /window\.addEventListener\('scroll', update, \{ passive: true \}\)/);
  assert.match(homePage, /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/);
  assert.match(homePage, /pb-20[^\"]*sm:pb-24/);
  assert.match(homePage, /fixed bottom-5 right-3 z-30/);
  assert.match(homePage, /aria-label=\{text\.backToTop\}/);
});

test('resolver mode slider stays clipped and settings reuse the onboarding Hosts source hint', () => {
  const settings = fs.readFileSync(steamAccessSettingsPath, 'utf8');
  const onboarding = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'onboarding', 'EnhancedSettings.tsx'), 'utf8');
  const hint = fs.readFileSync(hostsSourceHintPath, 'utf8');
  const zhText = fs.readFileSync(zhTextPath, 'utf8');
  const enText = fs.readFileSync(enTextPath, 'utf8');

  assert.match(settings, /grid w-full grid-cols-2 gap-1 overflow-hidden rounded-lg[^\"]*\[contain:paint\]/);
  assert.match(settings, /layoutId="settings-resolver-mode-indicator"/);
  assert.match(settings, /<HostsSourceHint exampleLabel=\{text\.resolverHostsUrlExample\} forkHint=\{text\.resolverHostsForkHint\} \/>/);
  assert.match(onboarding, /<HostsSourceHint exampleLabel=\{copy\.hostsUrlExample\} forkHint=\{copy\.hostsForkHint\} \/>/);
  assert.match(hint, /https:\/\/raw\.githubusercontent\.com\/ChEnLeo-7\/Github_hosts/);
  assert.equal(textEntry(zhText, 'resolverHostsUrlExample'), 'URL 示例');
  assert.equal(textEntry(enText, 'resolverHostsUrlExample'), 'Example URL');
});

test('home and detail back-to-top controls share a shadowed enter and exit animation with larger mobile targets', () => {
  const homePage = fs.readFileSync(homePagePath, 'utf8');
  const details = detailsDialogSource;

  assert.match(homePage, /from '@\/lib\/motion';/);
  assert.match(details, /import \{ AnimatePresence, motion \} from 'motion\/react';/);
  assert.match(homePage, /initial=\{BACK_TO_TOP_MOTION\.initial\}/);
  assert.match(homePage, /exit=\{BACK_TO_TOP_MOTION\.exit\}/);
  assert.match(details, /<AnimatePresence initial=\{false\}>/);
  assert.match(details, /initial=\{BACK_TO_TOP_MOTION\.initial\}/);
  assert.match(details, /exit=\{BACK_TO_TOP_MOTION\.exit\}/);
  assert.match(homePage, /h-11 w-11[^\"]*shadow-lg/);
  assert.match(homePage, /sm:h-10 sm:w-10/);
  assert.match(details, /h-11 w-11[^\"]*shadow-lg/);
  assert.match(details, /sm:h-10 sm:w-10/);
});

test('late-loaded description and comments use the longer low-opacity ready transition', () => {
  const details = detailsDialogSource;

  assert.match(details, /key=\{`details-late-content-\$\{id\}-\$\{loading \? 'loading' : 'ready'\}`\}/);
  assert.match(details, /initial=\{loading \|\| reduceMotion \? false : DETAILS_READY_CONTENT_MOTION\.initial\}/);
  assert.match(details, /key=\{`details-comments-\$\{id\}-ready`\}[\s\S]*?initial=\{reduceMotion \? false : DETAILS_READY_CONTENT_MOTION\.initial\}/);
  assert.match(details, /animate=\{DETAILS_READY_CONTENT_MOTION\.animate\}/);
  assert.match(details, /transition=\{reduceMotion \? \{ duration: 0 \} : DETAILS_READY_CONTENT_MOTION\.transition\}/);
});

test('details footer keeps download primary and groups subscription actions on mobile', () => {
  const details = detailsDialogSource;

  assert.doesNotMatch(details, /homeCardDefaultAction|actionVariant/);
  assert.match(itemActionButtonTag(details, 'onClientDownload'), /className="col-span-2 sm:col-span-1"/);
  assert.match(itemActionButtonTag(details, 'onClientDownload'), /variant="default"/);
  assert.match(itemActionButtonTag(details, 'onPlay'), /className="col-span-2 sm:col-span-1"/);
  assert.match(details, /col-span-2 grid grid-cols-2 gap-2 sm:contents/);
  assert.match(itemActionButtonTag(details, 'onRemoteSubscribe'), /className="min-w-0"/);
  assert.match(itemActionButtonTag(details, 'onRemoteUnsubscribe'), /className="min-w-0"/);
});

test('personal subscriptions do not bulk-mark stale home results as subscribed', () => {
  const app = readSources([appPath, appDialogsPath]);
  const steamController = fs.readFileSync(steamControllerPath, 'utf8');

  assert.doesNotMatch(`${app}\n${steamController}`, /personalFilter !== 'mysubscriptions'[\s\S]*?items\.forEach\(\(item\) =>[\s\S]*?next\[id\] = true/);
  assert.match(steamController, /const isPersonalSubscription = personalFilter === 'mysubscriptions';[\s\S]*?if \(isPersonalSubscription\) \{[\s\S]*?setSubscriptionStates\(\(current\) => current\[id\] === true \? current : \{ \.\.\.current, \[id\]: true \}\)/);
  assert.match(steamController, /if \(isPersonalSubscription \|\| isPersonalFavorite\) return;/);
  assert.match(app, /steamController\.syncSelectedItem\(id, preferences\.filters\.personalFilter\)/);
});

test('settings dialog delegates navigation and stable panels to focused modules', () => {
  const dialog = fs.readFileSync(settingsDialogPath, 'utf8');
  const panels = fs.readFileSync(settingsPanelsPath, 'utf8');
  const tabs = fs.readFileSync(settingsTabsPath, 'utf8');

  assert.match(dialog, /<SettingsTabs activeTab=\{tab\}/);
  assert.match(dialog, /<ServerSettingsPanel[\s\S]*?<DownloadSettingsPanel[\s\S]*?<SteamSettingsPanel[\s\S]*?<AppearanceSettingsPanel/);
  assert.match(dialog, /<ExperimentalSettingsPanel/);
  assert.match(dialog, /<ResolverPickerDialog/);
  assert.match(panels, /export \{ ServerSettingsPanel \} from '\.\/ServerSettingsPanel';/);
  assert.match(panels, /export \{ ExperimentalSettingsPanel \} from '\.\/ExperimentalSettingsPanel';/);
  assert.match(tabs, /export function SettingsTabs/);
});

test('settings logic stays within focused file boundaries', () => {
  const settingsDir = path.dirname(settingsDialogPath);
  const logicFiles = fs.readdirSync(settingsDir)
    .filter((name) => /\.(?:ts|tsx)$/.test(name));

  for (const name of logicFiles) {
    const source = fs.readFileSync(path.join(settingsDir, name), 'utf8');
    assert.ok(source.split(/\r?\n/).length < 500, `${name} should remain below 500 lines`);
  }
});

test('large media components delegate focused responsibilities to local modules', () => {
  const entries = [detailsDialogPath, wallpaperCardPath, path.join(path.dirname(detailsDialogPath), 'VideoDialog.tsx')];
  for (const entry of entries) {
    const source = fs.readFileSync(entry, 'utf8');
    assert.ok(source.split(/\r?\n/).length < 300, `${path.basename(entry)} should remain below 300 lines`);
  }
  assert.match(fs.readFileSync(detailsDialogPath, 'utf8'), /useDetailsDialogController[\s\S]*?<DetailsMetadata[\s\S]*?<DetailsComments/);
  assert.match(fs.readFileSync(path.join(path.dirname(detailsDialogPath), 'VideoDialog.tsx'), 'utf8'), /useVideoDialogController[\s\S]*?<VideoPlayer/);
  assert.match(fs.readFileSync(wallpaperCardPath, 'utf8'), /<WallpaperCardMedia[\s\S]*?<WallpaperCardMetadata[\s\S]*?<WallpaperCardActions/);
});

test('video dialog controller composes focused behavior hooks within the entry-point budget', () => {
  const videoDialogDir = path.join(path.dirname(detailsDialogPath), 'video-dialog');
  const controller = fs.readFileSync(path.join(videoDialogDir, 'useVideoDialogController.ts'), 'utf8');

  assert.ok(controller.split(/\r?\n/).length < 300, 'useVideoDialogController.ts should remain below 300 lines');
  for (const hook of [
    'useVideoAudio',
    'useVideoControlVisibility',
    'useVideoReadiness',
    'useVideoFullscreen',
    'useVideoInteraction',
    'useVideoKeyboard',
    'useVideoLayout',
    'useVideoLongPressRate',
    'useVideoPlayback',
    'useVideoSeek',
  ]) {
    assert.match(controller, new RegExp(`import \\{ ${hook} \\} from '\\.\\/${hook}';`));
    assert.match(controller, new RegExp(`${hook}\\(`));
    assert.ok(fs.existsSync(path.join(videoDialogDir, `${hook}.ts`)), `expected ${hook}.ts`);
  }
});

test('favorite state remains scoped to each wallpaper and treats My Favorites results as favorited', () => {
  const app = readSources([appPath, appDialogsPath]);
  const steamController = fs.readFileSync(steamControllerPath, 'utf8');

  assert.match(steamController, /const \[favoriteStates, setFavoriteStates\] = React\.useState<Record<string, boolean>>\(\{\}\);/);
  assert.match(steamController, /const isPersonalFavorite = personalFilter === 'myfavorites';[\s\S]*?if \(isPersonalFavorite\) \{[\s\S]*?setFavoriteStates\(\(current\) => current\[id\] === true \? current : \{ \.\.\.current, \[id\]: true \}\)/);
  assert.match(steamController, /setFavoriteStates\(\(current\) => current\[id\] === result\.favorited \? current : \{ \.\.\.current, \[id\]: result\.favorited \}\)/);
  assert.match(app, /preferences\.filters\.personalFilter === 'myfavorites'[\s\S]*?steamController\.favoriteStates\[selectedItemId\] === true/);
  assert.match(app, /preferences\.filters\.personalFilter === 'myfavorites'[\s\S]*?steamController\.favoriteStates\[contextMenuItemId\] === true/);
  assert.match(app, /preferences\.filters\.personalFilter !== 'mysubscriptions' && preferences\.filters\.personalFilter !== 'myfavorites'[\s\S]*?refreshSubscriptionStatus\(item\.publishedfileid\)/);
});

test('details favorite action is mutually exclusive within the mobile action pair', () => {
  const details = detailsDialogSource;

  assert.match(details, /personalFavoriteActive \? \([\s\S]*?onClick=\{\(\) => onRemoteUnfavorite\(item\)\}[\s\S]*?favoriteLabel[\s\S]*?\) : \([\s\S]*?onClick=\{\(\) => onRemoteFavorite\(item\)\}[\s\S]*?favoriteLabel/);
  assert.match(itemActionButtonTag(details, 'onRemoteFavorite'), /className="min-w-0"/);
  assert.match(itemActionButtonTag(details, 'onRemoteUnfavorite'), /className="min-w-0"/);
});

test('wallpaper context menu exposes mutually exclusive favorite actions', () => {
  const menu = fs.readFileSync(wallpaperContextMenuPath, 'utf8');

  assert.match(menu, /personalFavoriteActive[\s\S]*?onRemoteFavorite[\s\S]*?onRemoteUnfavorite/);
  assert.match(menu, /personalFavoriteActive[\s\S]*?label=\{favoriteLabel\}[\s\S]*?select\(onRemoteUnfavorite\)[\s\S]*?:[\s\S]*?label=\{favoriteLabel\}[\s\S]*?select\(onRemoteFavorite\)/);
});

test('queue title switches between one status or wallpaper type filter container', () => {
  const queueDialog = fs.readFileSync(queueDialogPath, 'utf8');

  assert.match(queueDialog, /type QueueFilterMode = 'status' \| 'type';/);
  assert.match(queueDialog, /const \[filterMode, setFilterMode\] = React\.useState<QueueFilterMode>\('status'\);/);
  assert.match(queueDialog, /onDoubleClick=\{toggleFilterMode\}/);
  assert.match(queueDialog, /setFilterMode\(\(current\) => current === 'status' \? 'type' : 'status'\)/);
  assert.match(queueDialog, /<AnimatePresence initial=\{false\} mode="wait">[\s\S]*?key=\{filterMode\}[\s\S]*?aria-label=\{filterMode === 'status' \? text\.queueStatusFilter : text\.queueTypeFilter\}/);
  assert.equal((queueDialog.match(/\{filterOptions\.map\(/g) || []).length, 1);
});

test('queue wallpaper type filter offers all video scene and web and filters by current mode', () => {
  const queueDialog = fs.readFileSync(queueDialogPath, 'utf8');

  assert.match(queueDialog, /type QueueWallpaperTypeFilter = 'all' \| 'video' \| 'scene' \| 'web';/);
  assert.match(queueDialog, /\{ value: 'all' as const, label: text\.queueFilterAll \}[\s\S]*?\{ value: 'video' as const, label: text\.queueFilterVideo \}[\s\S]*?\{ value: 'scene' as const, label: text\.queueFilterScene \}[\s\S]*?\{ value: 'web' as const, label: text\.queueFilterWeb \}/);
  assert.match(queueDialog, /if \(filterMode === 'status'\)[\s\S]*?statusFilter\(task\.status\) === activeStatusFilter[\s\S]*?wallpaperTypeFilter\(task\) === activeTypeFilter/);
  assert.match(queueDialog, /const type = String\(task\.workshopType \|\| ''\)\.trim\(\)\.toLowerCase\(\);/);
});

test('queue filter container remains centered without moving the title or close button', () => {
  const queueDialog = fs.readFileSync(queueDialogPath, 'utf8');

  assert.match(queueDialog, /relative flex w-full min-w-0 flex-col items-start[\s\S]*?w-full self-center sm:absolute sm:left-1\/2 sm:top-0 sm:w-auto sm:-translate-x-1\/2/);
  assert.match(queueDialog, /titleFullWidth/);
  assert.match(queueDialog, /closeButtonClassName="max-sm:top-3"/);
  assert.match(queueDialog, /flex w-full max-w-full flex-wrap justify-center[\s\S]*?sm:w-auto sm:flex-nowrap/);
});

test('download choice separates download timing from delivery format', () => {
  const app = readSources([appDialogsPath, downloadActionsPath]);
  const dialog = fs.readFileSync(downloadChoiceDialogPath, 'utf8');
  const overlays = fs.readFileSync(overlaysPath, 'utf8');

  assert.match(overlays, /type DownloadChoiceState = \{ item: WorkshopItem; stage: 'start' \| 'format' \};/);
  assert.match(app, /const openDownloadChoice = React\.useCallback\(\(item: WorkshopItem, stage: DownloadChoiceState\['stage'\] = 'start'\)/);
  assert.match(app, /openDownloadChoice\(item, 'format'\);/);
  assert.match(dialog, /stage: 'start' \| 'format';/);
  assert.match(dialog, /stage === 'start' \? text\.downloadStartTitle : text\.downloadChoiceTitle/);
  assert.match(dialog, /className=\{stage === 'format' \? 'w-\[min\(352px,calc\(100vw-1rem\)\)\]' : 'w-\[min\(420px,calc\(100vw-1rem\)\)\]'\}/);
  assert.match(dialog, /text\.normalDownload[\s\S]*?text\.backgroundDownload[\s\S]*?text\.close/);
  assert.match(dialog, /const supportsMpkg = type === 'Scene' \|\| type === 'Video';/);
  assert.match(dialog, /\{supportsMpkg \? \([\s\S]*?text\.downloadMpkgMobile[\s\S]*?text\.mpkgConvertOnly[\s\S]*?\) : null\}/);
  assert.match(dialog, /text\.downloadPkgSource[\s\S]*?text\.cancel/);
  assert.match(dialog, /const formatActionClass = '!size-\[88px\][\s\S]*?flex-col[\s\S]*?\[&_svg\]:size-9/);
  assert.match(dialog, /supportsMpkg \? 'grid grid-cols-\[repeat\(3,88px\)\] justify-center gap-1\.5 sm:grid-cols-\[repeat\(3,96px\)\] sm:gap-2' : 'grid justify-items-center'/);
  assert.match(dialog, /<Package \/>[\s\S]*?<span>\{text\.downloadPkgSource\}<\/span>[\s\S]*?text\.downloadDesktopFormat[\s\S]*?<Smartphone \/>[\s\S]*?<span>\{text\.downloadMpkgMobile\}<\/span>[\s\S]*?text\.downloadMobileFormat[\s\S]*?<Folder \/>[\s\S]*?<span>\{text\.mpkgConvertOnly\}<\/span>/);
  assert.match(dialog, /<Button className="justify-self-center" variant="secondary" onClick=\{\(\) => onOpenChange\(false\)\}>[\s\S]*?text\.cancel/);
  assert.doesNotMatch(dialog, /checked=\{backgroundDownload\}/);
});

test('download choice stages use a short sequential fade transition', () => {
  const dialog = fs.readFileSync(downloadChoiceDialogPath, 'utf8');

  assert.match(dialog, /import \{ AnimatePresence, motion, useReducedMotion \} from 'motion\/react';/);
  assert.match(dialog, /const stageEnterTransition = \{ duration: reduceMotion \? 0\.1 : 0\.15, ease: stageFadeEase \};/);
  assert.match(dialog, /const stageExitTransition = \{ duration: reduceMotion \? 0\.07 : 0\.09, ease: stageFadeEase \};/);
  assert.equal((dialog.match(/<AnimatePresence initial=\{false\} mode="wait">/g) || []).length, 2);
  assert.match(dialog, /key=\{stage\}[\s\S]*?initial=\{\{ opacity: 0 \}\}[\s\S]*?animate=\{\{ opacity: 1, transition: stageEnterTransition \}\}[\s\S]*?exit=\{\{ opacity: 0, transition: stageExitTransition \}\}/);
  assert.match(dialog, /key=\{`\$\{item\.publishedfileid \|\| 'download'\}-\$\{stage\}`\}[\s\S]*?exit=\{\{ opacity: 0, pointerEvents: 'none', transition: stageExitTransition \}\}/);
});

test('two-times video playback indicator uses the player height with a safe top inset', () => {
  const videoDialog = videoDialogSource;

  assert.match(videoDialog, /longPressActive \|\| keyboardLongPressActive[\s\S]*?top-\[max\(1rem,6%\)\][\s\S]*?px-5 py-3 text-sm[\s\S]*?sm:px-6 sm:py-3\.5 sm:text-base[\s\S]*?text\.videoSpeedPlaying/);
  assert.doesNotMatch(videoDialog, /top-\[max\(1rem,6%\)\][\s\S]*?-translate-y-1\/2/);
});

test('video player presents keyboard shortcuts as scannable keycap hints', () => {
  const videoDialog = videoDialogSource;
  const text = readSources([zhTextPath, enTextPath]);

  assert.match(videoDialog, /action\.type === 'toggle-fullscreen'[\s\S]*?toggleFullscreen\(\)/);
  assert.match(videoDialog, /\{ id: 'play', keyLabel: 'Space',[\s\S]*?\{ id: 'speed', keyLabel: '→', prefix: text\.videoShortcutHold[\s\S]*?\{ id: 'fullscreen', keyLabel: 'F',[\s\S]*?\{ id: 'exit-fullscreen', keyLabel: 'Esc'/);
  assert.match(videoDialog, /aria-label=\{text\.videoShortcutsLabel\}[\s\S]*?videoShortcuts\.map[\s\S]*?<kbd className="[^"]*rounded-\[4px\][^"]*font-mono[^"]*"/);
  assert.match(videoDialog, /hide-scrollbar[^"]*overflow-x-auto/);
  assert.match(text, /videoShortcutFullscreen: '全屏'/);
  assert.match(text, /videoShortcutFullscreen: 'Fullscreen'/);
  assert.doesNotMatch(videoDialog, /videoControlsHintDesktop|videoControlsHintMobile/);
});

test('video shortcuts fade in only after playback actually starts', () => {
  const videoDialog = videoDialogSource;

  assert.match(videoDialog, /const \[playbackStarted, setPlaybackStarted\] = React\.useState\(false\);/);
  assert.match(videoDialog, /const resetVideoPlayback = React\.useCallback[\s\S]*?setPlaybackStarted\(false\);/);
  assert.match(videoDialog, /playback\.resetVideoPlayback\(\);[\s\S]*?playerMode,[\s\S]*?readySrc,/);
  assert.match(videoDialog, /\{playbackStarted \? \([\s\S]*?<motion\.div[\s\S]*?initial=\{\{ opacity: 0, y: reduceMotion \? 0 : -4 \}\}[\s\S]*?animate=\{\{ opacity: 1, y: 0 \}\}/);
  assert.match(videoDialog, /onPlaying=\{\(\) => setPlaybackStarted\(true\)\}/);
});

test('video controls release pointer focus and retain long-press keyboard speed control', () => {
  const videoDialog = videoDialogSource;

  assert.match(videoDialog, /isPlayerControl: !!\(target && controlsRef\.current\?\.contains\(target\)\)/);
  assert.equal((videoDialog.match(/if \(event\.pointerType === 'mouse'\) event\.currentTarget\.blur\(\);/g) || []).length, 3);
});

test('compatibility video controls expose a direct playback speed selector', () => {
  const videoDialog = videoDialogSource;
  const select = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'ui', 'select.tsx'), 'utf8');

  assert.match(videoDialog, /const VIDEO_PLAYBACK_RATE_OPTIONS = \[0\.5, 0\.75, 1,[\s\S]*?2\.75, 3\];/);
  assert.match(videoDialog, /\{compatibilityMode \? <VideoControls controller=\{controller\} \/> : null\}/);
  assert.match(videoDialog, /<Select[\s\S]*?value=\{String\(playbackRate\)\}[\s\S]*?options=\{VIDEO_PLAYBACK_RATE_SELECT_OPTIONS\}[\s\S]*?onChange=\{\(value\) => setVideoPlaybackRate\(Number\(value\)\)\}[\s\S]*?ariaLabel=\{text\.videoPlaybackRate\}[\s\S]*?portalContainerRef=\{fullscreenActive \? playerShellRef : undefined\}[\s\S]*?variant="media"/);
  assert.match(select, /border-border bg-popover[\s\S]*?text-foreground/);
  assert.match(select, /portalContainerRef\?\.current \|\| document\.body/);
  assert.match(select, /const SELECT_MENU_MAX_HEIGHT = 256;/);
  assert.match(select, /const MEDIA_SELECT_MENU_WIDTH = 88;/);
  assert.match(select, /rect\.top - optionHeight - 4/);
  assert.match(select, /wallhub-media-select-menu rounded-md border-white\/20 bg-black\/90[\s\S]*?bg-white\/20 text-white/);
});

test('an open playback speed menu consumes the first video-area click', () => {
  const videoDialog = videoDialogSource;
  const select = fs.readFileSync(path.join(projectRoot, 'frontend', 'src', 'components', 'ui', 'select.tsx'), 'utf8');

  assert.match(select, /const setMenuOpen = React\.useCallback\([\s\S]*?setOpen\(nextOpen\);[\s\S]*?onOpenChange\?\.\(nextOpen\)/);
  assert.match(select, /onPointerDown[\s\S]*?setMenuOpen\(false\)/);
  assert.match(videoDialog, /playbackRateMenuOpenRef\.current && !open[\s\S]*?playbackRateMenuDismissedRef\.current = true/);
  assert.match(videoDialog, /if \(!playbackRateMenuOpen && !playbackRateMenuOpenRef\.current && !playbackRateMenuDismissedRef\.current\) return false;/);
  assert.match(videoDialog, /playbackRateMenuDismissedRef\.current = false;[\s\S]*?showControls\(\);[\s\S]*?return true;/);
  assert.match(videoDialog, /if \(!playbackRateMenuOpenRef\.current\) playbackRateMenuDismissedRef\.current = false;[\s\S]*?if \(playbackRateMenuOpenRef\.current \|\| event\.button !== 0/);
  assert.match(videoDialog, /onOpenChange=\{handlePlaybackRateMenuOpenChange\}/);
});

test('mobile video playback requires a double click or the playback button', () => {
  const videoDialog = videoDialogSource;

  assert.match(videoDialog, /React\.useState\(\(\) => hasTouchVideoInteraction\(\)\)/);
  assert.match(videoDialog, /window\.matchMedia\('\(pointer: coarse\)'\)/);
  assert.match(videoDialog, /desktopVideoInteraction: viewportSize\.width >= 640 && !touchVideoInteraction/);
  assert.match(videoDialog, /const handleMobileVideoDoubleClick = React\.useCallback[\s\S]*?if \(desktopVideoInteraction \|\| suppressVideoClickRef\.current\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?togglePlayback\(\);[\s\S]*?showControls\(\);/);
  assert.match(videoDialog, /touch-manipulation/);
  assert.match(videoDialog, /const handleVideoClick = React\.useCallback[\s\S]*?if \(!desktopVideoInteraction\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?showControls\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?togglePlayback\(\);/);
  assert.match(videoDialog, /onClick=\{handleVideoClick\}/);
  assert.match(videoDialog, /onDoubleClick=\{!desktopVideoInteraction \? handleMobileVideoDoubleClick : undefined\}/);
  assert.match(videoDialog, /onClick=\{togglePlayback\}[\s\S]*?aria-label=\{isPlaying \? text\.videoPause : text\.videoPlay\}/);
});

test('video seek slider previews while dragging and commits on pointer release', () => {
  const videoDialog = videoDialogSource;

  assert.match(videoDialog, /const \[seekPreviewTime, setSeekPreviewTime\] = React\.useState<number \| null>\(null\);/);
  assert.match(videoDialog, /const previewVideoPosition = React\.useCallback[\s\S]*?seekPreviewTimeRef\.current = nextValue;[\s\S]*?setSeekPreviewTime\(nextValue\);/);
  assert.match(videoDialog, /const finishVideoSeek = React\.useCallback[\s\S]*?player\.currentTime = nextValue;[\s\S]*?setCurrentTime\(nextValue\);/);
  assert.match(videoDialog, /onPointerDown=\{beginVideoSeek\}[\s\S]*?onPointerUp=\{finishVideoSeek\}[\s\S]*?onChange=\{\(event\) => previewVideoPosition\(Number\(event\.target\.value\)\)\}/);
  assert.doesNotMatch(videoDialog, /onChange=\{\(event\) => setVideoPosition/);
});

test('video arrow-key seeks ignore repeats and commit once on matching key release', () => {
  const videoDialog = videoDialogSource;

  assert.match(videoDialog, /keyboardPendingSeekKeyRef = React\.useRef<'ArrowLeft' \| 'ArrowRight' \| null>\(null\)/);
  assert.match(videoDialog, /if \(event\.repeat\) return;[\s\S]*?keyboardPendingSeekSecondsRef\.current = action\.seconds;[\s\S]*?keyboardPendingSeekKeyRef\.current = event\.key === 'ArrowLeft'/);
  assert.match(videoDialog, /if \(event\.key !== keyboardPendingSeekKeyRef\.current\) return;[\s\S]*?stopKeyboardLongPress\(true\);/);
  assert.doesNotMatch(videoDialog, /seekVideo\(action\.seconds\)/);
});

test('non-video play defaults open the download flow and Steam actions wait three seconds', () => {
  const homeCoordinator = fs.readFileSync(homeCoordinatorPath, 'utf8');
  const card = wallpaperCardSource;
  const steamController = fs.readFileSync(steamControllerPath, 'utf8');

  assert.match(homeCoordinator, /options\.defaultAction === 'playVideo' && itemType\(item\) !== 'Video'[\s\S]*?\? 'clientDownload'[\s\S]*?: options\.defaultAction/);
  assert.match(card, /defaultAction === 'playVideo' && type !== 'Video' \? 'clientDownload' : defaultAction/);
  assert.match(steamController, /const interval = window\.setInterval\([\s\S]*?\}, 1000\);/);
  assert.match(steamController, /const timeout = window\.setTimeout\(async \(\) => \{[\s\S]*?\}, 3000\);/);
  assert.match(steamController, /cancel-scheduled-remote-\$\{kind\}/);
});

test('App delegates preferences settings controls and overlay history to focused feature hooks', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const preferences = fs.readFileSync(preferencesPath, 'utf8');
  const settings = `${fs.readFileSync(settingsStatePath, 'utf8')}\n${fs.readFileSync(settingsControlsPath, 'utf8')}\n${fs.readFileSync(updateControlsPath, 'utf8')}`;
  const overlays = fs.readFileSync(overlaysPath, 'utf8');

  assert.ok(app.split(/\r?\n/).length < 600, 'App should remain below 600 lines as the application shell');
  assert.match(app, /useAppPreferences\(\)/);
  assert.match(app, /useSettingsState\(\)/);
  assert.match(app, /useSettingsControls\(\{/);
  assert.match(app, /useUpdateControls\(\{/);
  assert.match(app, /useAppOverlays\(\{/);
  assert.match(app, /useDownloadActions\(\{/);
  assert.match(app, /useAuthorNavigation\(\{/);
  assert.match(app, /useHomeCoordinator\(\{/);
  assert.match(app, /<HomePage/);
  assert.match(app, /<AppDialogs/);
  assert.match(preferences, /localStorage\.setItem\([\s\S]*?PREFS_KEY/);
  assert.match(preferences, /applyCustomAccentVariables/);
  assert.match(settings, /getSettingsDetails\(\)/);
  assert.match(settings, /await saveSettings\(payload\)/);
  assert.match(settings, /checkForUpdates\(\{ cached: true \}\)/);
  assert.match(overlays, /useOverlayHistory\(layers, restore\)/);
  assert.doesNotMatch(app, /localStorage\.setItem|await saveSettings\(payload\)|useOverlayHistory\(|<SettingsDialog|<WallpaperGrid|<DownloadChoiceDialog/);
});

test('MPKG browser downloads do not show a persistent preparation toast', () => {
  const downloadActions = fs.readFileSync(downloadActionsPath, 'utf8');
  const text = readSources([zhTextPath, enTextPath]);
  const handler = downloadActions.slice(downloadActions.indexOf('const doMpkgDownload'), downloadActions.indexOf('const doBackgroundDownload'));

  assert.match(handler, /await mpkgDownload[\s\S]*?\{ textureProfile \}/);
  assert.match(handler, /toast\(text\.mpkgSent, 'ok'\)/);
  assert.doesNotMatch(handler, /preparingToastId|onPreparing|updateToast|dismissToast|elapsedSeconds/);
  assert.doesNotMatch(text, /mpkgSourceDownloadingProgress|mpkgPreparingProgress/);
});

test('details actions keep subscription and favorite controls on one mobile row', () => {
  const dialog = detailsDialogSource;

  assert.match(dialog, /col-span-2 grid grid-cols-2 gap-2 sm:contents/);
  assert.match(dialog, /remoteSubscribePending\.replace\('\{dots\}'/);
  assert.match(dialog, /remoteFavoritePending\.replace\('\{dots\}'/);
});

test('details dialog keeps card layout disabled until scroll locking is fully restored', () => {
  const homePage = fs.readFileSync(homePagePath, 'utf8');
  const dialog = fs.readFileSync(dialogPath, 'utf8');

  assert.doesNotMatch(homePage, /selectedDialogIdRef/);
  assert.match(homePage, /if \(detailsDialogOpen\) \{[\s\S]*?setSuppressGridLayoutForDialog\(true\);[\s\S]*?return;/);
  assert.match(homePage, /suppressLayoutAnimation=\{suppressGridLayoutAnimation \|\| detailsDialogOpen \|\| suppressGridLayoutForDialog\}/);
  assert.match(homePage, /requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => setSuppressGridLayoutForDialog\(false\)\)/);
  assert.match(dialog, /scrollbarGutter\.split\(\/\\s\+\/\)\.includes\('stable'\)/);
  assert.match(dialog, /scrollbarWidth > 0 && !stableScrollbarGutter/);
});

test('App shell delegates home dialogs downloads author navigation and home coordination', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const homePage = fs.readFileSync(homePagePath, 'utf8');
  const appDialogs = fs.readFileSync(appDialogsPath, 'utf8');
  const downloads = fs.readFileSync(downloadActionsPath, 'utf8');
  const author = fs.readFileSync(authorNavigationPath, 'utf8');
  const home = fs.readFileSync(homeCoordinatorPath, 'utf8');

  assert.ok(app.split(/\r?\n/).length < 600, 'App should stay within the shell line budget');
  assert.match(homePage, /export function HomePage/);
  assert.match(homePage, /<Header[\s\S]*?<FilterBar[\s\S]*?<WallpaperGrid/);
  assert.match(appDialogs, /export function AppDialogs/);
  assert.match(appDialogs, /<GenreSheet[\s\S]*?<SettingsDialog[\s\S]*?<DetailsDialog[\s\S]*?<DownloadChoiceDialog/);
  assert.match(downloads, /export function useDownloadActions/);
  assert.match(downloads, /mpkgDownload[\s\S]*?mpkgConvertOnly/);
  assert.match(author, /export function useAuthorNavigation/);
  assert.match(author, /restoreWorkshopState\(snapshot\)/);
  assert.match(home, /export function useHomeCoordinator/);
  assert.match(home, /defaultHomeFilters\(GENRES, TEXT\.zh\)/);
});

test('home view switches keep visual regions proportional and scale action buttons independently', () => {
  const grid = fs.readFileSync(wallpaperGridPath, 'utf8');
  const card = wallpaperCardSource;
  const motion = fs.readFileSync(motionPath, 'utf8');

  assert.match(grid, /layout=\{suppressLayoutAnimation \? false : 'position'\}/);
  assert.match(grid, /initial=\{!suppressLayoutAnimation\} mode="popLayout"/);
  assert.match(grid, /suppressLayoutAnimation=\{suppressLayoutAnimation\}/);
  assert.match(grid, /transition=\{\{ layout: HOME_VIEW_CARD_LAYOUT_TRANSITION \}\}/);
  assert.doesNotMatch(grid, /type: 'spring'[\s\S]*?bounce:/);
  assert.match(card, /const MotionCard = motion\.create\(Card\);/);
  assert.match(card, /const layoutAnimationEnabled = !suppressLayoutAnimation && !prefersReducedMotion;/);
  assert.match(card, /const entryAnimationEnabled = !prefersReducedMotion;/);
  assert.match(card, /const preserveAspectLayout[^=]*= layoutAnimationEnabled \? 'preserve-aspect'(?: as const)? : false;/);
  assert.match(card, /<MotionCard[\s\S]*?layout=\{layoutAnimationEnabled\}/);
  assert.equal((card.match(/layout=\{layoutAnimationEnabled\}/g) || []).length, 3);
  assert.equal((card.match(/layout=\{preserveAspectLayout\}/g) || []).length, 5);
  assert.doesNotMatch(card, /wallpaper-card-pointer-glow|--wallpaper-card-pointer/);
  assert.match(card, /overflow-visible border-border bg-card text-card-foreground shadow-none/);
  assert.match(card, /relative z-10 aspect-square w-full overflow-hidden bg-muted/);
  assert.match(card, /view === 'grid' \? 'rounded-t-xl' : 'rounded-l-xl'/);
  assert.doesNotMatch(card, /sm:aspect-auto/);
  assert.match(card, /layoutDependency=\{view\}/);
  assert.match(card, /pointer-events-none absolute left-0 top-0 z-20 aspect-square/);
  assert.match(card, /transition=\{\{ layout: HOME_VIEW_MEDIA_LAYOUT_TRANSITION \}\}/);
  assert.match(card, /view === 'grid' \? 'w-full' : 'w-\[104px\] sm:w-\[150px\]'/);
  assert.doesNotMatch(card, /MotionBadge|motion\.create\(Badge\)/);
  assert.match(card, /<motion\.div[\s\S]*?absolute left-2 top-2 inline-flex h-6[\s\S]*?view === 'list' && 'h-4 px-1\.5 text-\[10px\] leading-none'/);
  assert.match(card, /wallpaper-card-equalizer absolute right-2 top-2 flex h-6 items-end[\s\S]*?view === 'list' && 'h-4 gap-px px-1\.5 py-0\.5'/);
  assert.match(card, /data-compact=\{view === 'list' \? 'true' : 'false'\}/);
  assert.match(card, /<MotionCardContent\s+layout=\{preserveAspectLayout\}/);
  assert.match(card, /<motion\.h2\s+layout=\{preserveAspectLayout\}/);
  assert.match(card, /<motion\.div\s+layout=\{preserveAspectLayout\}[\s\S]*?className="mt-1\.5/);
  assert.match(card, /function useActionButtonScale\(view: 'grid' \| 'list', layoutAnimationEnabled: boolean\)/);
  assert.match(card, /<motion\.div\s+layout=\{layoutAnimationEnabled \? 'position' : false\}[\s\S]*?className=\{cn\('flex h-8 shrink-0'/);
  assert.match(card, /ref=\{actionButtonRef\}/);
  assert.match(card, /actionContent\.style\.transform = `scale\(\$\{1 \/ currentScaleX\}, \$\{1 \/ currentScaleY\}\)`/);
  assert.doesNotMatch(card, /MotionButton|layout=\{layoutAnimationEnabled \? 'size' : false\}/);
  assert.doesNotMatch(card, /key=\{view\}/);
  assert.doesNotMatch(card, /scale: view === 'grid' \? 0\.94 : 0\.97/);
  assert.match(motion, /HOME_VIEW_CARD_LAYOUT_TRANSITION[\s\S]*?type: 'tween'[\s\S]*?duration: 0\.4[\s\S]*?ease: \[0\.4, 0, 0\.2, 1\]/);
  assert.match(motion, /HOME_VIEW_MEDIA_LAYOUT_TRANSITION[\s\S]*?type: 'tween'[\s\S]*?duration: 0\.52[\s\S]*?ease: \[0\.4, 0, 0\.2, 1\]/);
});
