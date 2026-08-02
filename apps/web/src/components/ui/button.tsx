'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-display text-xs font-bold uppercase tracking-widest transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-2 focus-visible:ring-offset-void motion-safe:active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-neon text-void shadow-neon hover:bg-neon-hot hover:shadow-neon-lg',
        ghost:
          'border border-edge bg-white/[0.02] text-ink hover:border-neon/40 hover:bg-neon/8',
        heart:
          'bg-heart text-white shadow-[0_0_24px_-6px_rgba(255,46,99,0.6)] hover:brightness-110',
        subtle: 'text-muted hover:text-ink',
        destructive: 'border border-heart/50 bg-heart/10 text-heart hover:bg-heart/20',
      },
      size: {
        sm: 'h-9 px-3.5 text-eyebrow',
        default: 'h-11 px-5',
        lg: 'h-13 px-7 text-sm',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
