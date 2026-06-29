import type { Config } from 'tailwindcss'
import { siminteroTheme } from '@sim/design-system/tailwind'

export default {
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/design-system/src/**/*.{ts,tsx}',
    '../../apps/web/*/src/**/*.{ts,tsx}',
  ],
  theme: { extend: siminteroTheme },
} satisfies Config
