import { Alert, Platform } from 'react-native'

interface ConfirmActionOptions {
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
}

export async function confirmAction(
  title: string,
  message: string,
  { confirmLabel, cancelLabel = 'Cancel', destructive = false }: ConfirmActionOptions,
): Promise<boolean> {
  if (Platform.OS === 'web') return globalThis.confirm(`${title}\n\n${message}`)
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    )
  })
}

export function showMessage(title: string, message?: string): void {
  if (Platform.OS === 'web') globalThis.alert(message ? `${title}\n\n${message}` : title)
  else Alert.alert(title, message)
}
