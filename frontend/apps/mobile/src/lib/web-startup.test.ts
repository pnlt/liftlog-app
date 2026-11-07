import { expect, it, vi } from 'vitest'
import { startWebApp } from './web-startup'

const environment = {
  href: 'http://localhost:8081/',
  development: true,
  isolated: true,
  sharedArrayBufferAvailable: true,
}
const actions = () => ({ load: vi.fn(async () => {}), redirect: vi.fn<(url: string) => void>() })

it('loads storage and routes in the isolated public origin', async () => {
  const handlers = actions()
  await startWebApp(environment, handlers)
  expect(handlers.load).toHaveBeenCalledOnce()
  expect(handlers.redirect).not.toHaveBeenCalled()
})

it.each(['localhost', '127.0.0.1', '[::1]'])(
  'redirects the internal Metro origin on %s before loading SQLite',
  async (hostname) => {
    const handlers = actions()
    await startWebApp(
      {
        ...environment,
        href: `http://${hostname}:8082/sso-callback?state=test#restore`,
        isolated: false,
        sharedArrayBufferAvailable: false,
      },
      handlers,
    )
    expect(handlers.redirect).toHaveBeenCalledWith('http://localhost:8081/sso-callback?state=test#restore')
    expect(handlers.load).not.toHaveBeenCalled()
  },
)

it('keeps a double-slash path on the trusted local origin', async () => {
  const handlers = actions()
  await startWebApp(
    { ...environment, href: 'http://localhost:8082//example.org/path', isolated: false },
    handlers,
  )
  expect(new URL(handlers.redirect.mock.calls[0]![0]).origin).toBe('http://localhost:8081')
  expect(handlers.load).not.toHaveBeenCalled()
})

it.each([
  { href: 'http://localhost:8081/', isolated: false, sharedArrayBufferAvailable: false },
  { href: 'https://myos.example/', isolated: false, sharedArrayBufferAvailable: false },
  { href: 'https://myos.example:8082/', isolated: false, sharedArrayBufferAvailable: false },
  { href: 'http://localhost:8081/', isolated: true, sharedArrayBufferAvailable: false },
])('does not open SQLite or redirect-loop on an unsupported host: $href', async (capabilities) => {
  const handlers = actions()
  await expect(startWebApp({ ...environment, ...capabilities }, handlers)).rejects.toThrow(
    'SharedArrayBuffer',
  )
  expect(handlers.load).not.toHaveBeenCalled()
  expect(handlers.redirect).not.toHaveBeenCalled()
})

it('does not redirect a production build between local ports', async () => {
  const handlers = actions()
  await expect(
    startWebApp(
      { ...environment, href: 'http://localhost:8082/', development: false, isolated: false },
      handlers,
    ),
  ).rejects.toThrow('SharedArrayBuffer')
  expect(handlers.load).not.toHaveBeenCalled()
  expect(handlers.redirect).not.toHaveBeenCalled()
})
