# MYØS: build and run guide

This guide covers the MYØS frontend, relocated under `frontend/` on November 6, 2026. Backend setup is documented in [backend/README.md](../../backend/README.md). MYØS is an Android and iOS workout logger with local persistence, Clerk authentication, an exercise library, onboarding-generated training and nutrition estimates, and workout history.

Commands below use Bash. Unless a block changes directories, run it from the repository root. On another machine, replace the absolute checkout path with your own.

## 1. Understand what you are running

| Component                  | Implementation                                                        |
| -------------------------- | --------------------------------------------------------------------- |
| Mobile application         | Expo `~58.0.21`, React Native `0.88.1`, React `19.3.0`, TypeScript    |
| Navigation                 | Expo Router; route files delegate to feature screens                  |
| UI                         | NativeWind 4, shared UI primitives, Reanimated, dark theme            |
| Local database             | Drizzle ORM over `expo-sqlite`, database named `liftlog.db`           |
| Preferences and onboarding | Account-scoped SQLite projections/outbox synchronized with PostgreSQL |
| Authentication             | Clerk; Google sign-in, plus Apple sign-in on iOS                      |
| Exercise content           | Bundled fallback and revision-pinned backend catalog                  |
| Shared rules               | Pure TypeScript in `@myos/domain`                                     |
| Shared data schemas        | Zod in `@myos/contracts`                                              |
| Checks                     | Prettier, TypeScript, Expo ESLint, Vitest                             |

PostgreSQL behind FastAPI is authoritative for acknowledged account data. First use of an uncached account needs online bootstrap; afterward SQLite supports offline logging and retains pending edits. See the [synchronization and recovery guide](synchronization.md) for backend setup, old-data import and conflict handling. The onboarding summary is computed locally without a model call. Rewards, AI coaching and automatic progression remain separate features.

The workspace packages expose TypeScript source directly. **There is no root `pnpm build` command and no shared-package compilation step.** Building this project means producing the native mobile application.

### Repository map

```text
liftlog-app/
├── frontend/apps/mobile/
│   ├── app.json                 App identity, native plugins, splash, icons
│   ├── eas.json                 Cloud build profiles
│   ├── .env.example             Required/optional public configuration
│   ├── assets/                  Bundled images, line art, video clips
│   ├── scripts/                 Exercise and demo asset importers
│   └── src/
│       ├── app/                 Routes and authentication/onboarding gates
│       ├── features/            Auth, onboarding, today, exercises, workout,
│       │                        history, profile, settings, coach interface
│       ├── ui/                  Shared components, colors, motion presets
│       ├── data/                SQLite schema, migrations, queries, writes
│       ├── services/content/    Bundled and Sanity catalog adapters
│       ├── services/events.ts   In-process domain event bus
│       └── lib/                 Environment, storage, formatting, clock helpers
├── frontend/packages/domain/             Plans, progression, e1RM, stats, streaks, units
├── frontend/packages/contracts/          Exercise, workout, profile, event schemas
├── backend/                     FastAPI and authoritative PostgreSQL account data
├── docs/adr/                    Architecture decisions
└── .github/workflows/ci.yml      Workspace checks
```

The dependency direction is mobile → contracts/domain, with contracts also using domain definitions. Domain code has no React Native or I/O dependency. See the [architecture decision](../adr/0001-monorepo-layout.md) and [repository instructions](../../AGENTS.md).

### Startup and persistence

1. `src/lib/env.ts` validates public environment values. Invalid configuration displays **App is misconfigured**.
2. The root layout installs the Clerk and keyboard providers. `DatabaseGate` applies bundled migrations before rendering navigation.
3. Bundled exercises are seeded when `BUNDLED_REVISION` changes. Authenticated foreground synchronization refreshes the cache from a complete backend catalog release.
4. Clerk authentication selects an account partition; initial online bootstrap restores its remote state. A missing accepted account profile opens onboarding. Global legacy preferences require explicit ownership confirmation.
5. Onboarding calculates and atomically saves a profile revision and accepted summary snapshot with an outbox intent. The main tabs are **Today**, **History**, **Exercises**, and **Profile**.
6. Every workout edit writes SQLite and its outbox atomically. Live queries update immediately while a foreground worker pushes versioned mutations and pulls changes. Finishing removes incomplete sets, saves the end time, and emits `workout.completed` independently of network success.

