import Ionicons from '@expo/vector-icons/Ionicons'
import { toDisplay, type Load, type Unit } from '@liftlog/domain'
import { Alert } from 'react-native'
import Animated from 'react-native-reanimated'
import type { WorkoutSetRow } from '@/data/db/schema'
import { removeSet, updateSet } from '@/data/workouts'
import { PressableScale, Text } from '@/ui'
import colors from '@/ui/colors'
import { fadeIn, fadeOut, listLayout, popIn } from '@/ui/motion'
import { toggleSetDone } from './toggle-set-done'

interface SetRowProps {
  sessionId: string
  set: WorkoutSetRow
  label: string
  load: Load
  unit: Unit
  restSeconds: number
  onEdit: () => void
}

function ValueCell({ value, label, onPress }: { value: number | null; label: string; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? 'empty'}`}
      accessibilityHint="Opens the set editor"
      containerClassName="flex-1"
      className="h-11 items-center justify-center rounded-lg bg-surface-raised"
    >
      <Text variant="body" className={`font-semibold ${value == null ? 'text-muted' : ''}`}>
        {value ?? '-'}
      </Text>
    </PressableScale>
  )
}

export function SetRow({ sessionId, set, label, load, unit, restSeconds, onEdit }: SetRowProps) {
  const done = set.completedAt != null
  const name = set.isWarmup ? 'Warm-up set' : `Set ${label}`

  function openMenu() {
    Alert.alert(name, undefined, [
      {
        text: set.isWarmup ? 'Mark as working set' : 'Mark as warm-up',
        onPress: () => void updateSet(sessionId, set.id, { isWarmup: !set.isWarmup }),
      },
      { text: 'Delete set', style: 'destructive', onPress: () => void removeSet(sessionId, set.id) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  return (
    <Animated.View
      entering={fadeIn}
      exiting={fadeOut}
      layout={listLayout}
      className={`flex-row items-center gap-2 rounded-lg px-1 py-1 ${done ? 'bg-success/10' : ''}`}
    >
      <PressableScale
        onPress={openMenu}
        accessibilityRole="button"
        accessibilityLabel={`${name} options`}
        className="h-11 w-10 items-center justify-center"
      >
        <Text variant="label" className={set.isWarmup ? 'text-muted' : ''}>
          {set.isWarmup ? 'W' : label}
        </Text>
      </PressableScale>
      {load === 'weight' && (
        <ValueCell
          label={`${name} weight in ${unit}`}
          value={set.kg == null ? null : toDisplay(set.kg, unit)}
          onPress={onEdit}
        />
      )}
      <ValueCell
        label={`${name} ${load === 'time' ? 'seconds' : 'reps'}`}
        value={set.reps}
        onPress={onEdit}
      />
      <PressableScale
        onPress={() => toggleSetDone(sessionId, set, restSeconds)}
        pressedScale={0.88}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`${name} done`}
        className={`h-11 w-11 items-center justify-center rounded-lg ${done ? 'bg-success' : 'bg-surface-raised'}`}
      >
        {done ? (
          <Animated.View entering={popIn}>
            <Ionicons name="checkmark" size={22} color={colors.background} />
          </Animated.View>
        ) : (
          <Ionicons name="checkmark" size={22} color={colors.muted} />
        )}
      </PressableScale>
    </Animated.View>
  )
}
