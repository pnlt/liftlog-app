import { Text as RNText, type TextProps } from 'react-native'

const variants = {
  display: 'text-5xl leading-[56px] font-extrabold text-foreground',
  title: 'text-3xl font-bold text-foreground',
  heading: 'text-xl font-semibold text-foreground',
  body: 'text-base text-foreground',
  label: 'text-sm font-medium text-foreground',
  muted: 'text-sm text-muted',
  caption: 'text-xs text-muted',
  mono: 'font-mono text-base text-foreground',
} as const

export type TextVariant = keyof typeof variants

export function Text({ variant = 'body', className = '', ...props }: TextProps & { variant?: TextVariant }) {
  return <RNText className={`${variants[variant]} ${className}`} {...props} />
}
