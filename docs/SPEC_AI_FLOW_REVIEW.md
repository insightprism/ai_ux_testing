# Spec — ai_flow_review (standalone product)

Status: **Proposed** · Companion-but-separate to `ai_ux_testing` · Date: 2026-04-20

---

## 1. What this application does

**`ai_flow_review` analyses how hard a UX flow is to use, and suggests ways to make it simpler.**

It replays a deterministic flow in a real browser (mobile + desktop), captures timing, click counts, navigation paths, and screenshots, and asks an AI reviewer two questions:

1. *How much friction would a reasonable first-time user experience in this flow?*
2. *What specific changes would reduce that friction?*

It produces a **flow report** — a structured JSON plus a human-readable Markdown — with a friction verdict (`low | medium | high`), evidence, and concrete improvement suggestions. Reports can be compared against a prior report to detect flow-quality regressions ("we made the checkout harder this week") and surface improvements ("the redesigned signup takes half the clicks").

Crucially: **this is an advisory tool, not a regression gate.** Its output is qualitative. It runs on demand (before a redesign, after a redesign, or on a weekly cadence), not on every commit.

## 2. Why this is a separate product from `ai_ux_testing`

| Dimension | `ai_ux_testing` | `ai_flow_review` |
|---|---|---|
| **Question it answers** | Did we break something? | Could this be better? |
| **Output shape** | Binary pass / fail per check | Qualitative friction verdict + suggestions |
| **Default model** | Haiku (cheap, fast) | Sonnet (reasoning, moderate cost) |
| **CI fit** | Perfect — runs on every PR | Poor — advisory, not gate-worthy |
| **Runs at what cadence** | Every PR, every deploy | Before/after redesigns; weekly |
| **Authoring loop** | Same recipes for months | Recipes authored once, advisory output iterated on |
| **Maintenance rhythm** | Tight — breakage blocks merges | Loose — stale advice is harmless |

Merging them into one codebase would force one tool's conventions onto the other. Keeping them separate lets each evolve with its own ethos. Recipes remain portable: a recipe authored in `ai_ux_testing` can be analysed by `ai_flow_review` without edits.

## 3. Why it's worth building

### The gap it fills
UX regression tools (Cypress, Percy, `ai_ux_testing`) all answer *"did we break something?"* None answer *"is this still the simplest way to do this?"* As DatsMe iterates on flows weekly, the risk isn't that buttons break — it's that features accrete, clicks multiply, and the product gets *harder to use one tiny change at a time*. Traditional tooling is blind to that pattern.

### The value it delivers
- **Catches complexity creep.** If last month's signup flow took 4 clicks and this month's takes 7, the tool surfaces that immediately.
- **Delivers actionable UX feedback without a UX researcher on staff.** For a one-person team, this is the difference between "I should redesign this eventually" and "these three specific moments add friction — here's what to try."
- **Informs, rather than gates.** Because output is advisory, the team treats it as input to design decisions — not as a noisy CI alarm to ignore.
- **Compounds with `ai_ux_testing`.** Used together: UX testing ensures the flow works; flow review ensures it works *well*.

### What it explicitly does NOT do
- Does **not** record real users. That's session replay (Hotjar, FullStory) — a different product with different privacy and cost profiles.
- Does **not** replace usability studies. It simulates a reasonable-first-time-user judgment from a vision-capable AI, which is a 60–70% substitute — useful, not definitive.
- Does **not** gate CI. The output is qualitative, and wiring qualitative judgment to merge blocks produces alert fatigue and pushback.

---

## 4. Repository and module layout

Three sibling projects under `/home/markly2/claude_code/`:

```
claude_code/
├── ai_testing_shared/                   # NEW — extracted shared package
├── ai_ux_testing/                       # EXISTING — regression tool
└── ai_flow_review/                      # NEW — this product
```

### `ai_testing_shared/` — the small shared package

Purpose: own the code both tools need, nothing more. Intentionally small; resists scope creep.

