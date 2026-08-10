# Architecture

The extension is split into five small modules:

- `schemas.js`: strict current-scene and current-arc schema plus local validation.
- `state.js`: capsule parsing, branch fingerprints, checkpoint selection, prompt compaction, and canonical injection.
- `tracker.js`: provider-aware quiet generation, prompts, JSON extraction, and validation.
- `backend.js`: storage, queues, event reconciliation, migration, variable mirrors, readiness, and prompt interception.
- `frontend.js`: Continuity drawer and profile-card status integration.

## Persistence

Each chat has one extension-owned JSON store under `chats/`. It contains the active epoch, current state, per-turn checkpoints, migration baseline, revision, and diagnostic status. Chat IDs are reduced to safe storage tokens. The backend mirrors a compact subset to private chat variables for interoperability, but extension storage is canonical.

## Update transaction

For each eligible assistant turn, the backend generates a complete replacement state, validates it, rereads the selected branch, compares its prefix fingerprint, and only then saves a checkpoint. Failed or stale results do not mutate current state.

Queues serialize updates per chat while allowing different chats to proceed independently. Prompt interception waits briefly for that chat's queue and then injects the newest committed state.

## Trust boundaries

The public transcript is untrusted tracker input. State fields reject HTML comments and Date Simulator XML-like envelopes. Strict key sets, length bounds, list caps, and source-message checks reduce accidental prompt/state injection. The interceptor marks injected data as private and the card separately forbids exposing it.

The tracker has no chat-mutation capability itself. Only the backend commits validated state, and it verifies the branch immediately before doing so.

## Migration

Legacy cases are not processed until the user explicitly requests migration. A successful migration produces one baseline checkpoint at the latest eligible selected turn. Subsequent updates start after that baseline. Editing or swiping away the baseline invalidates it and requires a new conservative reconciliation.
