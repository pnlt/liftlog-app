# Frontend and backend separation

The requested layout places the existing LiftLog application in `frontend/`
and a generated backend from the local Full-Stack AI Agent Template in `backend/`.
This is a repository reorganization, not a change to workout logging or its UI.

## Structure

- `frontend/` owns the existing pnpm workspace, including `apps/mobile`,
  `packages/domain`, `packages/contracts`, and existing `apps/plan-agent` drafts.
- `backend/` owns the rendered FastAPI application, CLI, Alembic migrations,
  Python dependencies, and tests.
- Root documentation, CI, ownership rules, Docker Compose, and command shortcuts
  describe and operate both parts.

## Implementation choices

Render the source template using its generator rather than copying unresolved
Jinja files or the generator itself. Keep its default Pydantic AI/OpenAI stack
and PostgreSQL storage. Select delegated JWKS authentication to accommodate the
existing Clerk sign-in. Leave optional queues, RAG, and telemetry disabled.
These backend defaults are implementation choices and can be configured later.

Preserve all existing source, assets, generated SQLite migrations, and uncommitted
drafts. Keep device SQLite authoritative and leave the existing app behavior intact.
Do not copy the template's Next.js frontend. Keep secrets in ignored `.env` files.

## Validation

Check file preservation, frontend workspace resolution, type checks, lint,
existing tests, backend lint/format/tests, Alembic migration ordering, and Docker
Compose configuration. Run `pnpm check` from the repository root and report any
pre-existing draft failures separately from regressions.
