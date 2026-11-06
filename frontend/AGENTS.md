# AGENTS.md

Instructions for humans and coding agents working in this repo. Setup and commands: [README.md](README.md).

## Expo changes every SDK; do not trust training data

Before touching an Expo, EAS or React Native API, read the `expo` major in `apps/mobile/package.json` and use the matching docs at `https://docs.expo.dev/versions/v<major>.0.0/`. Index with corrections to common LLM mistakes: https://docs.expo.dev/llms.txt.

## Workspace

pnpm monorepo, `nodeLinker: hoisted` (React Native needs a flat `node_modules`). Use `pnpm`, never npm, yarn or bun. Packages are consumed as TypeScript source; there is no build step.

| Path                 | Owns                                                       | May import                       |
| -------------------- | ---------------------------------------------------------- | -------------------------------- |
| `packages/domain`    | training rules: plans, progression, e1RM, stats, units     | nothing (pure TS, no RN, no I/O) |
| `packages/contracts` | zod schemas for data crossing a boundary (DB, CMS, server) | `zod`, `@liftlog/domain` types   |
| `apps/mobile`        | screens, UI, local SQLite, auth, device APIs               | both packages                    |

Logic that does not need React or a device goes in `packages/domain` with a vitest test next to it. Anything a backend must agree on goes in `packages/contracts`.

## Mobile app (`apps/mobile/src`)

- `app/`: Expo Router routes only. Each file is a screen that renders a component from `features/`. `(app)/` is behind auth.
- `features/<name>/`: screens, components, hooks and Zustand stores of one feature.
- `ui/`: shared primitives (`Button`, `Card`, `Text`, `Screen`, `PressableScale`), `colors.js` tokens, `motion.ts` springs and durations. Reuse these; no raw hex colours or ad-hoc animation timings in features.
- `data/`: Drizzle schema, migrations and queries. Screens read through `data/*` functions, never raw SQL.
- `services/content/`: exercise catalog sources (bundled JSON, optional Sanity CMS), validated with `ExerciseSchema` before upsert.
- `services/events.ts`: in-app domain event bus.
- `lib/`: env parsing, formatting, storage helpers.

Imports use `@/` for `src/`.

## Seams for backend, gamification and AI

These are the integration points. Extend them instead of importing another feature's internals.

- **Domain events.** `domainEvents.subscribe` in `services/events.ts` receives events such as `workout.completed` (schema in `packages/contracts/src/events.ts`). Gamification (XP, streak rewards, badges) and backend sync subscribe here. New events: add the zod schema to `contracts`, extend the `DomainEvent` union, emit from the feature that owns the fact.
- **Backend API.** The Python/FastAPI server lives in `../backend` and validates boundary data with Pydantic. Keep its API schemas aligned with `@liftlog/contracts`. The app's client goes in `apps/mobile/src/services/api/` and authenticates with the Clerk session token (`useAuth().getToken()`), never with a shared key.
- **AI coach.** `features/coach/coach.ts` defines `CoachClient`. Implement it against backend endpoints. Model API keys live on the server only; anything in the app bundle is public.
- **Content.** Implement `ExerciseSource` (`services/content/source.ts`) for a new catalog source.

The app is offline-first: SQLite is the source of truth on the device. Sync must never block logging a set.

## Database

Schema: `apps/mobile/src/data/db/schema.ts`. After changing it run `pnpm --filter @liftlog/mobile db:generate` and commit the generated SQL, snapshot and `migrations.js`. Never edit an existing migration; add a new one.

## Rules

- TypeScript strict, no `any`. Parse untrusted data with zod at the boundary.
- Add packages to the app with `pnpm exec expo install <pkg>` from `apps/mobile`.
- `android/` and `ios/` are generated; configure native behaviour in `app.json` or config plugins. A new native module needs a rebuilt dev client.
- Respect reduced motion (`useReducedMotion`) and give interactive elements accessibility labels.
- Generated files (`demos.ts`, `library.json`, migrations) are rewritten by their scripts; do not hand-edit.
- Comments explain only non-obvious behaviour.
- Conventional Commits, lowercase titles, one logical change per commit.
- Run `pnpm check` before declaring work done.
