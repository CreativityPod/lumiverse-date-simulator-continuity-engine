# Architecture

The extension is split into five small modules:

- `schemas.js`: strict current-scene and current-arc schema, lifecycle and provenance validation, private-response validation, and conservative schema-v1/v2/v3 upgrade.
- `state.js`: capsule parsing, branch fingerprints, checkpoint selection, prompt compaction, and canonical injection.
- `tracker.js`: provider-aware quiet generation, prompts, JSON extraction, and validation.
- `backend.js`: storage, queues, event reconciliation, migration, variable mirrors, readiness, and prompt interception.
- `frontend.js`: native Continuity drawer, compatibility controls, and self-healing profile-card status integration.

## Persistence

Each chat has one extension-owned JSON store under `chats/`. It contains the active epoch, current state, per-turn checkpoints, migration baseline, revision, last revision time, and diagnostic status. Revision number and `lastRevisionAt` are committed together only when a tracker or migration checkpoint is created; verification-only reconciliation never changes them. Chat IDs are reduced to safe storage tokens. The backend mirrors scene v2, full arc v2, and a response-free arc v1 compatibility view to private chat variables, but extension storage is canonical.

Tracker schema v1, v2, and v3 states are upgraded locally to schema v4. Existing validated scene, NPC, relationship, response, and objective values are preserved. Schema-v1 response fields and pre-v3 stable woman-appearance fields initialize conservatively as unknown. The combined v3 `manVisible` value is retained in the new visible-appearance field and the combined v3 `spatial` value is retained in proximity/contact; fields that cannot be separated without guessing initialize as unknown. Scene and arc lifecycle initialize as active, matching the prior runtime assumption, until a newly processed turn establishes an ending. The extension store remains schema v2 because its envelope did not change. Stored transcript messages are never rewritten, so state can be rebuilt from the selected branch if an extension rollback discards the newer sidecar store.

## Narrative time and lifecycle

`scene.date` and `scene.time` remain the only current-clock fields. The tracker treats them exclusively as fictional narrative time: completed public dialogue and action may advance them, explicit durations and clock references take priority, approximate wording remains approximate, and real message timestamps, user response delay, and generation latency are ignored. Observation, analysis, reload, and reprocessing do not advance fictional time.

Scene lifecycle and arc lifecycle are separate replacement-state fields. The current scene may be ended while the larger arc remains active because a later meeting or continuing connection exists. Starting a later scene replaces the prior current scene and marks the new scene active; it does not append a scene-history item. Prior versions remain available through branch checkpoints and the public transcript.

## Update transaction

For each eligible assistant turn, the backend generates a complete replacement state, validates it, rereads the selected branch, compares its prefix fingerprint, and only then saves a checkpoint. Failed or stale results do not mutate current state. Private response changes require the same source-message linkage as material relationship changes.

Queues serialize updates per chat while allowing different chats to proceed independently. Prompt interception waits for the selected turn's bounded reconciliation and then injects the newest committed state.

## Surprise Me sampler

Before any stable case exists, an exact `1` or `Surprise Me` setup command may receive one deterministic private sampler block. Pure state logic removes any prior sampler block, fingerprints the selected assembled prefix plus chat ID, draws each axis through a seeded generator, and returns one prompt-only system message immediately before the final user command. The sampler does not read prompt examples as live state, does not mutate the transcript or chat variables, does not select cultural identity or outcome, and is inactive for every other setup path and active case.

## Trust boundaries

The public transcript is untrusted tracker input. State fields reject HTML comments and Date Simulator XML-like envelopes. Strict key sets, length bounds, list caps, and source-message checks reduce accidental prompt/state injection. The interceptor marks injected data as private and the card separately forbids exposing it.

The tracker has no chat-mutation capability itself. Only the backend commits validated state, and it verifies the branch immediately before doing so.

## Profile-card handshake

The stable `DATE_SIM_CASE` capsule in the selected stored branch is authoritative. The backend validates and saves it directly; it never clicks the Regex Script action. Profile persistence completes before tracker generation and is mirrored to Lumiverse chat variables for card-macro interoperability.

The companion card exposes stable checking, live-engine, and manual-fallback hooks. While the frontend is loaded, extension-owned CSS switches every newly rendered card to the live-engine state before message-specific status arrives and hides the manual action by default. A cached backend status then updates the exact case-message card. A scoped mutation observer reapplies that status if Lumiverse inserts or replaces the card after the message event. If the frontend appears but the backend does not confirm a newly rendered profile within four seconds, a watchdog reports that distinction and restores the manual fallback. Manual saving is otherwise exposed only when automatic profile persistence remains unconfirmed because of configuration, permissions, or an unsaved failure; it never reappears after a successful save merely because tracker generation is disabled or degraded. An invalid capsule cannot be repaired by the manual action.

## Frontend components

The Continuity drawer uses Lumiverse host-mounted switches, selects, numeric inputs, badges, and checkboxes when the shared component bridge is available. Advanced and private sections use persistent theme-matched HTML details because Lumiverse's mounted collapsible removes its body while closed, which would destroy nested component mounts. Action buttons use Lumiverse theme tokens because the host does not expose a general mounted button. If any required shared form component is unavailable, the drawer falls back as one complete set to themed HTML controls instead of mixing two visual systems.

Every status payload also contains a deliberately narrow public projection for the drawer. It includes scene and arc lifecycle status without their reasons or sources, observable scene facts, the woman's stable visible face/eyes/skin/body traits and temporary appearance/state, the man's structured visible state, structured positions/contact/items, established relationship status, latest public change, and public NPC fields. Mental state, lifecycle reasons, boundaries, objectives, NPC intentions, the complete private response vector, and source-message identifiers never enter this projection. The complete canonical JSON is returned only after the user enables private-state inspection.

## Migration

Legacy cases are not processed until the user explicitly requests migration. A successful migration produces one baseline checkpoint at the latest eligible selected turn. Subsequent updates start after that baseline. Editing or swiping away the baseline invalidates it and requires a new conservative reconciliation.
