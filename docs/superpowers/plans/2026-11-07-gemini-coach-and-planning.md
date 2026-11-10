# Gemini Coach and Personalized Planning Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for implementation, or
> `superpowers:subagent-driven-development` only if that execution method is explicitly selected.
> Execute one task at a time and verify its deliverable before continuing.

**Goal:** Connect personalized Gemini workout planning and text coaching to the existing Expo app,
with preview/acceptance, synchronized plan snapshots, offline workout logging and server-only credentials.

**Architecture:** Reuse FastAPI and Pydantic AI with a Google provider configured by `GEMINI_API_KEY`.
PostgreSQL jobs and a worker handle bounded model calls; FE polls typed results through Clerk-authenticated
HTTP. Plan activation remains a SQLite projection/outbox transaction followed by versioned sync.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic AI Google extra, PostgreSQL/SQLAlchemy/Alembic;
Expo SDK 58, React Native, TypeScript, Zod, Zustand, Drizzle/expo-sqlite, pnpm and uv.

**Spec:** [Gemini coach and planning design](../specs/2026-11-07-gemini-coach-and-planning-design.md).

**Status:** Planning deliverable only. The user selected per-user Gemini personalization through the
backend. Library/runtime choices and numerical operational limits are proposals ready for review.

## Global constraints

- `GEMINI_API_KEY` belongs only to backend environment configuration; never use an `EXPO_PUBLIC_` key.
- Clerk session JWTs authenticate FE requests; backend resolves account ownership through JWKS.
- PostgreSQL is authoritative for acknowledged data; SQLite is the durable offline cache/outbox.
- Commit every local mutation and its outbox intent atomically. Never change a transmitted body.
- Add migrations; preserve applied Alembic and generated SQLite migrations.
- Keep Python dependencies/lockfile in `backend/`, pnpm dependencies/lockfile in `frontend/`.
- Adult eligibility, AI-specific consent and a compliant deployment precede personal model inputs.
- Preserve the `starter-1` programming limits until a separately reviewed policy expands them.
- Maximum three provider calls/run, one semantic repair, 30 seconds/call and a 90-second run deadline.
- Read SDK 58 Expo docs and `https://docs.expo.dev/llms.txt` before Expo/React Native implementation.
- Use the actual current `@myos/*` manifests; do not mix older `@liftlog/*` examples into new imports.
- Preserve unrelated uncommitted work. One logical change per Conventional Commit, if commits are requested.
- Root `pnpm check` is the completion gate; report pre-existing failures without suppressing them.

## Review focus

1. Account switch during a model call: results, drafts and messages remain isolated by owner (Tasks 4, 6, 9).
2. Profile changes or a second device accepts another plan: stale drafts cannot silently activate (Tasks 2, 7).
3. Worker crash after Gemini returns: lease recovery cannot duplicate messages or active plans (Task 4).
4. Legacy outbox remains unsent during upgrade: v1 bodies/IDs survive and v2 data fails explicitly on old clients (Task 2).
5. Small screens, keyboard-open states and offline restart: a saved plan and logging remain usable (Tasks 7–10).

## Ordered tasks

Each task follows red/green: add its named failing tests, run its focused command to observe failure,
implement the specified interface, then rerun to pass. Test names/assertions below are acceptance
requirements, not implementation-mirroring tests. Document any existing failure separately.

### Task 1: Define shared AI and plan boundaries

**Files:** Create `frontend/packages/contracts/src/ai.ts`, `ai.test.ts`,
`backend/app/schemas/ai.py`, `backend/tests/test_ai_schemas.py`; extend contract exports and add shared
fixtures under `frontend/packages/contracts/fixtures/ai/`.

**Interfaces:** Define `AiCapabilities`, `AiConsent`, `GeneratePlanRequest`, `CoachTurnRequest`,
`AiRunStatus`, `AiRunResponse`, `AiWorkoutPlanV1`, `AiPlanSnapshot`, `CoachReply`, `CoachMessagePage` and
their Pydantic/camelCase equivalents. `AiRunResponse` is discriminated by status and result kind;
`CoachReply` is `reply | planProposal` as specified. `requestId` and all run/draft/thread IDs are UUIDs.
`AdjustmentIntent` is strict `{reason: initial | variety | progressReview | userRequested,
avoidExerciseIds: string[]}` with at most four unique current-plan IDs. Cap rationale at 2,000
characters and coach response text at 4,000; plan/coach provider output caps are 4,096/1,024 tokens.

