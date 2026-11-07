# Personalized workout plans using Gemini templates

Status: implementation authorized for generation; companion deferred.

## Latest scope from the user

The user clarified: do not download GymMane; reference its 500+ exercises. Use GymMane as a reference,
and resolve generated exercise selections against LiftLog's existing bundled 600+ catalog. The earlier
GymMane import/pinning tasks below are superseded; do not claim the existing catalog came from GymMane.

The user instructed implementation to proceed for workout-plan generation. The companion is explicitly
**deferred**; it will later provide plan adjustments. First-login onboarding and saved plan reuse remain
in scope. Do not add a recurring onboarding flow for routine plan updates.

Within this implementation, preserve onboarding completion and plans per signed-in account on the device.
Account-wide synchronization across reinstalls/devices requires a separate server persistence feature;
local persistence must not be represented as cross-device recovery. Document that limit explicitly.

The selected free-tier architecture remains: generic templates are generated without personal data,
and onboarding inputs are applied locally. The no-companion scope in the remainder of this document
therefore applies again. The user's instruction to proceed supersedes the earlier approval-pending status.

## Intent and agreed requirements

Replace LiftLog's calculated plan presentation with a personalized workout plan immediately after onboarding.
The user selected LangGraph and LangChain, Google's free API tier, GymMane's exercise catalog, and additional
onboarding questions about equipment and injuries/movement restrictions.

The user selected **option 1**: Gemini generates reusable templates without user data; application rules
privately select and adapt those templates. This supersedes the original suggestion to send all onboarding
answers to an agent. Actual user answers remain on the device, including body measurements and restrictions.

Success means an eligible user finishes onboarding, sees an actionable plan that fits their confirmed
equipment and time budget, and can reopen that same plan offline. Model output must pass code validation.
Structural validation is not a guarantee of medical suitability.

## Approaches considered

1. **Generic AI templates plus local personalization — selected by the user.** A developer-run LangGraph
   workflow creates versioned templates from public exercise data. The app performs user-specific selection
   and adaptation. This supports the free-tier constraint and immediate offline results, but Gemini does not
   reason about an individual user's history or injury.
2. **Direct per-user generation through a backend.** This would allow model-based reasoning over onboarding
   answers but requires an appropriate service configuration for personal information, runtime availability,
   and additional privacy and operating-cost decisions. The user did not choose this approach.

