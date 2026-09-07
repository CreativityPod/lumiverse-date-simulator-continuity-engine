# Architecture

The extension is split into five small modules:

- `schemas.js`: strict canonical current-scene/current-arc schema, provider action schema, action-to-provenance materialization, lifecycle/private-response validation, and conservative schema-v1/v2/v3 upgrade.
- `state.js`: capsule parsing, branch fingerprints, checkpoint selection, prompt compaction, and canonical injection through a private compact prompt projection.
- `tracker.js`: provider-aware quiet generation, prompts, JSON extraction, and validation.
- `backend.js`: storage, queues, event reconciliation, migration, variable mirrors, readiness, and prompt interception.
- `frontend.js`: native Continuity drawer, compatibility controls, and self-healing profile-card status integration.

## Persistence

Each chat has one extension-owned JSON store under `chats/`. It contains the active epoch, current state, per-turn checkpoints, migration baseline, revision, last revision time, and diagnostic status. Revision number and `lastRevisionAt` are committed together only when a tracker or migration checkpoint is created; verification-only reconciliation never changes them. Chat IDs are reduced to safe storage tokens. The backend mirrors scene v2, full arc v2, and a response-free arc v1 compatibility view to private chat variables, but extension storage is canonical.

Lumiverse forks create a new chat and new IDs for every copied message. The host's `CHAT_FORKED` payload supplies the complete source-to-fork message map. The backend reserves the new chat's queue before `CHAT_SWITCHED` reconciliation can run, waits for any source-chat update already in flight, reconstructs the exact copied source prefix, and accepts only source checkpoints whose stored fingerprints still match that prefix. It then remaps all canonical provenance IDs, checkpoint keys, fingerprints, epoch identity, and any included migration baseline. Inheritance stops at the first missing or invalid checkpoint; ordinary reconciliation processes only the remaining tail. Checkpoints after the fork point are never visible to the branch.

Chats without an active profile and without an existing sidecar do not create an inert store. Lumiverse's `CHAT_DELETED` event queues exact-path sidecar deletion after any in-flight reconciliation, preventing a late tracker save from recreating the file. The drawer's two-step cleanup action strictly validates extension-owned store envelopes, rescans after confirmation, and removes only orphaned stores or stores that have never held meaningful continuity data. Malformed, mismatched, processing, and historical stores are retained.

Tracker schema v1, v2, and v3 states are upgraded locally to schema v4. Existing validated scene, NPC, relationship, response, and objective values are preserved. Schema-v1 response fields and pre-v3 stable woman-appearance fields initialize conservatively as unknown. The combined v3 `manVisible` value is retained in the new visible-appearance field and the combined v3 `spatial` value is retained in proximity/contact; fields that cannot be separated without guessing initialize as unknown. Scene and arc lifecycle initialize as active, matching the prior runtime assumption, until a newly processed turn establishes an ending. The extension store remains schema v2 because its envelope did not change. Stored transcript messages are never rewritten, so state can be rebuilt from the selected branch if an extension rollback discards the newer sidecar store.

## Narrative time and lifecycle

`scene.date` and `scene.time` remain the only current-clock fields. The tracker treats them exclusively as fictional narrative time: completed public dialogue and action may advance them, explicit durations and clock references take priority, approximate wording remains approximate, and real message timestamps, user response delay, and generation latency are ignored. Observation, analysis, reload, and reprocessing do not advance fictional time.

Scene lifecycle and arc lifecycle are separate replacement-state fields. The current scene may be ended while the larger arc remains active because a later meeting or continuing connection exists. Starting a later scene replaces the prior current scene and marks the new scene active; it does not append a scene-history item. Prior versions remain available through branch checkpoints and the public transcript.

## Portable initial setups

The schema-v2 store envelope gains optional `initialSetup`: the first eligible opening's key, prefix fingerprint, immutable schema-v4 state, profile text, and creation time. It is copied from the exact first checkpoint once and is not overwritten by forced reprocessing. Existing chats recover it only from a matching non-migration opening checkpoint. An edited/swiped opening invalidates the saved fingerprint. Reset starts a fresh epoch and removes the active baseline. Fork inheritance copies and remaps the frozen baseline independently of any subsequently reprocessed current checkpoint.

