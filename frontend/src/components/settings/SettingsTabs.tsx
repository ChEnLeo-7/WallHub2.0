import { Download, Palette, Server, Shield, User, type LucideIcon } from 'lucide-react';
import type { AppText } from '@/lib/text';
import { cn } from '@/lib/utils';

export type SettingsTab = 'server' | 'download' | 'steam' | 'appearance' | 'experimental';

export function SettingsTabs({ activeTab, onTabChange, text }: {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  text: AppText;
}) {
  const items: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
    { id: 'server', label: text.navServer, icon: Server },
    { id: 'download', label: text.navDownload, icon: Download },
    { id: 'steam', label: text.navSteam, icon: User },
    { id: 'appearance', label: text.navAppearance, icon: Palette },
    { id: 'experimental', label: text.navExperimental, icon: Shield },
  ];

  return (
    <nav className="hide-scrollbar flex max-w-full touch-pan-x gap-1 overflow-x-auto md:block md:space-y-1 md:overflow-visible">
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color,filter,transform] active:scale-95 active:brightness-110 md:w-full',
              active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
