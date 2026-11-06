# Backend instructions

This is the rendered Python backend, not the template generator. Provenance and
setup are recorded in [README.md](README.md).

- Use `uv sync --frozen` for dependencies and `uv run` for backend commands.
- Keep routes in `app/api/routes/v1`, business logic in `app/services`, data
  access in `app/repositories`, and validated boundary models in `app/schemas`.
- Repositories flush; the database session dependency owns transactions.
- Preserve delegated Clerk-compatible JWT/JWKS authentication.
- Model credentials and infrastructure secrets belong only in ignored `.env`
  files or server environment variables.
- Add Alembic migrations for database changes; do not rewrite an applied migration.
- Validate with `uv run ruff check .`, `uv run ruff format --check .`, and
  `uv run pytest` from this directory, or `pnpm check:backend` from the root.
