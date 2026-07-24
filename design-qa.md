# Design QA

- source visual truth path: `C:\Users\xbwu02\AppData\Local\Temp\codex-clipboard-62507b60-07ab-48dc-9070-3c48e82d3bd5.png`
- implementation screenshot path: not captured
- viewport: intended comparison viewport `1920 × 919`
- source pixels: `1920 × 919`
- implementation pixels: unavailable
- CSS size and density normalization: intended `1920 × 919` CSS pixels at `1x`; implementation capture unavailable
- state: completed web-search answer where the search execution summary is incorrectly shown inside the user question bubble

## Full-view comparison evidence

The source screenshot was opened and reviewed. The red-circled text, “搜索 4 个关键词，参考 21 篇资料”, is web-search execution metadata rather than user-authored question content. The implementation could not be captured in the selected in-app browser because the local preview remains unreachable there, so no final pixel-fidelity claim is made.

## Focused region comparison evidence

The intended focused comparison region is the user question bubble, the new web-search activity note beneath it, and the reasoning panel immediately below. Source evidence is available; browser-rendered implementation evidence is blocked.

## Findings

- [P2] Browser-rendered visual evidence is unavailable.
  - Location: question bubble, web-search activity note, and reasoning panel.
  - Evidence: the source visual is available, but the current implementation could not be captured from the selected browser.
  - Impact: final spacing, color, and wrapping cannot receive a valid screenshot-to-screenshot visual pass.
  - Fix: open the verified local build in a browser that can reach the app, load the affected historical conversation, capture at `1920 × 919`, and compare both images together.

## Required fidelity surfaces

- Content placement: implemented so the search execution summary is removed from the question bubble and placed in a dedicated “联网搜索” status note before the reasoning panel.
- Historical conversations: display-time extraction repairs previously stored messages without rewriting local history.
- Model context: server-side sanitization prevents the execution summary from being sent back to the model as user content.
- Responsive behavior: the status note uses the assistant content alignment on desktop and full available width on mobile.
- Fonts, spacing, and colors: code-level review complete; browser comparison blocked.

## Comparison history

- Iteration 1: implementation completed; static tests, lint, build, and diff validation passed. Visual comparison could not start because no browser-rendered implementation capture was available.

## Implementation checklist

- [x] Detect the web-search execution summary independently of surrounding whitespace.
- [x] Remove the summary from user and assistant text rendering.
- [x] Render the summary as a dedicated “联网搜索” status note.
- [x] Position the note below the question and before the reasoning panel.
- [x] Repair the presentation of existing stored conversations at render time.
- [x] Sanitize the summary from subsequent model context and search queries.
- [x] Add responsive styling and regression assertions.
- [ ] Capture and compare the browser-rendered result against the source visual.

## Follow-up polish

- Revisit the status-note spacing after a valid same-viewport implementation screenshot is available.

final result: blocked
