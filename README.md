# Date Simulator Continuity Engine

An optional Lumiverse extension for Date Simulator v1.4 and v1.5. It runs a small background LLM update after immersive turns, stores branch-safe scene, relationship, and private-response checkpoints, and privately injects a compact projection of the latest state before the next roleplay generation.

For v1.5.5 Surprise Me setup, it also injects one deterministic branch-stable casting draw across independent situation and engagement axes. An explicit `Surprise Me` always qualifies before a case is saved; a bare `1` qualifies only after the marked top-level startup menu. The draw is prompt-only, idempotent, never becomes story state, and never selects an outcome.

## Compatibility

- Intended card: `Date_Simulator_CCv3_v1.5.6.json`.
- Matching companion regex package: `Date_Simulator_Persistent_State_v1.5.6.json`.
- Do not enable the legacy v1.3.1 State Bridge on the same chat.
- Earlier v1.4/v1.5 prompts remain recognizable for continuity tracking, but contextual numeric startup routing and structural saved-case suppression require the coordinated v1.5.5 markers.
- v1.5.5 remains usable without this extension, but it deliberately has no inline structured scene fallback.

## Install

1. In Lumiverse, install the extension from `https://github.com/CreativityPod/lumiverse-date-simulator-continuity-engine`.
2. Grant `generation`, `interceptor`, `chat_mutation`, and `ui_panels` permissions. The first three power continuity tracking; `ui_panels` is used only for the optional floating status widget.
3. Open the **Continuity** drawer and optionally select a tracker connection and structured-output mode. With no selection, the active default connection and automatic provider detection are used.
4. Import the companion matching the card version so the private-profile warning card and reset action render correctly.

## Save and load an initial setup (v1.4.4)

Use Date Simulator **v1.5.6**, its matching persistent-state companion, and a Lumiverse host with `ctx.uploads.pickFile` and `spindle.chat.appendMessage` with generation support. The implementation follows the local Lumiverse 1.1.6 APIs. The existing permissions are sufficient.

- **Export Initial Setup** opens the native Save As picker when the browser supports it on a secure connection (HTTPS or localhost). Choose a location to write `date-simulator-initial-setup.json`.
- On a remote HTTP connection or a browser without that API, export prepares the file and displays a **Download JSON File** control styled like Lumiverse’s primary buttons. Click it to start the download. Whether a Save As window appears then depends on browser download settings; otherwise check Downloads. You can rename and keep as many files as you like.
- Canceling Save As writes no setup content. A save error is shown explicitly and offers the download button. Switching chats invalidates a pending export.
- At a fresh startup menu, click **Import Saved Setup — Choose File** in the greeting or use **Import Setup — Choose File** in the drawer. Typing `5` immediately after that menu, `Import Saved Setup`, or `/import` opens the import section; click Choose File to open the native picker.
- Select your JSON file. After **Setup loaded**, select **Begin Simulation**, or type `/begin`, to present the observable opening. Import and the opening do not run a tracker generation or advance the baseline. Normal play resumes from it.
- A case already in progress must be reset with `/new`, or you must open a new chat, before importing. A changed chat or a response in progress rejects import rather than replacing state in the wrong context. Canceling the picker changes nothing.

The file contains only the nine-field private case profile and the **frozen initial scene and arc state**, including the initial private response, plus format/version identifiers. It never includes later tracking, transcript history, checkpoints, chat IDs, or original source-message IDs. The file is plain readable JSON; ordinary roleplay and the import confirmation do not expose the private contents. Image-derived descriptions are preserved as text; original image attachments are not included.

The first valid opening checkpoint is saved separately from current tracking. Exporting later still exports that original baseline, even after reprocessing. A selected opening edit or swipe invalidates the old fingerprint. Older chats can export only when a valid original opening checkpoint is available; a migrated later checkpoint is never labeled as an original setup. Exports do not make a model call to reconstruct missing initial facts.

Import validates the complete file (format version 1, tracker schema v4, up to 256 KB) before writing a single setup anchor to the chat. The public anchor is a neutral confirmation; the private baseline is stored in extension message metadata. Canonical checkpoints and prompt injection are restored locally from it, including after reopening, sidecar recovery, or a chat fork. Deleting/swiping away the anchor or resetting the case deactivates it. Files are imported as recorded initial conditions, not guaranteed outcomes.

## What it tracks

Scene: narrative date and time, weather, location, immediate context, active/ended lifecycle, the woman's stable face, eyes, skin, body type and proportions, temporary hair/grooming, dress, temporary physical and mental state, the man's explicitly established or directly caused visible appearance/dress/physical state, and separate positions, proximity/contact, and important-item continuity. Narrative time advances only from completed fictional dialogue and action; real message delay and generation latency never advance it.

