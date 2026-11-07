import http from 'node:http'

export const webServerHealthPath = '/__liftlog__/dev-server'

function hasSameMarker(port: number, marker: string) {
  return new Promise<boolean>((resolve) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: webServerHealthPath,
        agent: false,
        signal: AbortSignal.timeout(1000),
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy()
          resolve(false)
          return
        }
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
          if (body.length > marker.length) {
            response.destroy()
            resolve(false)
          }
        })
        response.on('end', () => resolve(body === marker))
        response.on('error', () => resolve(false))
      },
    )
    request.on('error', () => resolve(false))
  })
}

export async function listenForWebServer(server: http.Server, port: number, marker: string) {
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
    return 'started'
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') throw error
    if (await hasSameMarker(port, marker)) return 'reused'
    throw new Error(
      `Port ${port} is already in use by another service, checkout, or an older MYØS launcher. ` +
        'Stop that process from its own terminal, then run pnpm dev:web again.',
      { cause: error },
    )
  }
}
