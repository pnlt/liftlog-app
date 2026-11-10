import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { apiReversePort, nativeApiUrl, watchAndroidApi } from './android-network.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const [command = 'start', ...args] = process.argv.slice(2)
if (!['start', 'run:android', 'usb'].includes(command))
  throw new Error(`Unsupported native command: ${command}`)

const help = args.includes('--help') || args.includes('-h')
const apiUrl = help ? '' : nativeApiUrl(root, command, args)
const stopForwarding = help ? () => {} : watchAndroidApi(apiUrl)
let stopping = false
let expo: ReturnType<typeof spawn> | undefined

const stop = (signal: NodeJS.Signals) => {
  stopping = true
  stopForwarding()
  expo?.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

if (command === 'usb') {
  if (help) console.log('Usage: pnpm android:usb — watch and restore the localhost API port over ADB.')
  else if (apiReversePort(apiUrl) === null)
    console.log('MYØS API uses a remote host; USB forwarding is unnecessary.')
} else {
  expo = spawn(process.execPath, [require.resolve('expo/bin/cli'), command, ...args], {
    cwd: root,
    stdio: 'inherit',
  })
  expo.on('error', (error) => {
    console.error(error.message)
    stopForwarding()
    process.exitCode = 1
  })
  expo.on('exit', (code) => {
    stopForwarding()
    process.exitCode = stopping ? 0 : (code ?? 1)
  })
}
