import { Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  validateSteamAccessEndpoint,
} from '@/lib/normalizers';
import type { AppText } from '@/lib/text';
import { cn } from '@/lib/utils';
import { DEFAULT_STEAM_ACCESS_DOH_ENDPOINT, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT } from './constants';
import type { SteamAccessSettingsController } from './useSteamAccessSettings';

export function ResolverPickerDialog({ text, controller }: {
  text: AppText;
  controller: SteamAccessSettingsController;
}) {
  const {
    resolverPickerOpen,
    setResolverPickerOpen,
    resolverProtocol,
    currentResolverEndpoint,
    allResolverEndpointOptions,
    selectedResolverEndpoints,
    customResolverEndpoints,
    customResolverEndpoint,
    setCustomResolverEndpoint,
    toggleResolverEndpoint,
    removeCustomResolverEndpoint,
    saveResolverEndpoint,
  } = controller;

  return (
    <Dialog
      open={resolverPickerOpen}
      onOpenChange={setResolverPickerOpen}
      title={text.resolverPickerTitle}
      fitContent
      lightweight
      className="w-[min(520px,calc(100vw-1rem))]"
      bodyClassName="space-y-3 p-3 sm:p-4"
    >
      <div className="rounded-lg border border-border bg-input/25 p-3">
        <div className="text-xs text-muted-foreground">{text.resolverCurrent}</div>
        <div className="mt-1 break-all text-sm font-medium text-foreground">{resolverProtocol.toUpperCase()} · {currentResolverEndpoint}</div>
      </div>
      <div className="grid max-h-[45vh] gap-2 overflow-y-auto pr-1">
        {allResolverEndpointOptions.map((endpoint, index) => {
          const normalizedEndpoint = resolverProtocol === 'dot'
            ? normalizeSteamAccessDotEndpoint(endpoint, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT)
            : normalizeSteamAccessDohEndpoint(endpoint, DEFAULT_STEAM_ACCESS_DOH_ENDPOINT);
          const active = selectedResolverEndpoints.includes(normalizedEndpoint);
          const isCustom = customResolverEndpoints.includes(normalizedEndpoint);
          return (
            <div
              key={`${endpoint}-${index}`}
              className={cn(
                'flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-input/45 px-3 py-2 text-left text-xs text-foreground transition-[background-color,border-color,color,filter,transform]',
                active && 'border-primary/40 bg-accent text-accent-foreground',
              )}
            >
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggleResolverEndpoint(normalizedEndpoint)}>
                {active ? <Check className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0 rounded border border-border" />}
                <span className="min-w-0 break-all">{isCustom ? `${text.resolverCustomEndpoint}: ` : ''}{endpoint}</span>
              </button>
              {isCustom ? (
                <Button size="icon-sm" variant="ghost" onClick={() => removeCustomResolverEndpoint(normalizedEndpoint)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:items-center">
        <Input
          className="min-w-0 flex-1"
          value={customResolverEndpoint}
          onChange={(event) => setCustomResolverEndpoint(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && customResolverEndpoint.trim()) saveResolverEndpoint(customResolverEndpoint);
          }}
          placeholder={resolverProtocol === 'dot' ? 'dns.example.com:853' : 'https://dns.example.com/resolve'}
        />
        <Button className="w-full sm:w-32" disabled={!validateSteamAccessEndpoint(customResolverEndpoint, resolverProtocol)} onClick={() => saveResolverEndpoint(customResolverEndpoint)}>
          <Check className="h-4 w-4" />
          {text.resolverSave}
        </Button>
      </div>
    </Dialog>
  );
}
