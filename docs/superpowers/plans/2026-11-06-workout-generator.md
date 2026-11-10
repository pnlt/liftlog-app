# Workout Generator Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the tasks below.

**Goal:** Deliver validated workout generation after initial onboarding, using generic Gemini templates and private local personalization. Companion is deferred by the user.

**Architecture:** A Node TypeScript LangGraph/LangChain maintenance workflow generates public templates; mobile personalizes and persists a plan without sending user data to Google. Reuse shared domain/contracts and existing SQLite/content seams.

**Tech Stack:** pnpm, TypeScript, Zod, LangGraph, LangChain Google, Expo 58, Drizzle SQLite.

**Spec:** docs/superpowers/specs/2026-11-06-workout-plan-design.md (latest user instruction overrides companion scope: deferred).

## Global Constraints

- No personal data sent to Gemini; keys remain outside mobile.
- Latest user clarification: no GymMane download; reference it and resolve plans using existing LiftLog catalog IDs.
- No changes to unrelated root native artifacts or root manifest dependencies.
- Preserve workout history. Onboarding must not recur on normal subsequent logins.
- Clearly document cross-device/reinstall persistence limitations if account synchronization is not included; never promise server persistence from local state.
- Use pinned catalog provenance and preserve upstream license notices.
- No fabricated AI-generation evidence; missing credentials must be reported.
- Strict TypeScript, pnpm, meaningful tests, SDK-matched docs before mobile APIs.

## Review Focus

- Restrictions or missing equipment must not be silently ignored.
- Invalid or partial model output must never replace a valid published pack.
- Profile/account changes must not display another user's plan.
- Offline first launch and failed generation must not block manual logging.
- Existing tests/check failures must be distinguished from new failures.

## Task 1: Catalog and planning contracts

- [ ] Inspect current schema and existing bundled catalog; retain its existing provenance and reference GymMane without downloading it.
- [ ] Add failing tests for template schemas, unknown IDs, malformed prescriptions and incomplete planning metadata.
- [ ] Implement shared planning types and validated catalog/template schemas in domain/contracts and content assets.
- [ ] Run focused tests and type checks.

## Task 2: Template agent and private personalizer

- [ ] Add failing tests for repair limits, publication atomicity and provider input allowlisting using a fake model.
- [ ] Implement Node workspace with LangGraph generation/validation/one repair, LangChain Google adapter and explicit environment configuration.
- [ ] Implement deterministic local planner with equipment, movement exclusions, time and experience checks; tests cover each rejection and valid representative plans.
- [ ] Include honestly labeled deterministic fallback; verify actual Google integration only if credentials exist.
- [ ] Add runnable commands and agent setup/use documentation.

## Task 3: Mobile onboarding and saved plan

- [ ] Extend onboarding equipment/restriction inputs with strict schemas.
- [ ] Persist user-scoped onboarding completion and generated plan; preserve existing workout records and add generated migrations as needed.
- [ ] Replace current workout summary with saved generated plan; keep manual logging available for unavailable results.
- [ ] Avoid re-onboarding on normal later sign-ins; defer companion and do not introduce a repeat-onboarding plan adjustment flow.
- [ ] Test persistence/account isolation and planner UI data adapters; verify feasible device/runtime behavior.

## Task 4: Verification and review

- [ ] Format only changed files and run focused tests plus pnpm check.
- [ ] Review implementation against requirements with an independent reviewer and fix important findings.
- [ ] Report actual validation, credentials or native environment limitations, and local-only persistence limits.
