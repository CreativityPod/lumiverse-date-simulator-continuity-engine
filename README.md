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

## Troubleshooting

- If the tracker menu shows only **Active default connection**, use **Refresh Connections** and read the diagnostic directly below the menu. Named profiles require the extension's `generation` permission; the active default remains a valid automatic choice.
- If a rendered private-profile card still says the engine is not detected, switch back to the chat or render/send one message after updating the extension. Version 1.0.1 also recovers the current chat ID from rendered and sent-message events, so the warning is replaced as soon as the startup handshake completes.
- After updating, verify that `generation`, `interceptor`, and `chat_mutation` are all granted and that tracking is enabled. Tracking being enabled does not itself grant those permissions.
- Tracker timeouts may be configured from 5 through 300 seconds. Version 1.0.2 fixes the earlier 120-second validation ceiling.
- Version 1.0.3 forwards the Lumiverse user scope through connection lookup and background generation, which is required when the extension is installed in operator scope.

## Development

```sh
npm run check
```

This builds both entry points, runs unit tests, and validates the extension package.
