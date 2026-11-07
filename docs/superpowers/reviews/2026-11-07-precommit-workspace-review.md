# Workspace checkpoint review — November 7, 2026

The user requested inspection of the current branch and all local changes, moving
the changes to another branch, and committing them. The starting branch was
`main` at `f799cbc`; the checkpoint branch is `feature/backend-and-offline-sync`.
This report records the review of that existing work. The findings below remain
open in the checkpoint; it is not an approval to merge or deploy.

## Coverage

The staged snapshot before this report contained 662 changed paths. Review covered
the frontend/backend reorganization, generated FastAPI application, account sync,
SQLite and Alembic migrations, catalog, web/authentication changes, domain and
boundary packages, planning drafts, dependency manifests/lockfiles, CI, Compose,
ownership rules, and documentation.

Three read-only reviewers examined backend, mobile, and shared/package scopes;
the coordinating reviewer examined repository configuration, documentation,
preservation, and the reported findings. Pure moves were compared by Git blob
identity. All 409 expected frontend relocation targets are present; 353 retain
identical blobs. Original SQLite SQL migrations and snapshots are preserved.
Generated catalog and lockfile content was checked structurally, including catalog
IDs/attribution and dependency importer/resolution consistency.

No critical or important findings were confirmed in mobile sync or the shared
packages. The TypeScript planner/provider work and newer Gemini/calendar designs
remain drafts; this checkpoint does not claim those features are implemented.

## Open findings

1. **P1 — Message pagination bypasses conversation ownership.**
   `backend/app/services/conversation.py:393` calls
   `get_conversation(conversation_id)` without the supplied `user_id`.
   The authenticated `GET /conversations/{conversation_id}/messages` route passes
   the caller's identity, but the service uses it only for ratings. A non-owner
   who knows another conversation UUID can read its messages and tool traces even
   though the direct conversation endpoint denies access. Pass the caller into
   the access check and cover the route/service with a non-owner regression.

2. **P1 — View-only sharing permits destructive conversation writes.**
   `backend/app/services/conversation.py:329` uses the general read-access guard
   before deletion. That guard permits any share, including `view`. The same
   pattern affects update and archive. A view-only recipient can delete the
   owner's conversation and all messages, or alter/archive it. Enforce distinct
   write permissions; destructive deletion should follow an explicit ownership
   policy. Test owner, edit-share, view-share, and unrelated callers separately.

3. **P1 — Attachment loading omits account ownership.**
   `backend/app/services/agent_session.py:261` passes client-supplied file IDs into
   `ConversationService.list_attached_files`, which delegates to an ID-only query
   in `backend/app/repositories/chat_file.py:26`. It does not pass the authenticated
   user. A caller who knows another account's file UUID can cause private parsed
   text or image content to enter their model request. Scope attachment retrieval
   and linking to the current account, and reject foreign file IDs before model
   execution or message association.

4. **P1 — Ordinary conversation updates can publish public demos.**
   `backend/app/schemas/conversation.py:133` exposes `is_demo` on the update model
   used by the ordinary authenticated PATCH route. The service applies it without
   an administrator check. A non-admin owner, and currently even a view-only share
   recipient, can set `is_demo=true`; public demo reads then expose the messages.
   Restrict demo curation to the administrator boundary and reject this field on
   ordinary updates. Fixing share write permissions alone does not fix the
   non-admin owner's bypass.

5. **P2 — Public share responses fail the declared response schema.**
   `backend/app/api/routes/v1/conversations.py:84` declares
   `ConversationReadWithMessages`, but
   `backend/app/services/conversation_share.py:149` returns an envelope containing
   `conversation` and `share`. A valid token therefore produces response
   validation errors for missing top-level conversation fields. Align the route
   response model with the intended envelope and test a valid public-share read.

These are defects in the generated backend included by this snapshot; they were
not introduced by the branch/commit operation. Isolated reproductions imported
the actual services and mocked repository I/O. They demonstrated all five
failures without changing the checkout or contacting a model provider.

Documentation also needs follow-up: `docs/guides/build-and-run.md` still says the
mobile test command only prints a message, presents the frontend-only command as
the full quality gate, omits the API URL from its setup table, and contains stale
Sanity activation guidance. The root README and synchronization guide describe
the current required backend connection more accurately.

## Verification

- Root `pnpm check` passed: formatting, TypeScript, lint, 162 frontend tests,
  backend Ruff checks, and 218 backend tests. Backend results included 15 skipped
  PostgreSQL/migration tests and 99 existing Pydantic deprecation warnings.
- The mobile reviewer independently ran all 98 mobile tests successfully.
- All three Compose configurations passed `docker compose ... config --quiet`.
- `git diff --cached --check` passed. No credential-pattern matches or private
  environment files were found in the staged snapshot.
- Local links in all 18 changed root/documentation Markdown files resolved.
- In an isolated temporary contracts copy, 14 sync tests passed. Inverting the
  deletion-tombstone guard caused two tests to fail, confirming relevant coverage.
- All five backend reproductions were independently rerun successfully.

The PostgreSQL-specific tests were not rerun against an isolated database in this
session: the required test database configuration was absent, and Docker socket
access was denied even outside the sandbox. Earlier sync-review evidence is
preserved separately. Native/device behavior, live OAuth/model integration,
production deployment, and dependency vulnerability status were not certified.
