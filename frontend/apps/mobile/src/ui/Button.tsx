import { ActivityIndicator, type PressableProps } from 'react-native'
import { PressableScale } from './PressableScale'
import { Text } from './Text'

const variants = {
  primary: { box: 'bg-primary', text: 'text-primary-foreground' },
  secondary: { box: 'bg-surface-raised border border-border', text: 'text-foreground' },
  ghost: { box: 'bg-transparent', text: 'text-foreground' },
  danger: { box: 'bg-danger/15 border border-danger/40', text: 'text-danger' },
} as const

const sizes = {
  md: 'min-h-12 px-5 rounded-xl',
  sm: 'min-h-11 px-3 rounded-lg',
} as const

interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  loading?: boolean
  /** Applied to the outer (animated) container, so layout classes like flex-1 work. */
  className?: string
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  ...props
}: ButtonProps) {
  const v = variants[variant]
  const inactive = disabled || loading
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      containerClassName={className}
      className={`flex-row items-center justify-center gap-2 ${sizes[size]} ${v.box} ${inactive ? 'opacity-50' : ''}`}
      {...props}
    >
      {loading && <ActivityIndicator size="small" />}
      <Text variant="label" className={`font-semibold ${v.text}`}>
        {label}
      </Text>
    </PressableScale>
  )
}