```
ai_testing_shared/
├── package.json                         # Exports: recipe_loader, env_loader, reviewer, run_discovery
├── README.md                            # "What goes here, what doesn't"
├── lib/
│   ├── recipe_loader.js                 # Validates recipe JSON, resolves credentials
│   ├── env_loader.js                    # Reads .env.local then falls back to DatsMe env
│   ├── reviewer/
│   │   ├── index.js                     # resolveReviewerModel(name) → { provider, modelId, adapter }
│   │   ├── claude_reviewer.js           # Adapter for Anthropic API
│   │   ├── gemini_reviewer.js           # Adapter for Google API
│   │   └── mock_reviewer.js             # Offline adapter for tests
│   └── run_discovery.js                 # findRunsForRecipe, latestRunWithResult, etc.
└── tests/
    └── test_*.js
```

**What goes in shared:** anything strictly needed by both tools, with a stable interface.
**What stays out of shared:** prompts, result schemas, diff engines, CLIs — those are product-specific and should be allowed to diverge.

### `ai_flow_review/` — the new product

```
ai_flow_review/
├── package.json
├── README.md
├── USER_GUIDE.md
├── start_webserver.sh                   # Optional — recipe-authoring form (may reuse ai_ux_testing's later)
├── cleanup_flow_runs.sh                 # Prunes old flow runs + videos
├── config/
│   └── defaults.js                      # NO hardcoded numbers anywhere else — they come from here
├── lib/
│   ├── flow_metrics_computer.js         # Pure — run log → flow metrics
│   ├── flow_report_schema.js            # Validates flow_report.json
│   ├── flow_review_prompt_builder.js    # Builds PROMPT_FLOW.md
│   ├── flow_regression_detector.js      # Compares two flow reports
│   └── flow_run_discovery.js            # Thin wrapper around shared run_discovery
├── runner/
│   ├── capture_flow.js                  # Drives Playwright, writes flow_run.json + video
│   ├── review_flow.js                   # Sends flow_run.json + screenshots to reviewer
│   ├── compare_flow.js                  # Diffs against a prior flow report
│   └── approve_flow.js                  # Promotes a report to "reference flow report"
├── flow_runs/                           # One folder per capture (gitignored)
├── flow_reference_reports/              # Reports promoted as "this is our current target"
├── recipes/                             # Flow recipes (may symlink from ai_ux_testing/recipes)
├── tests/
└── docs/
```

---

## 5. Module boundaries and naming

Following the principle "meaningful names, not generic":

| Old generic name (tempting) | Used name (descriptive) |
|---|---|
| `review.js` | `review_flow.js` |
| `diff.js` | `compare_flow.js` |
| `metrics.js` | `flow_metrics_computer.js` |
| `report.js` | `flow_report_schema.js` |
| `prompt.js` | `flow_review_prompt_builder.js` |
| `discovery.js` | `flow_run_discovery.js` |
| `detector.js` | `flow_regression_detector.js` |

Variables and parameters follow the same rule — longer descriptive names over short cryptic ones:

```js
// Not:
function diff(a, b, t) { ... }

// Yes:
function detectFlowRegressions(
  referenceFlowReport,
  candidateFlowReport,
  flowComparisonThresholds,
) { ... }
```

Function names that describe intent, not mechanism:

```js
// Not:
function processLog(log) { ... }

// Yes:
function computeFlowMetricsFromRunLog(runLogForOneViewport) { ... }
```

---

## 6. Configuration — no hardcoded numbers

All tunable values live in `config/defaults.js` and have environment-variable overrides. Nothing lives as a bare literal in application code.

