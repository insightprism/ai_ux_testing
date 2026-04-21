# Conversation Summary — ai_ux_testing

Purpose of this doc: if you start a fresh conversation with an AI assistant and need it to pick up where we left off, paste this file in. It captures what we built, why we built it, and where we left off.

Last updated: 2026-04-20 (after Phases 1–4 shipped)

---

## 1. What we're building (in one paragraph)

**ai_ux_testing** is a standalone tool that lets a non-engineer author a UX test by filling in a form (or recording a flow in a real browser), runs the flow in headless Chromium at mobile + desktop viewports, captures full-page screenshots, and hands those screenshots to an AI with plain-English "AI instructions" ("please look at the report and summarise what it says"). The AI reads the screenshots with vision and produces a verdict. The end goal is **UX regression testing**: run the same recipe before and after a UX change, detect what broke.

It lives at `/home/markly2/claude_code/ai_ux_testing/` and is deliberately separate from DatsMe (the original use-case codebase).

---

## 2. How it started — the real motivation

The user (Mark) was manually testing the DatsMe frontend. When bugs appear he has to log in, click, scroll, eyeball everything — slow, boring, easy to skip. We tested with a concrete task: **log in as markly.1, navigate to sara.1's profile, open her personality report, and describe what the AI sees**. That test worked end-to-end and proved the concept.

From there, Mark asked: *"Can we make this a form so I can record these tests and re-run them later?"* That's what this tool is.

Key moment in the conversation: Mark said *"this is interesting — we could do UX regression testing with this."* That framed the next direction — structured results + baselines + diffs, captured now in `SPEC_BASELINE_REGRESSION.md`.

---

## 3. Core design principles the user cares about

These come from the DatsMe `CLAUDE.md` and the user's feedback during this conversation. They apply to `ai_ux_testing` too.

- **Durable, maintainable solutions — no MVP shortcuts.** Don't propose "quick vs. better" trade-offs unless the user asks for a prototype.
- **Mobile-first by default.** The form UI and the test runner both honor this.
- **Reuse existing patterns.** If the codebase has a way of doing something (e.g. the DatsMe `start_backend_only.sh` as the template for `start_webserver.sh`), match it.
- **Recommendations must be grounded in real code** — read files first, then speak. Don't describe files you haven't read.
- **Use meaningful names, not generic ones.**
- **Credentials never stored in plain text in recipes** — always env-var indirection. Recipe holds `"password_env": "RECIPE_MARKLY1_PWD"`; value lives in `.env.local` (gitignored, 0600).

---

## 4. What's built so far

### Directory layout

```
ai_ux_testing/
├── README.md                         ← full user-facing workflow
├── package.json                      ← deps: express, playwright
├── start_webserver.sh                ← starts form server on port 11111
├── cleanup_runs.sh                   ← keeps newest 100 screenshots, deletes older
├── .env.example / .env.local         ← credentials (latter gitignored, 0600)
├── .gitignore
├── lib/
│   ├── schema.js                     ← recipe validator + viewport sizes
│   └── codegen_to_steps.js           ← parses playwright codegen JS → recipe actions
├── web/
│   ├── server/server.js              ← Express: form, recipes, credentials, record endpoint
│   └── public/                       ← index.html + app.js + styles.css (mobile-first)
├── runner/
│   └── run.js                        ← Playwright CLI runner
├── recipes/
│   ├── sara_personality_friend_view.json         ← working example (the one we tested)
│   └── markly_view_sara_personality_test.json    ← earlier scratch version
├── runs/                             ← one folder per run, gitignored
│   └── <recipe-id>__<timestamp>/
│       ├── 01_<name>_<viewport>.png  ← numbered full-page screenshots
│       ├── run.json                  ← mechanical log of the run
│       └── PROMPT.md                 ← human-readable prompt to paste to AI
└── docs/
    ├── SPEC_BASELINE_REGRESSION.md   ← proposed next-phase spec (baselines + diff)
    └── CONVERSATION_SUMMARY.md       ← this file
```

### The webform (port 11111)

