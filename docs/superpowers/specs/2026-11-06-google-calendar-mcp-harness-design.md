# Google Calendar MCP agent harness

Status: proposed design for review; Google Calendar and Google's official remote MCP server selected.

## User intent and confirmed choices

The user wants a backend agent harness that accesses a user's calendar through MCP and arranges reminders through that calendar. The user selected Google Calendar as the first provider and explicitly selected Google's official Developer Preview MCP server over a LiftLog-hosted adapter.

Meal suggestions and meal tracking are also requested product capabilities. This design defines their calendar integration boundary; it does not claim those features or their data storage already exist. Workout and meal events are reminders of planned activities, never evidence that a workout was completed or a meal was eaten.

Success means a signed-in user can connect Google Calendar, ask the agent to find suitable times for an accepted activity plan, create calendar events with reminders, and inspect the real result. Google Calendar delivers reminders after successful event creation without requiring the mobile app or an LLM run to stay open.

## Approaches considered

1. **Official Google Calendar remote MCP server — selected by the user.** Reuse a provider-maintained MCP endpoint. Deployment depends on Developer Preview access and compatibility with its OAuth, tool schemas, and interactive requests.
2. **LiftLog-hosted Calendar MCP server — not selected.** A small adapter would call Google Calendar APIs behind an MCP interface. This gives LiftLog more control but adds provider integration and server maintenance. Do not silently switch to this approach or direct Calendar REST writes if the selected preview is unavailable.

Reuse the existing FastAPI/Pydantic AI backend as the harness. A second LangGraph runtime is unnecessary for this feature. Keep the existing offline workout-template generator independent; its design does not authorize uploading personal profiles to Gemini.

## Existing project and the required change

- `backend/app/agents/assistant.py` contains the model/tool loop, but only registers the date/time and ask-user tools. Its current dependency group does not install MCP support.
- `backend/app/services/agent_session.py` streams interactive runs over an authenticated WebSocket. Its `Deps` currently lacks the authenticated user's populated identity and connector context. Disconnect cancels the active turn.
- Conversation messages and tool traces are persisted, but they are not a reliable external-action receipt. Add a separate operation ledger before enabling calendar writes.
- The template configuration has MCP disabled. Editing that generation record alone cannot implement the integration.
- The mobile onboarding stores days per week and minutes per session. It does not capture actual weekly availability, time zone, or reminder preferences. There is no calendar connector UI.
- The backend has no authoritative LiftLog workout/profile/meal integration yet. Do not treat a client-provided ID as a plan the backend has verified. The first calendar workflow can take an explicit, validated scheduling request; importing an accepted plan requires a separately validated snapshot or the planned synchronization feature.

## Proposed first release

The following are implementation proposals, not additional choices already confirmed by the user:

- Run the agent when the user requests scheduling or changes. Let Calendar execute reminders. Continuous calendar monitoring and unsolicited automatic rescheduling are later capabilities.
- Let users select the calendars to consult and one writable target calendar from the connected Google account. A dedicated LiftLog calendar is optional; do not promise to create one because calendar creation is not in the selected server's published tool list.
- Gather actual available weekdays/time windows, IANA time zone, activity duration, date range, and reminder preferences. Reuse confirmed preferences on later requests; do not repeat onboarding.
- Prefer availability-only context when proposing times. Share event titles/descriptions with the model only when needed for an explicit request.
- Show concrete dates, local times, target calendar, and reminder settings. A sufficiently explicit request to schedule activities authorizes writes within that request; a proposal-only request does not. Ask only for missing material details or provider-required confirmation.
- Create individual timed events for a finite, displayed date range in the first release. A request for a repeating plan must show that horizon and get the user's agreement to that interpretation; never silently represent a finite batch as an indefinite recurring series. Native recurring series and automatic replenishment are follow-up scope.
- User-requested changes and deletion affect only events linked to LiftLog operations. Invitations, attendee responses, changes to unrelated events, and autonomous changes outside a user's authorized request are excluded from this release.

The implementation is several slices: OAuth/connection, MCP harness, durable actions, scheduling contracts, and a minimal mobile interaction surface. These are parts of one calendar feature, not a rewrite of workout or nutrition logic.

