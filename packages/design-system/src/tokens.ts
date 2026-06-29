// packages/design-system/src/tokens.ts
export const colors = {
  deepNavy:         '#000000',
  complianceGreen:  '#006C49',
  intelligenceBlue: '#3980F4',
  surface:          '#F7F9FB',
  surfaceLow:       '#F2F4F6',
  surfaceMid:       '#ECEEF0',
  surfaceHigh:      '#E6E8EA',
  surfaceHighest:   '#E0E3E5',
  surfaceCard:      '#FFFFFF',
  error:            '#BA1A1A',
  warning:          '#B5780E',
  success:          '#006C49',
  info:             '#3980F4',
  ink:              '#14141A',
  inkMuted:         '#5A5A66',
} as const

export const fonts = {
  primary: "'Inter', system-ui, -apple-system, sans-serif",
  mono:    "'JetBrains Mono', 'Fira Code', monospace",
} as const

export const radius = {
  sm:   '2px',
  md:   '4px',
  card: '8px',
  full: '9999px',
} as const

export const shadows = {
  card:     '0px 4px 12px rgba(15, 23, 42, 0.05)',
  dropdown: '0px 8px 24px rgba(15, 23, 42, 0.12)',
} as const
