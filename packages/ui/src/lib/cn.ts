import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class-name helper.
 *
 * `clsx` handles conditionals; `tailwind-merge` resolves conflicts so a caller's
 * `className="px-6"` actually beats a component's default `px-4` instead of
 * both landing in the class list and letting CSS source order decide.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