- **Recipe list** at the top of the page.
- **Create / edit recipe** panel with fields for id, name, description, base URL, login, steps, AI instructions (formerly labeled "checks"), viewports.
- **Steps section** has two tabs:
  - **🎥 Record** (default) — opens Playwright codegen in a real browser; user performs the flow; closing the browser saves the recorded steps into the form (translated from codegen's JS into our action schema).
  - **✏️ Manual** — add step rows by hand. Each row is numbered with a badge (1, 2, 3…) that auto-renumbers on add/remove.
- **AI instructions** are numbered the same way.
- When recording is active, the whole page gets a pulsing red banner at the top and a dedicated banner inside the Steps section that reads: *"To SAVE, close the browser window. The button below only cancels."* (This came from Mark almost losing a recording by clicking the wrong button.)
- **Credential manager** (inside Login fieldset): pair of inputs that write `KEY=VALUE` to `.env.local` without ever putting the value into the recipe JSON.

### The runner

```
node runner/run.js <recipe-id>
```

- Runs `cleanup_runs.sh` first (keeps newest 100 screenshots).
- Loads `.env.local` so passwords are available.
- Launches headless Chromium; for each viewport (mobile 375 / desktop 1280):
  - Attempts login (best-effort, selector-free — tries common input patterns).
  - Executes the recipe's steps in order.
  - Writes numbered full-page PNGs.
- On completion, emits `run.json` and `PROMPT.md` in `runs/<recipe-id>__<timestamp>/`.
- On failure, captures `99_FAILURE_<viewport>.png` and marks status `failed`.

### Recipe action vocabulary (current)

- `goto { path }` — relative path or full URL.
- `click_text { text }` — clicks the first element containing that visible text.
- `click_selector { selector }` — CSS selector escape hatch.
- `fill { label|selector, value }` — uses Playwright's `getByLabel` or a CSS selector.
- `wait { ms }`
- `scroll { direction, amount? }` — direction: `up`/`down`/`top`/`bottom`; amount in pixels (default 800).
- `scroll_inside { text|selector, direction, amount? }` — NEW. Scrolls the nearest scrollable ancestor of the target element. Added because the sara.1 personality report opens as a modal with its own inner scrollbar; plain `scroll` only moved the page behind it.
- `screenshot { name }` — full-page PNG.

### Recording path

`POST /api/record { base_url }` spawns `playwright codegen --target=javascript --output /tmp/codegen_*.js <base_url>` directly (not via npx) and puts the child in its own process group so kill signals reach the browser. On browser close, codegen writes JS; we read and parse it with `lib/codegen_to_steps.js` into our action schema.

**Passwords are scrubbed** during parsing: any `fill()` targeting a label/selector that matches `/password|passwd|pwd/i` or `type=password` is emitted with `value: ""` and `needs_password_env: true`. The UI then nudges the user to wire that field to a credential.

There's also `POST /api/record/reset` for recovering from a stuck codegen lock (we hit this once during development when an aborted recording left processes behind).

---

## 5. The concrete working test we built

Recipe: **`recipes/sara_personality_friend_view.json`**

Flow:
1. Log in as markly.1 via `/login`.
2. Navigate to `/sara.1/`.
3. Screenshot the landing.
4. Scroll down ~900px to reveal the About Me section.
5. Screenshot About Me.
6. Click the text `"My Big Five"` — this opens a Big Five personality report **modal**.
7. Screenshot the modal (top).
8. `scroll_inside` using text hint `"Your Big Five Personality Test"` — scrolls the modal's inner scroll region, not the page.
9. Screenshot modal (mid).
10. `scroll_inside` to bottom of modal.
11. Screenshot modal (bottom).

Outcome (from the last run we did): AI vision could read the entire report across the three modal screenshots and produced a summary — Sara's type is Neuroticism with runner-up Agreeableness, sections include Your trait profile, Overview, Strengths, Growth areas, Growth edges, and a Runner-up type narrative.

This is our canonical example — the one to use when testing future features.

---

## 6. Friction we discovered along the way (worth remembering)

| Issue | Resolution |
|---|---|
| Mark accidentally hit "Stop / cancel" thinking it meant "save" — lost the recording | Renamed to "✕ Discard"; added confirmation dialog; added big red instruction banner |
| Codegen child process didn't die when cancelled | Spawn playwright binary directly (not via npx), detached + kill process group; added `/api/record/reset` for recovery |
| "Recording already in progress" stuck state | Frontend now auto-offers to reset via dialog on 409 |
| Plain `scroll direction: bottom` didn't move content inside the modal | Added `scroll_inside` action |
| `click_text: "Personality"` matched the card heading (no navigation), not the expected clickable target | Changed to `click_text: "My Big Five"` which reliably opens the modal |
| Two "More →" links on the profile (Favorites and Personality) — `click_text` takes the first match | Documented; flagged `click_selector` with `:below(:text(...))` as the reliable escape hatch |
| Playwright codegen recorded irrelevant tail steps (Sign In, Log In, Chat) from the logged-out session; runner failed on those | User edits the recipe after recording; recorded steps are literal, not smart |
| User had an old recipe with `target.base_url` pointing at a path, not the origin, plus `login.url` as a full URL | Runner now handles login.url being a full URL; user's recipes normalized to origin-only base_url |
| Non-text recipe fields showed placeholder text that looked like a saved value | Error messages improved; "AI instructions" label now explains placeholders don't save |

---

## 7. Where we are right now

All four phases from `SPEC_BASELINE_REGRESSION.md` are implemented and tested.

### Phase 1 — structured result contract (done)
- `lib/result_schema.js` validates `result.json`.
- `runner/prompt_structured.js` — single function builds the reviewer prompt.
- `runner/save_result.js` — CLI that validates AI JSON and writes it to a run folder.

### Phase 2 — baselines + diff (done)
- `lib/runs.js` — shared run/baseline discovery.
- `lib/diff_engine.js` — pure diff logic (status / checks / observed).
- `runner/approve.js` — promote a reviewed run to baseline.
- `runner/diff.js` — compare latest run to baseline, emit `diff.md`, exit 2 on regression.
- `cleanup_runs.sh` — preserves folders containing `result.json`.

### Phase 3 — API-driven reviewer (done)
- `lib/env_loader.js` — reads `.env.local`, then DatsMe's `api/.env` for shared keys.
- `lib/reviewer/{index,claude,gemini,mock}.js` — pluggable providers.
- `runner/review.js` — CLI that runs the reviewer and writes `result.json`.
- `runner/run.js` — `--review` / `--model` flags + `AI_UX_TEST_AUTO_REVIEW=1` env opt-in.
- Model presets: `haiku` (default), `sonnet`, `opus`, `gemini-flash`, `gemini-pro`, `mock`.
- Full provider IDs accepted (anything starting with `claude-` or `gemini-`).

### Phase 4 — nice-to-haves (done)
- Stable check IDs: recipe checks may be `{id, text}`; diff prefers id match over text match; renames logged with reason.
- Multi-baseline: `baselines/<recipe>/<name>.json`; `approve --name`, `diff --baseline`. Back-compat with flat `baselines/<recipe>.json`.
- `ignore_observed`: recipe declares keys the diff engine skips (for dynamic values).
- CI template at `ci/github-actions.yml.example` — runs recipe, auto-reviews, diffs, comments on PR, uploads run artifacts.

### Tests
- 5 test files at `tests/test_*.js`, **94 assertions** covering schema, diff engine, runs helpers, prompt builder, Phase 4 features. `npm test` runs all of them.

---

## 8. To pick up in a new conversation

Paste this file and say something like:

> "Read `docs/CONVERSATION_SUMMARY.md` and `docs/SPEC_BASELINE_REGRESSION.md`. All four phases are shipped. Let's work on <new topic>."

Likely follow-up work:
- Build out more recipes for other DatsMe flows (friend feed, group pages, chat).
- Tune reviewer prompting for recipes where the AI's `observed` keys drift.
- Pixel-level ignore regions (deferred from Phase 4 — non-trivial).
- A simple UI for viewing past runs + diffs.

---

## 9. Open questions from the spec (still unresolved)

1. Should `observed._schema_frozen` be a hard gate or soft signal? (Spec says soft for v1.)
2. Which Claude model for the v2 API reviewer? (Default: latest Opus with vision.)
3. Should `diff.js` output also get a natural-language "is this regression meaningful?" pass from the AI? (Spec says defer to phase 4.)

---

## 10. Things that are **out of scope** for this tool (at least for now)

- Pixel-level visual diffing.
- CI/CD integration.
- Multiple named baselines per recipe (per-release, per-environment).
- Automatic approval / pass-fail gating — approvals are always explicit user actions.
- Agentic AI that "explores" the app. We're deliberately using deterministic recipes for coverage control.

---

## 11. Key files to read first in a new conversation

In order of importance:

1. `docs/SPEC_BASELINE_REGRESSION.md` — the plan for what's next.
2. `docs/CONVERSATION_SUMMARY.md` — this file.
3. `README.md` — current workflow as documented for users.
4. `lib/schema.js` — recipe shape (also the contract this tool enforces).
5. `runner/run.js` — where all actions get executed.
6. `recipes/sara_personality_friend_view.json` — the canonical working example.

Reading those 6 files should be enough to have the full picture.
