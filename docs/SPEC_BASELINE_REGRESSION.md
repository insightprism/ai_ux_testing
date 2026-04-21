# Spec — Baseline Comparison & Structured AI Review

Status: **Proposed (rev 2)** · Owner: ai_ux_testing · Date: 2026-04-20

Rev 2 folds in review feedback: cleanup preservation of reviewed runs, shared `lib/runs.js` for latest-run selection, rename heuristic in diff, fixture-based testing in §11, clarification that `_schema_frozen` is a baseline-file marker, and a single `buildStructuredPrompt()` function.

## 1. Background

`ai_ux_testing` is a standalone tool that runs recipe-defined browser flows, captures full-page screenshots at mobile + desktop viewports, and lets an AI review the screenshots against plain-English "AI instructions" defined in the recipe.

Today, a run produces:

- numbered PNG screenshots (`01_<name>_<viewport>.png`, …)
- `run.json` — mechanical log of what happened (steps, URLs, status)
- `PROMPT.md` — human-pasteable prompt that directs the AI to open the screenshots and evaluate the checks

The AI review is done manually: the user pastes `PROMPT.md` into an AI chat, the AI responds with prose (✅/❌/⚠️ per check plus a written summary), and that prose is not saved anywhere. Each run is evaluated in isolation.

This is fine for one-off checks, but misses the real use-case the user actually wants: **UX regression testing** — run the same recipe before and after a change, and detect what broke.

## 2. Problem

Today's workflow has three concrete gaps that block regression use:

1. **AI output is prose, not data.** Can't be compared across runs.
2. **No baseline.** There is no notion of "the run that looked correct" — so nothing to regress against.
3. **Each run is isolated.** We don't know if the modal had the same sections last time, if the primary trait changed, or whether a check that passes today passed last week.

The user will make repeated UX changes to features (e.g. the personality report card). After each change they want to answer, in ~30 seconds:

- Does the flow still work end-to-end?
- Did anything observable regress vs. the previous approved version?
- If something changed, is it an intentional UX edit or a bug?

## 3. Goals

1. **Structured AI output per run.** Replace prose-only AI review with a strict JSON result the tool can diff.
2. **Baseline per recipe.** An approved run is promoted to "the baseline". Future runs are compared against it.
3. **Deterministic diff report.** Running a recipe after baseline exists produces a per-field diff the user can skim in seconds.
4. **Incremental — no big rewrite.** Fits on top of the existing runner; does not break the current manual-review workflow.
5. **AI-reviewer-agnostic.** The review step works with a human-pasting-to-chat today and swaps to an API call later without changing the rest of the pipeline.

## 4. Non-goals (for this spec)

- Pixel-level visual diffing. We're doing semantic (content/structure) comparison.
- CI/CD integration.
- Multi-baseline per recipe (per-release, per-environment). One baseline per recipe for v1.
- Automatic approval / pass-fail gating. Approvals are explicit user actions.
- "Smart" detection of intentional vs. unintentional changes. The diff surfaces differences; the user decides whether to re-approve.

## 5. Proposed design

### 5.1 Artifact flow

```
Recipe ─► Runner ─► Screenshots + run.json + PROMPT_STRUCTURED.md
                                                    │
                                                    ▼
                                           AI reviewer (manual for v1)
                                                    │
                                                    ▼
                                    runs/<...>/result.json  (structured)
                                                    │
                        ┌───────────────────────────┴───────────────────────────┐
                        ▼                                                       ▼
              node approve.js <recipe>                                node diff.js <recipe>
              copies result.json →                                 compares latest result.json
              baselines/<recipe>.json                              against baseline → diff.md + stdout
```

### 5.2 Key files (new)

```
ai_ux_testing/
├── lib/
│   ├── result_schema.js        # NEW — shape + validator for result.json
│   └── runs.js                 # NEW — shared run/baseline discovery helpers
├── runner/
│   ├── approve.js              # NEW — promote latest run to baseline
│   ├── diff.js                 # NEW — compare latest run to baseline
│   └── prompt_structured.js    # NEW — builds PROMPT_STRUCTURED.md
├── baselines/                  # NEW — gitignored (contains per-recipe baseline)
│   └── <recipe-id>.json
├── tests/                      # NEW — fixture-based assertion scripts (see §11)
│   ├── fixtures/
│   └── test_*.js
└── runs/<...>/
    ├── PROMPT.md               # EXISTING — human-readable prompt (unchanged)
    ├── PROMPT_STRUCTURED.md    # NEW — strict-JSON prompt used by reviewer
    ├── result.json             # NEW — written after AI review completes
    └── diff.md                 # NEW — generated by diff.js if baseline exists
```

