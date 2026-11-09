# Existing website design contract

This Astro site uses the existing terminal-oriented design in
`src/styles/global.css`. Content updates preserve it; this is not a redesign.

- Tokens: `--bg`, `--panel`, `--line`, `--text`, `--muted`, `--brand` and their
  light-scheme overrides own colors. Reuse them rather than adding literal colors.
  Secondary `--dim` text is #8491a3 in dark mode and #5e6b80 in light mode;
  white button text uses `--brand-solid` (#405bdd / #2f4bd8) for readable contrast.
- System sans for prose, system monospace for commands. Main content is capped
  by `--max: 1120px`, with 24px side padding; command groups cap at 820px.
- Primitives: `Base` owns navigation/footer and copy behavior; `Command` owns
  command code and its copy button; `Page` composes sections; all bilingual copy
  lives in `i18n.ts`.
- Commands must remain copyable verbatim. Long platform commands may scroll
  within their code region but must not widen the page or hide the copy button.
- Installation is one platform choice, then credential configuration, then launch.
  Label alternatives clearly; never present three platform commands as three steps.
- Preserve keyboard focus and semantic headings, label copy controls, and check
  English/Chinese at narrow and wide widths in both supported color schemes.
- Release claims must distinguish installation, credential storage compatibility
  and an actual successful model request. Keep the website on the `site` branch.
