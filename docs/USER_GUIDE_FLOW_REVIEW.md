# User Guide — ai_flow_review

A practical walkthrough: from installing the tool to running your first flow regression check.

For the spec (why this exists, architecture), see [`../ai_ux_testing/docs/SPEC_AI_FLOW_REVIEW.md`](../../ai_ux_testing/docs/SPEC_AI_FLOW_REVIEW.md).
For the sibling UX-regression tool, see [`../../ai_ux_testing`](../../ai_ux_testing).

---

## 1. What this tool is for

`ai_flow_review` answers one question: **"is this UX flow simpler than it was last time — or has it quietly gotten worse?"**

It drives a recipe-defined flow in a real browser (mobile + desktop), measures click counts / duration / backtracks, and asks an AI reviewer two things:

1. *How much friction would a reasonable first-time user experience?*
2. *What specific changes would reduce that friction?*

The output is a **flow report** with a friction verdict (`low | medium | high`), evidence bullets, and concrete improvement suggestions. You promote the first report to a **reference**, and every future run is compared against it — regressions flagged, improvements flagged, suggestions updated.

## 2. What it is NOT for

- **Not a regression gate.** Output is qualitative. Don't block merges on it. For pass/fail gating of UX-level checks, use the sibling [`ai_ux_testing`](../../ai_ux_testing).
- **Not a session-replay tool.** It evaluates scripted flows, not real-user behaviour. For real-user analytics, use Hotjar/FullStory.
- **Not a performance profiler.** Duration is captured, but it's one measurement among many — network jitter alone can shift it 20%. Use Lighthouse for perf.

## 3. One-time setup

```bash
cd /home/markly2/claude_code/ai_flow_review
npm install
npx playwright install chromium     # only needed once per machine

# Seed credentials — same format as ai_ux_testing
cp .env.example .env.local
# Edit .env.local to add RECIPE_<NAME>_PWD=<value> entries
chmod 600 .env.local
```

