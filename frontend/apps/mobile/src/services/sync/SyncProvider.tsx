import { useAuth, useClerk } from '@clerk/expo'
import Storage from 'expo-sqlite/kv-store'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState, View } from 'react-native'
import { upsertExercises } from '@/data/exercises'
import { syncRepository, type SyncConflict } from '@/data/sync'
import { hydrateProfileAccount, useProfile } from '@/features/profile/store'
import { hydrateSettingsAccount, useSettings } from '@/features/settings/store'
import { useRestTimer } from '@/features/workout/rest-timer-store'
import { envResult } from '@/lib/env'
import { Button, Card, Loading, Screen, Text } from '@/ui'
import { ApiClient } from '../api/client'
import { fetchBackendCatalog } from '../content/backend'
import { createSyncEngine, type SyncEngineState } from './engine'
import { parseLegacyPreferences } from './legacy'

interface SyncContextState extends SyncEngineState {
  pending: number
  conflicts: SyncConflict[]
  lastSyncedAt: string | null
  retry: () => void
  resolve: (conflict: SyncConflict, choice: 'local' | 'server') => void
}
const SyncContext = createContext<SyncContextState | null>(null)
export const useSynchronization = () => useContext(SyncContext)

export function SyncProvider({ children }: { children: ReactNode }) {
  const { userId, getToken, isLoaded } = useAuth()
  const { signOut } = useClerk()
  const currentOwner = useRef(userId)
  const tokenGetter = useRef(getToken)
  const retryRef = useRef<() => void>(() => {})
  const [engineState, setEngineState] = useState<SyncEngineState>({ state: 'idle', message: null })
  const [, render] = useState(0)
  const [legacyDecisionOwner, setLegacyDecisionOwner] = useState<string | null>(null)
  const owner = userId ?? null
  const boundOwner = useProfile((state) => state.owner)
  useLayoutEffect(() => {
    currentOwner.current = userId
    tokenGetter.current = getToken
  }, [userId, getToken])

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let catalogLoaded = false
    let running = false
    const isActive = () => live && currentOwner.current === owner
    hydrateProfileAccount(owner)
    hydrateSettingsAccount(owner)
    if (!owner || !envResult.success)
      return () => {
        live = false
      }
    const accountOwner = owner
    const api = new ApiClient(envResult.data.apiUrl, () => tokenGetter.current(), fetch, isActive)
    let latest: SyncEngineState = { state: 'idle', message: null }
    const engine = createSyncEngine({
      owner,
      api,
      repository: syncRepository,
      isActive,
      onState: (state) => {
        if (isActive()) {
          latest = state
          setEngineState(state)
        }
      },
    })
    const schedule = (delay: number, replace = false) => {
      if (!isActive() || AppState.currentState === 'background') return
      if (timer && !replace) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void run()
      }, delay)
    }
    const refresh = () => {
      if (!isActive()) return
      hydrateProfileAccount(owner)
      hydrateSettingsAccount(owner)
      render((value) => value + 1)
      if (!running && syncRepository.status(owner).pending > 0) schedule(750)
    }
    async function run() {
      if (running || !isActive() || AppState.currentState === 'background') return
      running = true
      try {
        await engine.run()
        if (!isActive()) return
        if (latest.state === 'idle' && !catalogLoaded) {
          try {
            const catalog = await fetchBackendCatalog(api)
            if (isActive()) {
              await upsertExercises(catalog)
              catalogLoaded = true
            }
          } catch {
            // Bundled/cached exercises stay available when catalog refresh fails.
          }
        }
        if (!isActive()) return
        failures = latest.state === 'idle' ? 0 : failures + 1
        const pending = syncRepository.status(accountOwner).pending
        schedule(
          latest.state === 'idle'
            ? pending > 0
              ? 0
              : 30_000
            : Math.min(60_000, 2 ** Math.min(failures, 6) * 1000) + Math.random() * 500,
        )
      } finally {
        running = false
        if (isActive()) refresh()
      }
    }
    retryRef.current = () => {
      failures = 0
      schedule(0, true)
    }
    const unsubscribe = syncRepository.subscribeSync(refresh)
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        catalogLoaded = false
        schedule(0, true)
      }
    })
    schedule(0)
    return () => {
      live = false
      if (timer) clearTimeout(timer)
      engine.stop()
      unsubscribe()
      foreground.remove()
      retryRef.current = () => {}
      useRestTimer.getState().stop()
    }
  }, [owner])

  if (!isLoaded || boundOwner !== owner) return <Loading />
  if (!owner) return children
  const status = syncRepository.status(owner)
  const conflicts = syncRepository.listConflicts(owner)
  const bootstrapped = syncRepository.hasBootstrapped(owner)
  const context: SyncContextState = {
    ...engineState,
    pending: status.pending,
    lastSyncedAt: status.lastSyncedAt,
    conflicts,
    retry: () => retryRef.current(),
    resolve: (conflict, choice) => {
      syncRepository.resolve(owner, conflict.entityType, conflict.entityId, choice)
      retryRef.current()
    },
  }
  if (!bootstrapped)
    return (
      <Screen>
        <Card className="gap-3">
          <Text variant="heading">Connect your account</Text>
          <Text>
            Connect once to restore your profile and workouts. After that, you can log workouts offline.
          </Text>
          {engineState.message && <Text variant="muted">{engineState.message}</Text>}
          <Button
            label="Connect and restore"
            loading={engineState.state === 'syncing'}
            onPress={() => retryRef.current()}
          />
          <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
        </Card>
      </Screen>
    )

  const legacy = parseLegacyPreferences(Storage.getItemSync('profile'), Storage.getItemSync('settings'))
  const decisionKey = `legacy-preferences-decision:${owner}`
  const needsLegacyDecision =
    legacyDecisionOwner !== owner &&
    !useProfile.getState().profile &&
    !Storage.getItemSync('legacy-preferences-owner') &&
    !Storage.getItemSync(decisionKey) &&
    (legacy.profile !== null || legacy.settings !== null)
  if (needsLegacyDecision) {
    const decide = (adopt: boolean) => {
      if (currentOwner.current !== owner) return
      if (adopt) {
        if (legacy.profile) useProfile.getState().setProfile(legacy.profile)
        if (legacy.settings) {
          const settings = useSettings.getState()
          settings.setUnit(legacy.settings.unit)
          settings.setRestSeconds(legacy.settings.restSeconds)
          settings.setDemoStyle(legacy.settings.demoStyle)
        }
        Storage.setItemSync('legacy-preferences-owner', owner)
      }
      Storage.setItemSync(decisionKey, adopt ? 'adopted' : 'declined')
      setLegacyDecisionOwner(owner)
    }
    return (
      <Screen>
        <Card className="gap-3">
          <Text variant="heading">Previous profile on this device</Text>
          <Text>
            This device has a previous profile or preferences. Import them only if they belong to your
            signed-in account. Your workouts are preserved either way.
          </Text>
          <View className="gap-2">
            <Button label="They belong to me — import" onPress={() => decide(true)} />
            <Button label="Start with a new profile" variant="secondary" onPress={() => decide(false)} />
          </View>
        </Card>
      </Screen>
    )
  }
  return <SyncContext.Provider value={context}>{children}</SyncContext.Provider>
}