## Architecture and responsibilities

```text
Mobile app --Clerk JWT--> FastAPI agent/session endpoints
                               |
                               v
                     Pydantic AI harness
                      |                 |
              PostgreSQL state    MCP tool boundary
                                        |
                                 Streamable HTTP
                                        |
                           Google's Calendar MCP
                                        |
                           Calendar events + reminders
                                        |
                              User's Calendar client
```

The harness owns authenticated run context, conversation continuity, bounded model/tool execution, structured scheduling input, permitted actions, MCP interactions, and action outcomes. MCP provides the calendar tools; it is not a clock or a guarantee that an LLM will wake up later.

The MCP endpoint is fixed to `https://calendarmcp.googleapis.com/mcp/v1`. No user-supplied MCP endpoints, stdio commands, or arbitrary URL imports are part of this release. Connect from the backend through Streamable HTTP using a client whose session is isolated to the authenticated user/run.

Use the installed Pydantic AI version as the starting point and add its supported MCP dependency group through uv. Verify client compatibility with Google's form elicitation before pinning the concrete MCP/FastMCP transport dependency. In particular, current Pydantic AI documentation notes differences in server-initiated request support between FastMCP protocol modes. An implementation must select and test a compatible mode rather than assume the latest default supports it.

## Identity, OAuth, and connection lifecycle

Clerk establishes the LiftLog user. Google OAuth separately authorizes access to that user's calendar. A Clerk JWT is not a Google Calendar credential.

1. An authenticated connection request creates a short-lived, single-use OAuth state bound to the backend user and an allowed application return route. Use an authorization-code flow with PKCE where supported; never accept an arbitrary redirect URL from the agent.
2. Redirect through the official Google authorization configuration for the selected MCP resource. The deployment needs preview enrollment, enabled Calendar/MCP services, and an OAuth client configured for an AI-powered agent.
3. Validate and consume state on callback before exchanging the code. Store the connected Google identity, granted scopes, and encrypted credentials under that LiftLog owner. Do not assume the Google account matches the Clerk login email.
4. Request offline access when continued use requires token refresh. Keep refresh credentials and client secrets on the server. Serialize refresh per connection, retain an existing refresh token when the response omits a replacement, and mark a revoked grant as requiring reconnection.
5. Resolve a connection from authenticated server context, not model-selected user IDs. Initialize the MCP session with credentials for the intended Google resource; never forward arbitrary bearer tokens to another audience. Clear sessions and pending local interaction handlers on sign-out/account change.
6. Disconnect prevents new operations immediately, revokes credentials when possible, and removes stored credentials. Preserve redacted receipts needed to explain past actions. Existing Calendar events/reminders remain unless the user separately requests their removal; disconnect must say this.

Discover and validate the granted read/write capabilities separately. The setup guide's example scope list is read-oriented despite the server also documenting write tools; do not assume those example scopes enable writes. Resolve the required write grant using the current server authorization metadata/documentation and prove it with the deployment smoke test. Report read-only access honestly rather than weakening authentication or claiming a write succeeded.

Reuse or extend the backend credential encryption facility with explicit key configuration and rotation behavior. Do not place OAuth codes, tokens, or complete calendar payloads in model prompts, logs, WebSocket traces, or ordinary conversation records.

## MCP tools and execution policy

Discover tools from the official server, compare the necessary schemas with the supported adapter, and expose only these capabilities as needed:

| Tool             | Intended use                                         |
| ---------------- | ---------------------------------------------------- |
| `list_calendars` | Resolve user-selected calendars and available access |
| `list_events`    | Inspect conflicts and reconcile uncertain operations |
| `get_event`      | Verify a linked event and its current state          |
| `suggest_time`   | Obtain scheduling candidates                         |
| `create_event`   | Create an authorized planned activity with reminders |
| `update_event`   | Change a linked planned activity on request          |
| `delete_event`   | Remove a linked planned activity on request          |

Tool existence does not imply write authority. The boundary independently checks the connected owner, selected calendar, request date range, duration, and permitted operation. Reject guests, attachments, public visibility, and unrelated capabilities in this release. `respond_to_event` is not needed.