```js
// ai_flow_review/config/defaults.js
module.exports = {
  // Duration change (percent) above which we flag a flow regression.
  // Set below the typical network-jitter floor so small variance doesn't trip it.
  flowDurationChangeToleratedPercent:
    numberFromEnv('FLOW_DURATION_CHANGE_TOLERATED_PERCENT', 25),

  // Step-wait timeouts (milliseconds). Separate knobs per phase so you can tune
  // granularly when a flow includes a long-running step.
  stepNavigationTimeoutMs:
    numberFromEnv('FLOW_STEP_NAVIGATION_TIMEOUT_MS', 15_000),
  stepInteractionTimeoutMs:
    numberFromEnv('FLOW_STEP_INTERACTION_TIMEOUT_MS', 8_000),

  // Reviewer limits.
  reviewerOutputMaxTokens:
    numberFromEnv('FLOW_REVIEWER_OUTPUT_MAX_TOKENS', 4_096),
  reviewerPromptTextMaxChars:
    numberFromEnv('FLOW_REVIEWER_PROMPT_TEXT_MAX_CHARS', 400),

  // Disk management — deliberately separate caps for screenshots and videos
  // because videos are orders of magnitude larger.
  keepNewestScreenshotCount:
    numberFromEnv('FLOW_KEEP_NEWEST_SCREENSHOT_COUNT', 100),
  keepNewestVideoCount:
    numberFromEnv('FLOW_KEEP_NEWEST_VIDEO_COUNT', 20),

  // Default reviewer model — Sonnet by design (see §9).
  defaultReviewerModel:
    stringFromEnv('FLOW_REVIEWER_DEFAULT_MODEL', 'sonnet'),

  // Default viewport dimensions. Keep mobile first — it's the baseline, not a trade-off.
  viewportSizes: {
    mobile: { widthPx: 375, heightPx: 812 },
    desktop: { widthPx: 1280, heightPx: 900 },
  },
};
```

Every production function takes its thresholds/timeouts as parameters (with these defaults) rather than importing them directly — easier to test, easier to override per-recipe.

---

## 7. Recipe format (portable with ai_ux_testing)

Flow-review recipes are a **superset** of UX-test recipes. Any `ai_ux_testing` recipe runs in `ai_flow_review` without edits. The extra fields are all optional.

```json
{
  "id": "sara_personality_friend_view",
  "name": "Sara personality report — friend view",
  "target": { "base_url": "http://localhost:19995" },
  "login": { "url": "/login", "username": "markly.1", "password_env": "RECIPE_MARKLY1_PWD" },
  "steps": [
    { "action": "goto", "path": "/sara.1/" },
    { "action": "click_text", "text": "My Big Five" }
  ],
  "viewports": ["mobile", "desktop"],

  "flow_review": {
    "captureVideo": false,
    "flowDurationChangeToleratedPercent": 25,
    "describedUserIntent": "A friend visiting sara.1's profile wants to view her personality report."
  }
}
```

`describedUserIntent` is the single most impactful field for review quality — it tells the AI what the user is *trying* to accomplish, so friction can be evaluated against intent rather than against arbitrary screen-complexity judgments.

---

## 8. Flow report schema (`flow_report.json`)

Validated by `lib/flow_report_schema.js`. Produced per run; promoted via `approve_flow.js` into `flow_reference_reports/`.

```json
{
  "schemaVersion": 1,
  "recipeId": "sara_personality_friend_view",
  "runId": "20260420-195030",
  "reviewedAt": "2026-04-20T19:55:14Z",
  "reviewerModel": "claude-sonnet-4-6",
  "perViewportMetrics": {
    "mobile": {
      "totalDurationMs": 12430,
      "totalClickCount": 7,
      "totalNavigationCount": 3,
      "totalScrollCount": 2,
      "detectedBacktrackCount": 1,
      "stepDurations": [ { "stepIndex": 0, "action": "goto", "durationMs": 420 } ]
    },
    "desktop": { "...": "..." }
  },
  "frictionVerdict": "medium",
  "frictionEvidenceBulletPoints": [
    "User must scroll past Favorites block before seeing Personality card.",
    "Personality card requires two separate clicks to reach the detail modal."
  ],
  "suggestedFlowImprovements": [
    "Elevate the Personality card above Favorites on the mobile breakpoint.",
    "Make the Personality card itself open the modal instead of requiring a secondary click."
  ],
  "humanReadableSummary": "The flow completes successfully but shows mid-tier friction..."
}
```

`frictionVerdict` uses an explicit enum (not free-form strings): `"low" | "medium" | "high"`.

---

## 9. Reviewer model defaults and cost profile

| Concern | Decision |
|---|---|
| Default model | `sonnet` — half the cost of Opus, usually adequate for friction judgment |
| Escalation path | Opus available via `--model opus` when a redesign needs deep analysis |
| Budget floor | `haiku` available via `--model haiku`; tends to give generic output — not recommended but not blocked |
| Offline testing | `mock` reviewer always available |
| Per-call prompt size | Capped via `reviewerPromptTextMaxChars`; runner errors out if exceeded rather than silently truncating |