**`lib/runs.js`** centralises run and baseline discovery so `approve.js` and `diff.js` don't drift. Minimum exports:

```js
findRuns(recipeId)          // returns [{ dir, runId, hasResult }] sorted newest first
latestRun(recipeId)         // latest folder for recipe, or null
latestResult(recipeId)      // latest run that has result.json, or null
loadBaseline(recipeId)      // returns parsed baseline JSON, or null
```

Selection rule (used by all callers): latest == lexicographically greatest folder name matching `<recipe-id>__*`. This is safe because timestamps are zero-padded `YYYYMMDD-HHMMSS`, so lex order equals chronological order.

### 5.3 `result.json` schema

```json
{
  "schema_version": 1,
  "recipe_id": "sara_personality_friend_view",
  "run_id": "20260420-182842",
  "reviewed_at": "2026-04-20T18:30:15Z",
  "reviewer": "claude-opus-manual",
  "overall_status": "pass",
  "checks": [
    {
      "instruction": "A personality-report modal/dialog is visible in the report screenshots.",
      "verdict": "pass",
      "evidence": "Modal overlays profile in shots 3–5; dimmed backdrop and close-X visible.",
      "screenshot_refs": ["03_personality_report_modal_top_desktop.png"]
    }
  ],
  "observed": {
    "_schema_frozen": false,
    "primary_trait": "Neuroticism",
    "runner_up_trait": "Agreeableness",
    "sections_found": ["Your trait profile", "Overview", "Strengths", "Growth areas", "Growth edges", "Your runner-up type"],
    "modal_present": true,
    "unexpected_items": []
  },
  "summary": "Big Five report modal opens from the Personality card and renders all expected sections; primary trait Neuroticism, runner-up Agreeableness."
}
```

#### Required fields

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `1` | Lets us evolve safely. |
| `recipe_id` | string | Must match recipe. |
| `run_id` | string | Matches run folder suffix. |
| `reviewed_at` | ISO-8601 string | Set by the reviewer at time of review. |
| `reviewer` | string | Identifier for who/what did the review. v1: `claude-opus-manual`; v2: `claude-<model-id>-api`. |
| `overall_status` | `"pass" \| "fail" \| "warn"` | Rollup across `checks[*].verdict`. |
| `checks[]` | array | One per recipe check, same order. |
| `checks[*].verdict` | `"pass" \| "fail" \| "warn"` | Required. |
| `checks[*].evidence` | string | One-sentence justification grounded in what the AI saw. |
| `observed` | object | Structured facts extracted from the screenshots. Shape is schema-locked at baseline-approval time (see §5.5). |
| `summary` | string | Short human-readable paragraph. |

#### `observed` rules

- `observed._schema_frozen`: `false` until baseline is approved; `true` after. **Baseline-file marker only — NOT part of the reviewer contract.** `approve.js` sets it on the copy that lands in `baselines/`. The reviewer never reads or writes this flag; it exists solely so tooling can tell "this baseline has a frozen shape" at a glance. Reviewers are told the required shape by inlined keys in `PROMPT_STRUCTURED.md`, not by this flag.
- All keys other than `_schema_frozen` are domain facts extracted from the screenshots.
- Values must be JSON-primitive or arrays of primitives/objects with primitive leaves. No nested prose paragraphs.
- When schema is frozen, the reviewer **must** produce the same set of top-level keys on future runs. Missing keys = diff flags them. Extra keys = diff flags them.

### 5.4 `PROMPT_STRUCTURED.md` (the reviewer contract)

This replaces `PROMPT.md` for structured review. It instructs the reviewer to return *only valid JSON* matching §5.3. Rough body:

> You are reviewing a UX test run. Open each screenshot listed below with vision. For each check, produce a verdict (`pass` / `fail` / `warn`) and one-sentence evidence. Then populate the `observed` object with structured facts you extracted.
>
> If a baseline schema is included, you **must** populate the same top-level keys in `observed`. If a value is not present in the current run, set it to `null` or `[]` — do not omit the key.
>
> Return ONLY valid JSON matching this skeleton: {…}

#### Single entry point

`runner/prompt_structured.js` exposes **one** function:

```js
buildStructuredPrompt(run, recipe, baseline = null) -> string
```