Portable JSON uses exactly `{ format: "date-simulator-initial-setup", version: 1, profile, initialState }`. All nonempty provenance fields use the sentinel `initial-setup`; no source chat/message identity or subsequent continuity is exported. Strict file, capsule, schema-v4, mode, and source validation precede import. Unknown fields, unsupported versions, invalid leaves and files exceeding 256 KB fail without a partial write.

Import is serialized with chat reconciliation. It checks the selected startup prefix again after validation and rejects active cases and in-progress generations. It appends one assistant confirmation containing the portable object in `metadata.date_simulator_setup`. Only the exact confirmation text and valid metadata establish an imported case. The branch fingerprint incorporates that metadata; a changed active swipe, edit, deletion, or reset therefore cannot silently retain a stale seed. The reducer derives case authority from that selected anchor, assigns the anchor's new message ID to provenance, and seeds its checkpoint without an LLM call. The private object is never copied into public message content.

`/begin` is observation-only and excluded from tracker turns; the v1.5.6 card presents observable baseline facts without recasting, a duplicate capsule, time advancement, or new actions. Begin uses the host's append-and-generate API outside the continuity queue so the normal prompt interceptor cannot deadlock. Normal turns thereafter use the usual tracker transaction. Import does not require or consume a background generation.

The frontend opens `ctx.uploads.pickFile` directly from a user click. A typed startup command opens the drawer via a backend event, then a Choose File click provides browser activation. Requests bind to the selected chat and its prefix; frontend responses bind to request IDs. Export opens `showSaveFilePicker` synchronously from the original click when available on a secure connection, then writes the backend JSON to the selected file. Save completion requires the writable stream to close successfully. Unsupported connections use the restored v1.4.1 Download JSON File button, which creates an attached temporary data-URL anchor, clicks it synchronously, and removes it. Prepared private data and pending saves are invalidated on replacement, chat switch, or teardown. Cancellation does not trigger fallback downloads. An import never puts the file in an ordinary chat attachment.

## Navigation and status lifetime

The frontend distinguishes unresolved bootstrap (`undefined`) from Home (`null`). After drawer registration and `ctx.ready()`, it makes one guarded `ctx.getActiveChat()` query when the host provides that helper; older or temporarily unavailable hosts fall back to the backend's selected chat. After bootstrap, `CHAT_SWITCHED` alone changes selection. Message and render events can refresh only the selected chat and never select one. Navigation clears the snapshot, widget timers, private-state cache, and pending setup requests and saves. Status payloads must match the current selection exactly, including `null`.

The backend retains explicit Home selection per user. Frontend requests can establish a chat only during unresolved bootstrap and cannot override a known selection. An explicit `chatId: null` request never falls back to a remembered chat. Reconciliation remains keyed to its originating chat and may finish while the user is on Home or another chat; status publication rechecks selection after asynchronous reads and suppresses results for chats the user has left.

## Update transaction

For each eligible assistant turn, the backend generates a complete action-marked replacement state, materializes it into canonical schema v4, validates it, rereads the selected branch, compares its prefix fingerprint, and only then saves a checkpoint. Failed or stale results do not mutate current state. The provider sees no source-message identifiers: `preserve` copies prior canonical provenance, while `update` receives the current assistant source in backend code. Relationship and private-response updates additionally require a nonempty `latestChange` summary.

Queues serialize updates per chat while allowing different chats to proceed independently. Prompt interception waits for the selected turn's bounded reconciliation and then injects the newest committed state.

## Surprise Me sampler

Before any stable case exists, an explicit `Surprise Me` setup command may receive one deterministic private sampler block. A bare `1` receives that block only when the immediately preceding assistant message contains the branch-local `DATE_SIM_STARTUP_MENU_V1` marker. Pure state logic removes prior sampler and startup-menu markers from the provider-bound copy, fingerprints the selected assembled prefix plus chat ID, draws each axis through a seeded generator, and returns one prompt-only system message immediately before the final user command. The sampler does not read prompt examples as live state, does not mutate the transcript or chat variables, does not select cultural identity or outcome, and is inactive for every other setup path and active case.

## Stable-case prompt authority

The card wraps its chat-variable fallback in `date_simulator_saved_case_fallback`. When a validated extension case is active, prompt compaction replaces that structurally bounded fallback with a short managed placeholder and injects exactly one self-contained canonical block containing STABLE CASE, CURRENT SCENE, and CURRENT ARC. The extension does not match neighboring instructional prose. Unmarked legacy fallback text is left untouched rather than guessed at.

## Trust boundaries