No hardcoded model strings anywhere outside `config/defaults.js` and the reviewer adapters' preset tables.

---

## 10. CLIs and their verbs

Verbs are deliberately different from `ai_ux_testing`'s to keep the two tools' mental models separate.

| Command | Purpose |
|---|---|
| `node runner/capture_flow.js <recipe>` | Run the recipe, produce `flow_run.json`, screenshots, optional video. No review. |
| `node runner/capture_flow.js <recipe> --review` | Above, then invoke reviewer, produce `flow_report.json`. |
| `node runner/review_flow.js <recipe>` | Review an already-captured run. |
| `node runner/approve_flow.js <recipe>` | Promote the latest report to `flow_reference_reports/<recipe>.json`. |
| `node runner/compare_flow.js <recipe>` | Compare latest report to the reference; write `flow_comparison.md`. |

`ai_ux_testing` keeps `run`, `review`, `approve`, `diff`. `ai_flow_review` uses `capture_flow`, `review_flow`, `approve_flow`, `compare_flow`. No collision, no confusion.

---

## 11. Module responsibilities (strict boundaries)

| Module | Responsibility | What it must NOT do |
|---|---|---|
| `flow_metrics_computer.js` | Pure: run log → metrics | No I/O, no logging, no config lookups |
| `flow_review_prompt_builder.js` | Pure: report inputs → prompt Markdown | No network, no file writes |
| `flow_report_schema.js` | Validate reports | No prompting, no reviewing |
| `flow_regression_detector.js` | Pure: two reports → list of regressions | No file I/O, no printing |
| `capture_flow.js` | Orchestrate browser + write artifacts | No AI calls |
| `review_flow.js` | Orchestrate reviewer + write report | No browser driving |
| `compare_flow.js` | CLI entry for regression detection | No AI calls, no capture |
| `approve_flow.js` | Copy + mark reference | No validation beyond schema |

Pure modules are trivially unit-testable. Orchestrators are thin.

---

## 12. What `ai_flow_review` depends on from `ai_testing_shared`

- `recipe_loader` — the recipe schema is source of truth in shared; flow-review-specific fields are nested under `flow_review.*` so `ai_ux_testing` ignores them cleanly.
- `env_loader` — single-source env handling; no duplicated env parsing.
- `reviewer/*` — the Claude / Gemini / mock adapters. `ai_flow_review` imports `resolveReviewerModel(name)` and calls `adapter.review(...)`; it does not know which provider is active.
- `run_discovery` — both tools discover runs the same way. `ai_flow_review` imports and wraps (adds `flow_` prefix conventions).

`ai_flow_review` has **zero** direct dependency on `ai_ux_testing`. Recipes are *data*, shared via filesystem or symlink, not via code imports.

---

## 13. Extraction plan (sequenced)

Extraction is a prerequisite for building `ai_flow_review` cleanly.

1. **Phase A — create `ai_testing_shared/`.**
   Move (not copy) from `ai_ux_testing/`: `lib/schema.js → recipe_loader.js`, `lib/env_loader.js`, `lib/reviewer/*`, `lib/runs.js → run_discovery.js`. Each rename is deliberate and descriptive.
2. **Phase B — rewire `ai_ux_testing/` to consume shared.**
   `ai_ux_testing` imports from `ai_testing_shared`. All existing tests pass. Zero behaviour change visible to users.
3. **Phase C — scaffold `ai_flow_review/`.**
   `package.json`, `config/defaults.js`, CLI stubs, README.
4. **Phase D — build pure modules first.**
   `flow_metrics_computer.js`, `flow_review_prompt_builder.js`, `flow_report_schema.js`, `flow_regression_detector.js` — each with its own test file before moving on.
5. **Phase E — orchestrators.**
   `capture_flow.js`, `review_flow.js`, `compare_flow.js`, `approve_flow.js`.
6. **Phase F — dogfood.**
   Copy the sara recipe, capture it, review it with Sonnet, approve as reference, make a deliberately worse recipe, capture + review + compare — expect a flagged regression.
