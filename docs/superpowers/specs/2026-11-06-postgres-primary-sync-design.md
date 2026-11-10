# PostgreSQL primary storage with a SQLite mobile cache

Status: implementation design approved by the user; implementation tracked in the matching plan.

## Intent and confirmed decisions

Connect the existing LiftLog mobile frontend to FastAPI and make PostgreSQL the
authoritative account database. The user selected SQLite for the on-device cache.
Continue logging sets without waiting for a network request. A local write is
durable on that device; only a server acknowledgment means it is persisted on
the server and available to another device. Reinstalling before synchronization can lose pending
changes. Redis is not required for this migration.

The primary-database decision supersedes the SQLite-authority wording in root
`AGENTS.md`, `frontend/AGENTS.md`, and ADR 0002. Preserve their no-blocking-network
requirement. ADR 0003 records the accepted storage direction. Update those
instructions when implementing the approved design; retain the historical ADRs.

Only the storage direction and offline cache were explicitly selected. Conflict
handling, protocol details, and rollout below are proposed engineering decisions.

## Approaches

1. **PostgreSQL with durable SQLite cache/outbox — selected.** FastAPI validates
   canonical writes; screens use local projections plus pending edits. This keeps
   offline logging and requires explicit retry and conflict handling.
2. **PostgreSQL with online-only mobile writes.** Simpler synchronization, but a
   disconnected phone cannot safely save a set to the server. Not selected.
3. **PostgreSQL with Redis caching.** Can reduce backend reads, but a remote Redis
   server does not store a disconnected phone's pending writes. It can be added
   independently after measurements justify it.

## Current code and scope

- `apps/mobile/src/data/workouts.ts` writes sessions and children in SQLite;
  `workout-queries.ts` supplies live queries to workout, history, and Today screens.
- `services/events.ts` is an in-memory event bus. Only workout completion is
  emitted; it cannot be the durable transport for all changes.
- Profile/settings use global Zustand storage keys. Their legacy ownership is
  unknown, whereas workout rows already contain a Clerk user ID.
- Catalog content merges `seed.ts` and `library.json`, with optional Sanity
  updates. Preserve both sets of IDs and their attribution.
- FastAPI already has PostgreSQL, SQLAlchemy, Alembic, Clerk JWT/JWKS validation,
  `users.external_user_id`, and `/api/v1/users/me`. Fitness models do not exist.
- `data/plans.ts`, `SavedPlan.tsx`, planning contracts, and `apps/plan-agent` are
  unfinished drafts in this checkout. Do not overwrite them or pretend they work.

In scope: account bootstrap, profile/onboarding, accepted plan persistence,
settings, catalog delivery, active/finished workouts, history/deletion, progress
queries, synchronization, and import of existing local workouts.

Not in scope: building the Gemini generator, chat coach, rewards, subscriptions,
Redis infrastructure, collaborative editing, attachments, or automatic population
of a workout from a plan. Existing local planning remains local; saving a profile
to PostgreSQL does not authorize sending it to an AI provider.

## Ownership and storage

Mobile calls FastAPI with a fresh token supplied by `useAuth().getToken()`.
FastAPI resolves the caller through the existing verified JWT subject. The server
derives ownership; a request body cannot choose another user. Local partitions
use the Clerk subject; server foreign keys use the existing PostgreSQL user UUID.
Keep an explicit mapping after account bootstrap rather than changing legacy IDs.

Proposed PostgreSQL entities:

| Entity                                                  | Purpose                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| Existing `users`                                        | Identity mapping and onboarding completion                            |
| `profile_revisions`                                     | Immutable validated training-profile revisions                        |
| `training_plans`                                        | Immutable accepted plan snapshots tied to a profile revision          |
| `training_state`                                        | One versioned aggregate per user with current profile/plan pointers   |
| `user_settings`                                         | Versioned unit, rest duration, demo preference, and display time zone |
| `exercises` and catalog releases                        | Canonical public catalog with stable exercise IDs                     |
| `workout_sessions`, `workout_exercises`, `workout_sets` | Owned sessions and ordered children                                   |
| `user_sync_state`, `sync_changes`, `sync_mutations`     | Ordered change feed and retry receipts                                |

