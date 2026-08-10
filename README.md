# Date Simulator Continuity Engine

An optional Lumiverse extension for Date Simulator v1.4. It runs a small background LLM update after immersive turns, stores branch-safe scene and relationship-arc checkpoints, and privately injects the latest state before the next roleplay generation.

## Compatibility

- Intended card: `Date_Simulator_CCv3_v1.4.json`
- Companion regex package: `Date_Simulator_Persistent_State_v1.4.json`
- Do not enable the legacy v1.3.1 State Bridge on the same chat.
- v1.4 remains usable without this extension, but it deliberately has no inline structured scene fallback.

## Install

1. In Lumiverse, install the extension from `https://github.com/CreativityPod/lumiverse-date-simulator-continuity-engine`.
2. Grant `generation`, `interceptor`, and `chat_mutation` permissions.
3. Open the **Continuity** drawer and optionally select a tracker connection and structured-output mode. With no selection, the active default connection and automatic provider detection are used.
4. Import the v1.4 regex companion so the private-profile warning card and reset action render correctly.

## What it tracks

Scene: date, time, weather, location, immediate context, the woman's temporary hair/grooming, dress, temporary physical and mental state, the man's explicitly established or directly caused visible state, and spatial continuity.

Arc: relevant recurring NPCs, current relationship, active boundary or concern, latest sourced relationship change, and at most three immediate objectives.

## Status behavior

The profile card is amber by default because a regex script cannot itself prove that an extension is running. Once the backend and frontend are ready, the extension validates and saves the stable profile locally before starting tracker generation, then updates that card:

- Green: private profile saved; automatic scene and arc tracking is ready.
- Amber: disabled, missing permission, processing, migration required, or using the last valid state after an error.

The manual profile action is only a no-extension or missing-permission fallback. With a functioning engine, no per-case click is required.

## Turn and recovery behavior

The tracker starts after every eligible assistant response. Before the next roleplay generation, the prompt interceptor queues a verification pass and waits for reconciliation of the latest completed assistant turn to finish. Each provider request is bounded by the configured tracker timeout; a failed request retains the last valid state and marks the engine degraded.

Tracker output is normalized conservatively and then passed through the strict validator before commit. Invalid leaf fields preserve their previous values, oversized safe text is truncated, malformed NPC or objective collections preserve the previous collection, and unsupported relationship source linkage preserves the previous relationship. A repair call is reserved for structurally unusable output.

Structured-output modes are **Auto**, **OpenAI-compatible JSON Schema**, **Anthropic Tool**, and **Plain JSON**. Auto uses Lumiverse connection metadata; it does not probe the provider with an extra generation.

For LM Studio, the extension's **OpenAI-compatible JSON Schema** mode supplies `response_format` on the API request and does not require the Structured Output control in LM Studio's chat UI to be enabled. The provider-facing schema is intentionally structural and regex-free for llama.cpp grammar compatibility; exact text limits and markup rejection remain enforced locally before state is committed.

The Continuity drawer also permits private-state inspection, reprocessing the latest turn, configuration changes, and explicit v1.3.1 migration.

## Troubleshooting

- If the tracker menu shows only **Active default connection**, use **Refresh Connections** and read the diagnostic directly below the menu. Named profiles require the extension's `generation` permission; the active default remains a valid automatic choice.
- If a rendered private-profile card still says the engine is not detected, switch back to the chat or render/send one message after updating the extension. Version 1.0.1 also recovers the current chat ID from rendered and sent-message events, so the warning is replaced as soon as the startup handshake completes.
- After updating, verify that `generation`, `interceptor`, and `chat_mutation` are all granted and that tracking is enabled. Tracking being enabled does not itself grant those permissions.
- Tracker timeouts may be configured from 5 through 300 seconds. Version 1.0.2 fixes the earlier 120-second validation ceiling.
- Version 1.0.3 forwards the Lumiverse user scope through connection lookup and background generation, which is required when the extension is installed in operator scope.
- Version 1.0.4 places that operator user scope in `GenerationRequestDTO.userId`, matching the Lumiverse 1.1 runtime contract for direct generation.
- Version 1.0.5 uses Lumiverse's normalized top-level tool schema for Claude connections, retries one schema-rejected tracker result, and reports the exact rejected field without exposing private state.
- Version 1.0.6 raises the fresh-install tracker output ceiling default from 1,200 to 2,000 tokens for more reliable complete JSON from local and long-haul trackers.
- Version 1.0.7 adds visible started, completed, no-chat, and tracker-error feedback for Reprocess Latest Turn and migration actions.
- Version 1.0.8 saves stable profiles before tracker generation, adds a strict next-turn checkpoint barrier, supports explicit output modes, aligns provider constraints with runtime validation, reports exact field diagnostics, and conservatively recovers valid state sections without spending a repair call on a malformed optional objective.
- Version 1.0.9 removes PCRE shorthand patterns that llama.cpp could not compile into a grammar, adds the complete expected JSON shape to the normal tracker prompt, improves Auto detection for custom OpenAI-compatible connections, and gives drawer dropdowns and buttons explicit Lumiverse 1.1-compatible affordances.

## Development

```sh
npm run check
```

This builds both entry points, runs unit tests, and validates the extension package.
