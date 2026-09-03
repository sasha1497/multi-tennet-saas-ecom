/**
 * The shared Tailwind preset is authored as CommonJS because Tailwind's config
 * loader requires it. This declaration gives it a type without forcing the
 * preset itself to become TypeScript.
 */
declare module '@retailos/config/tailwind-preset' {
  import type { Config } from 'tailwindcss';
  const preset: Partial<Config>;
  export default preset;
}
