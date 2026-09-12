# Handoff — `feat/code-mode-subcalls` → first publish

Written 2026-09-12, at the end of the branch's feature work. This is the
状态交接: where the tree stands, what is left, and the traps that cost this
branch time so the next reader does not pay for them twice.

It is not a design document. Design lives in [SPEC.md](SPEC.md), sequencing in
[TUI-ROADMAP.md](TUI-ROADMAP.md), and closed bugs in
[lessons/](lessons/README.md). This file goes stale the moment `0.1.0-rc.7`
is published — delete it then.

## 1. Where the tree stands

- **Branch** `feat/code-mode-subcalls`, 11 commits ahead of `main`, working
  tree clean.
- **Version** `0.1.0-rc.7`, lockstep with the whole `dsh-*` peer family (rule 5).
- **Gate** green as of `5f0d31a`: `pnpm typecheck` clean, **1310 tests**
  passing, `pnpm lint` at exactly the two pre-existing baseline errors in
  `src/render/message-layout.ts:181` (`no-non-null-assertion`,
  `no-unnecessary-type-assertion`). Those two are the baseline — if you see a
  third, it is yours.
- **Published** never. `npm view @deepseek-ai/dsh-tui` is a 404, while
  `README.md:54` already tells users to `pnpm add @deepseek-ai/dsh-tui`. That
  gap is the reason this branch exists in the state it does.

### What the 11 commits are

```
5f0d31a fix(approval): the session's opening policy is not a switch
ad9e03c feat(mcp): configure and connect a server from the TUI
546f2b1 feat(model): /model opens a picker over the provider's catalogue
8be3cd2 feat(permission): cycle presets with Tab / Shift+Tab on an empty prompt
8e7a267 feat(permission): pick a preset from a /permission secondary window
9e77367 feat(permission): surface the effective preset in the chrome
a90fd51 feat(skill): move skills out of the / palette into a dedicated /skill picker
a71d277 feat(prompt): /keybinds vim adds a normal mode without taking anything away
713bddd feat(approval): keep the audit trail the card cannot
8a2fee6 feat(workflow): draw a fan-out as one entry with a row per child agent
39ee18b feat(code-mode): draw run_code sub-calls inside the parent entry
```

Every SPEC Part 2 v1.0 item is now shipped. Part 2 is the accurate inventory;
read it there rather than re-deriving it.

## 2. What is left before publishing

Nothing in this list is a feature. All four are mechanical, and the last one is
irreversible — **do not run it without an explicit go-ahead from the owner.**

1. **Merge into `main`.** The branch name stopped describing its contents around
   commit four; the merge commit is where that gets said properly.
2. **`pnpm tty-check` on a real terminal.** The suite cannot make claims about
   pixels — chalk is level 0 under vitest — so the script asks a human. One
   question has never been answered on the background it is about:
   `scripts/tty-check.ts:190-191`, "on a **light** background, does the bold
   white line vanish and the bold uncolored one survive?" That check is the
   regression guard for the bold-white bug; everything else in the script has
   passed on a real TTY (see the memory note `tty-check-first-run`).
3. **`pnpm run build && pnpm pack:check`** — confirms `yaml` stays
   externalized and `shiki` stays lazily imported. Both were verified on this
   branch; re-run after the merge, not before.
4. **Publish `0.1.0-rc.7` with `--tag next`.** *Not* `latest`. Every package in
   this family carries a `latest` of the abandoned `0.0.1-rc.1`, both READMEs
   already tell users to install `@next`, and publishing `latest` here would
   make this package the only one in the family that disagrees. The flow is
   §3.8. Needs confirmed npm credentials.

Optional, not blocking: there is no `CHANGELOG.md`. Eleven commits of prose-y
subjects make a decent first one if you want it.

## 3. Deliberately deferred, so nobody re-opens them

These are refusals or waits, not gaps. Each has its reasoning recorded where it
belongs; do not re-litigate without reading it first.

- **Per-entry `▾ show more`.** Refused. Expanding *one* entry needs a focus /
  selection model this app does not have. `/verbose` shipped as a global switch
  precisely because a global switch needs none. SPEC §1.2, roadmap §6.
- **`/paste`.** Refused. Reading the clipboard needs a mid-session stdin
  listener, and stdin is Ink's. Every terminal already pastes. SPEC §1.5.5.
- **MCP credentials.** Waiting on the harness. The bridge's `env` resolves no
  credential references, so a key in a pasted `mcpServers` block is written to
  `$DSH_HOME/cordis.patch.yml` in plaintext. The TUI flags it and both READMEs
  recommend `!!js process.env.YOUR_VAR`; that is the whole mitigation available
  from this side. SPEC §1.12.1.
- **Hook aggregate row** for the match-everything case. SPEC §1.15.
- **Plan-mode diff preview.** Needs a diff to exist first. Part 2, v1.0.

## 4. Traps — the ones that actually cost time here

Four, in descending order of how much they cost.

**A capability's price is in its `.d.ts`, never in its package name or its
`npm view` output.** This branch wrote off reachable capabilities **five** times
— MCP twice, hooks once, sub-agents twice — with three distinct wrong reasons
("no published plugin", "wrong version line", "a design problem"). The trap that
makes it repeatable: every `dsh-*` package's `latest` dist-tag points at
`0.0.1-rc.1`, so a bare `npm view <pkg>` reports a version *below* the pinned
line and reads like confirmation that the thing is not there. The sequence is
`npm view <pkg> versions --json` → read the `.d.ts` in the tarball → check
*which* package emits into the session you are actually reading. Also recorded
in the memory note `dsh-size-capability-from-exports`.

**A fixture that disagrees with reality about a session's opening state makes a
whole test family blind.** `tests/fake-tty.ts`'s `seedSession` used to create a
session with an *empty* log — and no real assembly boots that way, because
`dsh-permission-presets` appends `permission/preset`, `sandbox/mode` and
`approval/policy` to any session carrying none. So the reducer drew an
approval-policy row on the first frame, the Banner/StatusBar mutual exclusion
(`renderer.tsx:787` vs `795`) swapped the splash for the two-row chrome, and not
one of the 29 spec files that paint through that harness could see it.
`seedSession` now writes that real boot log. When a frame bug survives the
suite, suspect the fixture's idea of "a fresh session" before suspecting the
renderer.

**A whole-value event is not a change event.** `approval/policy` carries the
policy, not a delta, and a construction seed is byte-identical to a `/approval`
switch — `source: 'delegation'` is the only thing the payload ever discriminates.
Position in the log is therefore the only signal available for "was this a
switch?", which is what `onApprovalPolicy` now uses. Any future whole-value
event has the same shape of problem waiting in it.

**In a fixed-height Ink frame, overflow overlaps — it does not scroll.** A
subtree whose height is data-driven will paint over its neighbour and the
symptom will look like a resize bug. First question is always: which subtree's
height is driven by data? Memory note `dsh-tui-frame-overflow-overlaps`;
`lessons/resize-reflow.md` for the frame-ownership half.

## 5. Before you touch anything

Read `AGENTS.md` first — it is 98 lines and its 13 rules are the ones a PR gets
rejected for. The four that catch people most often on this codebase:

- **8** — docs land in the same commit as the code. Stale docs are bugs.
- **11** — every on-screen string in `src/core/i18n.ts`, both languages, and anything
  padded or centred is measured with `displayWidth` (a CJK glyph is two columns).
- **12** — a new `UiEntry` kind is measured in `scroll.ts` and drawn in
  `MessageList.tsx` in the same change, row for row, or paging stops being
  invertible.
- **2** — `state.ts` is pure. It is the test surface for the whole model layer.
