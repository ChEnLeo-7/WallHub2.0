import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { ScrollArea } from './scroll-area';

let dialogLockCount = 0;
let previousBodyOverflow = '';
let previousBodyPaddingRight = '';

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  className,
  bodyClassName,
  bodyRef,
  footerClassName,
  wide,
  bare,
  fixedHeight,
  fitContent,
  lightweight,
  titleFullWidth,
  closeButtonClassName,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  bodyRef?: React.Ref<HTMLDivElement>;
  footerClassName?: string;
  wide?: boolean;
  bare?: boolean;
  fixedHeight?: boolean;
  fitContent?: boolean;
  lightweight?: boolean;
  titleFullWidth?: boolean;
  closeButtonClassName?: string;
  dismissible?: boolean;
}) {
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
    const { style } = document.body;
    if (dialogLockCount === 0) {
      previousBodyOverflow = style.overflow;
      previousBodyPaddingRight = style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      const scrollbarGutter = window.getComputedStyle(document.documentElement).scrollbarGutter;
      const stableScrollbarGutter = scrollbarGutter.split(/\s+/).includes('stable');
      style.overflow = 'hidden';
      if (scrollbarWidth > 0 && !stableScrollbarGutter) style.paddingRight = `${scrollbarWidth}px`;
    }

    dialogLockCount += 1;

    return () => {
      window.cancelAnimationFrame(frame);
      dialogLockCount = Math.max(0, dialogLockCount - 1);
      if (dialogLockCount === 0) {
        style.overflow = previousBodyOverflow;
        style.paddingRight = previousBodyPaddingRight;
      }
      previousFocus?.focus();
    };
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100] grid touch-auto place-items-center overflow-hidden bg-background/80 p-2 backdrop-blur-sm sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (dismissible && event.target === event.currentTarget) onOpenChange(false);
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={bare ? undefined : titleId}
            aria-label={bare && typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            layout={!lightweight}
            className={cn(
              bare
                ? cn(
                    fitContent ? 'w-auto' : 'w-full',
                    'touch-auto overflow-hidden rounded-2xl outline-none',
                    fixedHeight ? 'h-[calc(100dvh-1rem)] sm:h-[88vh]' : 'max-h-[92vh]',
                  )
                : cn(
                    'flex touch-auto flex-col overflow-hidden rounded-2xl border border-border bg-popover/95 text-popover-foreground shadow-panel outline-none backdrop-blur',
                    fitContent ? 'w-auto' : 'w-full',
                    fixedHeight ? 'h-[calc(100dvh-1rem)] sm:h-[88vh]' : 'max-h-[92vh]',
                  ),
              fitContent ? '' : (wide ? 'max-w-5xl' : 'max-w-2xl'),
              className,
            )}
            initial={lightweight ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
            animate={lightweight ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={lightweight ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={lightweight ? { duration: 0.12, ease: 'easeOut' } : {
              type: 'spring',
              stiffness: 420,
              damping: 38,
              mass: 0.9,
              layout: { type: 'spring', stiffness: 360, damping: 34, mass: 0.9 },
            }}
          >
            {bare ? (
              children
            ) : (
              <>
                <div className="relative border-b border-border/50 px-5 py-4">
                  <div id={titleId} className={cn('min-w-0 text-base font-semibold tracking-tight', titleFullWidth ? 'w-full' : 'pr-10')}>{title}</div>
                  {dismissible ? (
                    <Button className={cn('absolute right-5 top-4', closeButtonClassName)} variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label="关闭">
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
                <ScrollArea ref={bodyRef} className={cn('min-h-0 p-4 sm:p-5', fitContent ? 'flex-none' : 'flex-1', bodyClassName)}>{children}</ScrollArea>
                {footer ? <div className={cn("grid grid-cols-2 gap-2 border-t border-border/50 px-4 py-3 sm:flex sm:flex-wrap sm:justify-end sm:px-5 sm:py-4", footerClassName)}>{footer}</div> : null}
              </>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