Arc: active/ended lifecycle, relevant recurring NPCs with latest-update sources, current relationship, active boundary or concern, latest sourced relationship change, and at most three immediate objectives with timing and latest-update sources.

Private response in tracker schema v4: available attention, comfort and safety, rapport and trust, physical attraction, personal and romantic interest, age-appropriate sexual interest, willingness to continue, contact-exchange interest, desire to leave, and active uncertainty. These are qualitative private continuity fields, never scores, public cues, outcome promises, or consent state. Teen Mode sexual interest is normalized locally to `Not applicable in Teen Mode.` They are omitted from the always-visible public snapshot.

## Status behavior

The companion profile card starts in a neutral checking state. While the extension frontend is loaded, a persistent presence handshake immediately replaces that fallback with live engine status, including when Lumiverse renders or replaces the card after the original message event. The backend validates and saves the stable profile locally before starting tracker generation; it never simulates a click on the Regex Script action.

- Green: private profile saved; automatic scene and arc tracking is ready.
- Amber: disabled, missing permission, processing, migration required, or using the last valid state after an error.

The optional floating continuity widget reuses the Continuity drawer's clock icon and appears only in chats with a detected Date Simulator profile. A steady green icon means continuity is current, a gentle teal pulse means the scene and arc are updating, a brief brighter-green pulse confirms a committed revision, and amber with a small `!` means the engine needs attention. Click the widget to open the Continuity drawer. It is draggable, snaps to a screen edge, respects reduced-motion preferences, and can be disabled immediately with **Show Widget** in the drawer. The widget is a frontend-only view of existing status; it does not alter messages, prompts, variables, or checkpoints.

The manual profile action is only a fallback when the extension is absent or automatic profile persistence cannot be confirmed because of configuration, permissions, or an unsaved error. It remains hidden after a valid automatic save even if tracking is disabled or a later tracker update is degraded. With a functioning engine, no per-case click is required.

## Turn and recovery behavior

The tracker starts after every eligible assistant response. Before the next roleplay generation, the prompt interceptor queues a verification pass and waits for reconciliation of the latest completed assistant turn to finish. Each provider request is bounded by the configured tracker timeout; a failed request retains the last valid state and marks the engine degraded.

On hosts that provide Lumiverse's source-to-fork message map, branching inherits the complete validated checkpoint prefix through the exact fork point. Canonical provenance, checkpoint keys, fingerprints, epoch identity, and any accepted migration baseline are remapped to the copied message IDs before the branch is reconciled. Later source-chat checkpoints are never copied. A missing, stale, or partially mapped checkpoint stops inheritance at the last proven contiguous prefix, so normal reconciliation generates only the genuinely missing branch tail.

Canonical storage, chat-variable mirrors, migration results, and opt-in private inspection remain complete schema-v4 JSON. Provider-facing tracker output keeps the same `scene` and `arc` paths but replaces opaque source-message identifiers with `preserve` or `update` actions. The backend assigns the current assistant source to updates and retains canonical provenance for preserved sections and exact unchanged list items. Prompt injection uses a private one-way compact projection that omits source-message identifiers, empty collections, and known unknown/default values while retaining established private-response, relationship, objective, NPC, and scene facts. Omitted prompt fields are explicitly defined as unknown or empty; stored state is not pruned or rewritten. The injected block remains visible through Lumiverse Prompt Breakdown and Dry Run.

Tracker output is materialized conservatively into canonical schema v4 and then passed through the strict validator before commit. A `preserve` action copies the prior canonical singleton section; an `update` action receives the current assistant source in backend code. Exact unchanged NPCs and objectives retain their prior sources, while updated or new entries receive the current source. Invalid actions, empty relationship/response update summaries, invalid leaf fields, and malformed collections preserve their prior canonical scope. A repair call is reserved for structurally unusable output.

Structured-output modes are **Auto**, **OpenAI-compatible JSON Schema**, **Anthropic Tool**, and **Plain JSON**. Auto uses Lumiverse connection metadata; it does not probe the provider with an extra generation.

For LM Studio, the extension's **OpenAI-compatible JSON Schema** mode supplies `response_format` on the API request and does not require the Structured Output control in LM Studio's chat UI to be enabled. The provider-facing schema is intentionally structural and regex-free for llama.cpp grammar compatibility; exact text limits and markup rejection remain enforced locally before state is committed.

