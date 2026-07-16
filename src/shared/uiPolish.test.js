'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '..', '..');
const settingsDialogPath = path.join(projectRoot, 'frontend', 'src', 'components', 'dialogs', 'SettingsDialog.tsx');
const detailsDialogPath = path.join(projectRoot, 'frontend', 'src', 'components', 'dialogs', 'DetailsDialog.tsx');
const appPath = path.join(projectRoot, 'frontend', 'src', 'App.tsx');
const wallpaperGridPath = path.join(projectRoot, 'frontend', 'src', 'components', 'layout', 'WallpaperGrid.tsx');
const wallpaperCardPath = path.join(projectRoot, 'frontend', 'src', 'components', 'layout', 'WallpaperCard.tsx');
const motionPath = path.join(projectRoot, 'frontend', 'src', 'lib', 'motion.ts');
const textPath = path.join(projectRoot, 'frontend', 'src', 'lib', 'text.ts');

function textEntry(source, key) {
  const match = source.match(new RegExp(`${key}: '([^']*)'`));
  assert.ok(match, `expected ${key} text entry`);
  return match[1];
}

test('MPKG conversion setting explains the user-facing speed and compression choice without codec jargon', () => {
  const text = fs.readFileSync(textPath, 'utf8');
  const zhDescription = textEntry(text, 'mpkgTextureProfileDesc');
  const enDescription = text.match(/mpkgTextureProfileDesc: '([^']*)'/g)?.[1]?.match(/'([^']*)'/)?.[1] || '';

  assert.equal(textEntry(text, 'mpkgTextureProfile'), 'MPKG 文件转换方式');
  assert.match(zhDescription, /速度|快速/);
  assert.match(zhDescription, /压缩|文件/);
  assert.doesNotMatch(zhDescription, /RGBA|LZ4|ETC2|etcpak|Python|pip/);
  assert.equal(textEntry(text, 'mpkgTextureProfileFast'), '快速模式');
  assert.equal(textEntry(text, 'mpkgTextureProfileCompact'), '最大压缩');
  assert.match(enDescription, /fast|compression/i);
});

