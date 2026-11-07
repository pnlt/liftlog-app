interface WebStartupEnvironment {
  href: string
  development: boolean
  isolated: boolean
  sharedArrayBufferAvailable: boolean
}
interface WebStartupActions {
  load: () => Promise<void>
  redirect: (url: string) => void
}

export async function startWebApp(
  environment: WebStartupEnvironment,
  { load, redirect }: WebStartupActions,
): Promise<void> {
  if (environment.isolated && environment.sharedArrayBufferAvailable) {
    await load()
    return
  }

  const current = new URL(environment.href)
  if (
    environment.development &&
    current.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname) &&
    current.port === '8082'
  ) {
    const destination = new URL('http://localhost:8081')
    destination.pathname = current.pathname
    destination.search = current.search
    destination.hash = current.hash
    redirect(destination.href)
    return
  }

  throw new Error(
    'MYØS needs SharedArrayBuffer to open web storage. For local development, run pnpm dev:web and open http://localhost:8081. Hosted builds need HTTPS with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: credentialless.',
  )
}
