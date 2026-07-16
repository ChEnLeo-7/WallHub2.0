import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 touch-manipulation select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[background-color,border-color,color,box-shadow,filter,transform] duration-75 active:translate-y-0 active:scale-[0.96] active:brightness-125 disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(hover:hover)]:hover:-translate-y-0.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [@media(hover:hover)]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [@media(hover:hover)]:hover:bg-secondary/80',
        outline: 'border border-input bg-input/45 shadow-sm [@media(hover:hover)]:hover:bg-input/65 [@media(hover:hover)]:hover:text-accent-foreground',
        ghost: '[@media(hover:hover)]:hover:bg-accent/50 [@media(hover:hover)]:hover:text-accent-foreground',
        destructive: 'bg-destructive/70 text-destructive-foreground [@media(hover:hover)]:hover:bg-destructive/90 focus-visible:ring-destructive/20',
      },
      size: {
        default: 'h-9 px-4 py-2',
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 px-3 text-xs',
        lg: 'h-10 px-6',
        icon: 'size-9',
        'icon-xs': 'size-7',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
