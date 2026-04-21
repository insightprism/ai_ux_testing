# Enhancement Options — ai_ux_testing

Status: review document, not an implementation plan. Nothing below is scheduled.

Each option lists: **what it is → why it helps DatsMe specifically → what it costs to build → effort rating → honest recommendation**.

**Effort scale:**
- **S** — half-day or less. One focused session.
- **M** — 1–2 days. Touches 3–5 files, needs new tests.
- **L** — 3–5 days. New concepts, cross-cutting, schema changes.
- **XL** — 1–2 weeks. New architecture surface, significant edge cases.

**Priority**, where given, is relative to each other — P1 is "if you build more, build this first."

---

## Tier 1 — High leverage for DatsMe specifically

### 1. Multi-persona runs in a single recipe

**What:** Instead of one recipe = one logged-in user, allow a recipe to declare multiple personas (owner / friend / stranger). The runner executes the steps once per persona and labels screenshots accordingly.

```json
"personas": [
  { "name": "owner",    "login": { "username": "sara.1",   "password_env": "..." } },
  { "name": "friend",   "login": { "username": "markly.1", "password_env": "..." } },
  { "name": "stranger", "login": null }
]
```

**Why it matters for DatsMe:** your entire product is about *who you are to whom*. The same profile page renders differently for the owner, a friend, and a stranger. Today's tool catches bugs in one persona's view — a regression in the friend's view of sara.1 wouldn't be caught by a markly-viewing-his-own-profile test. This is a blind spot that matches directly onto DatsMe's biggest bug class: privacy leaks and role-gated UI.

**What it costs to build:**
- `lib/schema.js` — accept `personas[]` alongside / instead of top-level `login`.
- `runner/run.js` — outer loop: for each persona, do the existing viewport loop; prefix screenshots with persona name; record persona in `run.json`.
- `lib/diff_engine.js` — baseline and diff stored per-persona; diff reports grouped by persona.
- `runner/prompt_structured.js` — emit a separate `PROMPT_STRUCTURED.md` per persona, or a consolidated one with persona-labeled screenshots.
- `tests/` — fixture with a 2-persona recipe; tests that verify independent screenshot labelling and diff grouping.
- Docs in `README.md` and `USER_GUIDE.md`.

**Effort: L** — not conceptually hard but touches several files and doubles the storage/output surface area.

**Recommendation: do it, rank #1 of all options.** This is the single enhancement that most directly serves DatsMe's actual structure as a product. Every other tool in the industry assumes "one user at a time" — your product doesn't. You will ship regressions that only manifest from one persona's angle, and this is the only way to catch them systematically. If you only implement one thing from this doc, make it this.

---

### 2. Content-presence assertions

**What:** Recipe can declare hard requirements on specific content values that the AI is instructed to verify strictly. Separate from the reviewer's freeform `observed`.

```json
"expect_content": {
  "user_handle_visible": "sara.1",
  "primary_personality_trait": { "must_be_one_of": ["Neuroticism", "Agreeableness", "Openness", "Extraversion", "Conscientiousness"] },
  "favorites_count": { "at_least": 5 },
  "no_empty_states": true
}
```

The structured prompt passes these as required checks; the diff treats violations as regressions distinct from `observed` drift.

**Why it matters for DatsMe:** the "That's Me" moment is when someone's content *actually shows up*. The worst-case bug for a personal-website product is silent content loss — a section that was populated last week is empty today, but the layout still looks correct. Pure visual review will miss this; a diff on `observed` catches it only if the reviewer thought to extract that field. Content-presence assertions make the expectation explicit and binding.

**What it costs to build:**
- `lib/schema.js` — validate `expect_content` structure and the constraint DSL (`must_be_one_of`, `at_least`, `match`, `must_be_present`, etc.).
- `lib/expectations.js` (new) — evaluate an expectation against the reviewer's JSON output.
- `runner/prompt_structured.js` — render expectations into the prompt as explicit requirements.
- `runner/review.js` — after AI returns, run expectations against `result.json`; surface failures as checks.
- `lib/diff_engine.js` — expectations get their own diff section, always compared even without a baseline.
- `tests/` — fixtures for each constraint operator, especially edge cases (null, missing key, array length).

**Effort: L** — the DSL itself is small, but designing it well (not accidentally building a mini query language) needs care.

**Recommendation: do it, but only after #1.** For DatsMe specifically, this catches the bug that hurts users most (silent data loss from their profile). However, it's only powerful once you already have multi-persona coverage — otherwise you'll author expectations that happen to pass from the owner's view but fail from a friend's, and you won't know. Sequence #1 → #2.