- [ ] Add `test_ai_fixture_parity`: the same valid/invalid JSON fixtures produce the same decisions in
      Python and Zod; status payloads cannot mix an error with a succeeded result.
- [ ] Add `test_reject_client_identity_and_prompt`: input forbids `userId`, model, key, system messages
      and arbitrary history. Reject text over 2,000 characters and unknown adjustment-intent fields.
- [ ] Add `test_output_and_intent_bounds`: reject oversized rationale/reply and duplicate, unknown or
      more than four avoided exercise IDs; truncated provider output never becomes a ready result.
- [ ] Implement boundaries with explicit version/provenance fields and export TS types.
- [ ] Verify: `pnpm --dir frontend --filter @myos/contracts test` and
      `uv run --directory backend pytest tests/test_ai_schemas.py -q`.

### Task 2: Introduce synchronized plan/profile v2 without losing v1 writes

**Files:** Extend `frontend/packages/contracts/src/sync.ts`, `backend/app/schemas/fitness.py`, both
fitness/sync repositories and route readers. Add
`frontend/apps/mobile/src/data/sync/plans.ts`, an Alembic migration
and a generated SQLite migration if new persisted columns/tables are required.

**Interfaces:** `TrainingStateV2` uses confirmed planning preferences and a plan union that includes
`legacySummary` and `aiWorkoutPlanV1`. `saveAcceptedAiPlan(owner, draft, expectedProfileRevisionId)`
persists its projection and an immutable `schemaVersion: 2` outbox mutation. Both server sync readers
take `schemaVersion: 1 | 2 = 1`; mutation ingestion accepts v1 and v2. Version the `/training-plans`
list/detail readers in the same way.
`planApplicability` is `none | current | needsReview`; only `needsReview` permits an old snapshot
revision. Every persisted profile edit creates a new revision and atomically marks a retained plan
`needsReview`, rather than deleting it. Only a matching, explicitly accepted draft becomes `current`.

- [ ] Add `test_v1_outbox_survives_upgrade`: preserve an already transmitted v1 ID/body byte-for-byte.
      A v1 read encountering v2-only data returns `UPGRADE_REQUIRED` without advancing its cursor.
- [ ] Add `test_plan_snapshot_roundtrip`: v2 plan/preferences survive SQLite -> server -> fresh-account
      cache bootstrap, while the legacy summary remains readable.
- [ ] Add `test_stale_profile_and_plan_conflict`: a newer profile/accepted plan produces explicit conflict;
      it cannot be overwritten by an older draft or v1 mutation.
- [ ] Add `test_preferences_change_retains_previous_plan`: equipment/restriction edits advance the
      revision, keep the old snapshot as needsReview, disable planned-day start and preserve that state
      when replacement generation fails. Test cosmetic profile edits follow the same revision rule.
- [ ] Add `test_new_workout_does_not_invalidate_draft`: changing only workout history preserves plan
      eligibility; show its source timestamp. Accept without manufacturing a new profile revision.
- [ ] Implement draft-acceptance verification as a service seam for Task 5; do not allow unchecked
      client-created AI provenance. Extend existing legacy import for the separate `acceptedPlans` store,
      preserving ownership/provenance and requiring a choice when stores disagree.
- [ ] Verify focused sync/privacy/schema tests, then
      `pnpm --dir frontend --filter @myos/mobile test` and
      `uv run --directory backend pytest tests/test_fitness_schemas.py tests/test_sync_privacy.py -q`.

### Task 3: Add the Gemini adapter, consent and bounded account context

**Files:** Extend `backend/pyproject.toml`, `uv.lock`, `.env.example`, `app/core/config.py`;
create `app/agents/gemini.py`, `app/services/ai_context.py`, `app/services/ai_access.py`, consent storage,
and `tests/test_gemini_provider.py`, `tests/test_ai_context.py`, `tests/test_ai_access.py`.

