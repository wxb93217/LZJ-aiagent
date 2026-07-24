# Design QA

- source visual truth path: `C:\Users\xbwu02\AppData\Local\Temp\codex-clipboard-fd0d217d-f40e-47d1-8897-8e4b4cac7a68.png`
- implementation screenshot path: not captured
- viewport: intended comparison viewport `1920 × 916`
- source pixels: `1920 × 916`
- implementation pixels: unavailable
- CSS size and density normalization: intended `1920 × 916` CSS pixels at `1x`; implementation capture unavailable
- state: assistant answer with inline web citations and the right-side search-results drawer open

## Full-view comparison evidence

The source screenshot was opened and reviewed. The implementation could not be captured in the selected in-app browser: its localhost address resolved to an unrelated static workspace, while the LAN-host address timed out. Because the two artifacts could not be placed into the same visual comparison input, no visual fidelity claim is made.

## Focused region comparison evidence

Blocked for the same reason. The intended focused region was the inline citation treatment, drawer header, source-card metadata, active-source state, and mobile drawer treatment.

## Findings

- [P2] Browser-rendered visual evidence is unavailable.
  - Location: full chat page and right-side search drawer.
  - Evidence: the source visual is available, but the current implementation could not be captured from the selected browser.
  - Impact: typography, spacing, drawer width, card density, and animation cannot receive a valid source-versus-implementation visual pass.
  - Fix: open the verified local build in a browser that can reach `http://127.0.0.1:4173`, trigger a web-search response, open the source drawer, capture at `1920 × 916`, and compare both images together.

## Required fidelity surfaces

- Fonts and typography: code-level review complete; browser comparison blocked.
- Spacing and layout rhythm: code-level review complete; browser comparison blocked.
- Colors and visual tokens: implemented using the existing warm product palette with a restrained blue source-link accent; browser comparison blocked.
- Image quality and asset fidelity: existing app assets are unchanged; source favicons use result-provided image URLs with an icon-library fallback; browser comparison blocked.
- Copy and content: drawer labels, source count, site/date metadata, excerpts, and “打开原文” action are present; browser comparison blocked.

## Comparison history

- Iteration 1: implementation completed and build/lint/tests passed. Visual comparison could not start because no browser-rendered implementation capture was available.

## Implementation checklist

- [x] Stream structured search-source metadata with the assistant message.
- [x] Render clickable inline Markdown citations.
- [x] Open and position the right-side results drawer from a matching citation.
- [x] Provide a source-count trigger when the model does not emit an inline citation.
- [x] Open source cards in a new tab.
- [x] Add desktop and mobile drawer layouts.
- [x] Persist source metadata with local conversation history.
- [ ] Capture and compare the browser-rendered drawer state against the source visual.

## Follow-up polish

- Revisit drawer width and source-card density after a valid same-viewport screenshot is available.

final result: blocked