- When `baseline` is `null`, the prompt lets the reviewer freely author `observed` keys.
- When `baseline` is provided, the prompt embeds the baseline's `observed` top-level keys as the required shape (with a note: *"you must include exactly these keys; use null or [] for keys you can't populate this run"*).

This is intentionally one function with a branch, not two files. It keeps the no-baseline and baseline-present cases visibly on the same page, and it reinforces that §5.7's "contract doesn't change between phases" claim holds — the API reviewer (v2) calls this exact same function.

### 5.5 Baseline lifecycle

```
# First run — no baseline exists yet
node runner/run.js sara_personality_friend_view
# Captures screenshots + PROMPT_STRUCTURED.md (without schema lock)
# User pastes PROMPT_STRUCTURED.md → AI returns JSON → user saves as result.json
# User reviews manually, thinks it looks right, approves it:
node runner/approve.js sara_personality_friend_view
# → copies latest runs/<...>/result.json to baselines/sara_personality_friend_view.json
# → sets observed._schema_frozen = true in the copied file

# Later, after UX change
node runner/run.js sara_personality_friend_view
# PROMPT_STRUCTURED.md now embeds baseline's observed schema as required shape
# User pastes → AI returns JSON matching schema → user saves as result.json
node runner/diff.js sara_personality_friend_view
# → prints diff and writes diff.md

# If the change is intentional, re-approve to move baseline forward
node runner/approve.js sara_personality_friend_view
```

Approval is always explicit. There is no auto-promotion.

#### "Latest run" selection

`approve.js` and `diff.js` both rely on `lib/runs.js::latestRun(recipeId)` / `latestResult(recipeId)`. Selection rule:

- "Latest run" = lexicographically greatest folder under `runs/` whose name matches `<recipe-id>__*`.
- "Latest result" = latest run folder that additionally contains a `result.json`.

Because timestamps are zero-padded `YYYYMMDD-HHMMSS`, lex order equals chronological order — no date parsing required.

Flags:
- `approve.js <recipe>` — approves latest *reviewed* run by default.
- `approve.js <recipe> --run <timestamp>` — approves a specific run (must have `result.json`).

#### Cleanup interaction

`cleanup_runs.sh` must preserve runs that contain a `result.json`. Reviewed runs are the audit trail behind a baseline: "here are the screenshots the reviewer saw when it produced this result." Losing them after approval would break reproducibility.

Concretely:
- PNG trimming still applies to reviewed runs (their screenshots can be reclaimed).
- Folder removal (when PNG count hits 0) must **skip** any folder containing `result.json`.

Un-reviewed runs (no `result.json`) are disposable and eligible for full removal as before.

### 5.6 Diff semantics

`diff.js` loads `baselines/<recipe>.json` and the most recent run's `result.json`. It emits:

1. **Status diff** — `overall_status`: baseline vs. current.
2. **Per-check diff** — for each check (matched by `instruction` text):
   - Baseline `pass` → Current `fail`: regression (red).
   - Baseline `fail` → Current `pass`: improvement (green).
   - Both same: quiet unless `--verbose`.
   - **Rename heuristic:** if a check disappears and a different check appears at the same array index, emit a one-line warning in `diff.md` (not an error):
     ```
     ⚠️  Check at position 2 may have been renamed:
         was:  "Modal has heading and sub-sections"
         now:  "Modal displays title and trait sections"
     ```
     The comparison still treats them as "removed + added" — this is just a nudge to the user that the baseline may need re-approval rather than an actual regression. Proper stable check ids are a Phase 4 enhancement.
3. **`observed` field diff** — for each key:
   - Value changed → emit old/new values (yellow).
   - Scalar → scalar: direct string/number comparison.
   - Array → array: set-diff (added/removed items shown).
   - Missing key in current: red (schema-break).
   - Extra key in current: yellow (schema drift; reviewer ignored lock).
4. **Human summary** — one line: `3 passing, 1 regression (Check 2), 2 field changes.`
5. Exits non-zero if any regression or schema-break detected.

Example `diff.md` output:

```markdown
# Diff — sara_personality_friend_view

Baseline: baselines/sara_personality_friend_view.json (approved 2026-04-20)
Current:  runs/sara_personality_friend_view__20260421-091230/result.json

## Status
- overall: pass → pass ✅

## Checks
- Check 2 "Modal has heading and sub-sections": pass → fail ❌
  - baseline evidence: "all 7 sections present"
  - current  evidence: "Strengths section missing"

## Observed fields
- sections_found: removed [ "Strengths" ]
- primary_trait: unchanged (Neuroticism)
- runner_up_trait: unchanged (Agreeableness)

## Summary
1 regression, 1 field change. Investigate before re-approving.
```

