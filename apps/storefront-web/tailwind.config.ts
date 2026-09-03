import type { Config } from 'tailwindcss';
import preset from '@retailos/config/tailwind-preset';

const config: Config = {
  // The preset is a plain JS module (Tailwind requires CJS here), so its type is
  // widened rather than asserted — a preset legitimately has no `content` key.
  presets: [preset as Partial<Config>],
  content: [
    './src/**/*.{ts,tsx}',
    // The shared component library is compiled by Next, so Tailwind has to scan
    // it too or its class names get purged out of the stylesheet.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
