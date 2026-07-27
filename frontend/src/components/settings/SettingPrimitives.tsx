import * as React from 'react';
import { Shield, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useText, type AppText } from '@/lib/text';
import { cn } from '@/lib/utils';

function InfoRowCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/35 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}

function InfoRow({ label, value, stackOnMobile }: { label: string; value: React.ReactNode; stackOnMobile?: boolean }) {
  return (
    <div className={cn('flex gap-2 sm:items-center sm:justify-between sm:gap-4', stackOnMobile ? 'flex-col sm:flex-row' : 'items-center justify-between')}>
      <span className="text-muted-foreground">{label}</span>
      <strong className={cn('break-all', stackOnMobile ? 'text-left sm:text-right' : 'text-right')}>{value}</strong>
    </div>
  );
}

function ExperimentalToggle({
  icon: Icon = Shield,
  title,
  description,
  enabled,
  onChange,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const text = useText();
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4" />
            {title}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button
          className="w-full sm:w-24"
          variant={enabled ? 'default' : 'outline'}
          aria-pressed={enabled}
          onClick={() => onChange(!enabled)}
        >
          {enabled ? text.enabled : text.disabled}
        </Button>
      </div>
    </section>
  );
}

function translateRuntimeStatus(raw: string, text: AppText) {
  const value = String(raw || '').trim();
  if (!value) return value;

  const restored = value.match(/^SteamKit\s*运行文件已就绪[，,]\s*已恢复登录[:：]\s*(.+)$/);
  if (restored) return `SteamKit ${text.runtimeReady}\n${text.runtimeLoginRestored}: ${restored[1]}`;

  const kept = value.match(/^SteamKit\s*运行文件已就绪[，,]\s*已保留登录[:：]\s*(.+)$/);
  if (kept) return `SteamKit ${text.runtimeReady}\n${text.runtimeLoginKept}: ${kept[1]}`;

  const unverified = value.match(/^SteamKit\s*运行文件已就绪[，,]\s*本地登录会话未验证[，,]\s*请重新登录[:：]\s*(.+)$/);
  if (unverified) return `SteamKit ${text.runtimeReady}\n${text.runtimeSessionUnverified}: ${unverified[1]}`;

  if (/^SteamKit\s*运行文件已就绪[，,]\s*请重新登录\s*Steam$/.test(value)) return `SteamKit ${text.runtimeReady}, ${text.runtimeRelogin}`;
  if (/^SteamKit\s*运行文件已就绪/.test(value)) return `SteamKit ${text.runtimeReady}`;
  if (value === 'SteamKit JSON 真实进度下载器已就绪') return `SteamKit ${text.runtimeReadyJson}`;
  if (value === '正在检查 SteamKit 运行文件') return text.runtimeCheckSteamKit;
  if (value === '正在构建 SteamKit JSON 真实进度下载器') return text.runtimeBuildSteamKit;
  if (value === '运行文件准备失败') return text.runtimePrepareFailed;

  const buildFailed = value.match(/^SteamKit JSON 真实进度下载器构建失败[:：]\s*(.+)$/);
  if (buildFailed) return `${text.runtimeBuildFailed}: ${buildFailed[1]}`;
  if (/\u6769|\u942a|\u6ae5|\u59dd|\u8fab|\u89e6|\u93c8/.test(value)) return text.runtimePrepareFailed;

  return value;
}

function RuntimeStatusValue({ value }: { value: React.ReactNode }) {
  const text = useText();
  const raw = typeof value === 'string' ? value : '';
  const translated = raw ? translateRuntimeStatus(raw, text) : '';
  const lines = translated.split('\n').filter(Boolean);
  if (lines.length <= 1) return <>{translated || value}</>;
  return (
    <span className="inline-flex flex-col gap-0.5 text-left sm:items-end sm:text-right">
      {lines.map((line) => <span key={line}>{line}</span>)}
    </span>
  );
}
export { InfoRowCard, InfoRow, ExperimentalToggle, translateRuntimeStatus, RuntimeStatusValue };
