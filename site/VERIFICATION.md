# Website refresh acceptance · 2026-11-10

Scope: independent `site` branch, Astro static pages `/` and `/zh/`. No runtime or
installer changes. `docs/INSTALL.md` on `main` remains the canonical command source.

## Content and interaction

- Three installer commands match the canonical documentation byte-for-byte.
- Windows explanation links to Microsoft's curl documentation and separates
  download (`curl.exe`), execution (Node), installation shell and supported TUI
  shell. PS7 and CMD use separate, correctly quoted environment-variable forms.
- Real Chrome: 375, 768 and 1280px; English/Chinese; dark/light. No document
  horizontal overflow, including all disclosures open. Command wrapping preserves
  clipboard bytes. All three tabs and their copy buttons exercised in every case.
- ArrowLeft/Right and Home/End select/focus tabs; tab/panel labels and roving
  tabindex agree. Windows browser defaults to PS7; it can still select any platform.
- Denied clipboard access selects the exact command and announces manual copying;
  success announces completion in the page language. No-JS keeps all instructions
  visible and copy controls disabled. Disclosures work without JavaScript.
- Visible focus rings, skip link, native disclosures and reduced-motion fallback.
  Product demonstration is explicitly labeled as illustrative, not a live session.

## Browser audit

Real Chrome via Playwright, production build served by Astro preview; Lighthouse
Node API attached to Chrome CDP. Both languages scored **100 performance / 100
accessibility / 100 best practices / 100 SEO** with mobile and desktop presets.
These are local browser measurements, not native Windows installation tests or a
claim of full screen-reader certification. Reports and screenshots remain in the
local QA artifact directory, outside the repository.

## Design review

- The hero now presents the product before implementation details, with a large
  terminal preview and an unambiguous installation action.
- Features use compact, divided columns instead of eight competing cards.
- Installation is a three-step sequence; platform commands are alternatives,
  while credential and desktop compatibility details remain reachable.
- Windows novice walkthrough: choose PS7/CMD → see prerequisite explanation → copy
  exact command → configure a key → reopen supported terminal → launch.
- Keyboard walkthrough and clipboard-denial recovery passed in the browser.
- Existing terminal aesthetic, bilingual content and light theme retained. No new
  runtime dependency or external font introduced. No known blocking visual defect
  in the checked viewports; native installer validation is a separate workstream.

The standalone visual-qa/review-work commands and packaged redesign/brand reference
files are unavailable in this environment. The checks above describe the actual
browser work, not execution of those unavailable workflows.
