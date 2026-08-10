import { motion } from 'motion/react';
import { Database, ExternalLink, KeyRound, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { SteamStatus } from '@/lib/api';
import type { AppText } from '@/lib/text';
import { steamProxyUrl } from '@/lib/workshop';
import { STEAM_API_KEY_URL } from './constants';
import { panelLayoutMotion } from './panelMotion';
import type { SettingsStateProps } from './settingsTypes';

type SteamSettingsPanelProps = SettingsStateProps & {
  text: AppText;
  steam: SteamStatus | null;
  onLogin: () => void;
  onLogout: () => void;
};

export function SteamSettingsPanel({ text, steam, settings, setSettings, onSave, onLogin, onLogout }: SteamSettingsPanelProps) {
  return (
    <motion.div key="settings-steam" layout className="space-y-6 p-5" {...panelLayoutMotion}>
      <section>
        <h3 className="text-base font-semibold">{text.navSteam}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {steam?.loggedIn ? text.steamIntro : text.steamNotLoggedInDownloadHint}
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4" />{text.accountStatus}</h4>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">{steam?.loggedIn ? text.loggedInAs : text.steamUser}</span>
          {steam?.loggedIn ? <strong className="min-w-0 break-all text-foreground">{steam.username || text.unknown}</strong> : <span className="min-w-0 break-all text-muted-foreground">无</span>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {steam?.loggedIn ? (
            <Button className="w-full sm:w-32" variant="outline" onClick={onLogout}><LogOut className="h-4 w-4" />{text.logout}</Button>
          ) : (
            <Button className="w-full sm:w-40" onClick={onLogin}><User className="h-4 w-4" />{text.loginSteam}</Button>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" />{text.steamDataSourceTitle}</h4>
        <p className="text-sm text-muted-foreground">{text.steamDataSourceHelp}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Select
            className="min-w-0 flex-1"
            label={text.steamDataSourceLabel}
            ariaLabel={text.steamDataSourceLabel}
            value={settings.steamDataSource}
            options={[
              { value: 'community', label: 'Steam Community HTML' },
              { value: 'webapi', label: 'Steam Web API' },
              { value: 'cm', label: 'Steam CM WebSocket' },
            ]}
            onChange={(value) => onSave({ steamDataSource: value as SettingsStateProps['settings']['steamDataSource'] })}
          />
        </div>
      </section>

      {settings.steamDataSource === 'webapi' ? <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" />{text.steamApiTitle}</h4>
        <p className="text-sm text-muted-foreground">
          {text.steamApiHelp}{' '}
          <button
            type="button"
            className="inline-flex items-center gap-1 align-baseline text-primary underline-offset-4 hover:underline"
            onClick={() => window.open(settings.wallhubSteamAccessEnhance ? steamProxyUrl(STEAM_API_KEY_URL) : STEAM_API_KEY_URL, '_blank', 'noopener,noreferrer')}
          >
            {text.steamApiQuery}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            className="min-w-0 flex-1"
            type="password"
            value={settings.steamApiKey}
            onChange={(event) => setSettings((current) => ({ ...current, steamApiKey: event.target.value }))}
            placeholder={text.steamApiPlaceholder}
            autoComplete="off"
          />
          <Button className="w-full sm:w-32" onClick={() => onSave({ steamApiKey: settings.steamApiKey })}>{text.saveApply}</Button>
        </div>
      </section> : null}
    </motion.div>
  );
}