API keys (`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) are auto-loaded from `.env.local`, and if not present there, from `../myspace2/api/.env` (the DatsMe shared env).

## 4. The mental model

```
Recipe ──► capture_flow ──► flow_run.json + screenshots + (optional) video
                       │
                       ▼
               review_flow (Sonnet by default)
                       │
                       ▼
              flow_report.json  ── approve ──►  flow_reference_reports/<recipe>.json
                       │
                       ▼
              next run: compare_flow  ──► flow_comparison.md, exit 2 on regression
```

Four nouns to know:

| Noun | Lives at | What it is |
|---|---|---|
| **Recipe** | `recipes/<id>.json` (or inherited from `ai_ux_testing/recipes/<id>.json`) | The flow to drive |
| **Capture** | `flow_runs/<recipe>__<timestamp>/` | One execution's raw artefacts |
| **Report** | `flow_runs/<…>/flow_report.json` + `.md` | AI's friction verdict + suggestions |
| **Reference** | `flow_reference_reports/<recipe>.json` | An approved report used as the comparison baseline |

## 5. Recipes — write once, use in both tools

Flow-review recipes are a **superset** of UX-test recipes. Any recipe authored for `ai_ux_testing` runs here without edits. The resolver checks `ai_flow_review/recipes/` first, then falls back to `ai_ux_testing/recipes/` — so you don't need to duplicate.

Minimal shape:

```json
{
  "id": "sara_personality_friend_view",
  "name": "Sara personality report — friend view",
  "description": "Friend opens sara.1's profile and reads her Big Five report.",
  "target": { "base_url": "http://localhost:19995" },
  "login": {
    "url": "/login",
    "username": "markly.1",
    "password_env": "RECIPE_MARKLY1_PWD"
  },
  "steps": [
    { "action": "goto", "path": "/sara.1/" },
    { "action": "click_text", "text": "My Big Five" },
    { "action": "screenshot", "name": "report_modal" }
  ],
  "checks": [
    "Modal opens when the Personality card is clicked."
  ],
  "viewports": ["mobile", "desktop"]
}
```

### Flow-review-specific fields (all optional)

```json
"flow_review": {
  "captureVideo": false,
  "flowDurationChangeToleratedPercent": 25,
  "describedUserIntent": "A friend visiting sara.1 wants to read her personality report."
}
```

- **`captureVideo`** — when `true`, writes a WebM of each viewport's flow to the run folder. Useful for human debugging; no provider currently reviews video.
- **`flowDurationChangeToleratedPercent`** — how much duration drift counts as a regression. Defaults to 25%. Network jitter alone can cause 10–20% variance, so don't set this too tight.
- **`describedUserIntent`** — one-sentence statement of what a user is trying to accomplish. **The single highest-impact field for review quality.** Lets the AI evaluate friction against intent rather than screen complexity in the abstract.

## 6. Example 1 — your first flow review

Goal: review the sara personality flow, approve as reference, detect a regression when the flow gets worse.

### Step 1. Capture + review in one command

```bash
node runner/capture_flow.js sara_personality_friend_view --review
```

What happens:
1. Playwright opens Chromium headless; drives the flow at mobile (375 px) and desktop (1280 px).
2. Timing, clicks, navigations, scrolls, and backtracks are measured per viewport.
3. Full-page screenshots written to `flow_runs/sara_personality_friend_view__<timestamp>/`.
4. `FLOW_REVIEW_PROMPT.md` is always written (cheap; useful even without `--review`).
5. With `--review`, the reviewer is invoked (Sonnet by default) — sees screenshots + metrics JSON + the prompt — returns structured JSON.
6. The response is validated and saved as `flow_report.json` + `flow_report.md`.

Terminal output looks like:

```
Capturing flow: sara_personality_friend_view (…)

=== capture done (completed) ===
  run folder: flow_runs/sara_personality_friend_view__20260420-211337
  screenshots: 10
  prompt:      flow_runs/…/FLOW_REVIEW_PROMPT.md

--- flow review ---
Reviewing flow … with claude:claude-sonnet-4-6 (10 screenshots)…
Wrote flow_runs/…/flow_report.json
  frictionVerdict: low
  evidence: 5 bullets
  suggestions: 5 items
```

### Step 2. Read the report

```bash
cat flow_runs/sara_personality_friend_view__<timestamp>/flow_report.md
```

You'll see something like:

```
# Flow report — sara_personality_friend_view

Friction verdict: `low`

## Summary
The flow is largely smooth … one click opens the personality modal with no
backtracks on either viewport — but a first-time visitor must scroll the
profile before finding the Personality card …

## Friction evidence
- User must scroll the main profile page before the About Me / Personality card is visible …
- Personality card preview text on mobile is truncated early …
- Modal requires 2 additional scroll_inside actions to reach the scores table …

## Suggested improvements
- Surface a brief personality type badge directly on the profile hero …
- Add a sticky or floating summary at the top of the personality modal …
- Move the OCEAN scores table near the top of the modal …

## Per-viewport metrics
### mobile
- Duration: 21813 ms
- Clicks: 1
- Navigations: 1
- Scrolls: 3
- Backtracks: 0
### desktop
- Duration: 22386 ms
- …
```

### Step 3. Promote this report as the reference

```bash
node runner/approve_flow.js sara_personality_friend_view
```

Outputs:
```
Wrote flow_reference_reports/sara_personality_friend_view.json
  reference name: default
  source run:     flow_runs/…
  verdict:        low
```

`ai_flow_review/flow_reference_reports/<recipe>.json` is the "this is how this flow looks when it's working" snapshot.

### Step 4. Change the product (or the recipe) and re-run

Either:
- **Edit the product code** (the typical case — you're iterating on UX), or
- **Edit the recipe** to simulate a worsening, for testing the tool.

Then:

```bash
node runner/capture_flow.js sara_personality_friend_view --review
node runner/compare_flow.js sara_personality_friend_view
```

If the flow got worse, you'll see:

```
Flow comparison — sara_personality_friend_view
  reference verdict: low
  candidate verdict: medium
  candidate run:     sara_personality_friend_view__<newer>

  Regressions:
    [mobile] totalClickCount: 1 → 2 (Δ 1)
    [mobile] totalDurationMs: 21974 → 40376 (83.7%)
    [mobile] detectedBacktrackCount: 0 → 1 (Δ 1)
    [desktop] totalClickCount: 1 → 2 (Δ 1)
    [desktop] totalDurationMs: 22859 → 41313 (80.7%)
    [desktop] detectedBacktrackCount: 0 → 1 (Δ 1)
    [(overall)] frictionVerdict: "low" → "medium"
```

Exit code 2 when regressions are detected — handy for CI, scripts, or `&&`-chaining.

### Step 5. Fix, or re-approve

If the regression was **unintentional** — fix your code, re-run, diff again.

If the regression was **intentional** (you know you added the extra step for a good reason) — re-approve:

```bash
node runner/approve_flow.js sara_personality_friend_view
```

Reference moves forward. Future diffs use the new reference.

## 7. Example 2 — selecting a reviewer model

The default reviewer is Claude Sonnet 4.6 — picked deliberately because friction judgment needs more reasoning than a UX regression "did the header render?" check. You can override per-invocation.

```bash
# Haiku — cheapest, likely shallow for friction analysis
node runner/review_flow.js sara_personality_friend_view --model haiku --force

# Opus — deepest reasoning, best for a major redesign triage
node runner/review_flow.js sara_personality_friend_view --model opus --force

# Gemini as an alternative provider
node runner/review_flow.js sara_personality_friend_view --model gemini-pro --force

# Mock — offline, deterministic, for CI pipeline tests that don't burn tokens
node runner/review_flow.js sara_personality_friend_view --model mock --force
```

`--force` is needed to overwrite an existing `flow_report.json`.

**Cost calibration (rough):** Haiku < $0.02 per run, Sonnet ≈ $0.05, Opus ≈ $0.15–0.25, depending on screenshot count and output length. For weekly use this is noise; for hourly CI it matters.

## 8. Example 3 — dry-run to inspect the request without sending

Useful for debugging cost / payload size / prompt composition:

```bash
node runner/review_flow.js sara_personality_friend_view --dry-run
```

Prints:
```
{
  "dryRun": true,
  "url": "https://api.anthropic.com/v1/messages",
  "model": "claude-sonnet-4-6",
  "numImages": 10,
  "approxPromptChars": 5431
}
```

No API call made. Nothing written. Handy when you want to tweak the prompt and see the shape before burning tokens.

## 9. Example 4 — multiple references per recipe

Useful when you have multiple "correct" states — per-environment, per-release, per-feature-flag.

```bash
# Approve distinct references for staging and production flows
node runner/approve_flow.js sara_personality_friend_view --name staging
node runner/approve_flow.js sara_personality_friend_view --name production

# Compare against a specific reference
node runner/compare_flow.js sara_personality_friend_view --reference staging
node runner/compare_flow.js sara_personality_friend_view --reference production
```

References live in `flow_reference_reports/<recipe>/<name>.json` when named; the default single-reference flat layout (`flow_reference_reports/<recipe>.json`) is still supported.

## 10. Example 5 — capturing video

By default video is off (WebM files add ~10–20 MB per viewport per run and no provider currently reviews them). Turn it on per-recipe:

```json
"flow_review": { "captureVideo": true }
```

Then:
```bash
node runner/capture_flow.js sara_personality_friend_view
ls flow_runs/sara_personality_friend_view__<timestamp>/
# → flow_mobile.webm, flow_desktop.webm, plus the usual files
```

Play back with any WebM-capable viewer (VLC, mpv, browser). Useful for:
- Triaging a run that scored unexpectedly high friction
- Spotting a flash of empty state you missed
- Walking a teammate through a flow you want to redesign

## 11. Example 6 — tuning the duration tolerance

Flow duration is noisy. Default tolerance is **25%**. Tune per recipe:

```json
"flow_review": { "flowDurationChangeToleratedPercent": 40 }
```

Or globally via env:

```bash
FLOW_DURATION_CHANGE_TOLERATED_PERCENT=40 node runner/compare_flow.js sara_personality_friend_view
```

If your test environment has particularly noisy networking (Docker, shared CI runners), loosen this. If you're profiling a highly-cached production surface, tighten it.

## 12. Example 7 — describing user intent

The `describedUserIntent` field is small but high-leverage.

**Without it**, the AI judges friction against a vague notion of "what would be reasonable for this screen." Output tends to be generic.

**With it**, the AI evaluates friction against the specific user goal. Output becomes grounded and actionable.

Compare these two `describedUserIntent` values for the same sara flow:

```json
"describedUserIntent": "A friend quickly scans sara's personality type before sending her a message."
```
vs
```json
"describedUserIntent": "A curious acquaintance wants to understand sara's full Big Five profile including sub-scores."
```

The first will push the AI toward suggesting a top-level trait badge. The second will push it toward surfacing the OCEAN scores table earlier. Neither is "right" — they serve different users. Declaring your target user focuses the review.

## 13. Command reference

| Command | Purpose |
|---|---|
| `node runner/capture_flow.js <recipe>` | Run the recipe; write screenshots, metrics, prompt |
| `node runner/capture_flow.js <recipe> --review` | Capture then review (Sonnet by default) |
| `node runner/capture_flow.js <recipe> --review --model opus` | Capture then review with Opus |
| `node runner/review_flow.js <recipe>` | Review the latest captured run |
| `node runner/review_flow.js <recipe> --run <ts>` | Review a specific run |
| `node runner/review_flow.js <recipe> --dry-run` | Print the request that would be sent |
| `node runner/review_flow.js <recipe> --force` | Overwrite existing `flow_report.json` |
| `node runner/approve_flow.js <recipe>` | Promote latest report to reference |
| `node runner/approve_flow.js <recipe> --name staging` | Name the reference (multi-reference) |
| `node runner/compare_flow.js <recipe>` | Diff latest report against default reference |
| `node runner/compare_flow.js <recipe> --reference staging` | Diff against a named reference |
| `./cleanup_flow_runs.sh` | Trim old screenshots and videos; preserve reviewed runs |

## 14. Understanding the output files

Inside each `flow_runs/<recipe>__<timestamp>/`:

| File | What it is |
|---|---|
| `01_<name>_<viewport>.png` | Full-page screenshot taken at each `screenshot` step |
| `flow_run.json` | Raw execution record: step log, durations, paths, screenshots, videos |
| `flow_metrics.json` | Computed metrics (per-viewport click/duration/backtrack counts) |
| `FLOW_REVIEW_PROMPT.md` | The Markdown prompt sent to the AI reviewer (always written) |
| `flow_report.json` | AI's structured friction report (only after review) |
| `flow_report.md` | Human-readable rendering of the report |
| `flow_report_invalid.json` | Written only if reviewer returned invalid JSON (for debugging) |
| `flow_comparison.md` | Written by `compare_flow.js`; lists regressions + improvements |
| `flow_mobile.webm` / `flow_desktop.webm` | Only when `captureVideo: true` |

Inside `flow_reference_reports/`:

| File | What it is |
|---|---|
| `<recipe>.json` | The default reference (flat layout) |
| `<recipe>/<name>.json` | Named references (multi-reference layout) |

## 15. Disk management

Flow runs accumulate. The cleanup script trims:

```bash
./cleanup_flow_runs.sh
```

What it does:
- Keeps the **100 newest** PNGs across all runs (configurable: `FLOW_KEEP_NEWEST_SCREENSHOT_COUNT`).
- Keeps the **20 newest** WebMs (configurable: `FLOW_KEEP_NEWEST_VIDEO_COUNT`).
- Preserves any folder that contains `flow_report.json` — reviewed runs stick around as audit trail.

Run it periodically (or add to your deploy script) so `flow_runs/` stays manageable.

## 16. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ANTHROPIC_API_KEY not set` | Env not found | Add key to `.env.local` or ensure `../myspace2/api/.env` has it |
| `page.goto Timeout 30000ms exceeded` | Slow target site or `networkidle` wait hanging | `FLOW_STEP_NAVIGATION_TIMEOUT_MS=60000 node runner/capture_flow.js …` |
| `Reviewer returned invalid flow report: perViewportMetrics.X: unknown viewport name` | AI wrapped metrics incorrectly | Check `flow_report_invalid.json`, retry — usually transient |
| `could not locate login inputs` | Non-standard login form | Override login flow via explicit `fill` steps with CSS selectors |
| Comparison keeps flagging duration as regression | Tolerance too tight | Raise `flowDurationChangeToleratedPercent` in recipe, or env override |
| Video file missing after `captureVideo: true` | Playwright didn't flush on crash | Rerun; check for error in `flow_run.json` |
| Same flow, different verdict on each run | Model non-determinism | Use `mock` reviewer for deterministic CI tests; for humans, accept minor variance |

## 17. Relationship to ai_ux_testing

| Question | Tool |
|---|---|
| "Did the page break?" | `ai_ux_testing` |
| "Is the flow simpler than last time?" | `ai_flow_review` |
| "Did this PR regress the signup UX?" | Both — run `ai_ux_testing` in CI for gate, `ai_flow_review` on demand for insight |

Both tools share:
- **Recipe format** (the extra `flow_review` block is optional in both)
- **Reviewer adapters** (same Claude / Gemini / mock plumbing, same model presets)
- **Env handling** (both pull from `.env.local` then `../myspace2/api/.env`)

Both tools are deliberately **decoupled**: `ai_flow_review` has zero import-time dependency on `ai_ux_testing`. Recipes are shared via filesystem, not code.

## 18. When to use which

- **Write a recipe in `ai_ux_testing/recipes/`** when the assertion is pass/fail ("modal opens", "title renders"). Run it on every PR.
- **Add `flow_review` block to that same recipe** when you also want to ask "is this the simplest way to do this?" — then run `ai_flow_review` on demand.
- **Write a recipe exclusively for `ai_flow_review`** (in `ai_flow_review/recipes/`) only when the flow is specifically about friction — e.g. a benchmark recipe you run against different product variants.

## 19. Cold-start for a new conversation

If you start a fresh AI coding session and want the assistant to understand this tool:

> "Read `ai_ux_testing/docs/SPEC_AI_FLOW_REVIEW.md` and `ai_flow_review/docs/USER_GUIDE.md`. The tool is shipped. I want to work on <new topic>."

Those two files are sufficient to rehydrate full context.

## 20. Success criteria for your first use

You're using the tool well when, within 10 minutes of opening the repo, you can:

1. Capture a flow for a recipe you care about.
2. Read the report and find at least one genuinely useful improvement suggestion.
3. Approve it as the reference.
4. Make a change to the product, re-run, and see a meaningful comparison.
5. Decide — based on the comparison — whether to keep the change or revert.

If any of those steps takes longer than expected, that's feedback for the tool. File it in `../ai_ux_testing/docs/ENHANCEMENT_OPTIONS.md` (or here, once this project has its own).