The Continuity drawer always shows a privacy-safe observable snapshot: current scene and arc lifecycle, narrative date and time, the woman's stable face/eyes/skin/body traits and visible grooming/dress/physical state, the man's structured visible state, structured spatial continuity, established relationship status, latest relationship change, and public NPC facts. Lifecycle reasons, mental state, boundaries, objectives, NPC intentions, and source IDs remain private and appear only when **Show private tracker state** is explicitly enabled.

The drawer also permits private-state inspection, reprocessing the latest turn, configuration changes, explicit v1.3.1 migration, and confirmed cleanup of unused extension-owned tracking files. The cleanup action first reports orphaned and never-used sidecars, then requires a second click and a fresh safety check before deletion. It uses Lumiverse's host-mounted selects, switches, numeric inputs, badges, and checkboxes when available. Persistent theme-matched details sections keep those mounted controls alive while collapsed. Older hosts receive one consistent theme-token HTML fallback.

Returning Home hides the floating widget, clears the drawer's chat snapshot and pending setup saves, and leaves the frontend idle until a chat is opened. A tracker update already in progress can finish saving its checkpoint without restoring the old chat UI.

## Troubleshooting

- If the tracker menu shows only **Active default connection**, use **Refresh Connections** and read the diagnostic directly below the menu. Named profiles require the extension's `generation` permission; the active default remains a valid automatic choice.
- If a profile card remains in its checking/no-engine fallback after updating, confirm Continuity Engine v1.4.4 and the card's current persistent-state companion are installed. Version 1.2.2 and later detect and update profile cards inside Lumiverse's open Shadow DOM HTML islands; no extra chat turn or manual click should be required.
- After updating, verify that `generation`, `interceptor`, and `chat_mutation` are all granted and that tracking is enabled. Grant `ui_panels` if the optional floating status widget is enabled. Tracking being enabled does not itself grant those permissions.
- Tracker timeouts may be configured from 5 through 120 seconds. The manifest gives prompt reconciliation a five-minute host budget, enough for one maximum-length request plus its single permitted repair and overhead. The fresh-install default is 30 seconds.
- Version 1.0.3 forwards the Lumiverse user scope through connection lookup and background generation, which is required when the extension is installed in operator scope.
- Version 1.0.4 places that operator user scope in `GenerationRequestDTO.userId`, matching the Lumiverse 1.1 runtime contract for direct generation.
- Version 1.0.5 uses Lumiverse's normalized top-level tool schema for Claude connections, retries one schema-rejected tracker result, and reports the exact rejected field without exposing private state.
- Version 1.0.6 raises the fresh-install tracker output ceiling default from 1,200 to 2,000 tokens for more reliable complete JSON from local and long-haul trackers.
- Version 1.0.7 adds visible started, completed, no-chat, and tracker-error feedback for Reprocess Latest Turn and migration actions.
- Version 1.0.8 saves stable profiles before tracker generation, adds a strict next-turn checkpoint barrier, supports explicit output modes, aligns provider constraints with runtime validation, reports exact field diagnostics, and conservatively recovers valid state sections without spending a repair call on a malformed optional objective.
- Version 1.0.9 removes PCRE shorthand patterns that llama.cpp could not compile into a grammar, adds the complete expected JSON shape to the normal tracker prompt, improves Auto detection for custom OpenAI-compatible connections, and gives drawer dropdowns and buttons explicit Lumiverse 1.1-compatible affordances.
- Version 1.0.10 replaces the timing-sensitive profile-card update with a persistent presence handshake and delayed-render observer, keeps manual saving strictly as a fallback, and rebuilds the Continuity drawer with Lumiverse host-mounted components plus a complete theme-token compatibility mode.
- Version 1.0.11 opts the profile card out of Lumiverse HTML-island isolation, preserves claimed manual-button styling, keeps mounted advanced/private controls alive inside persistent details sections, and adds an always-visible privacy-safe continuity snapshot.
- Version 1.2.0 supports Date Simulator v1.5, upgrades schema-v1 checkpoints conservatively, adds the private qualitative response vector, mirrors full arc state to `date_simulator.arc_v2` while retaining a response-free `arc_v1` compatibility mirror, and aligns tracker and manifest timeouts with Lumiverse's interceptor budget. Its Surprise Me sampler injects exactly one branch-stable private draw before the final setup command while leaving other setup paths and active cases unchanged.
- Version 1.2.1 expands v1.5 recognition to v1.5.x patch cards and updates readiness diagnostics accordingly; tracker schema and behavior remain unchanged.
- Version 1.2.2 traverses open Shadow DOM HTML islands for profile-card lookup, applies status presentation inside the shadow root, and rescans mounted message bubbles so automatic profile confirmation remains visible under Lumiverse HTML isolation and virtualization.
- Version 1.2.3 displays revision timestamps using the browser's locale and local time zone, and makes private-state visibility explicit and resilient to stale public-only status responses.
- Version 1.2.4 records revision number and revision time together through one extension-owned commit helper. Reloads, status requests, and no-change reconciliation leave both values untouched; the drawer labels the timestamp as **Last revised**.
- Version 1.2.5 upgrades tracker state to schema v3 with stable observable face, eyes, skin, and body-type/proportion fields, conservatively migrates older checkpoints to unknown values, and exposes those traits in the privacy-safe Continuity snapshot.
- Version 1.3.0 upgrades tracker state to schema v4. It treats date and time as a fictional narrative clock unaffected by real response delay, adds sourced current-scene and relationship-arc lifecycle, structures the man's visible state and spatial continuity, adds timing/source data to objectives and source data to recurring NPCs, and conservatively upgrades schema-v1 through schema-v3 checkpoints without creating scene history.
- Version 1.3.1 adds an optional native floating status widget that reuses the Continuity tab icon, pulses gently during sustained processing, confirms committed revisions, surfaces attention states, and opens the existing drawer without changing tracker or prompt behavior.
- Version 1.3.2 removes the floating widget's container chrome, places a plain attention mark at the icon's upper-right, and prevents drag-release clicks from opening the Continuity drawer.
- Version 1.3.3 renames the display switch to **Show Widget** and makes it hide/show and persist immediately without requiring **Save Settings**.
- Version 1.3.4 keeps full schema-v4 JSON for canonical state and private inspection while injecting a compact private prompt projection that removes provenance, empty collections, and known unknown/default values without dropping established continuity.
- Version 1.3.5 recognizes bare `1` as Surprise Me only after a branch-local marked startup menu, strips that routing marker from provider-bound assistant history, and structurally suppresses the card's marked saved-case fallback so the authoritative engine block contains the only stable-case copy.
- Version 1.3.6 removes source-message identifiers from provider prompts and structured output, retains the existing schema-v4 scene and arc paths, uses `preserve`/`update` actions at all six provenance-bearing locations, and assigns canonical source identifiers deterministically in backend code.
- Version 1.3.7 deletes chat sidecars after Lumiverse confirms chat deletion, prevents unrelated or inactive chats from creating new inert sidecars, and adds a two-step drawer cleanup action that safely removes orphaned and never-used tracking files while retaining malformed, changing, and historical stores.
- Version 1.3.8 inherits the exact validated checkpoint prefix when Lumiverse forks a chat, remaps every canonical source ID and checkpoint fingerprint to the copied branch messages, and prevents a normal branch from replaying one tracker request per historical turn.

