# MYØS

**Myo (muscle) + OS — the operating system for muscle.**

Offline-first workout logging for Android and iOS, with a separate AI backend.

Brand name: **MYØS**. Technical slug and package scope: `myos` / `@myos`.
See the [brand and compatibility notes](docs/brand.md).

```text
frontend/                 Existing MYØS pnpm workspace
  apps/mobile/            Expo SDK 58 app, Clerk auth, local SQLite
  apps/plan-agent/         Existing TypeScript plan-agent draft
  packages/domain/        Pure training rules and tests
  packages/contracts/     Zod boundary schemas
backend/                  FastAPI backend generated from Full-Stack AI Agent Template
  app/                    API, services, repositories, AI agents, database models
  cli/                    Backend command-line tools
  alembic/                PostgreSQL migrations
  tests/                  Backend tests
docs/                     Shared architecture and development documentation
```

The mobile app uses Clerk sign-in, PostgreSQL as the authoritative account database,
and SQLite as a durable offline cache/outbox. Profile, settings, accepted plans, and
workouts synchronize through FastAPI; logging a set never waits for the network.
The AI coach and template-generation drafts are separate from synchronization.

## Frontend

Requires Node 22+ and pnpm 12.9.0. Web development runs in a browser; Android
Studio or a device is only needed for native Android development. iOS builds
require a Mac or EAS. Run from the repository root:

```bash
pnpm install:frontend
cp frontend/apps/mobile/.env.example frontend/apps/mobile/.env
```

Fill `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_API_URL` in that file.
Use the FastAPI origin without `/api/v1`; Android emulators use
`http://10.0.2.2:8000`, and physical devices need the computer's LAN address.

For web development:

```bash
pnpm dev:web
```

Open <http://localhost:8081>. The development launcher uses port 8082 internally
for Metro and applies the isolation headers required by SQLite to every response,
including HTML. Use the public port 8081. Browser startup waits for SQLite's worker
before loading routes and hydrating synchronous stores.
Running `pnpm dev:web` again prints the URL and exits successfully when this checkout's
launcher is already running. An unrelated service or another checkout on port 8081
still fails; stop that process from its own terminal before trying again.
Google sign-in uses a full-page redirect and completes at `/sso-callback`, because
the SQLite isolation headers do not support the native popup authentication flow.

For native development:

```bash
cd frontend/apps/mobile
pnpm android
pnpm start
```

Build the development client with `pnpm android` once, then use `pnpm start` for
later sessions. The app uses native modules and requires a development client.
From the repository root, `pnpm dev` also starts Metro.

Details: [frontend/README.md](frontend/README.md) and
[build and run guide](docs/guides/build-and-run.md).

## Backend

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), and PostgreSQL 16
(or Docker Compose). Run from the repository root:

```bash
pnpm install:backend
cp backend/.env.example backend/.env
```

Configure `IDP_JWKS_URL` and `IDP_ISSUER` for your Clerk instance, and
`IDP_AUDIENCE` if your JWT includes an audience. Set `OPENAI_API_KEY` to use the
template's AI agent. Generate `SECRET_KEY` and `API_KEY` with `openssl rand -hex 32`.

```bash
docker compose --env-file backend/.env up -d db
uv run --directory backend alembic upgrade head
uv run --directory backend myos cmd import-catalog
pnpm dev:backend
```

If another service uses port 8000, run `pnpm dev:backend --port 8001` and open
<http://localhost:8001/docs>. Backend CORS permits the frontend at
`http://localhost:8081`; keep that origin in `backend/.env` when customizing CORS.

API docs: <http://localhost:8000/docs>. Liveness:
<http://localhost:8000/api/v1/health/live>.

To run the API in Docker as well:

```bash
docker compose --env-file backend/.env up --build -d
docker compose --env-file backend/.env exec app alembic upgrade head
```

Details and template provenance: [backend/README.md](backend/README.md).
Account setup, migration, offline behavior, and recovery:
[synchronization guide](docs/guides/synchronization.md).

## Checks

```bash
pnpm check             # Frontend checks, then backend Ruff and pytest
pnpm check:frontend
pnpm check:backend
```

Frontend dependencies and its lockfile live in `frontend/`; Python dependencies
and `uv.lock` live in `backend/`. Use `pnpm --dir frontend --filter <package>`
for workspace commands, for example:

```bash
pnpm --dir frontend --filter @myos/mobile db:generate
```

See [AGENTS.md](AGENTS.md) for repository conventions and
[CREDITS.md](CREDITS.md) for frontend content licenses. The generated backend
retains the upstream [MIT license](backend/LICENSE).
