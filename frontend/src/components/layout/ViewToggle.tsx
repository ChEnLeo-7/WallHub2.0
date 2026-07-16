import * as React from 'react';
import { motion } from 'motion/react';
import { Grid3X3, List } from 'lucide-react';

import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';

export function ViewToggle({
  view,
  setView,
  className,
}: {
  view: 'grid' | 'list';
  setView: (view: 'grid' | 'list') => void;
  className?: string;
}) {
  const layoutId = React.useId();
  const text = useText();
  const options = [
    { value: 'grid' as const, label: text.grid, icon: Grid3X3 },
    { value: 'list' as const, label: text.list, icon: List },
  ];
  return (
    <div className={cn('relative grid h-9 grid-cols-2 rounded-md border border-input bg-input/40 p-1', className)}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            onClick={() => setView(option.value)}
            className={cn(
              'relative z-10 grid h-7 w-8 place-items-center rounded-sm transition-[color,filter,transform] active:scale-95 active:brightness-125',
              active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active ? (
              <motion.span
                layoutId={`${layoutId}-view-thumb`}
                className="absolute inset-0 -z-10 rounded-sm bg-primary"
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.75 }}
              />
            ) : null}
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
