# AGENTS.md

Setup and commands: [README.md](README.md).

## Repository layout

- `frontend/` contains the existing LiftLog pnpm monorepo. Follow
  [frontend/AGENTS.md](frontend/AGENTS.md) for mobile, domain, and contracts changes.
- `backend/` contains the FastAPI/Python backend generated from the local
  Full-Stack AI Agent Template. Follow [backend/AGENTS.md](backend/AGENTS.md).
- Root files coordinate CI, Docker Compose, documentation, and command shortcuts.

## Boundaries

- SQLite remains the mobile source of truth; network calls must not block set logging.
- Frontend API clients belong in `frontend/apps/mobile/src/services/api/` and
  authenticate using Clerk session JWTs from `useAuth().getToken()`.
- Backend validates external JWTs through the configured public JWKS endpoint.
  Never ship backend API keys or model credentials in the mobile bundle.
- Python boundary models use Pydantic; TypeScript boundary schemas use
  `frontend/packages/contracts`. Changes to an API must keep both sides aligned.
- Keep pnpm dependencies and its lockfile in `frontend/`, Python dependencies
  and `uv.lock` in `backend/`. Use pnpm for JavaScript and uv for Python.
- Preserve generated SQLite migrations and add new migrations for schema changes.
- Use Conventional Commits with lowercase titles and one logical change per commit.
- Run `pnpm check` from the repository root before declaring work done. Report
  existing failures explicitly; do not delete tests, suppress errors, or hide drafts.

## Expo

Before touching Expo, EAS, or React Native APIs, read the `expo` major in
`frontend/apps/mobile/package.json` and consult the matching version at
`https://docs.expo.dev/versions/v<major>.0.0/` and `https://docs.expo.dev/llms.txt`.