The local database retains `exercises`, `workout_sessions`, `workout_exercises`, and `workout_sets`, plus sync account/entity/outbox metadata. Weights remain kilograms; pounds are a display/input conversion. Timed exercises store seconds in `reps`. Both completed deletion and unfinished discard use synchronized tombstones.

Workout data, profile, settings, cursors and pending changes are scoped by Clerk subject. Signing out stops the worker and clears in-memory account views while preserving that account's pending data. A running rest timer remains device state and stops on account changes. PostgreSQL can restore acknowledged data on another installation; device storage removed before synchronization cannot be recovered from the server.

## 2. Prerequisites

### All development machines

- Git and a complete checkout, including the committed assets and generated content.
- Node.js **22 or later**, as required by root `package.json`; CI uses Node 22.
- pnpm **12.9.0**, pinned by the root `packageManager` field.
- A Clerk development application's publishable key and access to its enabled sign-in providers.
- Internet for dependency installation, first sign-in, and optional remote content.

If Corepack is installed, enable its package-manager shims and check the selected versions:

```bash
cd /home/ninkuto/Projects/Workspace/ai-projects/liftlog-app
corepack enable
node --version
pnpm --version
```

The expected pnpm version is `12.9.0`. If Corepack is unavailable, provision pnpm 12.9.0 through your development environment before continuing. Use pnpm throughout this repository. Keep `nodeLinker: hoisted` in `frontend/pnpm-workspace.yaml`; the native toolchain expects this flat dependency layout.

### Local Android builds

Install Android Studio, a compatible JDK, Android SDK platform/build tools, platform-tools (`adb`), and an emulator or a connected Android device. Expo's current setup guide uses JDK 17 and Android SDK Platform 36; install any additional SDK/NDK versions requested by the generated SDK 58 project. Follow the [official Android environment setup](https://docs.expo.dev/workflow/android-studio-emulator/).

