import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui's class helper. clsx resolves conditionals, tailwind-merge then
 * drops earlier utilities that a later one overrides — so `cn('px-4', 'px-6')`
 * yields `px-6` instead of leaving both and letting source order decide.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
