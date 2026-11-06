import { router } from 'expo-router'
import { useState } from 'react'
import { Alert } from 'react-native'
import { startSession } from '@/data/workouts'

export function useStartWorkout(userId: string) {
  const [starting, setStarting] = useState(false)
  async function start() {
    setStarting(true)
    try {
      await startSession(userId)
      router.push('/workout')
    } catch (err) {
      console.error('[workout] start failed', err)
      Alert.alert('Could not start workout', 'Please try again.')
    } finally {
      setStarting(false)
    }
  }
  return { start, starting }
}