**Interfaces:** `build_gemini_model(settings) -> GoogleModel` passes `GEMINI_API_KEY` explicitly.
`AiAccessService.require_access(user)` checks feature configuration, consent and adult eligibility.
`AiContextService.build(user, profile_revision_id, sync_revision) -> FitnessAiContext` reads only
account-owned records. `get_capabilities(user)` and `set_consent(user, version, accepted)` back the
capability/consent endpoints.

- [ ] Test explicit key binding when both `GEMINI_API_KEY` and a different `GOOGLE_API_KEY` exist;
      missing configuration fails the feature with `AI_DISABLED` without breaking ordinary API startup.
- [ ] Test no context for users under 18, missing/revoked consent or stale revisions; ensure captured
      structured context excludes names, emails, notes, credentials and the other account's records.
      No model inputs enter logs. Test consented user chat is forwarded as disclosed, without claiming
      anonymization of volunteered personal information.
- [ ] Test 50-workout/500-set/eight-week/ten-exchange and 12,000-token bounds with deterministic fixtures.
- [ ] Add the `google` extra to the existing dependency through uv, retain other extras, and verify the
      installed version's model/provider/structured-output API against official docs. Implement the
      proposed config defaults from the spec and versioned consent persistence.
- [ ] Verify: `uv run --directory backend pytest tests/test_gemini_provider.py tests/test_ai_context.py tests/test_ai_access.py -q`.

### Task 4: Deliver durable AI jobs and the worker

**Files:** Create `backend/app/db/models/ai.py`, `app/repositories/ai_runs.py`,
`app/services/ai_runs.py`, `app/commands/ai_worker.py`, `app/api/routes/v1/ai.py`,
`tests/test_ai_runs.py`, `tests/test_ai_worker.py`; register models/routes and add Alembic migration(s).

**Interfaces:** `AiRunService.enqueue(user, operation, request) -> AiRunResponse`;
`get_owned`, `list_active`, `cancel_owned`; `AiWorker.run_once() -> bool` claims one lease. A worker
handler accepts an immutable context snapshot and returns a typed result. Add the
`liftlog cmd ai-worker` command and worker service in Compose.

- [ ] Test identical requests yield one run; a changed body with the same requestId yields 409;
      account B cannot read, cancel or recover account A's run.
- [ ] Test two workers claim one lease; a stale lease cannot commit; a crash/reclaim cannot duplicate
      a final result. Reserve attempt budget before every model call and keep network I/O outside DB transactions.
- [ ] Test 429/Retry-After, timeout, invalid key, cancellation and revoked consent; assert no more than
      three model calls, one repair and the shared 90-second deadline. Enforce user/global budgets in
      PostgreSQL across workers; deadline-expired queued jobs terminate without calling Gemini.
- [ ] Implement retention: remove context inputs after 30 days, retain unresolved completed drafts,
      and delete private content on account/thread deletion. Log metadata only; expose worker heartbeat
      for readiness without contacting Gemini.
- [ ] Verify: `uv run --directory backend pytest tests/test_ai_runs.py tests/test_ai_worker.py -q`;
      use fake clock/provider and real PostgreSQL integration tests for lease/quota races.

### Task 5: Generate validated personalized plan drafts end to end on the backend

**Files:** Create `backend/app/agents/training_plan.py`, `app/services/ai_planning.py`,
`app/services/plan_validation.py`, `tests/test_ai_planning.py`, `tests/test_plan_validation.py`;
add shared reviewed catalog/policy artifacts and exporter beside existing catalog tooling.

**Interfaces:** `PlanGenerationService.create(user, GeneratePlanRequest) -> AiRunResponse`;
`TrainingPlanAgent.generate(context, candidates, policy) -> AiWorkoutPlanV1`;
`validate_plan(plan, context, catalog, policy) -> ValidatedPlanDraft`;
`verify_draft_acceptance(user, snapshot, profile_revision_id)` completes Task 2's acceptance seam.

- [ ] Test only confirmed equipment and reviewed/resolvable IDs enter candidates; unknown IDs,
      duplicates, exclusions, wrong load units and excessive duration are rejected even if model JSON is valid.