For Linux, use your actual Android Studio SDK location; a common configuration is:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
java -version
adb version
adb devices
```

For an emulator, create and start an Android Virtual Device in Android Studio's Device Manager. For a physical device, enable developer options and USB debugging, connect it, and accept the computer authorization prompt. `adb devices` should show the target as `device`, not `unauthorized` or `offline`.

### Local iOS builds

Use macOS with Xcode, its command-line tools, an installed iOS Simulator runtime, and CocoaPods available for native dependencies. Physical-device signing requires an appropriate Apple development setup. Linux cannot compile or launch iOS locally; use the cloud build path below to create an iOS device build from Linux.

## 3. Install and configure

```bash
cd /home/ninkuto/Projects/Workspace/ai-projects/liftlog-app
pnpm --dir frontend install --frozen-lockfile
# First setup only: preserve an existing .env file.
test -f frontend/apps/mobile/.env || cp frontend/apps/mobile/.env.example frontend/apps/mobile/.env
```

Edit `frontend/apps/mobile/.env`:

```dotenv
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_WITH_YOUR_REAL_KEY
EXPO_PUBLIC_SANITY_PROJECT_ID=
EXPO_PUBLIC_SANITY_DATASET=production
```

The example Clerk value is a placeholder, not a usable key.

| Variable                            | Required?   | Behavior                                                                                                                           |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes         | Obtain the real publishable key from your project's Clerk dashboard or project owner. The local validator requires a `pk_` prefix. |
| `EXPO_PUBLIC_SANITY_PROJECT_ID`     | No          | Leave empty for the bundled exercise catalog. A nonempty value enables the Sanity adapter.                                         |
| `EXPO_PUBLIC_SANITY_DATASET`        | With Sanity | Must be nonempty when Sanity is enabled. Defaults to `production` only when the variable is absent.                                |

The sign-in screen offers Google, plus Apple on iOS; there is no email/password or guest flow. Configure the corresponding providers in the Clerk application. The native scheme is `liftlog`, the callback route is `sso-callback`, and the application ID on both platforms is `com.team3ae.liftlog`. These values are relevant when checking OAuth callback configuration. Consult `SignInScreen.tsx` and `app.json` if sign-in opens a browser but does not return to the app.

All `EXPO_PUBLIC_*` values are client configuration and can appear in the application bundle. Do not place Clerk secret keys, Sanity write tokens, or model API keys there. `.env` is ignored by git.

Sanity is no longer a direct mobile refresh source. The previous adapter is retained for reference, but canonical catalog updates are published as validated backend artifacts. There is no Sanity Studio workspace in this repository. See the catalog section of the [synchronization guide](synchronization.md).

## 4. Build and run Android locally

After preparing the emulator/device and `.env`:

```bash
cd /home/ninkuto/Projects/Workspace/ai-projects/liftlog-app/frontend/apps/mobile
pnpm android
```

This runs `expo run:android`: generates the native Android directory when absent, compiles and installs a development client, and starts Metro. To choose a target explicitly:

```bash
pnpm exec expo run:android --device
```

Expected result: MYØS opens, Metro serves the JavaScript bundle, and the sign-in screen appears. After successful sign-in, a fresh installation enters onboarding. This project requires a **development client**, not Expo Go. See [Expo's local build workflow](https://docs.expo.dev/guides/local-app-development/).

### Subsequent development sessions

Once the development client is installed:

```bash
cd /home/ninkuto/Projects/Workspace/ai-projects/liftlog-app
pnpm dev
```

Alternatively, run `pnpm start` from `frontend/apps/mobile`. Both start Metro without compiling a new native app. Use the terminal's Android launch shortcut or open the installed development client. Keep Metro running while developing.

JavaScript/TypeScript changes usually reload through Metro. Native dependency and config-plugin changes require rebuilding the development client. Native directories are generated and ignored by git; change `app.json` or config plugins instead of editing generated native files.

## 5. Build and run iOS locally

On a Mac, complete the same installation and `.env` setup, then:

```bash
cd /path/to/liftlog-app/frontend/apps/mobile
pnpm ios
```

This runs `expo run:ios`. To select a simulator or connected device explicitly:

```bash
pnpm exec expo run:ios --device
```

Later sessions can use `pnpm start` from the app directory. The [local build documentation](https://docs.expo.dev/guides/local-app-development/) describes native generation, target selection, and rebuilding.

## 6. Create an Android APK that runs without Metro

The [repository README](../../README.md) documents a local testing APK path. First complete a native Android build as above, then stop Metro if desired and run:

```bash
cd /home/ninkuto/Projects/Workspace/ai-projects/liftlog-app/frontend/apps/mobile/android
./gradlew assembleRelease
```

The expected APK location is:

```text
frontend/apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Install it on a connected target:

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

This APK embeds its JavaScript and assets, so Metro is not needed. The README identifies this local release build as debug-key-signed and suitable for testing only; native output and signing were not generated or verified during this documentation review. Use configured release credentials for store distribution.

The build still needs a valid Clerk key, and initial sign-in still requires a connection. Changing bundled environment values requires rebuilding the standalone application. If installation reports a signature conflict with an existing build, use the matching signing key or a separate test device; uninstalling can remove local workout data.

## 7. Cloud builds with EAS CLI

The repository includes `frontend/apps/mobile/eas.json`. Expo's build service uses the `eas` CLI and can build iOS remotely from a Linux workstation. Local Android Studio/Xcode is not required for a cloud build. See [cloud build setup](https://docs.expo.dev/build/setup/).

| Profile       | Existing configuration                                               | Intended use                         |
| ------------- | -------------------------------------------------------------------- | ------------------------------------ |
| `development` | Development client, internal distribution, `development` environment | Native client for Metro development  |
| `preview`     | Internal distribution, Android APK, `preview` environment            | Standalone device testing            |
| `production`  | Automatic version increment, `production` environment                | Store build with appropriate signing |

The CLI requirement is `>=16.0.0` and versioning uses the remote app version source. The checked-in app configuration has no `extra.eas.projectId`; link it to the team's intended Expo project before building.

From `frontend/apps/mobile`, authenticate and configure the project using pnpm to invoke EAS CLI:

```bash
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest build:configure
```