7. **Phase G — docs.**
   User guide, README, enhancement notes for follow-ups (video-as-AI-input once providers support it, trend analysis across many runs, etc.).

Each phase is independently shippable. Phases A–B are worth doing even if `ai_flow_review` never gets built — they improve `ai_ux_testing`.

---

## 14. Testing contract

Every module has a matching `tests/test_<module>.js` file with plain Node assertions, using the same harness pattern as `ai_ux_testing/tests/_harness.js`. Required coverage:

| Module | Test scenarios |
|---|---|
| `flow_metrics_computer` | Click counting across viewports; backtrack detection (same path twice); zero-step; missing-duration fallback |
| `flow_report_schema` | Valid report accepted; missing required field rejected; out-of-enum verdict rejected; over-length evidence string rejected |
| `flow_review_prompt_builder` | Prompt includes verbatim evaluator instruction; includes metrics JSON fence; lists screenshots; references recipe's `describedUserIntent` when present |
| `flow_regression_detector` | Click-count increase triggers; duration increase under threshold ignored; duration increase over threshold triggers; verdict worsening triggers; missing reference metrics handled |
| `compare_flow` CLI | Exit code 0 on no regression; exit code 2 on regression; `flow_comparison.md` written |
| `capture_flow` CLI | Runs recipe, produces `flow_run.json` with expected keys; video produced when `captureVideo: true` |

---

## 15. Verification (how to tell it works end to end)

1. `npm test` in `ai_testing_shared/` — all shared tests green.
2. `npm test` in `ai_ux_testing/` — existing 94 assertions green (no behaviour change from extraction).
3. `npm test` in `ai_flow_review/` — new tests green.
4. `cd ai_flow_review && node runner/capture_flow.js sara_personality_friend_view --review` — produces a `flow_report.json` with a friction verdict and at least one evidence bullet.
5. `node runner/approve_flow.js sara_personality_friend_view` — writes `flow_reference_reports/sara_personality_friend_view.json`.
6. Edit the recipe to add redundant clicks (e.g. two extra `click_text` → `goto` round-trips). Recapture + re-review + `node runner/compare_flow.js sara_personality_friend_view` — exits 2 with a flagged click-count regression.
7. Restore the recipe; re-run comparison; exit 0.
8. Run `./cleanup_flow_runs.sh` with `FLOW_KEEP_NEWEST_SCREENSHOT_COUNT=10 FLOW_KEEP_NEWEST_VIDEO_COUNT=2` — confirm only the newest artefacts remain and all reference reports survive.

---

## 16. Explicit non-goals

- **No CI integration by default.** This tool's output is qualitative; wiring it to gate merges produces alert fatigue. A follow-up CI template can exist (`ci/github-actions.yml.example`) but opt-in.
- **No recipe authoring UI in v1.** `ai_ux_testing`'s form works perfectly for authoring; `ai_flow_review` consumes the same recipes. If a flow-review-specific UI becomes warranted later, design it then.
- **No video-as-AI-input in v1.** Playwright writes WebMs for human debugging; no provider reliably judges video yet. Revisit when the provider landscape changes.
- **No real-human session recording.** Fundamentally different product. Noted in `docs/ENHANCEMENT_OPTIONS.md`, not in scope here.

---

## 17. Success criteria

v1 ships when:
- All three packages install cleanly and have passing tests.
- Sara recipe produces a sensible flow report (`medium` verdict at minimum, with actionable suggestions — not generic filler).
- A deliberately-worsened recipe is correctly flagged as a regression.
- `ai_ux_testing`'s existing test suite still passes unchanged (shared extraction was non-breaking).
- A user can, given only the README, author a flow recipe, capture it, review it, approve it, compare a new run against it — in under 10 minutes.

---

## 18. Open questions (for future reviewer feedback)

1. Should the tool capture a separate "user thought bubble" pass — asking the AI to narrate *what a user might be thinking* at each screenshot? Potentially valuable for empathy, potentially noisy. Defer until real use surfaces the need.
2. Trend analysis across many historical reports (is friction going up over time?) — out of scope for v1, possibly valuable later.
3. Cross-recipe comparison ("does the signup flow have more friction than the login flow?") — interesting but not urgent.
