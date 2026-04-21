# User Guide — ai_ux_testing

A practical walkthrough of how to use this tool, from installing it to running your first regression check.

If you prefer code-first reference, see `README.md`. This guide is the narrative version.

---

## What this tool is for

You have a web app. You're about to change the UI. You want to know — after the change — whether anything broke that a human reviewer would notice: missing sections, swapped labels, busted layout, empty states.

Traditional tools answer this with brittle CSS-selector assertions (Cypress) or raw pixel diffs (Percy / Applitools). This tool uses a third path: **plain-English assertions evaluated by an AI looking at screenshots**. You describe what a user should see, and the AI judges whether the current page still matches.

It's most useful for:
- Pre-deploy sanity checks on user-facing flows.
- Catching regressions a hand-written CSS test would miss (missing copy, broken empty states).
- Letting non-engineers author tests by *doing* the flow once (recording).

It's *not* useful for:
- Unit-testing business logic (use your language's test framework).
- Pixel-perfect visual regression (use Percy / Applitools).
- Hammering an API under load (use k6 / wrk).

---

## One-time setup

Run these once:

```bash
cd /home/markly2/claude_code/ai_ux_testing
npm install                                # installs express + playwright
npx playwright install chromium            # downloads the browser binary
cp .env.example .env.local                 # create your local env file
```

The tool reads API keys from two places, in order:
1. `ai_ux_testing/.env.local` (gitignored, local overrides).
2. `../myspace2/api/.env` (the DatsMe env file — reused so you don't duplicate keys).

For DatsMe users, the shared env already has `ANTHROPIC_API_KEY` and `GOOGLE_API_KEY`, so you don't need to add anything. For other projects, put those keys in `.env.local`.

Credentials for the apps you're testing (like a login password) go in `.env.local` as `RECIPE_<NAME>_PWD=<value>`. The tool never stores passwords inside recipes — only the env-var name.

---

## The mental model

Every test is a **recipe**. A recipe has four parts:

1. **Target URL** — what to open.
2. **Login** (optional) — how to sign in.
3. **Steps** — ordered browser actions (`goto`, `click_text`, `fill`, `screenshot`, etc.).
4. **AI instructions** — plain-English things the AI should confirm in the screenshots.

When you **run** a recipe:
- Playwright drives a real Chromium browser at mobile (375px) and desktop (1280px).
- Full-page screenshots are captured at each `screenshot` step.
- The runner produces `runs/<recipe-id>__<timestamp>/` containing PNGs, a `run.json` log, and two prompt files.

When you **review**:
- `PROMPT.md` — paste this into an AI chat for a quick prose summary.
- `PROMPT_STRUCTURED.md` — for automation. Either paste it and save the AI's JSON reply via `save_result.js`, or let the tool call the API directly with `--review`.

When you **compare over time**:
- `approve.js` freezes the current review as the baseline.
- Next run's review is diffed against the baseline. Missing sections, flipped verdicts, changed values all flagged.
- `diff.js` exits non-zero on regression — CI-ready.

---

## Example 1 — Build your first recipe (the lazy way: record it)

Goal: test that `http://localhost:19995/sara.1/` renders her profile correctly when visited as a friend (logged in as `markly.1`).

### Step 1. Start the form

```bash
./start_webserver.sh
```

Open `http://localhost:11111` in your browser.

### Step 2. Fill in the header

| Field | Value |
|---|---|
| ID | `my_first_test` |
| Name | `My first test` |
| Description | Log in as markly.1 and check sara.1's profile renders. |
| Base URL | `http://localhost:19995` |
| Login URL path | `/login` |
| Username | `markly.1` |
| Password | click "+ Add / update a credential", name `RECIPE_MARKLY1_PWD`, value `markly123` |

The password is written to `.env.local` and the recipe stores only the env-var name.

### Step 3. Record the flow instead of typing steps

In the **Steps** section, keep **🎥 Record** selected (default). Click **● Start recording**. A real Chromium window opens at your Base URL.

Do the flow you want to test:
1. The page opens at `http://localhost:19995/`.
2. Navigate to `http://localhost:19995/sara.1/` in the address bar.
3. Scroll down to the About Me section.
4. Click the Personality card.
5. Scroll inside the modal.
6. **Close the Chromium window** (click its X). *Don't* click Discard on the form — that throws everything away.

When the window closes, the form repopulates with recorded steps. Playwright's codegen translates your clicks and scrolls into `goto`, `click_text`, and `fill` actions.

### Step 4. Add AI instructions

Switch to **✏️ Manual** if the form didn't auto-switch, scroll to **AI instructions**, and add checks like:

1. *A personality-report modal is visible after clicking the Personality card.*
2. *The modal heading mentions "Big Five" or "OCEAN".*
3. *No error banners, empty states, or broken images appear.*

### Step 5. Save

Click **Save recipe**. A file lands at `recipes/my_first_test.json`.

### Step 6. Run it

```bash
node runner/run.js my_first_test
```

Outputs land in `runs/my_first_test__<timestamp>/`. Paste the contents of `PROMPT.md` into an AI chat for a quick look — or go straight to automated review in Example 2.

---

## Example 2 — Automated AI review (no paste-and-save)

Once you have a recipe, you can skip the paste-into-chat step entirely. The tool calls the AI for you.

```bash
node runner/run.js my_first_test --review
```

This:
1. Runs the recipe and captures screenshots.
2. Calls Claude Haiku (default) with the screenshots + `PROMPT_STRUCTURED.md`.
3. Validates the AI's JSON against the schema.
4. Writes `result.json` to the run folder.

Pick a different model:

```bash
node runner/run.js my_first_test --review --model sonnet
node runner/run.js my_first_test --review --model opus
node runner/run.js my_first_test --review --model gemini-flash
node runner/run.js my_first_test --review --model gemini-pro
node runner/run.js my_first_test --review --model mock          # offline, no API call
```

Or use a full provider model ID:

```bash
node runner/run.js my_first_test --review --model claude-opus-4-7
node runner/run.js my_first_test --review --model gemini-2.5-pro
```

Want auto-review on every run without typing the flag? Add this to your shell:

```bash
export AI_UX_TEST_AUTO_REVIEW=1
```

### Reviewing a run that already finished

If you ran a recipe without `--review` and want to review it now:

```bash
node runner/review.js my_first_test
node runner/review.js my_first_test --run 20260420-193454    # a specific run
node runner/review.js my_first_test --dry-run                # print the request; send nothing
node runner/review.js my_first_test --force                  # overwrite existing result.json
```

### Manual paste workflow (no API key, or you just prefer it)

Still supported:

```bash
node runner/run.js my_first_test
cat runs/my_first_test__<ts>/PROMPT_STRUCTURED.md | pbcopy     # macOS
# paste into AI chat, get JSON back, save as my_review.json, then:
node runner/save_result.js my_first_test my_review.json
```

`save_result.js` validates the JSON and writes it to the run folder as `result.json`. Invalid JSON is rejected with a clear error.

---

## Example 3 — Baseline & regression (the real value)

Running a recipe once tells you the current state. To catch *regressions*, you need a baseline.

### Step 1. Approve your first good run

```bash
node runner/approve.js my_first_test
```

This copies `runs/<latest>/result.json` to `baselines/my_first_test.json` and locks the schema. This is your "known-good" reference.

### Step 2. Make a UX change

Edit the code, redesign a component, rename a section — whatever. You can even intentionally break something to test the tool (comment out a div, remove a label).

### Step 3. Re-run and diff

```bash
node runner/run.js my_first_test --review
node runner/diff.js my_first_test
```

Output looks like:

```
Diff — my_first_test
  baseline:  2026-04-20T19:20:00Z
  current:   my_first_test__20260421-091230 (fail)
  REGRESSION: 3 passing, 1 regression, 1 field change.

  Checks:
    [regression] The modal heading mentions "Big Five" or "OCEAN".

  Observed:
    [changed] primary_trait: "Neuroticism" → null

Wrote runs/my_first_test__20260421-091230/diff.md
```

**Exit code 2** when a regression or schema break is detected — easy to wire into CI or a pre-deploy script.

### Step 4. Decide: fix it, or re-approve

If the change was a **bug** — fix your code, re-run, diff again.

If the change was **intentional** (you redesigned the report intentionally) — re-approve:

```bash
node runner/approve.js my_first_test
```

The baseline moves forward. Next diff compares against the new baseline.

---

## Example 4 — Multiple baselines per recipe

Useful when you have multiple valid "correct" states — per-environment, per-release, per-feature-flag.

```bash
# Approve for a specific environment
node runner/approve.js my_first_test --name staging
node runner/approve.js my_first_test --name production

# Diff against a specific baseline
node runner/diff.js my_first_test --baseline staging
node runner/diff.js my_first_test --baseline production
```

Baselines live in `baselines/my_first_test/<name>.json` when named, or `baselines/my_first_test.json` for the default single-baseline case. Both paths are supported simultaneously.

---

## Example 5 — Ignoring fields that always change

The AI reviewer pulls `observed` facts from screenshots. Some will be genuinely unstable — timestamps, random avatars, session IDs — and the diff will keep flagging them forever.

Tell the diff engine to ignore them. Add `ignore_observed` to your recipe:

```json
{
  "id": "my_first_test",
  "...": "...",
  "ignore_observed": ["generated_at", "session_id", "avatar_url"]
}
```

Now `diff.js` silently skips those keys. They're still captured in `result.json` for the record — just not compared.

---

## Example 6 — Stable check IDs (survive text edits)

If you reword an AI instruction, the diff engine treats it as "check removed + new check added" — not great when you just fixed a typo.

Give each check a stable `id`:

```json
"checks": [
  "A plain-string check — matched by text",
  { "id": "modal_visible", "text": "The personality report modal is visible." },
  { "id": "has_big_five",  "text": "The modal heading mentions Big Five or OCEAN." }
]
```

Now you can rewrite the text freely (e.g. to `"The personality modal opens."`) and the diff engine keeps them linked by `id`. The text rewrite shows up as a one-line rename note in the diff, not a regression.

---

## Example 7 — Wiring into CI

Copy `ci/github-actions.yml.example` to `.github/workflows/ai-ux-regression.yml` in your project. Edit the two env vars at the top:

```yaml
env:
  RECIPE_ID: my_first_test
  AI_UX_DIR: ./tools/ai_ux_testing
```

Add these GitHub secrets to your repo:
- `ANTHROPIC_API_KEY` (required for Claude)
- `GOOGLE_API_KEY` (optional — only if using Gemini)

On every pull request, the workflow will:
1. Install deps + Playwright.
2. Run your recipe with auto-review.
3. Diff against baseline.
4. Upload screenshots + `run.json` + `result.json` + `diff.md` as an artifact.
5. Comment the `diff.md` contents on the PR.
6. Fail the job if there's a regression.

You need to decide where the app under test runs — typically a deployed preview URL (Vercel, Netlify, Cloud Run). The workflow as-shipped doesn't spin up a localhost server; if you need that, add a "run dev server" step before the recipe.

---

## Common workflows at a glance

| Situation | Command |
|---|---|
| Quick one-off sanity check | `node runner/run.js <id>` then paste `PROMPT.md` into chat |
| Auto-reviewed run | `node runner/run.js <id> --review` |
| Pick a reviewer model | `--model haiku` / `sonnet` / `opus` / `gemini-flash` / `gemini-pro` / `mock` |
| Promote the last run to baseline | `node runner/approve.js <id>` |
| See what changed since baseline | `node runner/diff.js <id>` |
| Run tests to verify the tool itself | `npm test` |
| Cleanup old screenshots | `./cleanup_runs.sh` (keeps newest 100) |

---

## Troubleshooting

**"Recording not implemented" or codegen window doesn't open:**
- Make sure `DISPLAY` is set (`echo $DISPLAY` — should show `:0` or similar). Recording needs a graphical session; headless SSH won't work.
- Restart the form server: `./start_webserver.sh`.

**"Recording already in progress" but you don't have a codegen window open:**
- Click **● Start recording** anyway — the form offers to reset the lock.
- Or manually: `curl -X POST http://localhost:11111/api/record/reset`.

**Recipe runs but 0 screenshots:**
- Your `steps` array has no `screenshot` action. Add one after each meaningful navigation.

**"Header missing" false positives in diff:**
- Reviewer is too strict (or too loose). Rewrite the AI instruction to be more specific, or add ignore-worthy keys to `ignore_observed`.

**Login fails — "could not locate login inputs":**
- Your login page uses a non-standard input layout. Override with explicit steps (use `fill` with a CSS selector) and set `login.url` to a placeholder page that just renders; then navigate to the real login via steps.

**`result.json` exists and review refuses to overwrite:**
- Pass `--force` to `review.js` or delete the file manually.

**Diff shows a change I don't care about on every run:**
- Add that key to `ignore_observed` in the recipe.

**I renamed an AI instruction and now diff is noisy:**
- Give the check a stable `id` going forward (Example 6).

**Costs are creeping up:**
- Haiku is 4–5x cheaper than Sonnet, 15–20x cheaper than Opus. Default to Haiku unless you need Sonnet/Opus for a tricky visual call. Use `--model mock` while iterating on recipe structure to avoid any API calls.

---

## When you come back to a cold conversation

If you start a new AI-assisted coding session and need it to understand this tool, paste `docs/CONVERSATION_SUMMARY.md` and `docs/SPEC_BASELINE_REGRESSION.md`. Those two files together are enough to restore full context.
