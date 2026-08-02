import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-display text-eyebrow font-bold uppercase tracking-widest',
  {
    variants: {
      variant: {
        default: 'bg-neon/15 text-neon-hot',
        heart: 'bg-heart/15 text-heart',
        outline: 'border border-edge text-muted',
        muted: 'bg-white/[0.04] text-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
