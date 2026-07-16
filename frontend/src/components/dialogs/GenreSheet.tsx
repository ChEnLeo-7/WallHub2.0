import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check } from 'lucide-react';
import { AnimatedHeight } from '@/components/layout/AnimatedHeight';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';
import { type Filters } from '@/lib/normalizers';

const GENRES = [
  { id: 'Abstract', name: '抽象' },
  { id: 'Animal', name: '动物' },
  { id: 'Anime', name: '动漫' },
  { id: 'Cartoon', name: '卡通' },
  { id: 'CGI', name: 'CGI' },
  { id: 'Cyberpunk', name: '网络朋克' },
  { id: 'Fantasy', name: '幻想' },
  { id: 'Game', name: '游戏' },
  { id: 'Girls', name: '女性' },
  { id: 'Guys', name: '男性' },
  { id: 'Landscape', name: '风景' },
  { id: 'Medieval', name: '中世纪' },
  { id: 'Memes', name: '网络事物' },
  { id: 'MMD', name: 'MMD' },
  { id: 'Music', name: '音乐' },
  { id: 'Nature', name: '自然' },
  { id: 'Pixel art', name: '像素艺术' },
  { id: 'Relaxing', name: '放松' },
  { id: 'Retro', name: '复古' },
  { id: 'Sci-Fi', name: '科幻' },
  { id: 'Sports', name: '运动' },
  { id: 'Technology', name: '科技' },
  { id: 'Television', name: '电视节目' },
  { id: 'Vehicle', name: '汽车' },
  { id: 'Unspecified', name: '未指定样式' },
];

const OFFICIAL_FILTERS = [
  { id: 'Approved', zh: '广受好评', en: 'Approved' },
  { id: 'Audio responsive', zh: '音频响应', en: 'Audio responsive' },
  { id: '3D', zh: '3D', en: '3D' },
  { id: 'Customizable', zh: '可自定义', en: 'Customizable' },
  { id: 'Puppet Warp', zh: '骨骼变形', en: 'Puppet Warp' },
  { id: 'HDR', zh: 'HDR', en: 'HDR' },
  { id: 'Media Integration', zh: '媒体集成', en: 'Media Integration' },
  { id: 'User Shortcut', zh: '用户快捷方式', en: 'User Shortcut' },
  { id: 'Video Texture', zh: '视频纹理', en: 'Video Texture' },
  { id: 'Asset Pack', zh: '资源包', en: 'Asset Pack' },
];

const RESOLUTION_GROUPS = [
  { titleZh: '宽屏', titleEn: 'Widescreen', items: ['Standard', '1280 x 720', '1366 x 768', '1920 x 1080', '2560 x 1440', '3840 x 2160'] },
  { titleZh: '超宽屏', titleEn: 'Ultrawide', items: ['Ultrawide', '2560 x 1080', '3440 x 1440'] },
  { titleZh: '双显示器', titleEn: 'Dual monitor', items: ['Dual monitor', '3840 x 1080', '5120 x 1440', '7680 x 2160'] },
  { titleZh: '三显示器', titleEn: 'Triple monitor', items: ['Triple monitor', '4096 x 768', '5760 x 1080', '7680 x 1440', '11520 x 2160'] },
  { titleZh: '纵向监视器/手机', titleEn: 'Portrait/Mobile', items: ['Portrait', '720 x 1280', '1080 x 1920', '1440 x 2560', '2160 x 3840'] },
  { titleZh: '', titleEn: '', items: ['Other resolution', 'Dynamic resolution'] },
];
const RESOLUTIONS = RESOLUTION_GROUPS.flatMap((group) => group.items);

export { GENRES };

