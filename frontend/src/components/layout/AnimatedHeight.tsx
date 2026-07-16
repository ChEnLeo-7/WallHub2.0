import * as React from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export function AnimatedHeight({
  children,
  className,
  innerClassName,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = React.useState<number | 'auto'>('auto');

  React.useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const updateHeight = () => setHeight(element.offsetHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      animate={{ height }}
      className={cn('overflow-hidden', className)}
      initial={false}
      transition={{ height: { type: 'spring', stiffness: 280, damping: 34, mass: 0.9 } }}
    >
      <div ref={contentRef} className={innerClassName}>
        {children}
      </div>
    </motion.div>
  );
}