test('static Steam asset controls identify their two domains and hide the enhancement action when enhanced access is off', () => {
  const settings = fs.readFileSync(settingsDialogPath, 'utf8');
  const text = fs.readFileSync(textPath, 'utf8');
  const start = settings.indexOf('{text.wallhubSteamAccessStaticCdnControl}');
  const end = settings.indexOf('<ExperimentalToggle', start);
  const staticControl = settings.slice(start, end);

  assert.equal(textEntry(text, 'wallhubSteamAccessStaticCdnControl'), 'Steam 图片与静态资源域名控制');
  assert.match(textEntry(text, 'wallhubSteamAccessStaticCdnControlDesc'), /images\.steamusercontent\.com/);
  assert.match(textEntry(text, 'wallhubSteamAccessStaticCdnControlDesc'), /shared\.akamai\.steamstatic\.com/);
  assert.match(staticControl, /\{settings\.wallhubSteamAccessEnhance \? \(\s*<Button[\s\S]*?saveStaticCdnHostControl\(key, \{ enhance:/);
  assert.match(staticControl, /settings\.wallhubSteamAccessEnhance\s*&&\s*'sm:grid-cols-\[1fr_auto_auto\]'/);
});

test('experimental next-page preload clearly warns about its additional loading cost and uses distinct semantic icons', () => {
  const settings = fs.readFileSync(settingsDialogPath, 'utf8');
  const text = fs.readFileSync(textPath, 'utf8');

  assert.match(textEntry(text, 'prefetchNextPageDesc'), /可能增加加载负担/);
  assert.match(settings, /Image as ImageIcon/);
  assert.match(settings, /<ImageIcon className="h-4 w-4" \/>\s*\{text\.mpkgTextureProfile\}/);
  assert.match(settings, /<Images className="h-4 w-4" \/>\s*\{text\.wallhubSteamAccessStaticCdnControl\}/);
  assert.match(settings, /icon=\{ChevronsRight\}[\s\S]*?title=\{text\.prefetchNextPage\}/);
  assert.match(settings, /icon=\{ListOrdered\}[\s\S]*?title=\{text\.workshopHtmlOrderMode\}/);
  assert.match(settings, /<LayoutTemplate className="h-4 w-4" \/>\s*\{text\.detailsPresentation\}/);
  assert.match(settings, /<Smartphone className="h-4 w-4" \/>\{text\.mobileColumns\}/);
  assert.match(settings, /<Monitor className="h-4 w-4" \/>\{text\.desktopColumns\}/);
  assert.equal((settings.match(/<Grid3X3 className=/g) || []).length, 1, 'keep one grid icon only for the cards-per-page setting');
});

test('only late-loaded redesigned detail sections use the ready reveal while the cover and fact cards stay static', () => {
  const details = fs.readFileSync(detailsDialogPath, 'utf8');

  assert.match(details, /import \{ AnimatePresence, motion, useReducedMotion \} from 'motion\/react';/);
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
  const app = fs.readFileSync(appPath, 'utf8');
  const text = fs.readFileSync(textPath, 'utf8');

  assert.equal(textEntry(text, 'backToTop'), '返回顶部');
  assert.match(app, /import \{ ArrowUp, Check, Loader2, X \} from 'lucide-react';/);
  assert.match(app, /const \[showHomeScrollTop, setShowHomeScrollTop\] = React\.useState\(false\);/);
  assert.match(app, /window\.addEventListener\('scroll', update, \{ passive: true \}\)/);
  assert.match(app, /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/);
  assert.match(app, /pb-20[^\"]*sm:pb-24/);
  assert.match(app, /fixed bottom-5 right-3 z-30/);
  assert.match(app, /aria-label=\{text\.backToTop\}/);
});

test('home and detail back-to-top controls share a shadowed enter and exit animation with larger mobile targets', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const details = fs.readFileSync(detailsDialogPath, 'utf8');

  assert.match(app, /from '@\/lib\/motion';/);
  assert.match(details, /import \{ AnimatePresence, motion, useReducedMotion \} from 'motion\/react';/);
  assert.match(app, /initial=\{BACK_TO_TOP_MOTION\.initial\}/);
  assert.match(app, /exit=\{BACK_TO_TOP_MOTION\.exit\}/);
  assert.match(details, /<AnimatePresence initial=\{false\}>/);
  assert.match(details, /initial=\{BACK_TO_TOP_MOTION\.initial\}/);
  assert.match(details, /exit=\{BACK_TO_TOP_MOTION\.exit\}/);
  assert.match(app, /h-11 w-11[^\"]*shadow-lg/);
  assert.match(app, /sm:h-10 sm:w-10/);
  assert.match(details, /h-11 w-11[^\"]*shadow-lg/);
  assert.match(details, /sm:h-10 sm:w-10/);
});

test('late-loaded description and comments use the longer low-opacity ready transition', () => {
  const details = fs.readFileSync(detailsDialogPath, 'utf8');

  assert.match(details, /key=\{`details-late-content-\$\{id\}-\$\{loading \? 'loading' : 'ready'\}`\}/);
  assert.match(details, /initial=\{loading \|\| reduceMotion \? false : DETAILS_READY_CONTENT_MOTION\.initial\}/);
  assert.match(details, /key=\{`details-comments-\$\{id\}-ready`\}[\s\S]*?initial=\{reduceMotion \? false : DETAILS_READY_CONTENT_MOTION\.initial\}/);
  assert.match(details, /animate=\{DETAILS_READY_CONTENT_MOTION\.animate\}/);
  assert.match(details, /transition=\{reduceMotion \? \{ duration: 0 \} : DETAILS_READY_CONTENT_MOTION\.transition\}/);
});

test('home view switches keep visual regions proportional and scale action buttons independently', () => {
  const grid = fs.readFileSync(wallpaperGridPath, 'utf8');
  const card = fs.readFileSync(wallpaperCardPath, 'utf8');
  const motion = fs.readFileSync(motionPath, 'utf8');

  assert.match(grid, /layout=\{suppressLayoutAnimation \? false : 'position'\}/);
  assert.match(grid, /initial=\{!suppressLayoutAnimation\} mode="popLayout"/);
  assert.match(grid, /suppressLayoutAnimation=\{suppressLayoutAnimation\}/);
  assert.match(grid, /transition=\{\{ layout: HOME_VIEW_CARD_LAYOUT_TRANSITION \}\}/);
  assert.doesNotMatch(grid, /type: 'spring'[\s\S]*?bounce:/);
  assert.match(card, /const MotionCard = motion\.create\(Card\);/);
  assert.match(card, /const layoutAnimationEnabled = !suppressLayoutAnimation && !prefersReducedMotion;/);
  assert.match(card, /const entryAnimationEnabled = !prefersReducedMotion;/);
  assert.match(card, /const preserveAspectLayout = layoutAnimationEnabled \? 'preserve-aspect' : false;/);
  assert.match(card, /<MotionCard[\s\S]*?layout=\{layoutAnimationEnabled \? 'position' : false\}/);
  assert.equal((card.match(/layout=\{layoutAnimationEnabled\}/g) || []).length, 1);
  assert.equal((card.match(/layout=\{preserveAspectLayout\}/g) || []).length, 5);
  assert.match(card, /aria-hidden="true"[\s\S]*?layout=\{layoutAnimationEnabled\}[\s\S]*?pointer-events-none absolute inset-0/);
  assert.match(card, /overflow-visible border-transparent bg-transparent text-card-foreground shadow-none/);
  assert.match(card, /relative z-10 aspect-square w-full overflow-hidden bg-muted/);
  assert.match(card, /view === 'grid' \? 'rounded-t-xl' : 'rounded-l-xl'/);
  assert.doesNotMatch(card, /sm:aspect-auto/);
  assert.match(card, /layoutDependency=\{view\}/);
  assert.match(card, /pointer-events-none absolute left-0 top-0 z-20 aspect-square/);
  assert.match(card, /transition=\{\{ layout: HOME_VIEW_MEDIA_LAYOUT_TRANSITION \}\}/);
  assert.match(card, /view === 'grid' \? 'w-full' : 'w-\[104px\] sm:w-\[150px\]'/);
  assert.match(card, /<Badge className="absolute left-2 top-2 bg-background\/80 backdrop-blur"/);
  assert.match(card, /wallpaper-card-equalizer absolute right-2 top-2/);
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