### 5.7 AI reviewer — manual (v1) and API (v2)

**v1 (manual, ships first):**
- Runner writes `PROMPT_STRUCTURED.md` to the run folder. When a baseline exists, the baseline's `observed` keys are embedded in the prompt.
- User pastes the prompt into an AI chat; AI returns strict JSON.
- User saves the JSON to `runs/<...>/result.json`.
- Optional helper: `node runner/save_result.js <recipe> < <path-to-json>` that validates and writes the file in one command.

**v2 (API, later):**
- `runner/review.js` takes a run folder, reads `PROMPT_STRUCTURED.md` and the screenshots, calls the Anthropic API with vision, writes `result.json` directly.
- Invoked automatically at the end of `runner/run.js`, gated behind a config flag `auto_review: true` or env `AI_UX_TEST_AUTO_REVIEW=1`.
- Nothing else changes — the contract (what `result.json` looks like) is identical.

## 6. Changes to existing code

| File | Change |
|---|---|
| `lib/schema.js` | Unchanged. |
| `runner/run.js` | After writing `PROMPT.md`, also write `PROMPT_STRUCTURED.md`. If a baseline exists, inline its `observed` schema. |
| `web/server/server.js` | Unchanged. |
| `web/public/*` | Unchanged. |
| `README.md` | Add a "Baseline & regression" section at the bottom. |

Everything new goes in new files. No behavior changes in existing artifacts except the additional `PROMPT_STRUCTURED.md` file.

## 7. Workflow — user's-eye view (v1)

```
# one-time
node runner/run.js sara_personality_friend_view
cat runs/<latest>/PROMPT_STRUCTURED.md     # paste to AI chat
# …paste AI's JSON reply into runs/<latest>/result.json…
node runner/approve.js sara_personality_friend_view

# every UX change after that
node runner/run.js sara_personality_friend_view
cat runs/<latest>/PROMPT_STRUCTURED.md     # paste to AI chat
# …save AI's JSON reply to runs/<latest>/result.json…
node runner/diff.js sara_personality_friend_view
# → reports pass/fail + what changed
```

## 8. Edge cases & decisions

| Case | Behaviour |
|---|---|
| `diff.js` called but no baseline exists | Exit 0 with "no baseline yet — run approve.js to set one." |
| `diff.js` called but latest run has no `result.json` | Exit 1 with "run has no result.json — paste PROMPT_STRUCTURED.md to reviewer first." |
| Baseline schema has key `X`; reviewer returns run without `X` | Diff flags `X: missing`. Exit non-zero. |
| Baseline has check `C1`; recipe has been edited and no longer contains `C1` | Recipe is source-of-truth. Drop `C1` from comparison; mention "check removed: C1" in diff. |
| Recipe adds a new check `C2` with no baseline entry | Record as "new check: C2 → pass" (informational, not regression). |
| Reviewer returns invalid JSON | `save_result.js` rejects; user asked to retry. `diff.js` treats missing result.json as error. |
| User changes recipe's AI instructions between runs | Checks are matched by instruction text. Renamed instruction = "check removed + new check added". Acceptable for v1; can be improved with a stable check id later. |
| Multiple runs of same recipe before approval | `approve.js` takes the latest by default; `--run <timestamp>` picks a specific one. |
| Cleanup script encounters a run with `result.json` | Skip the folder — reviewed runs are preserved as the audit trail. |
| Cleanup script deletes the run a baseline was *originally copied from* | Baseline file itself is a copy, unaffected. But the audit-trail folder is preserved (previous row), so the source run's screenshots and `result.json` stick around alongside the baseline. |

## 9. Phased rollout

**Phase 1 — structured result contract** (foundation; no diff yet)
- Write `lib/result_schema.js` with validator.
- Update `runner/run.js` to emit `PROMPT_STRUCTURED.md` (no baseline injection yet).
- Add `runner/save_result.js` that validates and writes `result.json`.
- User runs this end-to-end once manually to confirm the contract feels right.

**Phase 2 — baselines + diff** (the pitch)
- Implement `lib/runs.js` (shared run/baseline discovery).
- Implement `runner/approve.js`.
- Implement `runner/diff.js` with rename heuristic.
- Update `runner/run.js` to inject baseline's `observed` schema into `PROMPT_STRUCTURED.md` when a baseline exists (by passing `baseline` to `buildStructuredPrompt`).
- **Patch `cleanup_runs.sh`** to skip folders containing `result.json`.
- Ship fixture-based tests (see §11) for result schema + diff logic.
- Update `README.md` with the baseline workflow.
- Dogfood on sara_personality_friend_view.

