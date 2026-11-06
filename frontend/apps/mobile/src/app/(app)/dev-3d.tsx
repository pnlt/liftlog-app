import dbCurl from '@/assets/models/db-curl.glb'
import { Exercise3DDemo } from '@/features/exercises/Exercise3DDemo'
import { Screen, Text } from '@/ui'

export default function Dev3DRoute() {
  return (
    <Screen>
      <Text variant="title">Dumbbell curl</Text>
      <Exercise3DDemo source={dbCurl} />
      <Text variant="caption">Biceps highlighted · drag to rotate</Text>
    </Screen>
  )
}
