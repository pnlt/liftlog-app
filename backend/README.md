# MYØS backend

FastAPI, PostgreSQL, SQLAlchemy, Alembic, Pydantic AI, and delegated JWT/JWKS
authentication. This backend was rendered from the locally provided
`full-stack-ai-agent-template` repository, upstream commit
`475f799f7df02738f804fa350f2de244d7331a94` (generator 0.2.21).
The original license is preserved in [LICENSE](LICENSE), and generation choices
are recorded in [template-config.json](template-config.json).

The template's Next.js frontend is disabled because MYØS's Expo app lives in
`../frontend`. Optional RAG, queues, billing, and telemetry are disabled. The
fitness API stores account profiles, accepted plan snapshots, settings, and
workouts in PostgreSQL. Versioned mutations and a per-account change feed support
the mobile SQLite cache/outbox. AI coaching and template generation remain separate.

## Local development

From the repository root:

```bash
uv sync --directory backend --frozen
cp backend/.env.example backend/.env
docker compose --env-file backend/.env up -d db
uv run --directory backend alembic upgrade head
uv run --directory backend myos cmd import-catalog
pnpm dev:backend
```

Configure database credentials in `backend/.env`. Generate separate values for
`SECRET_KEY` and `API_KEY` with `openssl rand -hex 32`. `OPENAI_API_KEY` is needed
for model calls, and `AI_MODEL` selects the model used by the template agent.
Health checks, API documentation, and tests do not require a model key.
The checked-in catalog artifact contains 664 validated bundled exercises. Regenerate
it with `pnpm --dir frontend --filter @myos/mobile catalog:export` after changing
the source catalog. Import validates the entire immutable release before publishing.
See the [synchronization guide](../docs/guides/synchronization.md) for offline
semantics, import safeguards, and real PostgreSQL test configuration.

The Python distribution and primary management command use the ASCII identifier
`myos`; `liftlog` remains a CLI alias for existing scripts. The existing PostgreSQL
database name `liftlog` is retained so the rebrand uses the same data.

API documentation is at <http://localhost:8000/docs>, with OpenAPI at
<http://localhost:8000/api/v1/openapi.json>. `/api/v1/health/live` checks process
liveness; `/api/v1/health/ready` also checks the database.

## Clerk authentication

Set these backend-only values for the same Clerk instance as the mobile app:

- `IDP_JWKS_URL`: the Clerk instance's public JWKS endpoint.
- `IDP_ISSUER`: the exact issuer of the session token.
- `IDP_AUDIENCE`: the expected audience when configured on the token.

The mobile client sends `Authorization: Bearer <session JWT>` using a token from
Clerk's `getToken()`. The template validates its signature and provisions a
backend user by the token's `sub`. Local password login and registration routes
are disabled. `API_KEY` is for trusted server integrations only.

[Default Clerk session claims](https://clerk.com/docs/guides/sessions/session-tokens)
do not include email. In that case the backend stores a stable placeholder at
`<sub>@idp.example.com`; an email claim, when configured, supplies the actual
address. The placeholder is not a contact address.

## Tests and migrations

```bash
pnpm check:backend
uv run --directory backend alembic heads
uv run --directory backend alembic upgrade head
```

From `backend/`, create new migrations with
`uv run alembic revision --autogenerate -m "describe change"`. Commit the new
migration and retain existing revisions. Backend unit and API tests use dependency
overrides and do not need a running database or live model calls. Migration cycle
tests run only when the shell variable `TEST_POSTGRES_DB` names a separate,
reachable database ending in `_test`. Create that disposable database on the
configured PostgreSQL server, then run:

```bash
TEST_POSTGRES_DB=liftlog_test uv run --directory backend pytest tests/test_migrations.py
```

Migration tests drop and recreate tables in that test database. They never run
against `POSTGRES_DB`; leave `TEST_POSTGRES_DB` unset for ordinary checks.

## Docker

The root `docker-compose.yml` runs the API and PostgreSQL. It reads `backend/.env`;
pass `--env-file backend/.env` so database interpolation uses the same credentials:

```bash
docker compose --env-file backend/.env up --build -d
docker compose --env-file backend/.env exec app alembic upgrade head
docker compose --env-file backend/.env down
```

`docker compose down` keeps the named database volume. The production Compose
file requires real secrets and external HTTPS termination.