export function GenreSheet({
  open,
  onOpenChange,
  fixedPanelHeight,
  filters,
  setFilters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedPanelHeight: boolean;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
}) {
  const text = useText();
  const language = text.languageName === 'English' ? 'en' : 'zh';
  const [tab, setTab] = React.useState<'genres' | 'official' | 'resolution'>('genres');
  const [draftGenres, setDraftGenres] = React.useState<string[]>(filters.genres);
  const [draftOfficialTags, setDraftOfficialTags] = React.useState<string[]>(filters.officialTags || []);
  const [draftResolutions, setDraftResolutions] = React.useState<string[]>(filters.resolutions || []);
  const [draftResolutionAll, setDraftResolutionAll] = React.useState(!filters.resolutions?.length);
  React.useEffect(() => {
    if (!open) return;
    setDraftGenres(filters.genres);
    setDraftOfficialTags(filters.officialTags || []);
    setDraftResolutions(filters.resolutions || []);
    setDraftResolutionAll(!filters.resolutions?.length);
  }, [filters.genres, filters.officialTags, filters.resolutions, open]);
  const selected = new Set(draftGenres);
  const selectedOfficialTags = new Set(draftOfficialTags);
  const selectedResolutions = new Set(draftResolutions);
  const allResolutionsSelected = draftResolutionAll || selectedResolutions.size === RESOLUTIONS.length;
  const activeCount = draftGenres.length + draftOfficialTags.length + (allResolutionsSelected ? 0 : draftResolutions.length);
  const toggleAll = () => {
    if (tab === 'genres') setDraftGenres(selected.size === GENRES.length ? [] : GENRES.map((genre) => genre.id));
    if (tab === 'official') setDraftOfficialTags(selectedOfficialTags.size === OFFICIAL_FILTERS.length ? [] : OFFICIAL_FILTERS.map((item) => item.id));
    if (tab === 'resolution') {
      setDraftResolutionAll(!allResolutionsSelected);
      setDraftResolutions([]);
    }
  };
  const closeWithoutApply = () => {
    setDraftGenres(filters.genres);
    setDraftOfficialTags(filters.officialTags || []);
    setDraftResolutions(filters.resolutions || []);
    setDraftResolutionAll(!filters.resolutions?.length);
    onOpenChange(false);
  };
  const apply = () => {
    setFilters({ genres: draftGenres, officialTags: draftOfficialTags, resolutions: allResolutionsSelected ? [] : draftResolutions });
    onOpenChange(false);
  };
  const toggleListValue = (values: string[], setValues: (values: string[]) => void, id: string) => {
    const baseValues = setValues === setDraftResolutions && (draftResolutionAll || values.length === RESOLUTIONS.length)
      ? RESOLUTIONS
      : values;
    const next = new Set(baseValues);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const normalized = Array.from(next);
    if (setValues === setDraftResolutions) {
      setDraftResolutionAll(normalized.length === RESOLUTIONS.length);
      setValues(normalized.length === RESOLUTIONS.length ? [] : normalized);
      return;
    }
    setValues(normalized);
  };
  const tabItems = [
    { id: 'genres' as const, label: text.genreTabGenres, count: draftGenres.length },
    { id: 'official' as const, label: text.genreTabOfficial, count: draftOfficialTags.length },
    { id: 'resolution' as const, label: text.genreTabResolution, count: draftResolutions.length },
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : closeWithoutApply())}
      fixedHeight={fixedPanelHeight}
      title={text.genreFilterTitle}
      bodyClassName="overflow-hidden p-0 sm:p-0"
      footer={
        <>
          <Button variant="outline" onClick={toggleAll}>
            {(tab === 'genres' && selected.size === GENRES.length) || (tab === 'official' && selectedOfficialTags.size === OFFICIAL_FILTERS.length) || (tab === 'resolution' && allResolutionsSelected) ? text.clear : text.selectAll}
          </Button>
          <Button variant="outline" onClick={closeWithoutApply}>{text.cancel}</Button>
          <Button className="col-span-2 sm:col-span-1" onClick={apply}>{text.applyFilter}</Button>
        </>
      }
    >
      <div className={cn('grid min-h-0 grid-rows-[auto_1fr] overflow-hidden sm:grid-cols-[180px_1fr] sm:grid-rows-none', fixedPanelHeight && 'h-full')}>
        <aside className="h-full shrink-0 border-b border-border/50 bg-card p-2 sm:border-b-0 sm:border-r sm:p-3">
          <nav className="hide-scrollbar flex max-w-full touch-pan-x gap-1 overflow-x-auto sm:block sm:space-y-1 sm:overflow-visible">
            {tabItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-[background-color,color,filter,transform] active:scale-95 active:brightness-110 sm:w-full',
                  tab === item.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
                onClick={() => setTab(item.id)}
              >
                <span>{item.label}</span>
                <span className="text-xs opacity-75">{item.count}</span>
              </button>
            ))}
          </nav>
          <div className="px-3 py-2 text-xs text-muted-foreground/60">{text.genreActiveFilters}: {activeCount}</div>
        </aside>
        <div className="min-h-0 overflow-y-auto scrollbar-thin">
          <AnimatedHeight>
            <AnimatePresence initial={false} mode="wait">
              {tab === 'genres' ? (
                <motion.div
                  key="genre-sheet-genres"
                  layout
                  className="p-5"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 330, damping: 34, mass: 0.9 } }}
                >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {GENRES.map((genre) => {
                      const active = selected.has(genre.id);
                      return (
                        <FilterButton key={genre.id} active={active} onClick={() => toggleListValue(draftGenres, setDraftGenres, genre.id)}>
                          {text.genres[genre.id as keyof typeof text.genres] || genre.name}
                        </FilterButton>
                      );
                    })}
                  </div>
                </motion.div>
              ) : tab === 'official' ? (
                <motion.div
                  key="genre-sheet-official"
                  layout
                  className="p-5"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 330, damping: 34, mass: 0.9 } }}
                >
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {OFFICIAL_FILTERS.map((item) => (
                      <FilterButton key={item.id} active={selectedOfficialTags.has(item.id)} onClick={() => toggleListValue(draftOfficialTags, setDraftOfficialTags, item.id)}>
                        {language === 'en' ? item.en : item.zh}
                      </FilterButton>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="genre-sheet-resolution"
                  layout
                  className="p-5"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 330, damping: 34, mass: 0.9 } }}
                >
                  <div className="grid gap-3">
                    {RESOLUTION_GROUPS.map((group) => (
                      <section key={group.titleEn || 'other'} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                        {group.titleZh || group.titleEn ? <h4 className="mb-2 text-sm font-semibold">{language === 'en' ? group.titleEn : group.titleZh}</h4> : null}
                        <div className="flex flex-wrap gap-2">
                          {group.items.map((resolution) => (
                            <FilterButton key={resolution} active={allResolutionsSelected || selectedResolutions.has(resolution)} nowrap onClick={() => toggleListValue(draftResolutions, setDraftResolutions, resolution)}>
                              {resolutionLabel(resolution, language)}
                            </FilterButton>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </AnimatedHeight>
        </div>
      </div>
    </Dialog>
  );
}

function resolutionLabel(value: string, language: 'zh' | 'en') {
  if (language === 'en') return value;
  const labels: Record<string, string> = {
    Standard: '标准',
    '1920 x 1080': '1920 x 1080 - 全高清',
    '3840 x 2160': '3840 x 2160 - 4K',
    Ultrawide: '超宽（标准）',
    'Dual monitor': '双显示器（标准）',
    'Triple monitor': '三显示器（标准）',
    Portrait: '纵向（标准）',
    'Other resolution': '其他分辨率',
    'Dynamic resolution': '动态分辨率',
  };
  return labels[value] || value;
}

function FilterButton({ active, onClick, children, nowrap = false }: { active: boolean; onClick: () => void; children: React.ReactNode; nowrap?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-between gap-3 rounded-md border border-input bg-input/45 px-3 py-2 text-left text-sm transition-[background-color,border-color,color,filter,transform] active:scale-95 active:brightness-110 hover:bg-input/65',
        nowrap && 'w-auto whitespace-nowrap',
        active && 'border-primary/20 bg-accent text-accent-foreground',
      )}
      onClick={onClick}
    >
      <span className={cn(nowrap && 'whitespace-nowrap')}>{children}</span>
      {active ? <Check className="h-4 w-4 shrink-0" /> : null}
    </button>
  );
}
