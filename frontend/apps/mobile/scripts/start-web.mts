import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { listenForWebServer, webServerHealthPath } from './web-server.mjs'

const require = createRequire(import.meta.url)
const webPort = 8081
const metroPort = 8082
const origin = `http://localhost:${webPort}`
const marker = JSON.stringify({
  service: 'liftlog-web',
  version: 1,
  checkout: createHash('sha256')
    .update(realpathSync(fileURLToPath(new URL('..', import.meta.url))))
    .digest('hex'),
})

// SDK 58's SPA HTML bypasses Metro middleware, so isolate every proxied response.
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === webServerHealthPath) {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    })
    response.end(marker)
    return
  }
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: metroPort,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (result) => {
      response.writeHead(result.statusCode ?? 502, {
        ...result.headers,
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
      })
      result.pipe(response)
    },
  )
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain' })
    response.end('Metro is starting. Refresh this page shortly.')
  })
  request.on('aborted', () => upstream.destroy())
  request.pipe(upstream)
})

// Forward WebSocket upgrades so Fast Refresh and Expo's development tools work.
server.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(metroPort, '127.0.0.1', () => {
    const headers = request.rawHeaders.reduce<string[]>(
      (lines, value, index, values) =>
        index % 2 === 0 ? [...lines, `${value}: ${values[index + 1]}`] : lines,
      [],
    )
    upstream.write(
      `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`,
    )
    upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
  socket.on('close', () => upstream.destroy())
})

try {
  const status = await listenForWebServer(server, webPort, marker)
  if (status === 'reused') {
    console.log(`MYØS web is already running: ${origin}`)
  } else {
    console.log(`MYØS web: ${origin}`)
    const metro = spawn(
      process.execPath,
      [
        require.resolve('expo/bin/cli'),
        'start',
        '--web',
        '--localhost',
        '--port',
        String(metroPort),
        ...process.argv.slice(2),
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, BROWSER: 'none', EXPO_PACKAGER_PROXY_URL: origin },
      },
    )
    const stop = () => {
      server.closeAllConnections()
      server.close()
      metro.kill('SIGINT')
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    metro.on('error', (error) => {
      console.error(error.message)
      stop()
      process.exitCode = 1
    })
    metro.on('exit', (code) => {
      server.closeAllConnections()
      server.close()
      process.exitCode = code ?? 0
    })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