Choose the intended team/project in the prompts. Review any resulting `app.json` and `eas.json` changes and preserve the existing build profiles.

Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in the Expo project's environment-variable dashboard for each environment you will build. Add the Sanity variables only if using Sanity. The local ignored `.env` is not a substitute for cloud configuration. Client-visible values may use plaintext visibility; they are not private application secrets. See [Expo environment configuration](https://docs.expo.dev/eas/environment-variables/).

Choose the build you need:

```bash
# Development client: install the artifact, then run pnpm start locally.
pnpm dlx eas-cli@latest build --platform android --profile development

# Standalone Android APK for testers.
pnpm dlx eas-cli@latest build --platform android --profile preview

# iOS device build; requires appropriate signing and device provisioning.
pnpm dlx eas-cli@latest build --platform ios --profile development

# Store artifacts, after production configuration and credentials are ready.
pnpm dlx eas-cli@latest build --platform android --profile production
pnpm dlx eas-cli@latest build --platform ios --profile production
```

Download/install the artifact using the build result link. The existing iOS profiles do not enable `ios.simulator`; they are not configured for simulator artifacts. Building does not itself publish to an app store. Although `submit.production` exists, store submission setup still has to be completed separately.

## 8. Demonstrate the application

Use this walkthrough after a successful installation:

1. **Sign in:** select Google, or Apple on iOS, and complete the browser flow.
2. **Complete onboarding:** provide name, body measurements, goal, experience, weekly schedule, training location, and activity level. A cutting plan also asks about pace. Review the locally calculated plan and choose **Start my plan**.
3. **Browse exercises:** open **Exercises**, search by name, filter by muscle, and open an exercise to view instructions and demos.
4. **Log a workout:** open **Today → Start workout → Add exercise**. Select a weighted exercise, tap its weight/repetition cell, enter values, and choose **Complete set**. Add another set and try the rest timer's adjustment/skip buttons.
5. **Check persistence:** leave the workout unfinished, close/reopen the app, and use **Resume workout**. Verify the saved sets remain. A development client still needs Metro to reload JavaScript.
6. **Finish:** complete at least one set and tap **Finish**. The session summary should appear, and **History** should list the workout. Incomplete sets are removed when finishing.
7. **Change preferences:** in **Profile**, change kg/lb, demo style, or default rest. **Update my plan** repeats onboarding while preserving workouts.
8. **Check offline logging:** use a standalone preview/testing build, sign in and load it online first, then disable the connection while the authenticated app is running. Add/edit sets and view history. Local logging does not call a backend; first sign-in and authentication/session renewal are separate network concerns.

Exercise metadata is bundled, but many photo frames are remote URLs. Bundled line art and clips work without downloading; uncached remote photos and Sanity media may not. An unavailable image alone does not establish that workout storage failed.

## 9. Checks and development commands

Run the full quality gate from the repository root:

```bash
pnpm check:frontend
```

It runs formatting, type checking, linting, then tests. It stops when a step fails.

| Command, from repository root                           | Purpose                                                   |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `pnpm dev`                                              | Start the mobile Metro server                             |
| `pnpm --dir frontend format:check`                      | Check repository formatting                               |
| `pnpm --dir frontend typecheck`                         | Type-check every workspace                                |
| `pnpm --dir frontend lint`                              | Run workspace lint scripts                                |
| `pnpm --dir frontend test`                              | Run workspace test scripts                                |
| `pnpm --dir frontend --filter @myos/domain test`        | Run training-rule tests                                   |
| `pnpm --dir frontend --filter @myos/contracts test`     | Run schema tests                                          |
| `pnpm --dir frontend --filter @myos/mobile db:generate` | Generate a new SQLite migration after changing the schema |

The mobile `test` script currently prints a message; it does not run mobile UI or integration tests. Vitest tests cover domain behavior and selected contracts. Shared-package lint scripts use TypeScript unused-code checks; mobile lint uses Expo ESLint. CI installs with the frozen lockfile and runs the four quality steps on pull requests and pushes to `main`. It does not build native binaries.

### Dependencies and native configuration

From `frontend/apps/mobile`, install a mobile dependency using:

```bash
pnpm exec expo install <package-name>
```