Session child ownership is inherited through foreign keys and checked through
the authenticated session owner. Do not allow child IDs to be reassigned between
sessions through an incoming snapshot. Preserve UUIDs, kilograms, nullable loads,
warmups, positions, notes, timestamps, and the current timed-exercise convention.
Use UTC timestamps in storage and explicit display time zones for weekly stats.

SQLite keeps catalog records, account-scoped session/profile/plan/settings
projections, server-version metadata, a durable `sync_outbox`, conflicts, and a
per-account pull cursor. Keep the existing Drizzle/query boundary. Pending writes
and conflicts are never evicted as ordinary cache entries. Keep all synchronized
workouts locally in v1; no TTL or partial-history eviction is introduced.

Rest timers, editor state, animations, tokens, and bundled media remain device
state. Account settings are distinct from an individual running rest timer.

## Atomic local writes and synchronization

Each user action writes the local projection and an outbox intent in the same
SQLite transaction. This includes set edits, removal of children, completion,
notes, profile/settings changes, and session deletion. An event-bus notification
may wake the worker after commit, but the outbox is the recovery mechanism.

Use three versioned aggregate types: `workout`, `trainingState`, and `settings`.
A workout mutation carries the full session and children, matching the existing
workout contract's aggregate boundary. Training-state acceptance atomically writes
a profile revision, optional plan snapshot, active pointers, and onboarding state.

The worker sends one mutation at a time for each aggregate. It may coalesce edits
only while an intent has never been sent. Before first transmission, persist an
immutable mutation ID, base server version, body, and local revision. Once sent,
every retry uses exactly that ID and body, even after a timeout or process restart.
Later local edits remain a successor intent tied to the predecessor they edited.
Its base becomes that predecessor's acknowledged version, never the newest
observed version from an unrelated remote change. Persist this lineage separately
from the latest server version observed by pull. For example, if its predecessor
commits version 2 and another device commits version 3, the successor still
expects version 2 and must conflict; it cannot silently relabel its stale body as
based on version 3. Only explicit reconciliation can create a new intent based
on version 3. Feed entries include the originating mutation ID so own echoes can
be distinguished from unrelated writes.

The server transaction locks the caller's sync-state row, checks a unique
`(user_id, mutation_id)` receipt, validates the body and expected aggregate
version, updates the aggregate, appends its canonical change, and stores its
receipt. Mutation receipt, canonical state, and feed entry commit together.
A repeated ID/body returns the original result; the same ID with another body is
rejected. Do not use a non-atomic check-then-insert as the duplicate guard.

Each accepted aggregate write increments its server version. Feed revisions are
separate per-user integers allocated while holding the same per-user row lock
until transaction end. This orders commits for that user's feed. A plain sequence
or client `updatedAt` must not be used as a lossless synchronization cursor.
All routes that change synchronized fields, including the existing onboarding
setter, must use this write path. Different users do not share the lock.

An acknowledgment removes only its own outbox intent. Replace the visible local
projection only if no newer local revision exists. Otherwise preserve the newer
edits and advance only the confirmed server metadata. An older acknowledgment
must never roll back a version already observed from the feed.

Pull pages apply changes and advance their cursor in one SQLite transaction.
Ignore already-applied versions. Do not overwrite a dirty local projection;
retain the incoming server snapshot for reconciliation. Keep feed history and
deletion tombstones in v1, so long-offline devices can resume from their cursor.
Any later retention policy requires a full-resynchronization protocol first.

## Conflicts and lifecycle

Use optimistic version checks instead of trusting the phone's wall clock. A stale
base version returns `409` with the current version/snapshot. Never silently
replace one device's workout with another device's stale full-session snapshot.
Persist both versions and stop sending only the affected aggregate. Let the user
keep the server version or explicitly submit the local version against the latest
version. A remote-deleted session cannot be resurrected under its old ID; keeping
its local contents creates a new session after an explicit recovery action.

Two offline devices may start distinct sessions. Preserve both IDs and let the
user select which session to resume when more than one is open; do not discard a
session or claim globally unique offline activity. Simultaneous edits to one
session use the same conflict flow. In particular, the current hard-delete
assumption for discarded unfinished sessions must change once active sessions
can reach the server: discards become synchronized tombstones too.