**Phase 3 — reviewer automation** (removes manual step)
- Implement `runner/review.js` that calls Anthropic API with vision.
- Gate behind `auto_review` flag.
- Document API key setup in README.

**Phase 4 — nice-to-haves** (discovered by use, not pre-planned)
- Stable check ids so renamed instructions don't "drop + add" in diff.
- Multi-baseline (named, per-release).
- CI hook / GitHub action template.
- Ignore regions for dynamic content.

Phases 1–3 are scoped in this spec. Phase 4 is an open list to be revisited after real use.

## 10. Success criteria

- After phase 2 ships, the user can run a recipe, approve its result as baseline, make a UX change, re-run, and see a diff that correctly identifies at least:
  - a removed section (`observed.sections_found` drops an item),
  - a changed primary trait value,
  - a check that went from pass to fail.
- `diff.js` exits non-zero when any regression or schema-break is detected.
- The manual workflow takes < 2 minutes per regression check (run + paste prompt + save JSON + run diff).

## 11. Testing (required for Phases 1 and 2)

No framework — just plain Node assertion scripts under `tests/`, runnable with `node tests/test_<name>.js`. Each script returns non-zero on failure. A top-level `npm test` runs all of them in sequence.

### 11.1 Directory

```
tests/
├── fixtures/
│   ├── baseline_A.json              # canonical baseline (schema frozen)
│   ├── run_A_unchanged.json         # matches baseline exactly
│   ├── run_A_regression.json        # baseline pass → current fail on check[1]
│   ├── run_A_improvement.json       # baseline fail → current pass
│   ├── run_A_missing_key.json       # observed drops a baseline key
│   ├── run_A_extra_key.json         # observed adds a key not in baseline
│   ├── run_A_renamed_check.json     # check[2] text differs, same position
│   ├── run_A_invalid.json           # fails result_schema.js validation
│   └── recipe_A.json                # the recipe these fixtures pair with
├── test_result_schema.js            # Phase 1 — validator happy + sad paths
├── test_runs_helpers.js             # Phase 2 — latestRun / latestResult logic
├── test_diff_status.js              # Phase 2 — overall_status rollup
├── test_diff_checks.js              # Phase 2 — pass↔fail, rename heuristic
├── test_diff_observed.js            # Phase 2 — scalar/array, missing/extra keys
└── test_prompt_structured.js        # Phase 2 — presence of required-keys block when baseline given
```

### 11.2 Required coverage

| Module | Test |
|---|---|
| `lib/result_schema.js` | Accepts a valid `result.json`; rejects missing required fields; rejects nested-prose values in `observed`. |
| `lib/runs.js` | `latestRun` returns newest lex folder; `latestResult` skips folders without `result.json`; handles empty runs dir. |
| `runner/diff.js` — status | `pass→pass` emits ✅; `pass→fail` exits non-zero; `fail→pass` flagged as improvement. |
| `runner/diff.js` — checks | Regression flagged; improvement flagged; rename heuristic fires only at same position with different text. |
| `runner/diff.js` — observed | Scalar change, array add/remove (set diff), missing key flagged red, extra key flagged yellow. |
| `runner/prompt_structured.js` | Without baseline: no required-keys block. With baseline: block contains exactly the baseline's `observed` top-level keys. |

### 11.3 Ground rules

- Diff logic is not considered landed unless tests pass.
- Fixtures are tiny hand-written JSON — fast to add new scenarios.
- No mocking of Playwright or Anthropic API — those are integration concerns, not unit.
- When a bug is found in real use, add a fixture that reproduces it *before* fixing.

## 12. Open questions

1. Should `observed._schema_frozen` be a hard gate (reviewer errors out if baseline schema present but reviewer drops a key) or a soft signal (diff flags it)? Spec currently says soft. Revisit after phase 2 dogfooding.
2. How is the reviewer told the baseline existed for *this recipe*, not some other? Current plan: `PROMPT_STRUCTURED.md` either includes or doesn't include a `"required observed schema"` block — the AI doesn't need to know "why", just what shape to return.
3. For the v2 API reviewer, which Claude model? Default to latest Opus with vision at build time; make it a config value.
4. Should `diff.js` output also be fed back to the AI for a natural-language "is this regression meaningful?" verdict? Defer — that's close to phase 4.
