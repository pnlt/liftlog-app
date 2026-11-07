import type { SyncPayload } from '@myos/contracts'
import { View } from 'react-native'
import type { SyncConflict } from '@/data/sync'
import { confirmAction, showMessage } from '@/lib/dialogs'
import { useSynchronization } from '@/services/sync/SyncProvider'
import { Button, Card, Text } from '@/ui'

function describe(payload: SyncPayload): string {
  if ('exercises' in payload) {
    const sets = payload.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)
    return `${payload.deletedAt ? 'Deleted workout' : 'Workout'} · ${payload.exercises.length} exercises · ${sets} sets · ${new Date(payload.updatedAt).toLocaleString()}`
  }
  if ('profile' in payload)
    return payload.profile
      ? `${payload.profile.name} · ${payload.profile.goal} · ${payload.profile.daysPerWeek} days/week`
      : 'No accepted profile'
  return `${payload.unit} · ${payload.restSeconds}s rest · ${payload.demoStyle} demos`
}

export function SyncStatus() {
  const sync = useSynchronization()
  if (!sync) return null
  const resolveConflict = async (conflict: SyncConflict, choice: 'local' | 'server') => {
    const keepLocal = choice === 'local'
    const confirmed = await confirmAction(
      keepLocal ? 'Keep this version?' : 'Use the account version?',
      keepLocal
        ? 'This submits the version saved on this device. If the account version changes again, you will be asked to choose again.'
        : 'This replaces this device’s unsent version of this record.',
      { confirmLabel: keepLocal ? 'Keep' : 'Use account version', destructive: !keepLocal },
    )
    if (!confirmed) return
    try {
      sync.resolve(conflict, choice)
    } catch {
      showMessage(
        'Could not resolve this change',
        'Your saved data has been kept. Correct the record and try again.',
      )
    }
  }
  const label =
    sync.state === 'syncing'
      ? 'Synchronizing'
      : sync.conflicts.length > 0
        ? 'Some saved changes need attention'
        : sync.pending > 0
          ? `${sync.pending} saved changes waiting to sync`
          : 'Saved changes synchronized'
  return (
    <Card className="gap-3">
      <Text variant="heading">Your data</Text>
      <Text accessibilityLiveRegion="polite">{label}</Text>
      {sync.message && <Text variant="muted">{sync.message}</Text>}
      {sync.lastSyncedAt && (
        <Text variant="caption">Last connected: {new Date(sync.lastSyncedAt).toLocaleString()}</Text>
      )}
      <Button label="Sync now" variant="secondary" loading={sync.state === 'syncing'} onPress={sync.retry} />
      {sync.conflicts.map((conflict) => (
        <View key={conflict.mutationId} className="gap-2 border-t border-border pt-3">
          <Text variant="heading">
            {conflict.state === 'conflict'
              ? 'Choose which version to keep'
              : 'A saved change needs attention'}
          </Text>
          <Text variant="muted">On this device: {describe(conflict.local)}</Text>
          {conflict.server && (
            <Text variant="muted">On your account: {describe(conflict.server.payload)}</Text>
          )}
          {conflict.state === 'invalid' && (
            <Text variant="muted">
              Open the affected workout or profile to correct its values, then submit the updated version.
            </Text>
          )}
          <Button
            label={
              conflict.server?.operation === 'delete'
                ? 'Recover as a new workout'
                : 'Keep this device’s version'
            }
            size="sm"
            onPress={() => void resolveConflict(conflict, 'local')}
          />
          {conflict.server && (
            <Button
              label="Use account version"
              size="sm"
              variant="secondary"
              onPress={() => void resolveConflict(conflict, 'server')}
            />
          )}
        </View>
      ))}
    </Card>
  )
}
