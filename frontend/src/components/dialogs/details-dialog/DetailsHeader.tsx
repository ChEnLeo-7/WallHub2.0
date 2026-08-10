import { Copy } from 'lucide-react';

import type { DetailsDialogController } from './useDetailsDialogController';

export function DetailsHeader({
  controller,
  personalSourceLabel,
  onCopyId,
  onCopyTitle,
  onAuthor,
}: {
  controller: DetailsDialogController;
  personalSourceLabel?: string;
  onCopyId: (id: string) => void;
  onCopyTitle: (title: string) => void;
  onAuthor: (creator?: string) => void;
}) {
  const { id, isRedesigned, merged, text, wallpaperTitle } = controller;
  if (isRedesigned) {
    return (
      <div data-testid="details-redesigned-header" className="grid min-w-0 gap-1.5 pr-1">
        <button type="button" className="group flex min-w-0 w-fit max-w-[calc(100%-0.5rem)] justify-self-start items-center gap-1 text-left text-base font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:max-w-full sm:gap-1.5 sm:text-lg" title={text.copyTitle} onClick={() => onCopyTitle(wallpaperTitle)}>
          <span className="min-w-0 flex-1 truncate">{wallpaperTitle}</span>
          <Copy className="h-3 w-3 shrink-0 opacity-45 transition-opacity group-hover:opacity-100 sm:h-3.5 sm:w-3.5" />
        </button>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {id ? (
            <button type="button" className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onClick={() => onCopyId(id)}>
              <span className="font-semibold text-foreground">ID</span>
              <span className="truncate">{id}</span>
              <Copy className="h-3 w-3 shrink-0" />
            </button>
          ) : null}
          <button type="button" className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onClick={() => onAuthor(merged.creator)}>
            <span className="shrink-0 font-semibold text-foreground">{text.author}</span>
            <span className="truncate">{merged.author || text.loadingAuthor}</span>
          </button>
          {personalSourceLabel ? <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-500">{personalSourceLabel}</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <button type="button" className="group flex min-w-0 w-fit max-w-[calc(100%-0.5rem)] items-center gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:max-w-full sm:gap-1.5" title={text.copyTitle} onClick={() => onCopyTitle(wallpaperTitle)}>
        <span className="min-w-0 flex-1 truncate">{wallpaperTitle}</span>
        <Copy className="h-3 w-3 shrink-0 opacity-45 transition-opacity group-hover:opacity-100 sm:h-3.5 sm:w-3.5" />
      </button>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
        {id ? <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onCopyId(id)}>ID {id}<Copy className="h-3 w-3" /></button> : null}
        <button className="text-primary hover:underline" onClick={() => onAuthor(merged.creator)}>{text.author}: {merged.author || text.loadingAuthor}</button>
        {personalSourceLabel ? <span className="text-amber-400">来源：{personalSourceLabel}</span> : null}
      </div>
    </div>
  );
}
