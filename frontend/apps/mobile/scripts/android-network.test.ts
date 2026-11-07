/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apiReversePort, nativeApiUrl, syncApiForwarding, watchAndroidApi } from './android-network.mjs'

const projects: string[] = []

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

function projectEnv() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'myos-native-env-'))
  projects.push(root)
  writeFileSync(path.join(root, '.env'), 'EXPO_PUBLIC_API_URL=http://localhost:8000\n')
  writeFileSync(path.join(root, '.env.development'), 'EXPO_PUBLIC_API_URL=http://localhost:8001\n')
  writeFileSync(path.join(root, '.env.production'), 'EXPO_PUBLIC_API_URL=https://api.example.com\n')
  return root
}

describe('native launcher API configuration', () => {
  it.each([
    ['start', [], 'http://localhost:8001'],
    ['run:android', [], 'http://localhost:8001'],
    ['run:android', ['--variant', 'debugOptimized'], 'http://localhost:8001'],
    ['run:android', ['--variant', 'release'], 'https://api.example.com'],
    ['start', ['--no-dev'], 'https://api.example.com'],
  ])('matches Expo env mode for %s %j', (command, args, expected) => {
    expect(nativeApiUrl(projectEnv(), command, args, {})).toBe(expected)
  })

  it('respects .env.local and explicit shell overrides', () => {
    const root = projectEnv()
    writeFileSync(path.join(root, '.env.local'), 'EXPO_PUBLIC_API_URL=http://localhost:9000\n')
    expect(nativeApiUrl(root, 'start', [], {})).toBe('http://localhost:9000')
    expect(nativeApiUrl(root, 'start', [], { EXPO_PUBLIC_API_URL: 'http://localhost:8123' })).toBe(
      'http://localhost:8123',
    )
  })
})

describe('Android API USB forwarding', () => {
  it.each([
    ['http://localhost:8001', 8001],
    ['http://127.0.0.1:9123', 9123],
    ['http://[::1]:8000', 8000],
    ['http://localhost', 80],
    ['https://localhost', 443],
    ['https://api.example.com', null],
    ['http://192.168.1.10:8001', null],
  ])('derives the reverse port from %s', (url, port) => {
    expect(apiReversePort(url)).toBe(port)
  })

  it('forwards only ready devices and preserves other port mappings', async () => {
    const runAdb = vi.fn(async (args: string[]) => {
      if (args[0] === 'devices') {
        return 'List of devices attached\ntablet\tdevice\nlocked\tunauthorized\ngone\toffline\n'
      }
      if (args.at(-1) === '--list') return 'UsbFfs tcp:9000 tcp:9000\n'
      return ''
    })

    await expect(syncApiForwarding(8001, runAdb)).resolves.toBe(1)
    expect(runAdb.mock.calls.map(([args]) => args)).toEqual([
      ['devices'],
      ['-s', 'tablet', 'reverse', '--list'],
      ['-s', 'tablet', 'reverse', 'tcp:8001', 'tcp:8001'],
    ])
  })

  it('leaves an existing correct API mapping alone', async () => {
    const runAdb = vi.fn(async (args: string[]) =>
      args[0] === 'devices' ? 'List of devices attached\ntablet\tdevice\n' : 'UsbFfs tcp:8001 tcp:8001\n',
    )

    await expect(syncApiForwarding(8001, runAdb)).resolves.toBe(0)
    expect(runAdb).toHaveBeenCalledTimes(2)
  })

  it('restores the API mapping when the same tablet disconnects and reconnects', async () => {
    vi.useFakeTimers()
    let connected = true
    let forwarded = false
    let applied = 0
    const runAdb = vi.fn(async (args: string[]) => {
      if (args[0] === 'devices') {
        return `List of devices attached\n${connected ? 'tablet\tdevice\n' : ''}`
      }
      if (args.at(-1) === '--list') return forwarded ? 'UsbFfs tcp:8001 tcp:8001\n' : ''
      forwarded = true
      applied++
      return ''
    })
    const stop = watchAndroidApi('http://localhost:8001', { runAdb, intervalMs: 100, log: () => {} })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(forwarded).toBe(true)
      connected = false
      forwarded = false
      await vi.advanceTimersByTimeAsync(100)
      expect(applied).toBe(1)
      connected = true
      await vi.advanceTimersByTimeAsync(100)
      expect(forwarded).toBe(true)
      expect(applied).toBe(2)
    } finally {
      stop()
    }
  })

  it('retries after a disconnect interrupts ADB and stops when disposed', async () => {
    vi.useFakeTimers()
    const runAdb = vi
      .fn<(_: string[]) => Promise<string>>()
      .mockRejectedValueOnce(new Error('device offline'))
      .mockResolvedValue('List of devices attached\n')
    const log = vi.fn()
    const stop = watchAndroidApi('http://localhost:8001', { runAdb, intervalMs: 100, log })
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('device offline'))
    await vi.advanceTimersByTimeAsync(100)
    expect(runAdb).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(runAdb).toHaveBeenCalledTimes(2)
  })

  it('does not start overlapping ADB checks or reschedule after stopping mid-check', async () => {
    vi.useFakeTimers()
    let finish!: (output: string) => void
    const runAdb = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const stop = watchAndroidApi('http://localhost:8001', { runAdb, intervalMs: 100, log: () => {} })
    await vi.advanceTimersByTimeAsync(1000)
    expect(runAdb).toHaveBeenCalledTimes(1)
    stop()
    finish('List of devices attached\n')
    await vi.advanceTimersByTimeAsync(1000)
    expect(runAdb).toHaveBeenCalledTimes(1)
  })

  it('does not invoke ADB for an API reachable over LAN or HTTPS hosting', async () => {
    vi.useFakeTimers()
    const runAdb = vi.fn()
    const stop = watchAndroidApi('https://api.example.com', { runAdb, log: () => {} })
    await vi.advanceTimersByTimeAsync(10000)
    expect(runAdb).not.toHaveBeenCalled()
    stop()
  })
})
