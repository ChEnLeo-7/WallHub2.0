import * as React from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { VideoDialogController } from './useVideoDialogController';

export function VideoDialogHeader({
  controller,
  title,
}: {
  controller: VideoDialogController;
  title: string;
}) {
  const { fallbackFullscreen, handleDialogOpenChange, playbackStarted, reduceMotion, text } = controller;
  const videoShortcuts = [
    { id: 'play', keyLabel: 'Space', action: text.videoShortcutPlayPause },
    { id: 'back', keyLabel: '←', action: text.videoShortcutBack5 },
    { id: 'forward', keyLabel: '→', action: text.videoShortcutForward5 },
    { id: 'speed', keyLabel: '→', prefix: text.videoShortcutHold, action: text.videoShortcutSpeed },
    { id: 'fullscreen', keyLabel: 'F', action: text.videoShortcutFullscreen },
    { id: 'exit-fullscreen', keyLabel: 'Esc', action: text.videoShortcutExitFullscreen },
  ];
  return (
    <div className={cn('flex min-h-14 items-start justify-between gap-4 border-b border-border/50 px-4 py-3 sm:px-5 sm:py-4', fallbackFullscreen && 'hidden')}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold tracking-tight">{title || text.videoPlayer}</div>
        {playbackStarted ? (
          <motion.div
            className="hide-scrollbar mt-2 flex max-w-full items-center gap-2 overflow-x-auto pb-0.5 text-[10px] leading-none sm:gap-2.5 sm:text-[11px]"
            role="list"
            aria-label={text.videoShortcutsLabel}
            initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            {videoShortcuts.map((shortcut, index) => (
              <React.Fragment key={shortcut.id}>
                {index > 0 ? <span className="h-3 w-px shrink-0 bg-border/60" aria-hidden="true" /> : null}
                <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap" role="listitem">
                  {shortcut.prefix ? <span className="text-muted-foreground">{shortcut.prefix}</span> : null}
                  <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border/70 bg-muted/80 px-1.5 font-mono text-[10px] font-semibold leading-none text-foreground shadow-[inset_0_-1px_0_hsl(var(--border)/0.5)]">
                    {shortcut.keyLabel}
                  </kbd>
                  <span className="font-medium text-muted-foreground">{shortcut.action}</span>
                </span>
              </React.Fragment>
            ))}
          </motion.div>
        ) : null}
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => handleDialogOpenChange(false)} aria-label={text.close}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
