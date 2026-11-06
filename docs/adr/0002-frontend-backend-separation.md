# 0002: Separate the LiftLog frontend and generated FastAPI backend

Status: accepted

## Context

LiftLog needs the backend foundation from the supplied Full-Stack AI Agent
Template while retaining its Expo application. The source repository is a
Cookiecutter generator and includes an optional Next.js frontend.

## Decision

- Relocate the existing pnpm workspace into `frontend/`, retaining its internal
  `apps/*` and `packages/*` paths, hoisted dependencies, and lockfile.
- Render the source template with its frontend disabled and place the resulting
  FastAPI application in `backend/`. Keep Python dependencies independent of pnpm.
- Use PostgreSQL, SQLAlchemy, Alembic, and the template's default Pydantic AI stack.
- Select delegated JWT/JWKS authentication so the backend can validate tokens
  from the Clerk instance already used by the app.
- Keep root command shortcuts and CI checks for both parts. Store backend secrets
  only in the backend environment.

This supersedes the proposed Node server workspace location in ADR 0001.

## Consequences

Mobile workout logging remains offline-first and retains SQLite as its source
of truth. Merely adding this backend does not implement workout sync, connect
the coach interface, or migrate the existing TypeScript plan-agent draft.

TypeScript boundary schemas stay in `frontend/packages/contracts`. Python APIs
use Pydantic schemas; future API changes must keep the wire formats aligned.
Mobile build and database commands now run from `frontend/` or use
`pnpm --dir frontend --filter ...` from the repository root.