Start/resume synchronization on signed-in app launch, foreground/resume, a local
write, and a manual retry. Use bounded foreground retry with backoff and jitter.
OS background execution is optional and must not be required for correctness.
Network errors/5xx keep intents queued; authentication failure pauses until a
usable session token exists; validation failures retain the rejected draft and
show an actionable failure. A new or previously uncached account needs online
bootstrap before its remote onboarding status is known.

On account change, abort requests and workers, reset in-memory views, and open only
the new account's partition/cursor. Verify the request's captured owner again
before applying a response. Keep unsent writes with their original owner for a
future login. Apply user ownership checks to detail queries as well as lists.

## APIs and shared boundaries

All paths below are under `/api/v1`. These are proposed contracts, not claims
that the endpoints exist. Request/response schemas belong in Pydantic and
`frontend/packages/contracts`; contract tests use the same JSON fixtures.

| API                                                      | Behavior                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /users/me`                                          | Existing authenticated account bootstrap                       |
| `GET /users/me/training-state`                           | Current onboarding/profile/accepted plan and aggregate version |
| `GET /users/me/settings`                                 | Canonical settings and aggregate version                       |
| `GET /training-plans` and `GET /training-plans/{id}`     | Owned immutable plan history                                   |
| `GET /exercises` and `GET /exercises/{id}`               | Versioned public catalog, filters, bounded pages               |
| `GET /workouts` and `GET /workouts/{id}`                 | Owned history/open sessions and full snapshots                 |
| `GET /users/me/stats` and `GET /exercises/{id}/progress` | Canonical aggregates/progress with explicit time zone          |
| `POST /sync/mutations`                                   | One bounded, versioned aggregate mutation per request          |
| `GET /sync/changes?cursor=...&limit=...`                 | Ordered account changes and next cursor                        |

All fitness writes use the mutation endpoint so retry/version rules are shared.
The envelope contains `schemaVersion`, `mutationId`, `entityType`, `entityId`,
`baseVersion`, `operation`, and a typed payload. It does not trust client-supplied
ownership or canonical server versions. Define explicit size bounds in the
contracts; pages cap at 200 items. Existing structured backend errors remain the
error format; normalize validation errors consistently. Reject oversized/unknown
payloads without losing the local draft.

Use camelCase wire fields for the new LiftLog contracts with explicit Pydantic
aliases; do not silently change existing template APIs' snake_case fields.
Serialize instants as UTC ISO strings accepted by the existing Zod contracts.

Mobile screens continue using local queries. Hydrate them from canonical server
changes and pending actions, so offline Today/history/progress remain useful.
Server statistics are derived from PostgreSQL, not separately mutable totals.
Local statistics must use the full cached history, including pending edits,
rather than the current 200-row display limit. Do not combine a server total
with pending changes without a defined revision boundary.

## Catalog and plan compatibility

Create a reproducible importer from the current bundled seed plus library. It
must preserve all IDs, URLs, and attribution; validate before publishing an atomic
catalog release. Pin a catalog revision across paginated reads. Keep referenced
retired exercises available so older/offline clients can still synchronize.
Sanity becomes an optional backend import source, not an independent mobile
writer that can override canonical catalog data. Bundled content remains the
offline startup fallback.

Legacy SQLite/Sanity exercise IDs may be absent even from that combined catalog.
Preserve them using an explicit `importLegacyWorkout` mutation operation, including
a validated per-workout exercise snapshot from the local cache when available.
`workout_exercises.exercise_id` retains the original string; a separate nullable
`catalog_exercise_id` references a known catalog record. An unknown ID never
creates or changes a public catalog exercise. Persist the display-name/load
snapshot on that workout item, show it in restored history, and provide the
original ID as a fallback when metadata is missing. Catalog details may remain
unavailable. Existing unresolved items can be edited within their original
workout; newly added items must resolve to the canonical catalog. Contracts and
server validation distinguish legacy import from ordinary writes. This preserves
historical sessions without depending on access to a past Sanity revision.

Persist the existing calculated `Plan` as an explicitly tagged `legacySummary`
snapshot with schema version, profile revision, and calculation version. Add its
boundary validation without claiming it is a detailed exercise schedule. A later
completed planner may introduce another validated snapshot kind. This migration
does not finish or depend on the detailed draft planning implementation.
The first sync version uses the current exported `UserProfileSchema`; extending
it with the unfinished planner's equipment/restriction fields belongs to that
feature's separately validated contract, not an implicit migration dependency.
Profile/plan changes use a draft until acceptance; cancellation must not clear
the last accepted profile. Mark onboarding complete in the same canonical
transaction as the accepted training state.

## Existing-data migration and rollout

1. Add PostgreSQL models/Alembic migrations and SQLite cache/outbox migrations.
   Preserve applied/generated migrations; do not rewrite or remove them.
2. Seed a validated catalog compatible with all bundled IDs before workout import.
   Add contracts, authenticated client configuration, and the sync worker.
3. For each signed-in Clerk subject, enqueue that subject's existing sessions,
   including unfinished sessions and deletion tombstones, using preserved IDs.
   Import through the same retry-safe mutation protocol, with the legacy import
   operation for sessions. Record a local import checkpoint;
   retries and app restarts must not duplicate records. A nonempty server record
   with the same ID requires comparison/conflict handling, not blind replacement.
4. Legacy global profile/settings cannot be attributed to an account. Keep them
   out of automatic uploads. Show them only in an explicit ownership-confirmation
   flow before adopting them; otherwise reconfirm inputs. Prefer an existing
   server profile after bootstrap. No later routine login repeats this migration.
5. Compare imported session/exercise/set counts, field values, timestamps, and
   deletions before marking a partition imported. Acknowledged server state must
   rehydrate on a fresh installation. Pending/conflicted local records remain.
6. Enable the new path only after the matching server is ready. A rollback stops
   synchronization and retains both PostgreSQL data and the SQLite outbox. It
   must never fall back to destructive cache reset or claim queued data is backed
   up. Back up PostgreSQL before applying migrations; test schema rollback on an
   isolated database. Update repository instructions, ADR, setup, and recovery docs.

## Verification and completion criteria

- Real PostgreSQL integration tests cover concurrent retries, atomic receipts,
  version conflicts, ordered feed commits, ownership, rollback, and tombstones.
  Mock-only API tests do not prove these guarantees.
- Sync tests cover process death before send/after server commit/before local ack,
  editing during an in-flight request, successor intents, feed/ack races, cursor
  pagination, invalid payloads, and long offline reconnects.
- SQLite migration/import tests cover historical fields/IDs, repeat imports,
  unfinished sessions, missing catalog references, global legacy ownership, and
  switching accounts while a response is in flight.
- End-to-end checks cover offline logging/restart, foreground synchronization,
  another-device restore, concurrent-edit recovery, onboarding/plan acceptance,
  settings, history deletion, and stats including explicit week/time-zone cases.
- Read SDK 58 Expo docs before implementing device APIs; verify native behavior
  on an actual available device/emulator. Report unavailable runtime checks.
- Run root `pnpm check` and relevant backend/frontend integration tests. Existing
  checkout failures must be reported separately and never suppressed/deleted.

Observed baseline: root `pnpm check` stopped on nine draft files' formatting in
the preceding audit. Separate frontend typecheck/tests failed on missing planner
exports. Recheck before implementation; preserve concurrent user changes and
address necessary blockers explicitly rather than hiding the drafts.

## Sources and implementation latitude

- [Expo SDK 58 SQLite](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/): device
  persistence and transaction API reference. Also consult the required
  [Expo LLM index](https://docs.expo.dev/llms.txt).
- [Expo SDK 58 BackgroundTask](https://docs.expo.dev/versions/v58.0.0/sdk/background-task/):
  scheduling constraints; this design does not require prompt background runs.
- [Clerk Expo useAuth](https://clerk.com/docs/expo/reference/hooks/use-auth):
  authenticated requests through the existing session-token boundary.
- [PostgreSQL 16 explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html):
  row locks for serializing each account's canonical sync writes.

Exact module splits, index names, retry intervals, and request-byte limits are
left to implementation planning. They must preserve the transaction, ownership,
version, and recovery guarantees above. This is a multi-slice feature, not a
single schema swap; no product implementation is included in this document.
