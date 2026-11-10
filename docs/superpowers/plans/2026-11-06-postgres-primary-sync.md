# PostgreSQL Primary Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track steps with checkboxes. The user explicitly approved this design and requested immediate implementation and a final independent review; do not request another planning approval.

**Goal:** Connect mobile account data to PostgreSQL through FastAPI while SQLite preserves offline reads and pending writes.

**Architecture:** PostgreSQL owns acknowledged aggregate snapshots and normalized workouts; each account has a commit-ordered change feed and immutable mutation receipts. SQLite projections/outbox are written atomically and synchronize through a Clerk-authenticated client. Screens retain their local query boundary.

**Tech Stack:** Expo 58, TypeScript, Zod, Drizzle SQLite, FastAPI, Pydantic, SQLAlchemy, PostgreSQL 16, Alembic, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-06-postgres-primary-sync-design.md`.

## Global Constraints

- Never wait for a network request when logging a set; preserve UUIDs, UTC instants, kilograms, notes, and tombstones.
- Partition caches/outboxes by Clerk subject. Backend ownership comes from verified JWT, mapped to existing user UUID.
- Freeze transmitted mutation ID/body/baseVersion across retries; successors inherit their predecessor's acknowledged version, never unrelated feed versions.
- Preserve all pre-existing workspace changes and generated migrations. No automatic upload of unowned legacy global profile/settings.
- No model credentials or shared API keys in mobile; no profile sent to model providers.
- Finish with root `pnpm check`, real database checks where available, and independent review. Report existing failures explicitly.

## Review Focus

- Timeout after server commit must not duplicate an aggregate or completion event.
- New local edits during send must survive acknowledgment and pull.
- Account switch during network response must not apply data or send queued work as another user.
- Stale versions and deletion must not silently overwrite or resurrect sessions.
- Legacy unknown exercise IDs must survive import without publishing untrusted catalog records.

## Shared Interfaces

Root owns `frontend/packages/contracts/src/sync.ts` and shared fixtures. The wire vocabulary below is binding for all implementation lanes.

- `SyncEntityType = 'workout' | 'trainingState' | 'settings'`.
- `SyncMutation = { schemaVersion: 1; mutationId: UUID; entityType; entityId: string; baseVersion: nonnegative integer; operation: 'upsert' | 'delete' | 'importLegacyWorkout'; payload: SyncWorkout | TrainingState | SyncedSettings }`.
- `SyncWorkout`: current `WorkoutSessionSchema` with bounded children and optional `exerciseSnapshot: {name: string; load: 'weight'|'bodyweight'|'time'}` on each exercise. `userId` is the Clerk subject, never the backend UUID. Deleted payloads retain the full snapshot and non-null `deletedAt`.
- `TrainingState = {profileRevisionId: UUID|null; profile: UserProfile|null; plan: LegacyPlanSnapshot|null; onboardingCompletedAt: UTC ISO|null}`.
- `LegacyPlanSnapshot = {id: UUID; kind: 'legacySummary'; calculationVersion: '1'; profileRevisionId: UUID; createdAt: UTC ISO; result: Plan}` using the existing `Plan` fields.
- `SyncedSettings = {unit: 'kg'|'lb'; restSeconds: integer 0..600; demoStyle: 'art'|'photo'; timeZone: IANA name}`.
- `SyncChange = {revision: positive integer; mutationId: UUID; entityType; entityId; version: positive integer; operation: 'upsert'|'delete'; payload: same typed aggregate}`.
- `SyncAck = {mutationId: UUID; change: SyncChange}`; `SyncPage = {changes: SyncChange[]; nextCursor: nonnegative integer; hasMore: boolean}`.
- `entityId` for singleton trainingState/settings is exactly `self`; workout uses its UUID. Only workouts support delete/import. Validate exercise/set IDs and positions are unique within their owning aggregate.
- `409` uses existing error shape with `error.details.current: SyncChange|null`; rejected drafts remain local. Mutation request max 1 MiB; pages max 200.
- `CatalogPage = {revision: string; items: Exercise[]; nextCursor: string|null}`. `GET /exercises?revision=...&cursor=...&limit=...` pins a catalog release.

## Task 1: Contracts and catalog artifact (root)

**Files:** create contracts `sync.ts`, `sync.test.ts`, `fixtures/sync.json`; modify contracts `index.ts`; create mobile `scripts/export-catalog.mts` and backend `data/exercise-catalog.json`.

- [x] Write failing contract tests for entity/payload mismatch, invalid owner/time/unit, duplicate child IDs, illegal singleton deletion, and legacy snapshot compatibility.
- [x] Run contracts Vitest to observe expected failures; implement typed strict schemas and JSON fixtures shared with Python tests.
- [x] Export the existing combined bundled catalog reproducibly without importing device APIs; preserve source IDs and attribution.
- [x] Run contracts tests/typecheck and artifact validation. Fix only demonstrated baseline blockers, preserving unfinished drafts.

## Task 2: PostgreSQL canonical storage and authenticated APIs (backend lane)

**Files:** create `backend/app/schemas/fitness.py`, `db/models/fitness.py`, `repositories/fitness.py`, `services/fitness.py`, `api/routes/v1/fitness.py`, Alembic revision after `0027_user_magic_link_epoch`, catalog import command and focused tests; modify model/router aggregators and users onboarding setter as needed.

**Consumes:** shared wire vocabulary/fixtures. **Produces:** all spec read routes, `POST /sync/mutations`, `GET /sync/changes`, deterministic catalog import.

- [x] Write failing schema/route tests and PostgreSQL transaction tests for receipts, feed ordering, ownership, conflicts, tombstones, unknown legacy references, profile/plan atomicity and progress.
- [x] Implement normalized owned sessions/children, immutable profiles/plans, settings, release-pinned catalog, sync receipts and feed. Lock one account state row until commit; do not use a bare sequence as cursor.
- [x] Implement all read endpoints in the design, bounded pagination, coherent ISO/camelCase aliases, errors, and versioned mutation path. All onboarding changes enter the same feed transaction.
- [x] Run Ruff/pytest and real PostgreSQL upgrade/downgrade/concurrency checks against an isolated test database; record environmental limitations explicitly.

## Task 3: SQLite outbox and local sync repository (mobile data lane)

**Files:** modify mobile `data/db/schema.ts`, `data/workouts.ts`, `data/workout-queries.ts`; create `data/sync/` modules and focused tests; generate new Drizzle migration after accounting for existing draft `0002` without rewriting it.

**Consumes:** shared contracts. **Produces:** `syncRepository` used by root runtime with `prepare(owner): Promise<void>`, `next(owner): SyncMutation|null`, `acknowledge(owner, ack): void`, `applyPage(owner,page): void`, `conflict(owner,mutationId,current): void`, `reject(owner,mutationId,message): void`, `retry(owner): void`, `status(owner): {pending:number;conflicts:number;invalid:number;lastSyncedAt:string|null}`, `listConflicts(owner)` and `resolve(owner,entityType,entityId,choice:'local'|'server')`.

- [x] Use real temporary SQLite (Node 24 `node:sqlite` adapter where needed) to demonstrate failing restart/transaction/ack-race/account-isolation/import tests before implementing.
- [x] Add durable outbox, server shadows/cursor, account projections, frozen send bodies, causal successors, and typed conflict/validation states.
- [x] Make every workout mutation and outbox enqueue atomic; synchronize unfinished discards as tombstones. Scope detail reads and writes to owners. Preserve unknown legacy item snapshots.
- [x] Import existing account-owned workouts once, preserve local-only drafts on failure, and apply pull/acks without overwriting newer edits.
- [x] Generate/validate migrations; test upgrade from existing schema, repeated import, and restoring a fresh cache from feed.

## Task 4: Authenticated client, runtime, account UI integration (root)

**Files:** create `services/api/client.ts`, `services/sync/engine.ts`, `services/sync/SyncProvider.tsx`, `features/sync/SyncStatus.tsx`; modify env/app layout/profile/settings/onboarding/catalog to use account projections through `data/*`.

**Consumes:** contracts, backend routes, and `syncRepository`. **Produces:** running foreground sync and per-account profile/settings/plan views.

- [x] Write failing engine/client tests for timeout/retry, malformed response, 401 pause, foreground restart, and account-switch races.
- [x] Inject `getToken`, fetch, and the repository into a device-independent sync engine. Pull and push with bounded retries; preserve unknown outcomes. Validate all responses.
- [x] Mount auth-bound lifecycle runtime; persist profile/settings acceptance locally with outbox; hydrate only the active account. First uncached account bootstrap needs network; cached accounts continue offline.
- [x] Add meaningful pending/conflict/error/retry controls and explicit legacy-profile ownership confirmation. Allow selecting between multiple open sessions without dropping any.
- [x] Pull revision-pinned catalog via backend; keep bundled offline fallback and media assets. Verify offline manual logging remains responsive.

## Task 5: Verification, documentation, independent review (root + reviewer)

**Files:** update root/frontend instructions, ADR status, setup/recovery guide, environment examples, and test/CI commands only where required.

- [x] Run focused suites and root `pnpm check`. Exercise PostgreSQL concurrency and SQLite crash/restart fixtures, then native/device smoke checks if available.
- [x] Dispatch an independent reviewer with the approved spec, implementation plan, changed-file scope, and actual checks. Fix important findings with regression tests and rerun relevant checks.
- [x] Record completed behavior and limitations. Do not deploy, apply migrations to a user's live database, reset local caches, or commit unrelated workspace drafts.

## Execution ledger

- Approved design and implementation authorization received in conversation.
- Workspace ruling: work in the existing shared checkout, without branch reset/stash/automatic commits; it contains user changes required by this project. User requested implementation here, and an isolated clean checkout would omit those changes.
- Baseline: root check currently stops on formatting in nine existing planner draft files. Domain/contract exports and plan-agent generator drafts also need explicit repair if they block required verification.
- PostgreSQL environment: Docker socket is unavailable to the current account even outside the sandbox; establish an isolated local test instance or report the exact limitation.

## Final verification — November 7, 2026

- Root `pnpm check` passed with the disposable PostgreSQL environment configured: 109 frontend tests and 233 backend tests, 342 total, no skips. This includes the general migration upgrade/downgrade suite on a separate `_test` database.
- Expo SDK 58 web export passed. Native/device and interactive authenticated browser smoke checks remain unverified; the earlier ADB check found no attached device.
- Independent review completed; all important findings were fixed with regressions. See `docs/superpowers/reviews/2026-11-07-postgres-primary-sync.md`.
- Original formatter/export/provider-helper blockers were repaired without deleting tests or hiding planner drafts. No live Gemini integration was added. Existing Pydantic `json_encoders` deprecation warnings remain visible.
- PostgreSQL was tested in a disposable container only. The user explicitly authorized its creation and its later `sudo docker stop liftlog-sync-test-db` cleanup. No application database was migrated or reset.
- Changes remain uncommitted in the existing shared checkout, preserving unrelated user work.
