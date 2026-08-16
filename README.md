# Date Simulator Continuity Engine

An optional Lumiverse extension for Date Simulator v1.4 and v1.5. It runs a small background LLM update after immersive turns, stores branch-safe scene, relationship, and private-response checkpoints, and privately injects the latest state before the next roleplay generation.

For v1.5 Surprise Me setup, it also injects one deterministic branch-stable casting draw across independent situation and engagement axes. The draw is prompt-only, idempotent, never becomes story state, and never selects an outcome.

## Compatibility

- Intended cards: `Date_Simulator_CCv3_v1.5.json` and the v1.4 family.
- Matching companion regex package: `Date_Simulator_Persistent_State_v1.5.json` or the card's v1.4 companion.
- Do not enable the legacy v1.3.1 State Bridge on the same chat.
- v1.4 and v1.5 remain usable without this extension, but they deliberately have no inline structured scene fallback.

## Install

1. In Lumiverse, install the extension from `https://github.com/CreativityPod/lumiverse-date-simulator-continuity-engine`.
2. Grant `generation`, `interceptor`, and `chat_mutation` permissions.
3. Open the **Continuity** drawer and optionally select a tracker connection and structured-output mode. With no selection, the active default connection and automatic provider detection are used.
4. Import the companion matching the card version so the private-profile warning card and reset action render correctly.

## What it tracks

Scene: date, time, weather, location, immediate context, the woman's temporary hair/grooming, dress, temporary physical and mental state, the man's explicitly established or directly caused visible state, and spatial continuity.

Arc: relevant recurring NPCs, current relationship, active boundary or concern, latest sourced relationship change, and at most three immediate objectives.

Private response in tracker schema v2: available attention, comfort and safety, rapport and trust, physical attraction, personal and romantic interest, age-appropriate sexual interest, willingness to continue, contact-exchange interest, desire to leave, and active uncertainty. These are qualitative private continuity fields, never scores, public cues, outcome promises, or consent state. Teen Mode sexual interest is normalized locally to `Not applicable in Teen Mode.` They are omitted from the always-visible public snapshot.

## Status behavior

The companion profile card starts in a neutral checking state. While the extension frontend is loaded, a persistent presence handshake immediately replaces that fallback with live engine status, including when Lumiverse renders or replaces the card after the original message event. The backend validates and saves the stable profile locally before starting tracker generation; it never simulates a click on the Regex Script action.

- Green: private profile saved; automatic scene and arc tracking is ready.
- Amber: disabled, missing permission, processing, migration required, or using the last valid state after an error.

The manual profile action is only a fallback when the extension is absent or automatic profile persistence cannot be confirmed because of configuration, permissions, or an unsaved error. It remains hidden after a valid automatic save even if tracking is disabled or a later tracker update is degraded. With a functioning engine, no per-case click is required.

## Turn and recovery behavior

The tracker starts after every eligible assistant response. Before the next roleplay generation, the prompt interceptor queues a verification pass and waits for reconciliation of the latest completed assistant turn to finish. Each provider request is bounded by the configured tracker timeout; a failed request retains the last valid state and marks the engine degraded.

Tracker output is normalized conservatively and then passed through the strict validator before commit. Invalid leaf fields preserve their previous values, oversized safe text is truncated, malformed NPC or objective collections preserve the previous collection, and unsupported relationship source linkage preserves the previous relationship. A repair call is reserved for structurally unusable output.

Structured-output modes are **Auto**, **OpenAI-compatible JSON Schema**, **Anthropic Tool**, and **Plain JSON**. Auto uses Lumiverse connection metadata; it does not probe the provider with an extra generation.

For LM Studio, the extension's **OpenAI-compatible JSON Schema** mode supplies `response_format` on the API request and does not require the Structured Output control in LM Studio's chat UI to be enabled. The provider-facing schema is intentionally structural and regex-free for llama.cpp grammar compatibility; exact text limits and markup rejection remain enforced locally before state is committed.

The Continuity drawer always shows a privacy-safe observable snapshot: current scene, the woman's visible grooming/dress/physical state, the man's visible state, spatial continuity, established relationship status, latest relationship change, and public NPC facts. Mental state, boundaries, objectives, NPC intentions, and source IDs remain private and appear only when **Show private tracker state** is explicitly enabled.

The drawer also permits private-state inspection, reprocessing the latest turn, configuration changes, and explicit v1.3.1 migration. It uses Lumiverse's host-mounted selects, switches, numeric inputs, badges, and checkboxes when available. Persistent theme-matched details sections keep those mounted controls alive while collapsed. Older hosts receive one consistent theme-token HTML fallback.

## Troubleshooting

- If the tracker menu shows only **Active default connection**, use **Refresh Connections** and read the diagnostic directly below the menu. Named profiles require the extension's `generation` permission; the active default remains a valid automatic choice.
- If a profile card remains in its checking/no-engine fallback after updating, confirm Continuity Engine v1.2.4 and the card's current persistent-state companion are installed. Version 1.2.2 and later detect and update profile cards inside Lumiverse's open Shadow DOM HTML islands; no extra chat turn or manual click should be required.
- After updating, verify that `generation`, `interceptor`, and `chat_mutation` are all granted and that tracking is enabled. Tracking being enabled does not itself grant those permissions.
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

## Development

```sh
npm run check
```

This builds both entry points, runs unit tests, and validates the extension package.