Use the [SDK 58 documentation](https://docs.expo.dev/versions/v58.0.0/) when working on this checkout, and recheck the Expo major after an upgrade. Expo's [documentation index](https://docs.expo.dev/llms.txt) includes corrections to outdated workflow assumptions.

### Database changes

Edit `frontend/apps/mobile/src/data/db/schema.ts`, then run the migration command in the table. Commit the generated SQL, metadata/snapshot, and `migrations.js`. Never edit an existing migration. On startup, `DatabaseGate` applies bundled migrations to the device; there is no separate manual database bootstrap required for normal app installation.

### Exercise and demo updates

Existing generated content is checked in; **do not run importers just to build or launch the app**. For an intentional catalog update, run from `frontend/apps/mobile`:

```bash
pnpm exec tsx scripts/import-exercises.mts
```

This downloads pinned upstream content and regenerates `src/services/content/library.json`. Bump `BUNDLED_REVISION` in `bundled.ts` after changing the bundled catalog or seed so existing installations import it again.

For an intentional demo rebuild, install ImageMagick (`magick`) and FFmpeg, then:

```bash
pnpm exec tsx scripts/import-demos.mts
```

The demo importer replaces generated art/video directories and rewrites `demos.ts`; it needs network access. `tsx` is not declared directly in the app manifest, so if it is unavailable, add it as an explicit development dependency using the repository's package-install workflow before running these maintenance scripts. Do not hand-edit generated content. Preserve the licenses and attribution documented in [CREDITS.md](../../CREDITS.md).

## 10. Troubleshooting

| Symptom                                   | What to check                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm: command not found`                 | Enable Corepack shims or provision pnpm 12.9.0; reopen the shell and check PATH.                                                                           |
| Frozen installation fails                 | Confirm the branch has matching manifests and lockfile and that the pinned pnpm version is active. Do not silently replace the lockfile to get a build.    |
| **App is misconfigured**                  | Check `frontend/apps/mobile/.env`, the Clerk key, and a nonempty dataset when Sanity is enabled. Restart Metro and reload after correcting values.         |
| Sign-in fails or callback does not return | Check connectivity, Clerk key/application, enabled providers, native scheme, and callback configuration. Logs use `[auth]`.                                |
| No Android target                         | Start an emulator or authorize the physical device; inspect `adb devices`.                                                                                 |
| Android SDK/JDK not found                 | Check Android Studio SDK location, `ANDROID_HOME`, PATH, and Java/Gradle compatibility.                                                                    |
| Development client cannot load JavaScript | Ensure Metro is running and reachable. Check Wi-Fi/firewall settings. For a USB Android device using Metro port 8081, try `adb reverse tcp:8081 tcp:8081`. |
| Stale Metro/module resolution             | From `frontend/apps/mobile`, run `pnpm exec expo start --clear`. Confirm dependencies were installed in `frontend/` with hoisted linking.                  |
| Native module missing or mismatched       | Rebuild the development client after native dependency/config changes; restarting Metro alone cannot add native code.                                      |
| **Could not open your data**              | Inspect `[db] migration failed` logs and the committed migration chain. Preserve local workout data while investigating.                                   |
| Catalog missing or CMS unavailable        | Inspect `[content]` logs, bundled revision, schema validation warnings, and optional Sanity configuration.                                                 |
| **Nothing to save** on Finish             | Mark at least one set completed; entered numbers alone do not mark a set done.                                                                             |
| Cloud build has no Clerk key              | Configure the environment selected by the profile in `eas.json`, then rebuild.                                                                             |

The mobile manifest also contains a `doctor` script invoking `expo-doctor`, but that executable is not declared as a direct dependency. If it is unavailable locally, invoke the diagnostic tool from `frontend/apps/mobile` with `pnpm dlx expo-doctor`.

## 11. Verification scope of this document

The guide was checked against workspace manifests, app/build configuration, routes and feature code, persistence and content code, domain logic and tests, schemas, migrations, importers, CI, and existing repository documentation. External Expo workflow references were checked against the SDK 58 context.

At review time this workspace had Node `v24.16.0`, no `pnpm` executable on PATH, no installed root `node_modules`, and no generated Android project. Consequently, `pnpm check` could not run, and native builds, cloud builds, authentication, and the device walkthrough were not executed. These are documented procedures, not a claim that the app was built or tested successfully in this environment.
