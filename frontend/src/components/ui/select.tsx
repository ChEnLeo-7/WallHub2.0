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

export function Select({
  value,
  options,
  onChange,
  className,
  label,
  disabled,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [placement, setPlacement] = React.useState<'bottom' | 'top'>('bottom');
  const [menuRect, setMenuRect] = React.useState({ left: 0, top: 0, width: 0 });
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || options[0];

  const updatePlacement = React.useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const optionHeight = Math.min(320, Math.max(44, options.length * 34 + 8));
    const bottomSpace = window.innerHeight - rect.bottom;
    const topSpace = rect.top;
    const nextPlacement = bottomSpace < optionHeight + 12 && topSpace > bottomSpace ? 'top' : 'bottom';
    setPlacement(nextPlacement);
    setMenuRect({
      left: rect.left,
      top: nextPlacement === 'top' ? Math.max(8, rect.top - optionHeight - 4) : Math.min(window.innerHeight - 8, rect.bottom + 4),
      width: rect.width,
    });
  }, [options.length]);

  React.useEffect(() => {
    if (!open || disabled) return;
    updatePlacement();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
  }, [disabled, open, updatePlacement]);

  return (
    <div ref={rootRef} className={cn('relative grid gap-1.5 text-xs font-medium text-muted-foreground', className)}>
      {label ? <span>{label}</span> : null}
      <button
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onPointerDown={() => !disabled && updatePlacement()}
        onClick={() => !disabled && setOpen((current) => !current)}
        className={cn(
          'flex h-9 w-full min-w-0 touch-manipulation select-none items-center justify-between gap-2 rounded-md border border-input bg-input/45 px-3 text-left text-sm text-foreground outline-none transition-[color,box-shadow,background-color,transform] duration-75 active:scale-[0.96] active:brightness-125',
          'hover:bg-input/65 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          disabled && 'cursor-not-allowed opacity-45 hover:bg-input/45 active:scale-100 active:brightness-100',
        )}
      >
        <span className="truncate">{selected?.label || '-'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
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
                  className="fixed z-[220] max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-foreground shadow-panel scrollbar-thin"
                  style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
                  onPointerDown={(event) => {
                    if (!open) event.preventDefault();
                  }}
                >
                  {options.map((option, index) => {
                    if (option.separator) return <div key={`separator-${index}`} className="my-1 border-t border-border" />;
                    const active = option.value === value;
                    return (
                      <button
                        key={option.value || `option-${index}`}
                        type="button"
                        onClick={() => {
                          if (option.value === undefined) return;
                          onChange(option.value);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex h-8 w-full touch-manipulation select-none items-center justify-between gap-2 rounded-md px-2.5 text-left transition-[background-color,color,transform] duration-75 active:scale-[0.96] active:brightness-125',
                          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
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
            document.body,
          )
        : null}
    </div>
  );
}