Google's [API terms](https://ai.google.dev/gemini-api/terms) restrict sensitive/personal inputs to unpaid
services, with regional distinctions. This design avoids submitting user inputs at all. Free-tier model
availability and [quotas](https://ai.google.dev/gemini-api/docs/rate-limits) are deployment configuration,
not hard-coded promises of unlimited use.

## Proposed scope and product choices

The following are design proposals, not additional requirements already agreed by the user:

- Show a repeatable weekly workout schedule: session focus, catalog exercises, sets, repetition ranges or
  hold duration, rest intervals, estimated duration, and a short explanation of the local selection.
- Preserve current calorie/macro estimates as a separate section for eligible adults, calculated locally.
  Gemini does not invent nutrition numbers. The old summary is no longer the workout plan.
- Keep existing manual workout logging unchanged in this release. Exercise links open existing detail
  screens. Automatically populating a logged workout from a planned day is a later feature.
- Run the AI workflow as a Node/TypeScript maintenance command in `apps/plan-agent`, not as a mobile chat
  agent or a publicly accessible generation endpoint. No always-running API server is required for v1.
- Ship validated, versioned templates in the app. Generating a new template pack is a developer operation;
  completing onboarding never triggers a Google request or consumes free-tier quota.
- Return an explicit unavailable/guidance state when constraints cannot be satisfied. Never silently drop
  restrictions or label a deterministic fallback as AI-generated.

## Architecture and data boundaries

```text
Developer workflow (no user data)
  Pinned GymMane source -> normalized catalog + reviewed planning annotations
  Fixed generic scenario -> LangGraph -> LangChain Google model -> validation
  Validated template pack -> review/publish command -> bundled app asset

On-device workflow
  Onboarding answers + bundled templates + annotated catalog
      -> deterministic personalizer -> final validation
      -> saved plan snapshot -> onboarding preview and Profile
```

The generator only accepts a fixed scenario ID from a checked-in registry. It never accepts a user ID,
onboarding JSON, free-form profile text, injury labels, or derived user-specific constraints. It does not
read the app database. Catalog refresh and template generation occur independently of app usage.

No real profiles, names, measurements, or restrictions enter prompts, traces, exception payloads, or
generation logs. LangSmith/remote tracing is off by default. The Google key is loaded only by the Node
workspace through a non-public environment variable. It never enters Expo configuration or mobile imports.

### Package ownership

- `packages/domain`: planning types, equipment/movement filters, template matching, schedule construction,
  duration estimates, policy validation, and deterministic tests. No I/O or LangChain imports.
- `packages/contracts`: Zod schemas for normalized planning metadata, generic templates, packs, expanded
  onboarding data, and persisted personalized plans.
- `packages/content` (new): versioned public catalog/planning metadata and template artifacts consumed as
  source data by both the generator and mobile. No React Native dependency. Keep these assets separate from
  domain rules; declare all workspace dependencies explicitly.
- `apps/plan-agent` (new): import/generation/publishing commands, LangGraph graph, LangChain model adapter,
  prompt versions, environment parsing, mock-provider tests, and setup documentation.
- `apps/mobile/src/services/content`: adapt the public catalog through `ExerciseSource`; validate before
  SQLite upsert. Keep existing content records available for historical workouts.
- `apps/mobile/src/features/coach`: expose a local planning boundary for the selected architecture. Do not
  implement the existing network-oriented `CoachClient.suggestPlan(profile, baseline)` by uploading a
  profile. Retain other unimplemented coach methods as future seams, clearly separated from local planning.
- `apps/mobile/src/data`: transactional persistence for current profile and plan snapshots.
- `apps/mobile/src/features/onboarding` and `features/profile`: collect inputs, render the new plan and
  generation states, and support intentional plan updates.

Use current official [LangGraph JavaScript](https://docs.langchain.com/oss/javascript/langgraph/overview)
and [LangChain Google integration](https://docs.langchain.com/oss/javascript/integrations/chat/google)
documentation. The current integration recommends `@langchain/google`. Confirm concrete package versions
and structured-output compatibility before installing. Keep Node >=22 and pnpm as required by the repo.

## Exercise catalog and provenance

Import the public [GymMane catalog](https://github.com/InlitX/GymMane/blob/main/lib/catalog/exercise_catalog.dart)
from a pinned commit. Parse data without executing Dart. Record source commit, importer version, source IDs,
counts, and conversion warnings in a manifest. Verify the actual imported count rather than assuming every
advertised exercise maps successfully.

Use namespaced IDs such as `gymmane:<source-id>` to avoid collisions. New generated plans reference this
catalog; do not rewrite old workout exercise IDs or remove their existing catalog rows. The library may
contain both sources initially; deduplication across historical IDs is out of scope.

Map muscles, equipment, difficulty, instructions, and load type to strict application definitions. The
upstream equipment field alone is insufficient: a barbell bench press also requires a bench and rack.
Reviewed annotations must specify all required equipment, movement tags, load type, difficulty, and planner
eligibility. Unknown mappings are reported, never silently converted to bodyweight or beginner difficulty.

The full successfully normalized catalog can be browsed, but automatic planning uses only entries with
complete reviewed annotations. It is acceptable for the initial planner-eligible subset to be smaller than
the 500+ library. Publish its exact coverage. At minimum it must support feasible adult scenarios for
bodyweight-only, dumbbell-only, dumbbell-plus-bench, and common gym equipment; unsupported combinations
return explicit coverage errors rather than invented exercises.

GymMane identifies its code as GPL-3.0 with an additional attribution term, and artwork separately as
CC BY-SA 4.0. Preserve source notices and record imported material and attribution in `CREDITS.md`; do not
assume the catalog has the Unlicense used by LiftLog's existing free-exercise-db import. Resolve distribution
licensing for the imported catalog before shipping binaries. Design approval does not itself settle those
license obligations. See [GymMane credits](https://github.com/InlitX/GymMane/blob/main/CREDITS.md) and
[additional terms](https://github.com/InlitX/GymMane/blob/main/ADDITIONAL_TERMS.md).

Importing GymMane illustration files is not required for v1. Existing media can remain under their existing
IDs; new entries without correctly attributed media show a normal placeholder, not an unrelated exercise.

## Expanded onboarding

Retain current profile fields. Add two steps after training location and before plan creation:

1. **Available equipment:** multi-select exact supported equipment, including bench/rack/pull-up bar and
   specific machine capabilities needed by planner-eligible exercises. Location can suggest a checklist,
   but availability must be confirmed; “gym” must not automatically grant all equipment. “No equipment”
   maps to bodyweight only. “Unsure” must be resolved before automatic planning.
2. **Movement restrictions:** explicit `none`, `specified`, or `unsure` status. Collect movements the user
   has been told to avoid, using controlled selections, and whether current pain or an unresolved injury
   affects training. Do not request diagnosis narratives or interpret medical history with a model.

Restriction tags use a controlled movement taxonomy, including overhead pressing, horizontal pressing,
pulling, knee-dominant work, hip hinges, spinal loading, impact, and floor-supported positions. Annotated
exercises can carry multiple tags. A selection excludes every matching exercise; the app must not infer
that an untagged alternative treats or rehabilitates an injury.

Current pain/unresolved injury, an `unsure` restriction response, or constraints leaving no valid plan
produce a clear guidance state and allow correction of answers or continuation to manual logging. No
automatic injury-specific plan is supplied. A completed profile with an unavailable plan still unlocks
the app; a plan is not required to log a workout.

Proposed age scope: automatic templates and the existing adult nutrition estimates are limited to adults
(18+). Users aged 13–17 can still use manual logging; the planner displays an age-appropriate guidance
state instead of applying the adult rules. No minor data is sent to any model. Clinical/rehabilitation and
adolescent programming are outside this first version.

Name is for display only; measurements, sex, activity, and pace inform existing local nutrition estimates.
Workout selection primarily uses goal, experience, confirmed equipment, available days/time, and movement
restrictions. Do not force every collected field into exercise selection merely because it is available.

## Template generation workflow

Use a bounded LangGraph workflow, with LangChain providing the Gemini client and structured output:

1. Load a fixed, non-personal scenario and catalog version.
2. Select planner-eligible catalog candidates for its generic session focus.
3. Generate a structured template containing movement slots, ordered eligible exercise IDs, and allowed
   prescription choices. The model does not set policy bounds.
4. Validate schema, references, role coverage, prescription ranges, and annotation consistency in code.
5. On semantic/schema failure, permit one repair call using generic validation errors.
6. Stage valid output as a candidate pack; otherwise fail without overwriting the last published pack.

Use one model request plus at most one semantic repair per template, with a total attempt cap of three
including any transient retry. Set a per-call timeout and a total generation deadline. Respect provider
backoff on 429; fail on exhausted quota or invalid credentials. Disable hidden SDK retries that would
exceed the shared cap. Do not rotate keys or switch to a billable service automatically.

The model name is explicit generator configuration (`GEMINI_MODEL`); verify its free-tier availability in
the project's Google AI Studio account. Generation does not enable billing. Missing credentials do not
prevent mobile builds or local tests, but a successful real model run must occur before claiming that the
first shipped pack is AI-generated.

A pack declares schema/catalog/policy/prompt versions, scenario coverage, model ID, generation timestamp,
and provenance. Coverage is a finite set of session archetypes (full body, upper, lower, push, pull, legs)
and goal families, not the Cartesian product of user profiles. Local rules compose these into a week.
Templates store candidate options per movement slot so filtering can replace an unavailable exercise.

An explicit publish command validates the entire candidate pack and atomically writes the bundled pack.
Never publish a partially generated pack. Include reviewed deterministic templates as a separately marked
fallback; mock output must never be recorded as genuine Gemini output.

## On-device personalization and validation

The personalizer is pure and deterministic for the same profile, policy, catalog, and template versions:

1. Validate profile completeness and eligibility.
2. Pick a split and session archetypes using local policy and the requested weekly availability.
3. Filter candidate exercises by all required equipment, experience eligibility, and exclusion tags.
4. Select a stable exercise order and prescribe sets, repetition ranges or seconds, and rest using policy
   bounds. No starting weights are inferred from body weight or sex; starting load stays unspecified.
5. Estimate duration including warm-up allocation, work time, rest, and transitions. Reduce optional
   accessories/sets within policy bounds if necessary; never shorten required rest to force a match.
6. Validate the completed schedule, then generate short local explanations describing the actual choices.

Hard invariants: every ID resolves; no duplicate exercise within a session; all equipment is available;
no excluded movement appears; all prescriptions use correct units and positive bounded numbers; estimated
session duration fits the stated budget; schedule fits weekly availability and policy recovery spacing;
required movement coverage and volume bounds hold. If a restriction prevents required coverage, return
unavailable rather than silently presenting a complete plan.

Desired days are availability, not a mandate to prescribe seven hard lifting days. The result explicitly
identifies training and recovery slots and explains any reduction in training frequency. Initial policy
tables and numerical bounds must be documented with authoritative exercise-programming sources during
implementation planning, independently of the LLM. Do not treat software checks as clinical validation.

Fallback order: compatible AI pack, then explicitly marked deterministic templates. Both pass the same
constraints. If neither yields a valid plan, keep the user's answers and return a typed failure such as
`needsEquipmentConfirmation`, `needsGuidance`, `insufficientCatalogCoverage`, or `cannotFitDuration`.

## Output and persistence

The result is a discriminated union: `ready` with a plan or `unavailable` with a reason and correction path.
A ready plan contains a unique ID, profile revision, creation time, provenance (`aiTemplate` or `rules`),
catalog/template/policy versions, ordered training/recovery days, exercise IDs with display-name snapshots,
sets/repetition range or seconds, rest, duration estimate, and local rationale codes. Keep adult nutrition
estimates a separate optional object rather than mixing them into exercise prescriptions.

Add user-scoped SQLite persistence for profile revisions and immutable plan snapshots, with an active-plan
pointer. Save the completed profile and its result atomically. Screens read through `data/*`. Generate new
migrations through Drizzle and commit the SQL, snapshots, and migration manifest. Historical workouts remain
unchanged. Do not put sensitive fields in logs or sync them through the domain event bus.

The existing global Zustand `profile` storage is not reliably attributable to a Clerk user. Do not silently
assign it to whichever user next signs in. Existing users retain workout history but must reconfirm their
profile/equipment/restrictions before creating the first new plan. Do not display legacy profile data to a
different signed-in user. Other unrelated settings may remain device-global in this release.

Reopening the app loads the saved plan instead of recalculating it each render. An app/template update does
not silently rewrite a user's plan. Updated answers create a new profile revision and result; an older
plan becomes inactive immediately and cannot remain presented as suitable for the new restrictions. A
failed update preserves its snapshot for history but displays the new unavailable state.

## Presentation and failure behavior

Replace the artificial onboarding build timer with actual local assembly/validation progress, then show
the saved result. Keep the final acceptance action; persist the accepted profile/result transactionally.
If inputs change before acceptance, discard stale computed results. Reject double-submit duplicates.

The new plan replaces the workout portion of `PlanSummary` in onboarding and Profile. Show training days,
exercise prescriptions, estimated duration, and brief reasons. A small factual label distinguishes
“Personalized from AI-designed templates” from “Personalized starter plan.” Do not imply a fresh model call
occurred for the user. Keep API/framework names out of product UI.

Use existing UI primitives, token colors, accessible labels, and reduced-motion behavior. The builder may
choose the exact card layout. Manual logging and history remain usable offline, including when plan
generation is unavailable. No asynchronous remote refresh can change a plan being viewed or logged.

## Verification and completion criteria

- Catalog import is reproducible from a pinned source; bad mappings fail explicitly. Source IDs and
  attribution are retained. Planner eligibility and imported counts are inspectable.
- Contract tests reject malformed packs, bad units, non-finite values, unrecognized scenarios, and
  references to absent/ineligible exercises.
- Domain tests cover deterministic generation, equipment subsets, excluded movements, time constraints,
  weekly spacing, unsupported combinations, age/guidance states, and fallback provenance. Use a scenario
  matrix for all archetypes and representative equipment sets; do not assert that every profile succeeds.
- Agent tests use a fake model to prove bounded repair/retry behavior, no partial publish, invalid output
  rejection, and that only allowed generic fields can reach the provider. CI makes no paid or live calls.
- Persistence tests cover atomic profile/plan acceptance, account switching, stale results, regeneration,
  and preservation of historical workout IDs.
- Device verification covers both onboarding success and unavailable states, plan reopening offline,
  Profile rendering, equipment/restriction edits, and unchanged manual logging.
- A real free-tier Gemini generation is verified separately with developer credentials before publishing
  AI provenance. If unavailable, report the unverified integration; never manufacture that evidence.
- Run `pnpm check`, relevant agent/content tests, and the applicable native checks before claiming the
  implementation complete. Resolve existing failures separately from this feature's changes.

## Explicit non-goals and implementation latitude

No chat coach, personal medical advice, rehabilitation, model-generated calorie targets, live web-search
tools, vector database, per-user cloud generation, profile synchronization, or automated store deployment.
No auto-progression based on logged workouts and no one-tap plan-to-workout population in v1.

The builder may select exact filenames, SQLite table names, UI layout, stable candidate tie-breaking,
test fixtures, and compatible dependency versions. Exact policy bounds require documented evidence and
tests before implementation; they must not be inferred from model output. The selected scope is a feature
spanning catalog preparation, an offline agent workflow, local domain logic, persistence, and mobile UI.

Workspace note: root manifest/lockfile and root Expo/native artifacts already have unrelated local changes.
Preserve them and do not fold them into this feature without checking their purpose.