- [ ] Test starter policy coverage (four roles, two sets, 8–12 reps, 90-second rest, 1–3 training days);
      insufficient coverage returns unavailable. Derive names/equipment/time from trusted annotations.
- [ ] Test valid draft storage includes source revisions, provenance/model and content hash; malformed
      output permits one repair within Task 4's total budget. Failure leaves the active plan unchanged.
- [ ] Test the provider receives the 4,096-token cap for plans; coach runs receive 1,024 tokens.
- [ ] Test a forged/foreign/stale draft cannot be accepted. Store an immutable server draft and verify
      the full accepted content against it; never call Gemini from sync mutation ingestion.
- [ ] Wire `POST /ai/plan-generations` to the job handler and run cross-language catalog/policy fixtures.
- [ ] Verify: `uv run --directory backend pytest tests/test_ai_planning.py tests/test_plan_validation.py -q`.

### Task 6: Add the FE AI client and resumable generation flow

**Files:** Create `frontend/apps/mobile/src/services/api/ai.ts`, `ai.test.ts`,
`src/features/coach/use-ai-run.ts`, `use-ai-run.test.ts`,
`src/features/planning/AiConsent.tsx`, `GeneratePlanScreen.tsx`; add routes in `src/app/(app)/`.

**Interfaces:** `AiClient` wraps the existing `ApiClient`; use `useAuth().getToken()` and Zod response
schemas. `useAiRun(runId)` returns typed status/result, cancellation and retry actions. Poll at
1/2/4 seconds, then 4 seconds while active; recover active jobs after login/restart.

- [ ] Test retries preserve requestId and exact body, timeout does not imply run failure, and returning
      to an existing job does not create a second model request.
- [ ] Test AppState pause/resume, sign-out/account switch, stale late responses and owner-scoped caches.
- [ ] Implement capabilities, consent, acknowledged sync-revision capture and explicit handling of
      pending/conflicted context. Render offline, retry, quota, refused/invalid-output and unavailable states.
- [ ] Verify: `pnpm --dir frontend --filter @myos/mobile test` and
      `pnpm --dir frontend --filter @myos/mobile typecheck`; manually inspect progress on web.

### Task 7: Preview, accept and recover the AI plan offline

**Files:** Create `src/features/planning/PlanPreferencesScreen.tsx`, `PlanPreviewScreen.tsx`,
`PlanPreviewScreen.test.ts`; extend `src/features/profile/SavedPlan.tsx`, profile model tests and the
Task 2 persistence seam. Wire onboarding completion/Profile actions without replaying onboarding.

**Interfaces:** `useAcceptAiPlan(draft)` validates the currently bound owner/profile, calls
`saveAcceptedAiPlan` and hydrates canonical account state. `SavedPlan` renders the discriminated
plan snapshot and its true provenance; the existing nutrition summary remains separately calculated.

- [ ] Test offline acceptance commits snapshot and outbox together; an injected failure commits
      neither. Restart shows the accepted plan before network access.
- [ ] Test a changed profile, newer remote acceptance and disagreement with a legacy local plan
      require explicit resolution. Existing transmitted mutations stay immutable.
- [ ] Add confirmed equipment/restriction inputs and preview including schedule, rationale, source
      freshness and comparison with the current plan. Accepting is a distinct action from generating.
- [ ] Verify mobile/profile/sync tests and manually run generation -> preview -> accept -> offline reopen
      on web and a native development client.

### Task 8: Start a logged workout from a planned day

**Files:** Extend `src/data/workouts.ts`, add `src/data/start-planned-workout.test.ts`,
create `src/features/planning/PlannedDayCard.tsx`, extend `src/features/today/TodayScreen.tsx`
and the existing start-workout hook.

**Interfaces:** `startPlannedWorkout(owner, planId, dayId) -> Promise<workoutId>` creates fresh workout,
exercise and set IDs and a single aggregate outbox intent in one transaction. Snapshot plan ID/day and
prescriptions so later plan changes cannot alter an already logged workout.

- [ ] Test offline creation, correct exercise order/load units, empty starting loads and generated IDs;
      retries/double taps cannot create duplicate open workouts.
