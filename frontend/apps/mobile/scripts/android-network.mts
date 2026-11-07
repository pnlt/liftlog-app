import { parseProjectEnv } from '@expo/env'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

type RunAdb = (args: string[]) => Promise<string>
type WatchOptions = { runAdb?: RunAdb; intervalMs?: number; log?: (message: string) => void }

const execute = promisify(execFile)
const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
const sdkAdb =
  sdkRoot && path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')

export function nativeApiUrl(
  root: string,
  command: string,
  args: string[],
  env: Record<string, string | undefined> = process.env,
): string {
  const variantIndex = args.indexOf('--variant')
  const variant =
    args.find((arg) => arg.startsWith('--variant='))?.slice('--variant='.length) ??
    (variantIndex >= 0 ? args[variantIndex + 1] : 'debug')
  const production =
    command === 'run:android'
      ? !['debug', 'debugoptimized'].includes((variant ?? 'debug').toLowerCase())
      : args.includes('--no-dev')
  const mode = command === 'usb' ? (env.NODE_ENV ?? 'development') : production ? 'production' : 'development'
  const parsed = parseProjectEnv(root, { mode, silent: true, systemEnv: env })
  return env.EXPO_PUBLIC_API_URL ?? parsed.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'
}

async function runAdb(args: string[]): Promise<string> {
  const { stdout } = await execute(sdkAdb && existsSync(sdkAdb) ? sdkAdb : 'adb', args, { timeout: 5000 })
  return stdout
}

export function apiReversePort(apiUrl: string): number | null {
  const url = new URL(apiUrl)
  if (!['http:', 'https:'].includes(url.protocol)) return null
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80))
}

export async function syncApiForwarding(port: number, adb: RunAdb = runAdb): Promise<number> {
  const devices = await adb(['devices'])
  const socket = `tcp:${port}`
  let applied = 0
  for (const line of devices.split(/\r?\n/)) {
    const [serial, state] = line.trim().split(/\s+/)
    if (!serial || state !== 'device') continue
    const mappings = await adb(['-s', serial, 'reverse', '--list'])
    const exists = mappings.split(/\r?\n/).some((mapping) => {
      const [, source, target] = mapping.trim().split(/\s+/)
      return source === socket && target === socket
    })
    if (exists) continue
    await adb(['-s', serial, 'reverse', socket, socket])
    applied++
  }
  return applied
}

export function watchAndroidApi(apiUrl: string, options: WatchOptions = {}): () => void {
  const port = apiReversePort(apiUrl)
  if (port === null) return () => {}
  const log = options.log ?? console.log
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastError = ''
  log(`MYØS USB API: watching port ${port}; reconnecting devices will be forwarded automatically.`)

  const check = async () => {
    try {
      // Inspect actual mappings every time: the same serial loses them on USB disconnect.
      const applied = await syncApiForwarding(port, options.runAdb)
      if (!stopped && applied) log(`MYØS USB API: forwarded port ${port} on ${applied} device(s).`)
      lastError = ''
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!stopped && message !== lastError)
        log(`MYØS USB API: ${message}. Retrying; check USB debugging and adb.`)
      lastError = message
    } finally {
      if (!stopped) timer = setTimeout(check, options.intervalMs ?? 2000)
    }
  }
  void check()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
