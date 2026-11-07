# Account synchronization and recovery

PostgreSQL stores acknowledged account data behind FastAPI. SQLite on the device
stores projections and pending changes. A set edit commits locally with its
outbox intent before synchronization starts. It remains available after restarting
the app; it reaches another device only after the server acknowledges it.

## Configure and start

Configure PostgreSQL and the same Clerk instance used by mobile in `backend/.env`.
Back up an existing server database before applying migrations. Run from the root:

```bash
uv run --directory backend alembic upgrade head
uv run --directory backend myos cmd import-catalog
pnpm dev:backend
```

Set these public mobile values in `frontend/apps/mobile/.env`:

```dotenv
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_your_clerk_publishable_key
EXPO_PUBLIC_API_URL=http://localhost:8000
```

Use `http://10.0.2.2:8000` for an Android emulator, or the development computer's
LAN address for a physical device. Supply the origin only; the client adds
`/api/v1`. Production uses HTTPS. Mobile never connects directly to PostgreSQL
or receives database/model credentials. Web requests require the app origin in
the backend CORS configuration.

The first use of an uncached account requires a connection to discover its remote
profile and restore workouts. After bootstrap, cached accounts can log offline.
Foreground launch, returning to the app, local edits, periodic foreground refresh,
and **Sync now** attempt synchronization. The app does not depend on OS background
scheduling. Profile displays pending changes, last connection, and conflicts.

## Existing local data

New generated SQLite migrations preserve existing rows and the draft accepted-plan
table. The cache prepares an import for each Clerk user's existing workouts once,
including open sessions and deletion tombstones. Existing session/exercise/set IDs,
kilograms, notes, positions, and timestamps remain intact. Unknown old catalog IDs
retain a per-workout name/load snapshot, without modifying the public catalog.

Global legacy profile/settings keys do not identify their account owner. When no
account profile exists, the app asks whether those preferences belong to the
signed-in account before adopting them. Declining keeps them out of uploads.
An existing server profile takes precedence. Routine future sign-ins restore the
account partition and do not repeat onboarding.

## Failures and conflicts

- A timeout may happen after a server commit. The outbox retries the identical
  mutation ID/body, and server receipts prevent duplicate writes.
- Authentication or network failure keeps pending writes on the original account.
  Signing out stops its worker; signing back into that account resumes it.
- A version conflict preserves the local draft and server snapshot. Profile lets
  the user explicitly keep the local version or use the account version. A newer
  server change can require choosing again. A remotely deleted workout is recovered
  under a new ID when the user chooses to keep its local contents.
- Correct an invalid local draft before resubmitting it. Do not clear the SQLite
  database, browser site storage, application data, or the outbox to fix a failed
  request. Removing device storage before acknowledgment can lose pending changes.
- A fresh install can restore acknowledged PostgreSQL data. It cannot recover
  edits that never left the old device. Synchronization is not a substitute for
  PostgreSQL backups.

Screens read local projections, including pending edits. Server read APIs and
statistics reflect acknowledged state. Weekly calculations use an explicit time
zone. Timers, editor state, and media assets remain local.

## Catalog updates

```bash
pnpm --dir frontend --filter @myos/mobile catalog:export
uv run --directory backend myos cmd import-catalog
```

The exporter validates and merges the current seed and library, sorts IDs, preserves
credits, and derives a reproducible release ID from content. The backend publishes
an immutable release atomically. Mobile pins a revision across pages and applies
only a complete valid release. Bundled exercises remain available offline. Direct
mobile Sanity refresh is replaced by backend catalog delivery; publishing a new CMS
artifact is an operator operation.

## Verification

```bash
pnpm check
```

Mobile sync tests use temporary, real SQLite databases through Node's `node:sqlite`.
For real PostgreSQL transaction/concurrency tests, configure an isolated disposable
database whose name ends in `_test`. Never point this at application data:

```bash
FITNESS_TEST_DATABASE_URL=postgresql+asyncpg://liftlog:liftlog_test@127.0.0.1:55432/liftlog_sync_test \
  uv run --directory backend pytest tests/test_fitness_postgres.py
```

The suite exercises concurrent retries, version/ownership conflicts, commit/feed
ordering, rollback, catalog releases, profile/plan acceptance, and migration cycles.
Without this environment variable, PostgreSQL-specific integration cases report
skipped; schema and API unit tests still run. CI provisions PostgreSQL for these
tests. Device smoke checks additionally cover logging in airplane mode, restarting,
reconnecting, switching accounts, and restoring on another installation.
