// packages/design-system/tailwind.config.ts
import { colors, fonts, radius, shadows } from './src/tokens'

export const siminteroTheme = {
  colors: {
    navy:  colors.deepNavy,
    green: colors.complianceGreen,
    blue:  colors.intelligenceBlue,
    surface: {
      DEFAULT: colors.surface,
      low:     colors.surfaceLow,
      mid:     colors.surfaceMid,
      high:    colors.surfaceHigh,
      card:    colors.surfaceCard,
    },
    error:   colors.error,
    warning: colors.warning,
    success: colors.success,
    info:    colors.info,
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
    md:   radius.md,
    card: radius.card,
    full: radius.full,
  },
  boxShadow: {
    card:     shadows.card,
    dropdown: shadows.dropdown,
  },
}