---

### 3. AI diff explanation ("is this regression meaningful?")

**What:** After `diff.js` produces its structured diff, hand it + the before/after screenshots back to the AI with the question *"Is this regression meaningful or cosmetic? Which changes should a human look at first?"* Append the answer as a one-paragraph editorial to `diff.md`.

**Why it matters for DatsMe:** you iterate on UX weekly. Without this, every redesign produces a wall of "changed" diff entries you'll learn to ignore — and the day a real bug slips in, it'll hide in the noise. With this, the AI says *"these 5 changes are color/spacing tweaks from the redesign you just did; this 1 change silently removed the trait summary — look at that one first."*

**What it costs to build:**
- `lib/reviewer/*` — new method `explainDiff({ diff, baselineScreenshots, currentScreenshots })`. Reuses existing vision infrastructure.
- `runner/diff.js` — optional `--explain` flag that invokes the explainer after producing the structured diff.
- Prompt engineering — designing the "is this meaningful?" prompt well is 70% of the work here.
- `tests/` — mostly needs a mock reviewer that returns canned explanations; the logic itself is a single call.

**Effort: M** — small code surface, but prompt-engineering iterations take time.

**Recommendation: do it, but treat prompt quality as the real deliverable.** This is the enhancement that makes the tool *sustainable* for a one-person team that iterates fast. Without it, diff fatigue sets in within a month and you'll stop trusting the tool. With it, the tool continues to earn its keep even as you redesign constantly. **One real caution:** this doubles the API cost per diff. Default it to off; turn on via `--explain` when you're deep in a UX sprint and need to triage fast.

---

### 4. Mobile-first regression weighting

**What:** Elevate mobile from "one of two viewports" to "the primary verdict." Add `mobile_critical` (default `true`) so a mobile regression fails the diff hard; desktop-only regressions are warnings. Optionally reorder `diff.md` output so mobile screenshots come first.

**Why it matters for DatsMe:** your `CLAUDE.md` explicitly says mobile-first isn't a trade-off. The tool today treats the two viewports equally, which quietly contradicts that principle — a mobile regression and a desktop regression are both just "regression" in the exit code. This change makes the tool reflect what you've already decided matters.

**What it costs to build:**
- `lib/schema.js` — accept `mobile_critical: bool` on recipes (default true).
- `lib/diff_engine.js` — track viewport per finding; compute `hasMobileRegression` separately; exit code logic considers it.
- `runner/diff.js` — reorder sections, emit "MOBILE REGRESSION" header.
- `runner/prompt_structured.js` — minor emphasis change in prompt ("evaluate mobile first").
- `tests/` — fixture with mobile-only regression vs desktop-only.

**Effort: S** — genuinely small.

**Recommendation: do it whenever you touch the diff engine next.** Low cost, real alignment with a principle you've already committed to. Don't do it in isolation — bundle it with #1, #2, or #3 so the testing/CI churn is absorbed once.

---

### 5. Recipe inheritance / templates

**What:** A recipe can `extends` a parent recipe, inheriting login, base_url, shared setup steps. Child overrides or appends as needed.

```json
{
  "id": "sara_personality_friend_view",
  "extends": "base/friend_views_profile",
  "target_user": "sara.1",
  "steps": [ "...additional steps..." ]
}
```

**Why it matters for DatsMe:** as you build coverage across profile, feed, groups, chat, store, etc., 80% of every recipe will repeat the same login dance and preamble. Without inheritance, test-authoring friction rises to the point where you stop doing it. With inheritance, a new recipe is 5 lines — which is cheap enough to write on every feature.

**What it costs to build:**
- `lib/schema.js` — resolve `extends` at load time; detect cycles; merge rules for arrays (append) vs objects (override).
- `lib/recipe_loader.js` (new — extract from current inline logic) — load, resolve inheritance, validate.
- `runner/run.js`, `runner/review.js`, `runner/diff.js` — use the loader instead of reading recipes directly.
- `recipes/base/` directory for templates.
- `tests/` — inheritance resolution, cycle detection, array vs object merge semantics.
- Docs.

**Effort: M.**

**Recommendation: defer until you have pain.** The pitch is sound — you *will* hit this friction — but *you haven't hit it yet*. You have 2 recipes. Build 5–10 more first without inheritance and see which parts actually repeat. Premature inheritance designs force awkward abstractions; evidence-based inheritance designs survive. Implement this after you've felt the real friction.

