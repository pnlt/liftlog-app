import type { PlanningResult } from '@myos/domain'
import { Link } from 'expo-router'
import { Card, Text } from '@/ui'
const reasons = {
  needsGuidance:
    'Automatic plans are for adults without current pain or unresolved movement restrictions. Get qualified guidance before choosing exercises. You can still log workouts manually.',
  needsEquipmentConfirmation:
    'Confirm the equipment you can use before creating a plan. Manual logging remains available.',
  insufficientCatalogCoverage:
    'Our reviewed exercise choices cannot cover a complete plan with these equipment and movement limits. Your answers are saved; you can log workouts manually.',
  cannotFitDuration:
    'A complete session with warm-up and full rest will not fit this time budget. You can still log workouts manually.',
}
export function SavedPlan({ result }: { result: PlanningResult }) {
  if (result.status === 'unavailable')
    return (
      <Card>
        <Text variant="heading">Manual logging is ready</Text>
        <Text>{reasons[result.reason]}</Text>
      </Card>
    )
  return (
    <>
      <Card className="gap-2">
        <Text variant="heading">
          {result.provenance === 'aiTemplate'
            ? 'Personalized from AI-designed templates'
            : 'Personalized starter plan'}
        </Text>
        <Text variant="muted">{result.rationale}</Text>
      </Card>
      {result.days.map((day) => (
        <Card key={day.day} className="gap-3">
          <Text variant="heading">
            Day {day.day} · {day.kind === 'recovery' ? 'Recovery' : `Full body · ${day.minutes} min`}
          </Text>
          {day.kind === 'training' &&
            day.exercises.map((exercise) => (
              <Link
                key={exercise.id}
                href={{ pathname: '/exercise/[id]', params: { id: exercise.id } }}
                accessibilityLabel={`View ${exercise.name}`}
              >
                <Text>
                  {exercise.name} · {exercise.sets} × {exercise.repLow}–{exercise.repHigh} reps ·{' '}
                  {exercise.restSeconds}s rest
                </Text>
              </Link>
            ))}
        </Card>
      ))}
    </>
  )
}
