type HostsSourceHintProps = {
  exampleLabel: string;
  forkHint: string;
};

export function HostsSourceHint({ exampleLabel, forkHint }: HostsSourceHintProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
      <div>
        <span className="font-medium text-foreground/80">{exampleLabel}：</span>
        <code className="break-all font-mono">https://raw.githubusercontent.com/ChEnLeo-7/Github_hosts/refs/heads/main/steam-hosts</code>
      </div>
      <div className="mt-1">
        {forkHint}{' '}
        <a href="https://github.com/ChEnLeo-7/Github_hosts" target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">GitHub</a>
      </div>
    </div>
  );
}