Calendar text and tool results are external data. They cannot grant new permissions, change tool policy, or authorize additional destinations. Implement input/output screening and document it in accordance with Google's MCP security requirements; a prompt alone is insufficient. Model Armor is optional, not an automatically enabled billable dependency.

Validate scheduling feasibility in application code after candidate selection: valid instants, explicit time zone, positive duration, requested availability, activity constraints, and overlap. Recheck relevant conflicts shortly before a write; this is a best-effort check, not an atomic reservation against concurrent Calendar changes. If no suitable slot exists, ask for relaxed availability rather than inventing a free slot or silently shortening the activity.

## Reminders and concrete event representation

The published MCP `create_event` request supports `startTime`, `endTime`, `timeZone`, and `overrideReminders`. Use the actual MCP schema, not the Calendar REST API's different request shape.

For an example request, the user might choose a 60-minute workout at 18:00 in their saved time zone with a popup 30 minutes before it starts. Build those fields from validated request data. Do not hard-code that example as a default for every user.

Store the provider event ID, calendar ID, event link, normalized times, and verified reminder settings after a successful tool response. Retrieve the event through MCP when needed to verify an ambiguous result. Report that the event/reminder is configured; do not claim a notification was delivered. Delivery also depends on Calendar/client settings.

Google's calendar-change push notifications are server signals, not user reminders. Continuous monitoring, watch-channel renewal, and notification-driven replanning are explicitly outside this first release.

## Durable operation ledger and recovery

Before each external mutation, persist an operation with owner, connection, stable request/operation IDs, validated arguments, authorization scope, related activity reference, and state. Link a batch to its individual operations so partial success remains visible.

Suggested states are `prepared`, `executing`, `awaitingUser`, `succeeded`, `failed`, `cancelled`, and `outcomeUnknown`. A unique owner/request/operation key prevents duplicate dispatch from repeated app submissions. Record execution evidence separately from a best-effort conversation trace.

The published MCP create request does not document a client-chosen event ID or idempotency key. Therefore a PostgreSQL ledger alone cannot guarantee exactly-once creation across a network timeout or process crash. Include an opaque operation marker in the event description and reconcile through MCP reads before any retry. Do not include health details in this marker.

If creation might have succeeded, preserve `outcomeUnknown`: do not automatically repeat the write. A missing or ambiguous marker match is not proof of failure. Offer reconciliation or a clear user decision instead of silently creating a duplicate. Use the same caution for provider retries hidden inside SDKs; disable unsafe automatic mutation retries.

Cancellation or WebSocket disconnect prevents undispatched writes and cancels pending interactions. An already dispatched operation may have taken effect: retain and reconcile its ledger entry. Reconnection retrieves operation status without replaying the original mutation. A restarted backend must retain the same uncertainty semantics.

On update/delete, fetch the linked event first. If the user changed or removed it outside LiftLog, show the discrepancy and avoid blindly replacing those changes. Do not promise atomic conflict protection where the selected MCP schema does not expose conditional writes.

## Provider elicitation and mobile interaction

Forward provider-requested form elicitation to the signed-in user and support accept, decline, and cancel. Bind each response to the current owner, run, operation, and interaction ID; a model cannot manufacture the answer. Expiration, missing UI support, or disconnection does not count as acceptance.

Do not automatically answer provider-required confirmation from a general standing permission. Persist an interrupted operation as awaiting reconciliation; resume only through a provider-supported continuation. If continuation cannot be recovered, reconcile before attempting a fresh call.

Keep ordinary clarification separate from provider confirmation. The existing `ask_user` callback uses an in-memory future and is not a durable authorization record; extend the protocol rather than treating it as sufficient.

The mobile surface needs connection/status management, a scheduling/agent interaction, a readable schedule/result, provider interaction responses, and recovery status. Reuse existing UI primitives. Local workout/set writes must continue without waiting for the agent, OAuth, or Google.

## Persistence and API boundaries

Proposed PostgreSQL entities: owned `calendar_connections`, expiring `calendar_oauth_states`, versioned `calendar_preferences`, `calendar_scheduling_requests`, `calendar_operations`, and `calendar_event_links`. Add Alembic migrations; exact names and indexes are left to implementation planning.

