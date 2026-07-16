import { cn } from '@/lib/utils';

export function Progress({ value = 0, className, indeterminate }: { value?: number; className?: string; indeterminate?: boolean }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-input/30', className)}>
      {indeterminate ? (
        <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-primary" />
      ) : (
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      )}
    </div>
  );
}
