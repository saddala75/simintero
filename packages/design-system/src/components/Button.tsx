// packages/design-system/src/components/Button.tsx
import React from 'react'

export type ButtonVariant = 'primary' | 'ai' | 'ghost' | 'danger' | 'secondary'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  children?: React.ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:   'bg-[#000000] text-white hover:bg-slate-800 active:bg-slate-900',
  ai:        'bg-[#3980F4] text-white hover:bg-blue-600 active:bg-blue-700',
  ghost:     'bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 border border-slate-300',
  danger:    'bg-[#BA1A1A] text-white hover:bg-red-700 active:bg-red-800',
  secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200 active:bg-slate-300 border border-slate-200',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2.5',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      {...props}
      data-variant={variant}
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center font-medium rounded-md
        transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
        disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
        ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}
      `}
    >
      {loading ? (
        <span className="animate-spin inline-block text-current">⟳</span>
      ) : icon ? (
        <span className="inline-flex items-center shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  )
}