Keep routes under `/api/v1`, with Pydantic models and matching Zod schemas in `frontend/packages/contracts`. Suggested boundaries:

- Start/complete OAuth; inspect or disconnect the caller's connection. Callback uses validated OAuth state; other account operations require Clerk authentication.
- Read/update scheduling preferences, including selected calendars, availability, time zone, and reminder choices.
- Submit an explicit scheduling request or continue an authenticated agent conversation.
- Retrieve an owned request/operation status and submit a correlated provider interaction response.

Use camelCase for new LiftLog wire contracts without renaming existing template endpoints. No client-supplied owner ID grants access. Status responses redact credentials and minimize event details. Validate request bounds and authorized activity snapshots at the boundary.

Keep APIs and existing in-app data access separated: clients belong in `frontend/apps/mobile/src/services/api/` and obtain Clerk tokens with `getToken()`. Device-specific UI APIs must follow the project's Expo SDK 58 documentation requirements when implemented.

## Workout and nutrition integration boundary

The harness can schedule an explicit workout instruction immediately after that instruction is validated. An accepted workout plan can later provide activity IDs, durations, and availability constraints through a typed snapshot. Do not make completion of the unfinished planner or full workout synchronization an implicit dependency of OAuth/MCP verification.

Meal suggestions should eventually provide proposed meals and preparation/eating times; meal tracking records actual intake separately. Add meal reminders only when requested. A calendar event firing, being deleted, or reaching its end time must never automatically log a meal, its calories, or a completed workout.

Dietary preferences, allergies, budgets, and nutrition totals belong to the meal feature's own validated contracts. They are not Calendar event metadata. This design does not change nutrition targets or assume existing calorie estimates are validated for every user.

## Verification and rollout

1. Verify preview eligibility and a real OAuth/MCP handshake using deployment credentials. Fetch tool schemas and prove read access, reminder-bearing creation/readback, and the required elicitation flow on an authorized test calendar. If unavailable, report the integration as unverified; do not substitute mock evidence.
2. Add offline tests with fake model/MCP transports for owner isolation, state/PKCE handling, refresh/revocation, request bounds, tool allowlisting, reminder mapping, time zones, conflict handling, and accept/decline/cancel correlation.
3. Test ledger recovery with a provider commit followed by a lost response, process restart, repeated client submission, cancellation during a call, and partial batch success. Tests must prove uncertain creation is not automatically dispatched twice.
4. Verify the mobile connection/scheduling/result flow and continued offline set logging. In a real Calendar client, separately observe an actual reminder; an event readback alone only proves configuration.
5. Run root `pnpm check` and relevant backend/frontend checks. Preserve and report unrelated draft failures. Existing observed baseline fails on nine frontend draft files' formatting and missing planner exports; recheck before implementation.

Enable the connector behind server configuration after the real compatibility check. With the connector disabled/unavailable, preserve user drafts and existing offline logging. Document prerequisites, credential configuration, reconnect/disconnect behavior, and the distinction between planned, configured, and actually completed activities.

## Sources and implementation latitude

Primary references consulted on 2026-11-06:

- [Official Calendar MCP setup](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server): preview, endpoint, OAuth, and tool availability.
- [MCP create_event schema](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/create_event): reminder and timed-event fields; no documented client idempotency argument.
- [Calendar reminder concepts](https://developers.google.com/workspace/calendar/api/concepts/reminders): reminder delivery versus calendar-change notifications.
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server): authorization and refresh lifecycle.
- [Google Workspace MCP security configuration](https://developers.google.com/workspace/guides/configure-mcp-security): provider security requirements.
- [Pydantic AI MCP client](https://pydantic.dev/docs/ai/mcp/client/): transport, per-user sessions, and elicitation compatibility.
- [MCP security best practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices): resource authorization and session boundaries.

The builder chooses exact module splits, dependency pins, page sizes, timeouts, run/tool budgets, and retry intervals after checking the installed SDK and real preview. Those choices must preserve owner isolation, explicit authorization, finite scheduling scope, external-action recovery, and the distinction between a configured reminder and confirmed delivery.