---

### 6. "Snapshot a user" one-shot

**What:** A drop-in CLI that takes a target user (and optional viewer) and produces screenshots + default "is this healthy?" review without needing a recipe.

```bash
node runner/snapshot.js sara.1                    # logged-out view
node runner/snapshot.js sara.1 --as markly.1      # friend view
node runner/snapshot.js sara.1 --as markly.1 --auto-review
```

**Why it matters for DatsMe:** on deploy day you don't want to write or find a recipe — you want to spot-check that the platform didn't break. A `snapshot.js` with sane defaults (visit profile, scroll, capture, AI review with canned "looks healthy?" checks) turns that into one command. Also perfect for investigating a user bug report — snapshot their profile as yourself, look at what they look like, get an AI read.

**What it costs to build:**
- `runner/snapshot.js` (new) — internally builds a transient recipe + runs it + reviews it.
- A default "snapshot checks" prompt (AI evaluates: content present? layout OK? error banners?).
- Reuse all existing run/review/diff plumbing.
- Optional: store snapshots outside `runs/` in `snapshots/` since they aren't tied to a recipe.

**Effort: M.**

**Recommendation: do it before you need it, but last in this tier.** Cheap to build, high moment-of-need value. But it's a convenience wrapper, not an infrastructure layer — so low urgency. Do this when you want a break from denser work.

---

## Tier 2 — Broadly useful, moderate DatsMe-specific leverage

### 7. Recipe suites

**What:** A `suites/<name>.json` file lists recipe IDs. `node runner/run-suite.js <name>` runs them all, aggregates exit codes, produces a single combined report.

```json
{ "id": "critical_user_journeys", "recipes": ["sara_personality_friend_view", "feed_fresh_friend_post", "groups_member_view"] }
```

**Why it matters:** "did anything regress?" is a one-command question. You will want this the moment you have 5+ recipes.

**What it costs to build:**
- `suites/` directory, JSON schema.
- `runner/run-suite.js` — spawns each recipe run, collects results, writes an aggregate `suite_run.json`.
- Aggregate diff output that highlights which recipes regressed.
- Effort ~M.

**Recommendation: build when you have 5 recipes.** Not needed now (you have 2). Premature at this scale. Trivial to add when needed.

---

### 8. Focus hints for screenshots

**What:** Attach a focus description to a screenshot action. The AI is told to pay particular attention to that area.

```json
{ "action": "screenshot", "name": "feed_card_top", "focus": "the topmost feed card — verify avatar, name, timestamp, and preview text are all visible" }
```

**Why it matters:** AI vision is great at "anything wrong?" but hit-or-miss at *the specific small thing*. Focus hints concentrate its attention — and also serve as inline documentation for why the screenshot exists.

**What it costs to build:**
- `lib/schema.js` — accept optional `focus` on screenshot steps.
- `runner/run.js` — propagate focus into `run.json` screenshot metadata.
- `runner/prompt_structured.js` — render focus inline with each screenshot listing.
- Effort S.

**Recommendation: do it.** Low cost, genuine quality improvement. Bundle with #1, #2, or #3.

---

### 9. Shared-component baselines

