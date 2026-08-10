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
3. Open the **Continuity** drawer and optionally select a tracker connection. With no selection, the active default connection is used.
4. Import the v1.4 regex companion so the private-profile warning card and reset action render correctly.

## What it tracks

Scene: date, time, weather, location, immediate context, the woman's temporary hair/grooming, dress, temporary physical and mental state, the man's explicitly established or directly caused visible state, and spatial continuity.

Arc: relevant recurring NPCs, current relationship, active boundary or concern, latest sourced relationship change, and at most three immediate objectives.

## Status behavior

The profile card is amber by default because a regex script cannot itself prove that an extension is running. Once the backend and frontend are ready, the extension updates that card:

- Green: private profile saved; automatic scene and arc tracking is ready.
- Amber: disabled, missing permission, processing, migration required, or using the last valid state after an error.

The Continuity drawer also permits private-state inspection, reprocessing the latest turn, configuration changes, and explicit v1.3.1 migration.

## Development

```sh
npm run check
```

This builds both entry points, runs unit tests, and validates the extension package.
