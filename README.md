# LiftLog

Offline-first workout logging for Android and iOS, with a separate AI backend.

```text
frontend/                 Existing LiftLog pnpm workspace
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

The mobile app retains Clerk sign-in and offline SQLite storage. The backend is
a separately runnable foundation; workout sync and AI coach integration are not
implemented by this repository reorganization.

## Frontend

Requires Node 22+, pnpm 12.9.0, and Android Studio or a device. iOS builds require
a Mac or EAS. Run from the repository root:

```bash
pnpm install:frontend
cp frontend/apps/mobile/.env.example frontend/apps/mobile/.env
```

Fill `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in that file. Leave the Sanity variables
empty to use the bundled exercise catalog.

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
pnpm dev:backend
```

API docs: <http://localhost:8000/docs>. Liveness:
<http://localhost:8000/api/v1/health/live>.

To run the API in Docker as well:

```bash
docker compose --env-file backend/.env up --build -d
docker compose --env-file backend/.env exec app alembic upgrade head
```

Details and template provenance: [backend/README.md](backend/README.md).

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
pnpm --dir frontend --filter @liftlog/mobile db:generate
```

See [AGENTS.md](AGENTS.md) for repository conventions and
[CREDITS.md](CREDITS.md) for frontend content licenses. The generated backend
retains the upstream [MIT license](backend/LICENSE).