- [ ] Test an existing open workout is resumed or explicitly handled rather than overwritten; a
      recovery/needsReview day has no start action and a later plan replacement cannot rewrite workout history.
- [ ] Implement Today/Profile day actions leading to the existing `ActiveWorkoutScreen`.
- [ ] Verify: `pnpm --dir frontend --filter @myos/mobile test` and a native offline workout walkthrough.

### Task 9: Deliver private personalized coach conversations

**Files:** Create `backend/app/agents/fitness_coach.py`, `app/services/fitness_coach.py`,
`app/repositories/fitness_coach.py`, dedicated thread/message models and an Alembic migration;
create `tests/test_fitness_coach.py`. Add `src/features/coach/CoachScreen.tsx`,
`use-coach-thread.ts`, tests, and a Coach tab route.

**Interfaces:** `FitnessCoachService.create_thread/list_threads/list_messages/submit_turn/delete_thread`
uses private account-owned records, not the template's public conversation-sharing routes. A successful
worker turn atomically commits one assistant reply and its job result. The agent returns only the Task 1
`CoachReply` union. FE can open a `planProposal` through Task 6 with a fresh generation requestId.

- [ ] Test account ownership on every endpoint, idempotent user+assistant messages, one active turn
      per thread, retained history after restart, deletion and account switch.
- [ ] Test user text cannot override system instructions, select a model, access another account,
      invoke write tools or fabricate an accepted plan. Requests involving pain receive guidance rather
      than rehabilitation instructions. Only bounded context is passed to the provider.
- [ ] Add thread list/messages/composer, suggested questions, acknowledged-history caching, online-only
      sending and actionable proposal cards. UI drafts are never labeled as server-accepted messages.
- [ ] Verify: `uv run --directory backend pytest tests/test_fitness_coach.py -q` and
      `pnpm --dir frontend --filter @myos/mobile test`; manual question -> reply -> proposal -> preview.

### Task 10: Verify integration and prepare controlled enablement

**Files:** Extend `README.md`, `backend/README.md`, `frontend/README.md`,
`docs/guides/build-and-run.md`, `docs/guides/synchronization.md`; add an AI guide and end-to-end scenarios.

- [ ] Add a fake-provider integration scenario covering onboarding save/sync -> consent -> generation
      -> preview -> offline acceptance -> sync -> second-device recovery -> planned workout -> coach.
- [ ] Verify disabled/missing-key startup, provider failures, quota exhaustion, logout, restart and
      worker outage preserve the accepted plan and set logging. Test old/new client compatibility.
- [ ] Verify UI at 320/390/768/1280 widths, large text, keyboard-open forms/chat, Android Back and safe
      areas. Run Android native and iOS native checks when their environments are available; report any
      unavailable platform explicitly. Use the existing cross-platform dialogs, not raw web-incompatible alerts.
- [ ] Document backend key/model flags, worker command, migrations, operational budgets, consent,
      data deletion, context freshness and the initial programming/catalog limits.
- [ ] Run root `pnpm check`. With separate authorization for provider usage, run a synthetic adult-data
      Gemini smoke test; fake tests alone must never be described as verification of live generation.
- [ ] Roll out backend v2/migrations -> worker -> FE -> internal-account enablement. Test disabling AI
      stops new provider calls while saved plans, normal sync and logging keep working.

## Dependencies and checkpoints

`1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10` is the default execution order. Backend and FE work
can overlap after Task 1's fixtures are stable, but shared sync/model files must have one owner.

- After Task 5: provider fakes prove authenticated, bounded, durable draft generation and v2 sync compatibility.
- After Task 8: one complete user path works online and offline before adding conversation UI.
- After Task 10: all required checks have fresh evidence; unverified native/live-provider work is stated.

## Proposed commit boundaries

Use task-sized Conventional Commits such as `feat: define ai planning contracts`,
`feat: support versioned ai plan synchronization`, `feat: add gemini fitness jobs`,
`feat: connect plan preview and acceptance`, `feat: start workouts from saved plans`, and
`feat: add personalized fitness coach`. Split a task further if implementation/review requires it.
Do not include unrelated existing working-tree changes in any commit.
