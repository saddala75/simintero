// packages/design-system/tailwind.config.ts
import { colors, fonts, radius, shadows } from './src/tokens'

export const siminteroTheme = {
  colors: {
    ...colors,
    navy:  colors.deepNavy,
    green: colors.complianceGreen,
    blue:  colors.intelligenceBlue,
    ink: {
      DEFAULT: colors.ink,
      mut:     colors.inkMuted,
    },
  },
  fontFamily: {
    sans: [fonts.primary],
    mono: [fonts.mono],
  },
  borderRadius: {
    sm:   radius.sm,
    DEFAULT: radius.md,
    md:   radius.md,
    lg:   radius.lg,
    xl:   radius.xl,
    card: radius.card,
    full: radius.full,
  },
  boxShadow: {
    card:     shadows.card,
    dropdown: shadows.dropdown,
  },
}
