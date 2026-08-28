import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { AnimatedHeight } from '@/components/layout/AnimatedHeight';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';
import {
  AppearanceSettingsPanel,
  DownloadSettingsPanel,
  ExperimentalSettingsPanel,
  ServerSettingsPanel,
  SteamSettingsPanel,
} from './SettingsPanels';
import { ResolverPickerDialog } from './ResolverPickerDialog';
import { SettingsTabs } from './SettingsTabs';
import type { SettingsDialogContentProps } from './settingsTypes';
import { useSettingsDialogState } from './useSettingsDialogState';
import { useSteamAccessSettings } from './useSteamAccessSettings';

export type { SettingsForm, SteamAccessStaticCdnHostControl } from './settingsTypes';

export function SettingsDialogContent(props: SettingsDialogContentProps) {
  const {
    open,
    onOpenChange,
    fixedPanelHeight,
    runtime,
    runtimeDiagnostics,
    settings,
    settingsHostsLoaded,
    mpkgCompactAvailable,
    mpkgCompactUnavailableReason,
    setSettings,
    steam,
    language,
    setLanguage,
    themeMode,
    setThemeMode,
    accentTheme,
    customAccentColor,
    setCustomAccentColor,
    setAccentTheme,
    fixedPanelHeightEnabled,
    setFixedPanelHeight,
    detailsPresentation,
    setDetailsPresentation,
    homeCardDefaultAction,
    setHomeCardDefaultAction,
    homeFilterMultiSelect,
    setHomeFilterMultiSelect,
    mobileColumns,
    setMobileColumns,
    desktopColumns,
    setDesktopColumns,
    homePageSize,
    setHomePageSize,
    prefetchNextPage,
    setPrefetchNextPage,
    onSave,
    onClearDepotStreamCache,
    onLogin,
    onLogout,
    onCheckUpdate,
    onDownloadUpdate,
    onInstallUpdate,
    onRestart,
    onShutdown,
  } = props;
  const text = useText();
  const dialogState = useSettingsDialogState({ open, settings, customAccentColor });
  const { tab, setTab } = dialogState;
  const steamAccess = useSteamAccessSettings({
    runtime,
    runtimeDiagnostics,
    settings,
    setSettings,
    onSave,
    language,
    text,
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={text.settings}
        wide
        bare
        fixedHeight={fixedPanelHeight}
        className="max-w-[calc(100vw-1rem)] overflow-hidden border border-border bg-popover/95 p-0 text-popover-foreground shadow-panel backdrop-blur sm:max-w-6xl"
      >
        <motion.div
          className={cn(
            'flex w-full max-w-full min-w-0 touch-auto flex-col overflow-hidden bg-transparent shadow-none',
            fixedPanelHeight ? 'h-full' : 'max-h-[calc(100dvh-1rem)] sm:max-h-[92vh]',
          )}
        >
          <header className="flex items-center justify-between border-b border-border/50 px-5 py-4">
            <h2 className="text-base font-semibold tracking-tight">{text.settings}</h2>
            <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label={text.close}>
              <X className="h-4 w-4" />
            </Button>
          </header>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:grid md:grid-cols-[180px_1fr]">
            <aside className="shrink-0 border-b border-border/50 bg-card p-2 md:border-b-0 md:border-r md:p-3">
              <SettingsTabs activeTab={tab} onTabChange={setTab} text={text} />
            </aside>

            <ScrollArea className="min-h-0 min-w-0 flex-1 overscroll-contain overflow-x-hidden pb-[calc(env(safe-area-inset-bottom)_+_5rem)] sm:pb-0">
              <AnimatedHeight>
                <AnimatePresence initial={false} mode="wait">
                  {tab === 'server' ? (
                    <ServerSettingsPanel
                      key="settings-server"
                      text={text}
                      runtime={runtime}
                      runtimeSteamAccess={steamAccess.runtimeSteamAccess}
                      steamAccessResolverValue={steamAccess.steamAccessResolverValue}
                      webapiConnectionValue={steamAccess.webapiConnectionValue}
                      settings={settings}
                      setSettings={setSettings}
                      onSave={onSave}
                      onCheckUpdate={onCheckUpdate}
                      onDownloadUpdate={onDownloadUpdate}
                      onInstallUpdate={onInstallUpdate}
                      onRestart={onRestart}
                      onShutdown={onShutdown}
                    />
                  ) : tab === 'download' ? (
                    <DownloadSettingsPanel
                      key="settings-download"
                      text={text}
                      settings={settings}
                      setSettings={setSettings}
                      mpkgCompactAvailable={mpkgCompactAvailable}
                      mpkgCompactUnavailableReason={mpkgCompactUnavailableReason}
                      onSave={onSave}
                    />
                  ) : tab === 'steam' ? (
                    <SteamSettingsPanel
                      key="settings-steam"
                      text={text}
                      steam={steam}
                      settings={settings}
                      setSettings={setSettings}
                      onSave={onSave}
                      onLogin={onLogin}
                      onLogout={onLogout}
                    />
                  ) : tab === 'experimental' ? (
                    <ExperimentalSettingsPanel
                      key="settings-experimental"
                      text={text}
                      settings={settings}
                      setSettings={setSettings}
                      onSave={onSave}
                      settingsHostsLoaded={settingsHostsLoaded}
                      prefetchNextPage={prefetchNextPage}
                      setPrefetchNextPage={setPrefetchNextPage}
                      steamAccess={steamAccess}
                      depotStreamCacheSelectValue={dialogState.depotStreamCacheSelectValue}
                      depotStreamCacheCustomInput={dialogState.depotStreamCacheCustomInput}
                      setDepotStreamCacheCustomMode={dialogState.setDepotStreamCacheCustomMode}
                      setDepotStreamCacheCustomInput={dialogState.setDepotStreamCacheCustomInput}
                      onClearDepotStreamCache={onClearDepotStreamCache}
                    />
                  ) : (
                    <AppearanceSettingsPanel
                      key="settings-appearance"
                      text={text}
                      language={language}
                      setLanguage={setLanguage}
                      themeMode={themeMode}
                      setThemeMode={setThemeMode}
                      accentTheme={accentTheme}
                      setAccentTheme={setAccentTheme}
                      customAccentColor={customAccentColor}
                      customAccentColorDraft={dialogState.customAccentColorDraft}
                      setCustomAccentColor={setCustomAccentColor}
                      setCustomAccentColorDraft={dialogState.setCustomAccentColorDraft}
                      fixedPanelHeightEnabled={fixedPanelHeightEnabled}
                      setFixedPanelHeight={setFixedPanelHeight}
                      detailsPresentation={detailsPresentation}
                      setDetailsPresentation={setDetailsPresentation}
                      homeCardDefaultAction={homeCardDefaultAction}
                      setHomeCardDefaultAction={setHomeCardDefaultAction}
                      homeFilterMultiSelect={homeFilterMultiSelect}
                      setHomeFilterMultiSelect={setHomeFilterMultiSelect}
                      homePageSize={homePageSize}
                      setHomePageSize={setHomePageSize}
                      mobileColumns={mobileColumns}
                      setMobileColumns={setMobileColumns}
                      desktopColumns={desktopColumns}
                      setDesktopColumns={setDesktopColumns}
                    />
                  )}
                </AnimatePresence>
              </AnimatedHeight>
            </ScrollArea>
          </div>
        </motion.div>
      </Dialog>
      <ResolverPickerDialog text={text} controller={steamAccess} />
    </>
  );
}
