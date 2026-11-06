# Frontend and Backend Separation Implementation Plan

> Execute each task in the current session and verify each completed slice.

**Goal:** Place LiftLog in `frontend/` and its generated FastAPI backend in `backend/`.

**Architecture:** Preserve LiftLog's internal pnpm layout. Render a backend-only
project from the provided local template and retain its runtime and test files.
Root commands and CI operate the two independent dependency environments.

**Tech stack:** Existing Expo SDK 58/pnpm workspace; Python/FastAPI, PostgreSQL,
SQLAlchemy, Alembic, Pydantic AI, uv.

**Spec:** `docs/superpowers/specs/2026-11-06-frontend-backend-design.md`

## Constraints and review focus

- Preserve existing tracked files and uncommitted drafts; never rewrite generated migrations.
- Keep hoisted frontend dependencies and relative imports intact.
- Preserve mobile Clerk sign-in and offline SQLite behavior.
- Keep backend-only secrets out of frontend configuration.
- Update CI, code owners, format rules, and development instructions for the new paths.

## Task 1: Preserve and relocate the frontend

- [x] Capture file hashes and the baseline check result.
- [x] Move apps, packages, frontend configuration, dependency files, and local artifacts under `frontend/`.
- [x] Add root command shortcuts and update path-dependent tooling.
- [x] Verify moved source hashes and workspace resolution.

## Task 2: Generate the backend

- [x] Render the local template with no Next.js frontend, delegated JWT/JWKS auth,
      PostgreSQL, and the default AI framework/provider.
- [x] Add the generated backend, original license, generation provenance, and environment example.
- [x] Generate the Python lockfile; run backend lint, format, and tests.
- [x] Validate migrations and Compose configuration.

## Task 3: Document and verify the combined repository

- [x] Update root/frontend/backend instructions, architecture records, CI, and code owners.
- [x] Run `pnpm check` and focused frontend/backend checks.
- [x] Review the diff and preservation report; document outstanding pre-existing draft failures.

## Verification results

- All 416 frontend source and asset files in the preservation inventory retain
  their original SHA-256 hashes, including the uncommitted planning drafts.
- Shared repository formatting and mobile ESLint pass.
- Domain tests: 42 passed; existing contracts tests: 3 passed. The unfinished
  planning suite fails on missing domain exports, as it did before relocation.
- `pnpm check:backend`: Ruff lint and formatting pass; 190 tests pass, and 4
  database migration tests are skipped without an explicit disposable test DB.
- `pnpm check`: shared formatting passes, then frontend formatting reports the
  9 existing planning draft files. Separate typecheck/lint runs confirm missing
  planning exports and `acceptedPlans` in those unchanged drafts.
- All three Docker Compose configurations validate; Alembic resolves one head.
  Live database migration cycles and native mobile builds were not run.
- Independent review identified and resolved production outbound networking,
  Clerk JWTs without email, and destructive migration tests using the app DB.
  Clerk and migration safety fixes have regression tests observed failing before
  the fixes and passing afterward.
