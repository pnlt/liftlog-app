import { useClerk } from '@clerk/expo'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Button, EmptyState, Loading, Screen } from '@/ui'

export function SsoCallbackScreen() {
  const clerk = useClerk()
  const router = useRouter()
  const started = useRef(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void clerk
      .handleRedirectCallback({ signInFallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/' })
      .catch(() => setFailed(true))
  }, [clerk])

  if (!failed) return <Loading label="Completing sign-in" />

  return (
    <Screen>
      <EmptyState title="Sign-in could not be completed" body="Please return to sign-in and try again." />
      <Button label="Back to sign-in" onPress={() => router.replace('/sign-in')} />
    </Screen>
  )
}
