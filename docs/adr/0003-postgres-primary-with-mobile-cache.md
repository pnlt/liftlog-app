# 0003: PostgreSQL primary storage with a SQLite mobile cache

Status: accepted; implemented and reviewed.

## Context

The user wants the mobile frontend connected to the existing FastAPI backend,
with PostgreSQL replacing SQLite as the primary account database. After comparing
server-side Redis caching with on-device storage, the user selected SQLite for
the mobile cache. Workout logging must continue without waiting for network I/O.

## Decision

- PostgreSQL holds the authoritative, acknowledged account data behind FastAPI.
- SQLite holds account-scoped local projections and durable pending writes.
  An unsynchronized write is saved on its device but is not yet stored on the server.
- Mobile authenticates API requests with Clerk session JWTs. The backend derives
  data ownership from the verified identity and maps it to its existing user UUID.
- Local writes and their pending-sync intent commit atomically. Canonical server
  writes, retry receipts, and pull-feed changes also commit atomically.
- Conflicting offline edits must preserve both versions until reconciled; device
  timestamps alone cannot decide which workout to overwrite.
- Redis is not needed to replace device storage. Server-side caching can be
  introduced independently when backend measurements justify it.

This supersedes only the SQLite-as-authority consequence of
[ADR 0002](0002-frontend-backend-separation.md). Its repository layout, FastAPI,
PostgreSQL, migration tooling, and delegated authentication decisions remain.
The [approved implementation design](../superpowers/specs/2026-11-06-postgres-primary-sync-design.md)
describes the protocol and rollout. Implementation and review evidence are tracked
in the matching implementation plan.

## Consequences

Acknowledged data can be restored across devices and reinstalls. Pending writes
survive an ordinary app restart but may be lost when device storage is removed
before synchronization. The app must distinguish local persistence from server
acknowledgment and handle retries, account switching, deletions, and conflicts.

Preserve existing workout identifiers and generated migrations. Import only data
whose account ownership is known or explicitly confirmed. Do not delete local
records merely because a request fails or an account signs out.

The root/frontend instructions and setup/recovery guides must be updated with
the implementation; their present SQLite-authority wording describes the old
runtime. The user's selected storage direction takes precedence for this work.
