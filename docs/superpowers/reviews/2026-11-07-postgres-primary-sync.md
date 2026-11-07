# PostgreSQL primary / SQLite cache: implementation review

Reviewed against the approved
[design](../specs/2026-11-06-postgres-primary-sync-design.md) and
[implementation plan](../plans/2026-11-06-postgres-primary-sync.md).

## Result

No important findings remain in the reviewed synchronization implementation.
An independent reviewer traced backend ownership, transaction/receipt/feed
ordering, SQLite outbox and acknowledgment races, shared contracts, account
hydration, import reconciliation, privacy fixes, and catalog packaging. The
reviewer was read-only; execution evidence below was collected by the implementer.

## Findings addressed

| Finding                                                                           | Resolution and regression coverage                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery/resolution lost legacy-import semantics, stranding old unknown exercises | Preserve the import operation and historical snapshots. First import against existing state still conflicts; explicit reconciliation requires the exact current version and a fresh mutation ID. SQLite and real PostgreSQL regressions cover collision, recovery, retry and tombstone protection. |
| Mobile ignored server onboarding resets when the profile and plan were unchanged  | Project onboarding completion separately, notify on timestamp changes, and gate navigation on completion. A real SQLite feed regression checks reset/restore while preserving profile/plan references.                                                                                             |
| Conflict/error diagnostics could log private snapshots or SQL bound values        | Keep conflict details in the authenticated response, omit them from log metadata, omit raw validation input, and hide SQL parameters in primary/worker engines. Privacy regressions verify response behavior and rendered failure logs.                                                            |
| Default backend catalog artifact was ignored by Git                               | Keep the public validated artifact visible while retaining the ignore rule for other backend data. Artifact validation covers seeded/library IDs and credits.                                                                                                                                      |

## Verification on November 7, 2026

- Root `pnpm check`: passed. Frontend: 44 domain + 18 contracts + 45 mobile +
  2 draft-provider tests = 109. Backend: 233. Total: **342 passed**, no skips.
- PostgreSQL 16 ran in an explicitly authorized disposable container. Separate
  `liftlog_sync_test` and `liftlog_migrations_test` databases exercised transaction
  concurrency, rollback, HTTP reads, explicit reconciliation, and full migration
  upgrade/downgrade cycles. No application database was migrated.
- Mobile tests use real temporary SQLite databases for outbox/restart/retry,
  in-flight edits, owner switching, import, fresh-cache restore, and profile/settings.
- Expo SDK 58 web export succeeded at `/tmp/liftlog-sync-web`.
- `git diff --check`: passed.
- Pydantic reports 99 deprecation warnings from the existing `json_encoders`
  configuration during the backend suite. No warnings were suppressed.

## Limits and activation

At the initial review, native/device smoke testing and an interactive
Clerk-authenticated browser flow were not verified. The authenticated web follow-up
below covers local activation; native/device testing remains outstanding.
Pre-existing unrelated authentication/native configuration and unfinished detailed
planner functionality were outside this review.

Configure `EXPO_PUBLIC_API_URL`, database credentials and Clerk JWKS/issuer for the
target environment, then apply Alembic and import the catalog as described in the
[synchronization guide](../../guides/synchronization.md). Pending device edits
are not server-backed until acknowledged. Changes remain in the shared workspace;
this work does not deploy a service or automatically commit unrelated drafts.

## Authenticated web restore follow-up

The first interactive Google sign-in exposed a browser-specific failure before
requests reached the backend: calling native `fetch` as an `ApiClient` method
supplied the wrong receiver. The client now explicitly calls it with `globalThis`.
Temporary diagnostics were removed without changing account storage or the session.

The API regression failed with the observed `Window` receiver error before the
fix. Real SQLite/provider regressions cover signing in, returning from a background
OAuth tab, and pressing **Connect and restore** after a failed first connection.
The user's authenticated `/users/me` and `/sync/changes` requests subsequently
returned HTTP 200, and the user confirmed reaching the next screen.

Independent review found no critical or important issues in this fix. Root
`pnpm check` passes; local checks do not enable the 15 tests requiring dedicated
PostgreSQL test databases. The application database is not used for those tests.

## Web sign-out and launcher follow-up

The profile's sign-out button previously invoked React Native's `Alert.alert`,
which is a no-op in the installed web implementation. On web it now uses browser
confirmation, keeps the warning about unsent changes, and calls Clerk sign-out.
Pending requests disable repeat clicks; failures show a retryable message. Native
confirmation is retained. Five component regressions cover these paths; the web
cases failed before the fix. The user confirmed returning to sign-in, and an
isolated Chromium check rendered sign-in without JavaScript errors.

A second `pnpm dev:web` reproduced `EADDRINUSE` on port 8081 because the local
preview was already running. The launcher follow-up distinguishes its own checkout's
development server from unrelated listeners, so repeated starts can report the
existing URL without terminating another service.

## Web BackHandler follow-up

Onboarding and the set editor registered Android hardware-back listeners on web,
where the installed BackHandler implementation reports an unsupported API error.
Both effects now register only on Android. Six component regressions cover web/iOS
Back and Close controls, Android hardware-back behavior, and listener cleanup. The
four unsupported-platform cases failed before the guards were added; all six pass
afterwards. Independent review found no issues in the scoped fix.

## Shared web confirmations follow-up

Plan updates, workout deletion/discard, exercise removal, and both conflict choices
now use a shared platform-aware confirmation helper. Web uses browser confirmation;
Android/iOS retain native buttons, cancellation, and dismissal. Sign-out uses the
same helper. Failure messages work on web and native, and destructive workout
actions disable repeats while pending. Discard stops its timer only after storage
succeeds. Cancellation never reaches a mutation or navigation action.

The focused suites cover all five flows, retry/error handling, native decisions,
and real temporary SQLite conflict resolution. Cancelled choices preserve the
frozen outbox; failed transactions preserve both versions. Independent review
reported no findings and verified all 35 focused tests. No synchronization protocol,
database schema, or account data was changed by this fix.
