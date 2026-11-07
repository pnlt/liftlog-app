/// <reference types="node" />
import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenForWebServer } from './web-server.mjs'

const marker = JSON.stringify({ service: 'liftlog-web', version: 1, checkout: 'this-checkout' })
const servers: http.Server[] = []

function server(handler?: http.RequestListener) {
  const result = http.createServer(handler)
  servers.push(result)
  return result
}

async function bind(result: http.Server) {
  await new Promise<void>((resolve, reject) => {
    result.once('error', reject)
    result.listen(0, '127.0.0.1', resolve)
  })
  const address = result.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
  return address.port
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    servers.splice(0).map(
      (result) =>
        new Promise<void>((resolve) => {
          result.closeAllConnections()
          result.close(() => resolve())
        }),
    ),
  )
})

describe('web launcher port ownership', () => {
  it('reuses the same checkout without opening another listener', async () => {
    const active = server((request, response) => {
      expect(request.url).toBe('/__liftlog__/dev-server')
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(marker)
    })
    const port = await bind(active)
    const duplicate = server()

    await expect(listenForWebServer(duplicate, port, marker)).resolves.toBe('reused')
    expect(duplicate.listening).toBe(false)
    expect(active.listening).toBe(true)
  })

  it('starts a new listener when the port is available', async () => {
    const candidate = server()
    await expect(listenForWebServer(candidate, 0, marker)).resolves.toBe('started')
    expect(candidate.listening).toBe(true)
  })

  it.each([
    { name: 'an arbitrary service', status: 200, body: '<html>another app</html>' },
    {
      name: 'another checkout',
      status: 200,
      body: '{"service":"liftlog-web","version":1,"checkout":"another-checkout"}',
    },
    { name: 'a failed health response', status: 503, body: marker },
    { name: 'an oversized response', status: 200, body: marker + 'x'.repeat(4096) },
  ])('rejects a port owned by $name', async ({ status, body }) => {
    const active = server((_request, response) => {
      response.writeHead(status)
      response.end(body)
    })
    const port = await bind(active)

    await expect(listenForWebServer(server(), port, marker)).rejects.toThrow(`Port ${port} is already in use`)
    expect(active.listening).toBe(true)
  })

  it('fails promptly when an unrelated service never completes its response', async () => {
    const active = server((_request, response) => {
      response.writeHead(200)
      response.flushHeaders()
    })
    const port = await bind(active)

    await expect(listenForWebServer(server(), port, marker)).rejects.toThrow(`Port ${port} is already in use`)
    expect(active.listening).toBe(true)
  })

  it('preserves bind failures other than EADDRINUSE', async () => {
    const candidate = server()
    const denied = Object.assign(new Error('listen EACCES: permission denied'), { code: 'EACCES' })
    vi.spyOn(candidate, 'listen').mockImplementation(() => {
      queueMicrotask(() => candidate.emit('error', denied))
      return candidate
    })

    await expect(listenForWebServer(candidate, 8081, marker)).rejects.toBe(denied)
  })
})
