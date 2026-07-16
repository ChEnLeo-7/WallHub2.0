import * as React from 'react';
import { cn } from '@/lib/utils';

export const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('touch-pan-y overflow-y-auto overscroll-contain scrollbar-thin [-webkit-overflow-scrolling:touch]', className)} {...props}>
      {children}
    </div>
  ),
);
ScrollArea.displayName = 'ScrollArea';
