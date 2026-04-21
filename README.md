# ai_ux_testing

Two AI-powered UX tools in one codebase.

| Tool | Question it answers | Output | When to run |
|---|---|---|---|
| **ux_testing/** | Did we break something? | Pass/fail per check, CI-friendly | Every PR |
| **flow_review/** | Is this flow simpler than last time? | Friction verdict + improvement suggestions | On demand, before/after redesigns |

Shared plumbing lives in **shared/** — recipe validation, env loading, AI reviewer adapters (Claude + Gemini + mock), run-folder discovery. One install, one `npm test`, one place to look.

---

## Install

```bash
npm install
npx playwright install chromium       # one-time
cp .env.example .env.local
# Edit .env.local to add RECIPE_<NAME>_PWD=<value> for any logins your recipes use.
chmod 600 .env.local
```

API keys (`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) auto-load from `.env.local` first, then from `../myspace2/api/.env` if that exists. Override the fallback path with `AI_UX_FALLBACK_ENV_PATH`.

---

## Quick start — ux_testing (regression)

```bash
# Start the recipe-authoring form at http://localhost:11111
./start_webserver.sh

# Run a recipe, capture screenshots, auto-review with Claude Haiku
npm run ux-run -- sara_personality_friend_view --review

# Promote the current run as the regression baseline
npm run ux-approve -- sara_personality_friend_view

# Later, re-run and diff; exits 2 on regression
npm run ux-run -- sara_personality_friend_view --review
npm run ux-diff -- sara_personality_friend_view
```

See **[docs/USER_GUIDE_UX_TESTING.md](docs/USER_GUIDE_UX_TESTING.md)** for the full walkthrough.

## Quick start — flow_review (friction)

```bash
# Capture + review (Sonnet by default — friction reasoning benefits from it)
npm run flow-capture -- sara_personality_friend_view --review

# Promote as the reference
npm run flow-approve -- sara_personality_friend_view

# Later, re-capture and compare; exits 2 on friction regression
npm run flow-capture -- sara_personality_friend_view --review
npm run flow-compare -- sara_personality_friend_view
```

See **[docs/USER_GUIDE_FLOW_REVIEW.md](docs/USER_GUIDE_FLOW_REVIEW.md)** for the full walkthrough.

---

## Directory layout

```
ai_ux_testing/
├── package.json                    # unified scripts: ux-* and flow-*
├── .env.local                      # single shared env (gitignored)
├── start_webserver.sh              # recipe-authoring form
├── cleanup_runs.sh                 # prunes ux_testing/runs/
├── cleanup_flow_runs.sh            # prunes flow_review/flow_runs/
│
├── shared/                         # USED BY BOTH — keep small
│   ├── recipe_loader.js            # recipe schema + validator
│   ├── env_loader.js               # .env.local + fallback env
│   ├── run_discovery.js            # findRuns / latestRun / baselines
│   └── reviewer/                   # claude / gemini / mock adapters
│
├── ux_testing/                     # pass/fail UX regression
│   ├── lib/ (diff_engine, result_schema, checks, codegen_to_steps, …)
│   ├── runner/ (run, review, approve, diff, prepare_review, …)
│   ├── web/  (recipe-authoring form — Express + static)
│   ├── recipes/
│   ├── runs/                       # gitignored; generated
│   └── baselines/
│
├── flow_review/                    # qualitative flow/friction review
│   ├── config/defaults.js          # all tunables; env-overridable
│   ├── lib/ (flow_metrics_computer, flow_report_schema, …)
│   ├── runner/ (capture_flow, review_flow, approve_flow, compare_flow)
│   ├── recipes/                    # local recipes override ux_testing/recipes/
│   ├── flow_runs/                  # gitignored; generated
│   └── flow_reference_reports/
│
├── tests/
│   ├── run_all.js                  # runs all test_*.js per package
│   ├── fixtures/{shared,ux_testing,flow_review}/
│   ├── shared/test_*.js
│   ├── ux_testing/test_*.js
│   └── flow_review/test_*.js
│
├── ci/
│   └── github-actions.yml.example
│
└── docs/
    ├── USER_GUIDE_UX_TESTING.md
    ├── USER_GUIDE_FLOW_REVIEW.md
    ├── SPEC_BASELINE_REGRESSION.md
    ├── SPEC_AI_FLOW_REVIEW.md
    ├── ENHANCEMENT_OPTIONS.md
    └── CONVERSATION_SUMMARY.md
```

---

## Module boundaries (why this is modular, not monolithic)

**One-way dependency:**
```
ux_testing ──▶ shared ◀── flow_review
```

Neither tool imports the other. Recipes are shared as filesystem data only. The two tools are decoupled enough that either can be pulled out as a standalone package later with minimal effort — the boundaries are preserved by folder, even though they live in one repo.

**What goes in `shared/`:** anything *both tools need* with a stable interface. Today: recipe validation, env loading, reviewer adapters, run-folder discovery. Resist adding more — the small surface is the feature.

**What does NOT go in `shared/`:** prompts, result schemas, diff engines, CLIs. Those are product-specific and diverge freely.

---

## Testing

```bash
npm test
```

Runs every `tests/<package>/test_*.js` in sequence. 187 assertions across 3 packages:

- `shared/` — 18 (recipe validation, run discovery helpers)
- `ux_testing/` — 124 (diff engine, result schema, prompt builders, etc.)
- `flow_review/` — 45 (flow metrics, flow report schema, regression detector, prompt)

Tests use a minimalist harness — no framework, plain Node assertions. Fixtures live under `tests/fixtures/<package>/`.

---

## How the two tools relate to each other

They are **complementary**, not overlapping:

- `ux_testing` verifies that specific things **work** on the page.
  Example check: *"The personality modal has a heading, subtitle, and trait name."*
  Output is JSON a machine compares; binary pass/fail; cheap (Haiku); runs every PR.

- `flow_review` judges whether a **flow** is **simple enough**.
  Example question: *"Does the user experience unnecessary clicks, backtracks, or hesitation moments to reach the personality report?"*
  Output is a qualitative verdict; runs on demand; uses Sonnet by default.

**Recipes are portable between them.** A recipe authored in `ux_testing/recipes/` runs in `flow_review` without edits. Add an optional `flow_review` block to a UX recipe to control flow-specific knobs (capture video, tune duration tolerance, describe user intent).

---

## Further reading

- **[docs/USER_GUIDE_UX_TESTING.md](docs/USER_GUIDE_UX_TESTING.md)** — full walkthrough of ux_testing
- **[docs/USER_GUIDE_FLOW_REVIEW.md](docs/USER_GUIDE_FLOW_REVIEW.md)** — full walkthrough of flow_review
- **[docs/SPEC_BASELINE_REGRESSION.md](docs/SPEC_BASELINE_REGRESSION.md)** — spec for ux_testing's baseline/diff architecture
- **[docs/SPEC_AI_FLOW_REVIEW.md](docs/SPEC_AI_FLOW_REVIEW.md)** — spec for flow_review
- **[docs/ENHANCEMENT_OPTIONS.md](docs/ENHANCEMENT_OPTIONS.md)** — future enhancements catalogued, rated, recommended
- **[docs/CONVERSATION_SUMMARY.md](docs/CONVERSATION_SUMMARY.md)** — how this tool came to exist; useful cold-start for a new AI coding session
