# 0001: pnpm monorepo with pure domain and contracts packages

Status: accepted

## Context

LiftLog is built by several people with separate lanes: mobile UI and motion, backend and gamification, AI coaching. Training rules (plans, progression, e1RM, stats) and the data shapes exchanged between app, CMS and a future server must be shared without each side copying them, and must be testable without a device.

## Decision

- One pnpm workspace: `apps/*` for deployables, `packages/*` for shared code.
- `packages/domain` is pure TypeScript with no React Native, I/O or runtime dependencies, tested with vitest.
- `packages/contracts` holds zod schemas for every boundary (SQLite rows, CMS documents, events, future API payloads). It depends only on `zod` and domain types.
- Packages are consumed as TypeScript source (`main: ./src/index.ts`). Metro and `tsc` compile them directly; there is no build step or publishing.
- `nodeLinker: hoisted`, because React Native, Expo autolinking and Metro still assume a flat `node_modules`.
- A backend, when added, is a new `apps/<name>` workspace importing `@liftlog/contracts`.

## Consequences

- Domain logic and schemas change in one pull request together with their callers, and CI typechecks every consumer.
- Hoisting gives up pnpm's strict dependency isolation: a package can import something it did not declare. Declare every import in the package's own `package.json`.
- Shared packages must stay runtime-agnostic so a Node backend can use them.
