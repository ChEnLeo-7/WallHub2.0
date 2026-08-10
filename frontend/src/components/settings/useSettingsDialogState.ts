import * as React from 'react';
import type { SettingsTab } from './SettingsTabs';
import type { SettingsForm } from './settingsTypes';

const DEPOT_STREAM_CACHE_PRESETS = [512, 1024, 2048, 3072, 4096, 5120, 6144, 7168, 8192];

export function useSettingsDialogState({
  open,
  settings,
  customAccentColor,
}: {
  open: boolean;
  settings: SettingsForm;
  customAccentColor: string;
}) {
  const [tab, setTab] = React.useState<SettingsTab>('server');
  const [depotStreamCacheCustomMode, setDepotStreamCacheCustomMode] = React.useState(false);
  const [depotStreamCacheCustomInput, setDepotStreamCacheCustomInput] = React.useState('');
  const [customAccentColorDraft, setCustomAccentColorDraft] = React.useState(customAccentColor);
  const depotStreamCacheIsPreset = DEPOT_STREAM_CACHE_PRESETS.includes(settings.depotStreamCacheMaxMb);
  const depotStreamCacheSelectValue = depotStreamCacheCustomMode || !depotStreamCacheIsPreset
    ? 'custom'
    : String(settings.depotStreamCacheMaxMb);

  React.useEffect(() => {
    if (!depotStreamCacheCustomMode) setDepotStreamCacheCustomInput(String(settings.depotStreamCacheMaxMb || 512));
  }, [depotStreamCacheCustomMode, settings.depotStreamCacheMaxMb]);

  React.useEffect(() => {
    if (!open) setCustomAccentColorDraft(customAccentColor);
  }, [customAccentColor, open]);

  return {
    tab,
    setTab,
    depotStreamCacheSelectValue,
    depotStreamCacheCustomInput,
    setDepotStreamCacheCustomMode,
    setDepotStreamCacheCustomInput,
    customAccentColorDraft,
    setCustomAccentColorDraft,
  };
}
