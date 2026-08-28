import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SelectOption = {
  value?: string;
  label?: string;
  separator?: boolean;
};

const SELECT_MENU_MAX_HEIGHT = 256;
const MEDIA_SELECT_MENU_WIDTH = 88;

export function Select({
  value,
  options,
  onChange,
  onOpenChange,
  className,
  label,
  ariaLabel,
  disabled,
  portalContainerRef,
  variant = 'default',
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  portalContainerRef?: React.RefObject<Element>;
  variant?: 'default' | 'media';
}) {
  const [open, setOpen] = React.useState(false);
  const [placement, setPlacement] = React.useState<'bottom' | 'top'>('bottom');
  const [menuRect, setMenuRect] = React.useState({ left: 0, top: 0, width: 0 });
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || options[0];

  const setMenuOpen = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  const updatePlacement = React.useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const optionHeight = Math.min(SELECT_MENU_MAX_HEIGHT, Math.max(44, options.length * 32 + 8));
    const menuWidth = variant === 'media' ? Math.max(rect.width, MEDIA_SELECT_MENU_WIDTH) : rect.width;
    const centeredLeft = rect.left - (menuWidth - rect.width) / 2;
    const bottomSpace = window.innerHeight - rect.bottom;
    const topSpace = rect.top;
    const nextPlacement = bottomSpace < optionHeight + 12 && topSpace > bottomSpace ? 'top' : 'bottom';
    setPlacement(nextPlacement);
    setMenuRect({
      left: Math.min(Math.max(8, centeredLeft), Math.max(8, window.innerWidth - menuWidth - 8)),
      top: nextPlacement === 'top'
        ? Math.max(8, rect.top - optionHeight - 4)
        : Math.max(8, Math.min(window.innerHeight - optionHeight - 8, rect.bottom + 4)),
      width: menuWidth,
    });
  }, [options.length, variant]);

  React.useEffect(() => {
    if (!open || disabled) return;
    updatePlacement();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [disabled, open, setMenuOpen, updatePlacement]);

  return (
    <div ref={rootRef} className={cn('relative grid gap-1.5 text-xs font-medium text-muted-foreground', variant === 'media' && 'gap-0 text-white', className)}>
      {label ? <span>{label}</span> : null}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onPointerDown={() => !disabled && updatePlacement()}
        onClick={() => !disabled && setMenuOpen(!open)}
        className={cn(
          'flex h-9 w-full min-w-0 touch-manipulation select-none items-center justify-between gap-2 rounded-md border text-left outline-none transition-[color,box-shadow,background-color,transform] duration-75 active:scale-[0.96] active:brightness-125',
          variant === 'media'
            ? 'border-white/25 bg-black/45 px-2 text-xs font-semibold tabular-nums text-white hover:bg-white/15 focus-visible:border-white/50 focus-visible:ring-[3px] focus-visible:ring-white/35'
            : 'border-input bg-input/45 px-3 text-sm text-foreground hover:bg-input/65 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          disabled && (variant === 'media'
            ? 'cursor-not-allowed opacity-45 hover:bg-black/45 active:scale-100 active:brightness-100'
            : 'cursor-not-allowed opacity-45 hover:bg-input/45 active:scale-100 active:brightness-100'),
        )}
      >
        <span className="truncate">{selected?.label || '-'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', variant === 'media' && 'h-3 w-3 text-white/70', open && 'rotate-180')} />
      </button>
      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  ref={menuRef}
                  initial={{ opacity: 0, y: placement === 'top' ? 6 : -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1, pointerEvents: 'auto' }}
                  exit={{ opacity: 0, y: placement === 'top' ? 4 : -4, scale: 0.98, pointerEvents: 'none' }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
                  role="listbox"
                  aria-label={ariaLabel}
                  className={cn(
                    'fixed z-[220] max-h-64 overflow-y-auto border p-1 scrollbar-thin',
                    variant === 'media'
                      ? 'wallhub-media-select-menu rounded-md border-white/20 bg-black/55 text-xs text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)] backdrop-blur-xl'
                      : 'rounded-lg border-border bg-popover text-sm text-foreground shadow-panel',
                  )}
                  style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
                  onPointerDown={(event) => {
                    if (!open) event.preventDefault();
                  }}
                >
                  {options.map((option, index) => {
                    if (option.separator) return <div key={`separator-${index}`} className={cn('my-1 border-t border-border', variant === 'media' && 'border-white/15')} />;
                    const active = option.value === value;
                    return (
                      <button
                        key={option.value || `option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          if (option.value === undefined) return;
                          onChange(option.value);
                          setMenuOpen(false);
                        }}
                        className={cn(
                          'flex h-8 w-full touch-manipulation select-none items-center justify-between gap-2 rounded-md text-left transition-[background-color,color,transform] duration-75 active:scale-[0.96] active:brightness-125',
                          variant === 'media' ? 'px-2 text-xs font-semibold tabular-nums' : 'px-2.5',
                          active
                            ? variant === 'media' ? 'bg-white/20 text-white' : 'bg-accent text-accent-foreground'
                            : variant === 'media' ? 'text-white/75 hover:bg-white/10 hover:text-white' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        )}
                      >
                        <span className="truncate">{option.label}</span>
                        {active ? <Check className="h-3.5 w-3.5" /> : null}
                      </button>
                    );
                  })}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            portalContainerRef?.current || document.body,
          )
        : null}
    </div>
  );
}