**What:** Some `observed` fields describe a shared component (the Personality card on every user's profile). Let baselines be keyed to the component, not the recipe — so changing the Personality component is a single baseline update instead of N.

```json
"observed": {
  "_components": {
    "personality_card": { "primary_trait": "Neuroticism", "runner_up_trait": "Agreeableness" }
  },
  "other_top_level_key": "..."
}
```

Baselines store per-component sub-baselines in `baselines/_components/<name>.json`, shared across recipes.

**Why it matters for DatsMe:** your template / platform-engine vision means the same card appears on many users' sites. Without shared baselines, every template change requires N baseline updates. With them, component regressions are caught globally.

**What it costs to build:**
- Baseline storage redesign — component baselines live alongside per-recipe ones.
- `lib/runs.js` — add component baseline loader.
- `lib/diff_engine.js` — detect `_components` block; diff each against its component baseline.
- `runner/approve.js` — ability to approve a component baseline separately.
- Effort L — this is the most architecturally significant Tier-2 change.

**Recommendation: defer until templates are in real use.** Powerful, and directly aligned with your Platform Engine vision — but your templates are still conceptual. Implementing this now means designing abstractions around components that don't exist yet. Build it the moment you ship the first template-driven site and feel the baseline-duplication pain.

---

### 10. Diff visualization as static HTML

**What:** Generate `runs/<...>/diff.html` alongside `diff.md` — a side-by-side mobile+desktop screenshot grid with diff annotations as overlays. Pure static HTML (no framework, no server).

**Why it matters:** Markdown diffs are great in CI comments and terminals. For local review, a visual page is 10x faster to scan. Especially valuable when a diff involves several screenshots.

**What it costs to build:**
- `runner/diff.js` — extra step after `diff.md` writes `diff.html` using a template string.
- Template: flex-grid of screenshots (baseline | current), diff summary at top, per-section annotations inline.
- Effort S–M (mostly design polish).

**Recommendation: do it when you get tired of reading Markdown.** You won't need it for the first month. Trivial to add when you want it.

---

## Tier 3 — Nice but low DatsMe leverage right now

### 11. Performance budgets

Capture page-load time + Largest Contentful Paint; regress on >20% slowdowns.

**Effort: M.** Playwright provides these metrics natively; storing + diffing them is small code. But DatsMe is not yet at the scale where perf dominates UX problems. **Defer indefinitely** unless you hit a specific perf complaint from users.

### 12. Accessibility audit integration

Pipe axe-core through the runner; surface a11y violations alongside AI checks.

**Effort: M.** Valuable for product maturity, especially given your cross-border family use case (grandparents use screen readers, motor impairment rises with age). **Consider for Tier 2 once you have 20+ active users.** Not now.

### 13. Slack / email notifications on regression

**Effort: S.** Genuinely useful, but CI already comments on PRs. **Skip unless you move to a cadence where nobody's checking PRs actively.**

### 14. Multi-tab / multi-window recipes

Test real-time features (A sends message → B sees it).

**Effort: XL.** Complex — requires running two browser contexts, orchestrating events, handling timing. Only worth doing once you're seriously productizing chat / calls. **Defer.**

### 15. Test data fixtures

Seed a known-good DB state before each run for deterministic results.

**Effort: L.** DatsMe's per-user SQLite makes this naturally tractable (copy a golden .db into place), but needed only once flakiness from real-user-state changes bites you. **Defer until flakiness forces the issue.**

---

## Tier 4 — Looks shiny, would actively slow you down

### 16. Auto-recipe generation by an exploring agent

AI wanders the site autonomously, writes recipes. Sounds magical.

**Don't do this.** Non-deterministic coverage = non-deterministic diffs = the tool stops being trustworthy. Your whole architecture has *intentionally* chosen deterministic recipes. Don't backslide for a demo-looking feature.

### 17. Pixel-level visual diffing

**Don't do this.** You explicitly designed against it in the spec, for good reasons. Pixel diffing produces high-noise output that drowns signal. Stay with semantic (content-level) diffing — that's your differentiator.

### 18. Web UI for managing recipes / runs / baselines

**Don't do this.** The CLI works fine. A UI is a 10x maintenance burden for a 1.5x ergonomic gain. You already have the recipe-authoring form — that's the one UI that genuinely saves time. Everything else is best as CLI.

### 19. Recipe marketplace / sharing

**Don't do this.** Premature for a single-team tool. Would distract from the core job.

### 20. Cross-browser matrix (Firefox + WebKit in addition to Chromium)

**Don't do this for now.** Cross-browser bugs in 2026 web apps are rare and mostly in CSS edge cases — which your AI reviewer can't reliably judge anyway. 3x the runtime + 3x the baseline maintenance. **Revisit only if you hit a real Safari-specific bug.**

---

## Suggested sequencing if you decide to build

If you're going to pick a subset, here's the order I'd do them in:

1. **Multi-persona runs (#1)** — biggest DatsMe-specific unlock.
2. **Mobile-first weighting (#4)** — small, aligns tool with principle, bundle with #1.
3. **Content-presence assertions (#2)** — activates only after #1 is in place.
4. **AI diff explanation (#3)** — sustainability; becomes valuable when diff output gets noisy.
5. **Focus hints (#8)** — small polish, improves AI accuracy incrementally.
6. **Recipe suites (#7)** — build the moment you have 5+ recipes.
7. **Snapshot CLI (#6)** — whenever you want a break from denser work.

Everything below that: wait until real usage surfaces the need.

## Honest reminder

Before implementing *any* of this: **write and run 5–10 more recipes over the next two weeks.** The features you'll actually want will become obvious — and they may not be exactly what I listed. The tool as-shipped is good enough that adding features later is cheap; building speculatively before usage is the trap.

Every enhancement here is a real idea, but only 3–4 of them are likely to survive contact with actual use. Don't over-build before the signal comes in.