- Version 1.4.3 restores the v1.4.1 Download JSON File button and its temporary-anchor click behavior at user request. It retains v1.4.2 drawer styling and chat-change cleanup.
- Version 1.4.4 makes navigation authoritative. Returning Home hides the widget and clears chat content from the drawer; late render events, background messages, and stale status responses cannot restore the previous chat. Background reconciliation can still finish and is shown when that chat is opened again.
- Version 1.4.2 matches Lumiverse drawer button typography, theme colors, and disabled treatment. HTTP downloads use a persistent native download link styled as a button, preserving the original user click instead of proxying through a hidden scripted link. Pending saves reset consistently on chat changes. Repeated exports/downloads are covered in frontend regressions.
- Version 1.4.1 adds visible import/export button outlines, synchronous native Save As activation and an explicit download fallback. It repairs profile status refreshes for delayed Shadow DOM rendering and prevents background message events from changing the active export target.
- Version 1.4.0 adds file export/import for frozen initial setups, a v1.5.6 greeting button, contextual import routing, and an observation-only imported opening. It preserves the profile and initial schema-v4 state through local metadata-backed recovery and forks.

## Development

```sh
npm run check
```

This builds both entry points, runs unit tests, and validates the extension package.

### Frontend regression checks

`npm ci` installs the development-only DOM test dependency; the shipped extension has no runtime dependencies. `npm run check` includes full frontend tests with the release companion markup. For visual verification, serve this folder locally and open `test/browser-regressions.html`; its backend is synthetic, and the checkbox exercises the download fallback. Automated file-handle tests do not certify native browser dialogs or an installed remote Lumiverse instance.

Drawer buttons follow the host FormComponents medium button: 13px times the font scale, weight 500, primary border matching the fill, and disabled opacity 0.4 with a not-allowed cursor. Keyboard focus retains a visible outline. If an HTTP download control responds but no download appears, check the site’s download permission and browser Downloads; a webpage cannot confirm completion of a native hyperlink download.