The public transcript is untrusted tracker input. State fields reject HTML comments and Date Simulator XML-like envelopes. Strict key sets, length bounds, list caps, action validation, backend-owned provenance, and final canonical source checks reduce accidental prompt/state injection. The interceptor marks injected data as private and the card separately forbids exposing it.

Canonical extension storage, checkpoints, chat-variable mirrors, migrations, and opt-in private inspection retain the complete schema-v4 JSON object. Tracker generation uses a separate provider schema with the same outer paths and `action` in place of every `sourceMessageId`; the previous provider state is likewise stripped of provenance before generation. Backend materialization is the only bridge from that action protocol to canonical provenance. The late interceptor derives a one-way private prompt projection from the validated canonical object: it preserves every established scene, arc, relationship, private-response, NPC, and objective value while omitting provenance identifiers, empty collections, and known unknown/default values. The projection defines omitted fields as unknown or empty and is never parsed back into canonical state.

The tracker has no chat-mutation capability itself. Only the backend commits validated state, and it verifies the branch immediately before doing so.

## Profile-card handshake

The stable `DATE_SIM_CASE` capsule in the selected stored branch is authoritative. The backend validates and saves it directly; it never clicks the Regex Script action. Profile persistence completes before tracker generation and is mirrored to Lumiverse chat variables for card-macro interoperability.

The companion card exposes stable checking, live-engine, and manual-fallback hooks. While the frontend is loaded, extension-owned CSS switches every newly rendered card to the live-engine state before message-specific status arrives and hides the manual action by default. A cached backend status then updates the exact case-message card. A scoped mutation observer reapplies that status if Lumiverse inserts or replaces the card after the message event. If the frontend appears but the backend does not confirm a newly rendered profile within four seconds, a watchdog reports that distinction and restores the manual fallback. Manual saving is otherwise exposed only when automatic profile persistence remains unconfirmed because of configuration, permissions, or an unsaved failure; it never reappears after a successful save merely because tracker generation is disabled or degraded. An invalid capsule cannot be repaired by the manual action.

## Frontend components

The Continuity drawer uses Lumiverse host-mounted switches, selects, numeric inputs, badges, and checkboxes when the shared component bridge is available. Advanced and private sections use persistent theme-matched HTML details because Lumiverse's mounted collapsible removes its body while closed, which would destroy nested component mounts. Action buttons use Lumiverse theme tokens because the host does not expose a general mounted button. If any required shared form component is unavailable, the drawer falls back as one complete set to themed HTML controls instead of mixing two visual systems.

When enabled, a native `ui_panels` float widget provides an ambient frontend-only projection of the same public status payload. It reuses the drawer's Continuity icon, appears only for chats with a detected Date Simulator profile, opens the existing drawer when clicked, and uses color plus reduced-motion-aware pulses for updating, committed, and attention states. A short processing debounce suppresses flashes from no-change verification passes, and a completion pulse is shown only when the committed revision increases. Disabling the preference destroys the widget; missing or revoked UI-panel capability leaves tracking unchanged and reports the widget as unavailable in the drawer.

Every status payload also contains a deliberately narrow public projection for the drawer. It includes scene and arc lifecycle status without their reasons or sources, observable scene facts, the woman's stable visible face/eyes/skin/body traits and temporary appearance/state, the man's structured visible state, structured positions/contact/items, established relationship status, latest public change, and public NPC fields. Mental state, lifecycle reasons, boundaries, objectives, NPC intentions, the complete private response vector, and source-message identifiers never enter this projection. The complete canonical JSON is returned only after the user enables private-state inspection.

## Migration

Legacy cases are not processed until the user explicitly requests migration. A successful migration produces one baseline checkpoint at the latest eligible selected turn. Subsequent updates start after that baseline. Editing or swiping away the baseline invalidates it and requires a new conservative reconciliation.

Profile status is cached by case-message ID without private payloads and reapplied when message DOM arrives. Observers cover open Shadow DOM roots, with bounded delayed rescans for roots attached after the host event. Exact-message updates run before drawer rendering; unrelated background MESSAGE_SENT events cannot change the active chat.

`CHAT_SWITCHED` uses one reset function so a stale save completion cannot leave setupBusy set in another chat. Rendered-message events never change selection. Repeated saves on the same chat deliberately create fresh native pickers; HTTP exports retain the prepared JSON until replaced or the chat changes; each download button click creates a fresh temporary anchor.
