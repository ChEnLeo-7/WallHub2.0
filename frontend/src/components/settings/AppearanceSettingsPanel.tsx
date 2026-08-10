import { motion } from 'motion/react';
import { Filter, Grid3X3, Languages, LayoutTemplate, Monitor, Paintbrush, Play, SlidersHorizontal, Smartphone, SunMoon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  accentThemeOptions,
  homeCardDefaultActionOptions,
  normalizeAccentTheme,
  normalizeCustomAccentColor,
  normalizeDesktopColumns,
  normalizeHomeCardDefaultAction,
  normalizeHomePageSize,
  normalizeLanguage,
  normalizeMobileColumns,
  normalizeThemeMode,
  themeModeOptions,
} from '@/lib/normalizers';
import type { AppText, Language } from '@/lib/text';
import { cn } from '@/lib/utils';
import { isCompleteCustomAccentColor } from '../../../../src/shared/customAccentInput.mjs';
import { panelMotion } from './panelMotion';
import type { AccentTheme, DetailsPresentation, HomeCardDefaultAction, ThemeMode } from './settingsTypes';

type AppearanceSettingsPanelProps = {
  text: AppText;
  language: Language;
  setLanguage: (language: Language) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  accentTheme: AccentTheme;
  setAccentTheme: (theme: AccentTheme) => void;
  customAccentColor: string;
  customAccentColorDraft: string;
  setCustomAccentColor: (color: string) => void;
  setCustomAccentColorDraft: (color: string) => void;
  fixedPanelHeightEnabled: boolean;
  setFixedPanelHeight: (enabled: boolean) => void;
  detailsPresentation: DetailsPresentation;
  setDetailsPresentation: (presentation: DetailsPresentation) => void;
  homeCardDefaultAction: HomeCardDefaultAction;
  setHomeCardDefaultAction: (action: HomeCardDefaultAction) => void;
  homeFilterMultiSelect: boolean;
  setHomeFilterMultiSelect: (enabled: boolean) => void;
  homePageSize: number;
  setHomePageSize: (size: number) => void;
  mobileColumns: number;
  setMobileColumns: (columns: number) => void;
  desktopColumns: number;
  setDesktopColumns: (columns: number) => void;
};

