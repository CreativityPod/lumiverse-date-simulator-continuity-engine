# Architecture

The extension is split into five small modules:

- `schemas.js`: strict current-scene and current-arc schema plus local validation.
- `state.js`: capsule parsing, branch fingerprints, checkpoint selection, prompt compaction, and canonical injection.
- `tracker.js`: provider-aware quiet generation, prompts, JSON extraction, and validation.
- `backend.js`: storage, queues, event reconciliation, migration, variable mirrors, readiness, and prompt interception.
- `frontend.js`: native Continuity drawer, compatibility controls, and self-healing profile-card status integration.

## Persistence

Each chat has one extension-owned JSON store under `chats/`. It contains the active epoch, current state, per-turn checkpoints, migration baseline, revision, and diagnostic status. Chat IDs are reduced to safe storage tokens. The backend mirrors a compact subset to private chat variables for interoperability, but extension storage is canonical.

## Update transaction

For each eligible assistant turn, the backend generates a complete replacement state, validates it, rereads the selected branch, compares its prefix fingerprint, and only then saves a checkpoint. Failed or stale results do not mutate current state.

Queues serialize updates per chat while allowing different chats to proceed independently. Prompt interception waits briefly for that chat's queue and then injects the newest committed state.

## Trust boundaries

The public transcript is untrusted tracker input. State fields reject HTML comments and Date Simulator XML-like envelopes. Strict key sets, length bounds, list caps, and source-message checks reduce accidental prompt/state injection. The interceptor marks injected data as private and the card separately forbids exposing it.

The tracker has no chat-mutation capability itself. Only the backend commits validated state, and it verifies the branch immediately before doing so.

## Profile-card handshake

The stable `DATE_SIM_CASE` capsule in the selected stored branch is authoritative. The backend validates and saves it directly; it never clicks the Regex Script action. Profile persistence completes before tracker generation and is mirrored to Lumiverse chat variables for card-macro interoperability.

The companion card exposes stable checking, live-engine, and manual-fallback hooks. While the frontend is loaded, extension-owned CSS switches every newly rendered card to the live-engine state before message-specific status arrives and hides the manual action by default. A cached backend status then updates the exact case-message card. A scoped mutation observer reapplies that status if Lumiverse inserts or replaces the card after the message event. If the frontend appears but the backend does not confirm a newly rendered profile within four seconds, a watchdog reports that distinction and restores the manual fallback. Manual saving is otherwise exposed only when automatic profile persistence remains unconfirmed because of configuration, permissions, or an unsaved failure; it never reappears after a successful save merely because tracker generation is disabled or degraded. An invalid capsule cannot be repaired by the manual action.

## Frontend components

The Continuity drawer uses Lumiverse host-mounted switches, selects, numeric inputs, badges, checkboxes, and collapsible sections when the shared component bridge is available. Action buttons use Lumiverse theme tokens because the host does not expose a general mounted button. If any required shared component is unavailable, the drawer falls back as one complete set to themed HTML controls instead of mixing two visual systems.

## Migration

Legacy cases are not processed until the user explicitly requests migration. A successful migration produces one baseline checkpoint at the latest eligible selected turn. Subsequent updates start after that baseline. Editing or swiping away the baseline invalidates it and requires a new conservative reconciliation.
