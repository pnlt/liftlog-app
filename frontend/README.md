# MYØS

Offline-first workout logger for Android and iOS. Expo SDK 58, React Native 0.88, TypeScript, NativeWind, Zustand, Drizzle on expo-sqlite, Clerk auth.

## Layout

```
apps/mobile          Expo app (screens, UI, local database)
packages/domain      pure TypeScript training logic: plans, progression, e1RM, stats, units
packages/contracts   zod schemas shared by the app and any backend: exercises, workouts, events
../docs/adr          architecture decisions
```

All commands below run from `frontend/` unless stated otherwise. The separate
FastAPI backend lives in `../backend`; see the [repository README](../README.md).

Why it is split this way: [architecture decisions](../docs/adr/0001-monorepo-layout.md).

## Setup

Requires Node 22+ and pnpm 12 (`corepack enable` picks the version from `package.json`). Web development uses a browser. Native Android development needs Android Studio or a device with USB/wireless debugging; iOS builds need a Mac or EAS.

```bash
pnpm install
cp apps/mobile/.env.example apps/mobile/.env
```

Fill `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`.
The API URL is the FastAPI origin without `/api/v1`. Use `http://10.0.2.2:8000`
for Android emulators. For a physical device over USB, keep `localhost` and
forward the API port with ADB; see the [USB setup](../README.md#frontend).
For testing over Wi-Fi, use the computer's LAN address instead.
PostgreSQL holds acknowledged account data; SQLite caches it and queues offline
edits. First use of an account needs online bootstrap. See the
[synchronization guide](../docs/guides/synchronization.md).

## Run

Run in a browser from `frontend/`:

```bash
pnpm dev:web
```

Open <http://localhost:8081>. Port 8082 is used internally by Metro; the public
port adds SQLite isolation headers to HTML, assets, and worker responses. The web
entry point initializes SQLite asynchronously before routes load.
Repeated `pnpm dev:web` commands reuse this checkout's running launcher and print its
URL. Another service or checkout on port 8081 produces an error; stop it from its own
terminal before trying again. Stop and restart the launcher to apply new startup flags.

The app uses native modules, so Expo Go does not work. Build a development client once, then iterate with Metro:

```bash
cd apps/mobile
pnpm android        # builds and installs the dev client, starts Metro
pnpm start          # later: Metro only, the installed dev client reloads JS
```

Both commands automatically forward a localhost API port over ADB and restore it
after USB reconnection while the command stays running. For an installed APK or
raw Expo/Gradle/Android Studio builds, run `pnpm android:usb` from the repository
root in a separate terminal. The backend must be running on the configured API port.

`android/` and `ios/` are generated from `app.json` (Continuous Native Generation) and ignored by git. Never edit them; change `app.json` or a config plugin and rebuild.

A standalone APK without Metro: `cd apps/mobile/android && ./gradlew assembleRelease` after one `pnpm android`. It is signed with the debug key, so it is for testing only.

## Checks

```bash
pnpm check          # prettier, typecheck, lint, tests across the workspace
pnpm test           # Vitest in packages and mobile, including real SQLite sync tests
```

CI runs `pnpm check` on every push and pull request. `main` requires a green run.

## Common tasks

| Task                        | How                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Add a dependency to the app | `cd apps/mobile && pnpm exec expo install <pkg>` (picks SDK-compatible versions)           |
| Change the database schema  | edit `src/data/db/schema.ts`, then `pnpm --filter @myos/mobile db:generate`, commit output |
| Update the exercise catalog | `cd apps/mobile && pnpm exec tsx scripts/import-exercises.mts`, bump `BUNDLED_REVISION`    |
| Update demo art and clips   | `cd apps/mobile && pnpm exec tsx scripts/import-demos.mts` (needs `magick`, `ffmpeg`)      |

`BUNDLED_REVISION` in `src/services/content/bundled.ts` makes installed apps re-import the bundled catalog on next launch.

## Contributing

Branch from `main`, open a pull request, get a review from the CODEOWNERS of the paths you touched. Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:` ...). See [AGENTS.md](AGENTS.md) for code conventions and where new code belongs.

Third-party content and licences: [CREDITS.md](../CREDITS.md).