export function AppearanceSettingsPanel({
  text,
  language,
  setLanguage,
  themeMode,
  setThemeMode,
  accentTheme,
  setAccentTheme,
  customAccentColor,
  customAccentColorDraft,
  setCustomAccentColor,
  setCustomAccentColorDraft,
  fixedPanelHeightEnabled,
  setFixedPanelHeight,
  detailsPresentation,
  setDetailsPresentation,
  homeCardDefaultAction,
  setHomeCardDefaultAction,
  homeFilterMultiSelect,
  setHomeFilterMultiSelect,
  homePageSize,
  setHomePageSize,
  mobileColumns,
  setMobileColumns,
  desktopColumns,
  setDesktopColumns,
}: AppearanceSettingsPanelProps) {
  return (
    <motion.div key="settings-appearance" className="relative isolate space-y-6 p-5" {...panelMotion}>
      <section><h3 className="text-base font-semibold">{text.navAppearance}</h3><p className="mt-1 text-sm text-muted-foreground">{text.appearanceIntro}</p></section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><Languages className="h-4 w-4" />{text.language}</h4>
        <p className="text-sm text-muted-foreground">{text.languageDesc}</p>
        <Select value={language} onChange={(value) => setLanguage(normalizeLanguage(value))} options={[{ value: 'zh', label: text.languageChinese }, { value: 'en', label: text.languageEnglish }]} />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><SunMoon className="h-4 w-4" />{text.themeMode}</h4>
        <p className="text-sm text-muted-foreground">{text.themeModeDesc}</p>
        <Select value={themeMode} onChange={(value) => setThemeMode(normalizeThemeMode(value))} options={themeModeOptions(text)} />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><Paintbrush className="h-4 w-4" />{text.accentTheme}</h4>
        <p className="text-sm text-muted-foreground">{text.accentThemeDesc}</p>
        <Select value={accentTheme} onChange={(value) => setAccentTheme(normalizeAccentTheme(value))} options={accentThemeOptions(text)} />
        {accentTheme === 'custom' ? (
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            <span>{text.customAccentColor}</span>
            <div className="flex items-center gap-2">
              <input className="h-9 w-12 rounded-md border border-input bg-input p-1" type="color" value={customAccentColor} onChange={(event) => { const color = normalizeCustomAccentColor(event.target.value); setCustomAccentColorDraft(color); setCustomAccentColor(color); }} />
              <Input value={customAccentColorDraft} onChange={(event) => { const draft = event.target.value; setCustomAccentColorDraft(draft); if (isCompleteCustomAccentColor(draft)) setCustomAccentColor(draft.trim()); }} onBlur={() => setCustomAccentColorDraft(customAccentColor)} />
            </div>
          </label>
        ) : null}
      </section>

      <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h4 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4" />{text.fixedPanelHeight}</h4><p className="mt-1 text-sm text-muted-foreground">{text.fixedPanelHeightDesc}</p></div>
          <Button className="w-full sm:w-24" variant={fixedPanelHeightEnabled ? 'default' : 'outline'} onClick={() => setFixedPanelHeight(!fixedPanelHeightEnabled)}>{fixedPanelHeightEnabled ? text.enabled : text.disabled}</Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><LayoutTemplate className="h-4 w-4" />{text.detailsPresentation}</h4>
        <p className="text-sm text-muted-foreground">{text.detailsPresentationDesc}</p>
        <Select value={detailsPresentation} onChange={(value) => setDetailsPresentation(value === 'redesigned' ? 'redesigned' : 'classic')} options={[{ value: 'classic', label: text.detailsPresentationClassic }, { value: 'redesigned', label: text.detailsPresentationRedesigned }]} />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><Play className="h-4 w-4" />{text.homeCardDefaultAction}</h4>
        <p className="text-sm text-muted-foreground">{text.homeCardDefaultActionDesc}</p>
        <Select value={homeCardDefaultAction} onChange={(value) => setHomeCardDefaultAction(normalizeHomeCardDefaultAction(value))} options={homeCardDefaultActionOptions(text)} />
      </section>

      <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h4 className="flex items-center gap-2 text-sm font-semibold"><Filter className="h-4 w-4" />{text.homeFilterMultiSelect}</h4><p className="mt-1 text-sm text-muted-foreground">{text.homeFilterMultiSelectDesc}</p></div>
          <button type="button" aria-pressed={homeFilterMultiSelect} className={cn('relative z-0 inline-flex h-9 w-full shrink-0 touch-manipulation select-none items-center justify-center rounded-md border px-4 text-sm font-medium outline-none transition-[background-color,border-color,color,box-shadow,filter] duration-75 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:brightness-110 sm:w-24', homeFilterMultiSelect ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-input/45 text-foreground shadow-sm [@media(hover:hover)]:hover:bg-input/65')} onClick={() => setHomeFilterMultiSelect(!homeFilterMultiSelect)}>{homeFilterMultiSelect ? text.enabled : text.disabled}</button>
        </div>
      </section>

      <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
        <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Grid3X3 className="h-4 w-4" />{text.homePageSize}</span><Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">{text.current} {homePageSize} {text.itemUnit}</Badge></h4>
        <p className="text-sm text-muted-foreground">{text.homePageSizeDesc}</p>
        <Select value={String(homePageSize)} onChange={(value) => setHomePageSize(normalizeHomePageSize(value))} options={[{ value: '10', label: `10 ${text.itemUnit}` }, { value: '15', label: `15 ${text.itemUnit}` }, { value: '30', label: `30 ${text.itemUnit}（Wallhub ${text.defaultMark}）` }, { value: '50', label: `50 ${text.itemUnit}（Wallpaper Engine ${text.defaultMark}）` }]} />
      </section>

      <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
        <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Smartphone className="h-4 w-4" />{text.mobileColumns}</span><Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">{text.current} {mobileColumns} {text.itemUnit}</Badge></h4>
        <Select className="min-w-0 flex-1" value={String(mobileColumns)} onChange={(value) => setMobileColumns(normalizeMobileColumns(value))} options={[{ value: '1', label: `1 ${text.itemUnit}` }, { value: '2', label: `2 ${text.itemUnit}（${text.defaultMark}）` }, { value: '3', label: `3 ${text.itemUnit}` }, { value: '4', label: `4 ${text.itemUnit}` }]} />
      </section>

      <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
        <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Monitor className="h-4 w-4" />{text.desktopColumns}</span><Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">{desktopColumns ? `${text.current} ${desktopColumns} ${text.itemUnit}` : text.auto}</Badge></h4>
        <Select className="min-w-0 flex-1" value={String(desktopColumns)} onChange={(value) => setDesktopColumns(normalizeDesktopColumns(value))} options={[{ value: '0', label: `${text.autoFit}（${text.defaultMark}）` }, { value: '3', label: `3 ${text.itemUnit}` }, { value: '4', label: `4 ${text.itemUnit}` }, { value: '5', label: `5 ${text.itemUnit}` }, { value: '6', label: `6 ${text.itemUnit}` }, { value: '7', label: `7 ${text.itemUnit}` }, { value: '8', label: `8 ${text.itemUnit}` }]} />
      </section>
    </motion.div>
  );
}
