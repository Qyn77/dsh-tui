# dsh-tui website design contract

## 1. Direction and evidence

Existing Astro website, refreshed 2026-11-10. Keep the terminal identity and
DeepSeek blue. Lead with a centered editorial headline and a large, readable
terminal demonstration; keep documentation depth in disclosures below installation.
The signature object is the terminal: raised dark metal surface, a thin blue rim,
soft grounded shadow and restrained blue light behind it. No decorative animation,
stock photography, runtime framework or marketing claims without source evidence.

Reviewed the prior page: eight equal cards and three simultaneous platform commands
made the hierarchy weak. The new decision path is product → capabilities → choose
one installer → credentials → launch → reference. Reference routing uses frontend
Design Router, Interaction Mechanics, Perfection and designpowers Lane C. The
packaged redesign/brand reference files are unavailable; the existing design is the
visual source. Tab reference: beui.dev/r/tabs/raw (retrieved and read; roving tab stop, selection and panel labeling retained). Adapt selection and focus states to vanilla DOM; do
not vendor React/Motion. This is an existing-site redesign, not a new brand.

## 2. Color and material

CSS custom properties own all colors. Dark: bg #080b12, surface #101624,
surface-raised #161e2e, border #29354a, text #eef2fa, muted #a3afc2,
brand #405bdd (white button text), accent #a5b4ff, cyan #83d3de, green #a3d79a.
Light: bg #f7f9fd, surface #ffffff, raised #edf1fa, border #ced7e8,
text #172237, muted #526179, brand #334cc7, accent #344dc3,
cyan #176875, green #326e32. Shadow uses black at .24/.40; decorative terminal
window dots use #ff776d, #f2c35b, #79cb91. All text meets 4.5:1 contrast.
Use solid text accents, hairline boundaries and soft lighting rather than a grid
of interchangeable cards. No gradients behind body text except subtle surface tint.

## 3. Typography and spacing

System sans with Chinese system fallbacks; system monospace for commands and
metadata. No third-party font requests. Display clamp 40–76px, section 28–40px,
subhead 18–24px, body 16px, secondary 14px, metadata 12px. Body line-height 1.7;
headings 1.08–1.25. Spacing scale 4/8/12/16/20/24/32/40/48/64/80/96.
Content max 1120px; demo max 920px; prose max 64ch; viewport gutters 24px,
20px at narrow widths. Radius 8px buttons/code, 16px panels, 24px terminal.

## 4. Layout and responsive behavior

Document owns vertical scroll. All grid children use min-width:0 and responsive
columns use minmax(0,1fr). Hero centered; terminal below it; features 4 columns,
2 below 980px, 1 below 560px. Installation is an editorial sidebar + numbered
steps; stacks below 800px. Three platform buttons remain visible, wrapping their
labels if necessary. Code wraps visually without changing the copied bytes.
Headings use scroll-margin to clear sticky navigation. No device-dependent hidden
content; all platforms remain selectable. No-JS renders all platform instructions.

## 5. Reusable primitives and states

- Base: bilingual navigation, skip link, footer, localized clipboard feedback.
- Terminal: illustrative product preview, semantic user/tool/result groups;
  decorative ASCII and window dots hidden from assistive tech.
- Command: label, verbatim code, copy button, persistent live-status space.
  Idle, focus, pending, copied, failure/manual-selection states. Never claim a
  failed clipboard write succeeded. Button labels localized to the page language.
- PlatformPicker: three tabs, selected/unselected/focus states; roving tabindex,
  ArrowLeft/Right and Home/End activation; panels labeled by corresponding tab.
  Default Unix; on Windows browser default PS7. Initial HTML shows all panels.
- Step: numbered installation/configuration/launch section with associated title.
- Disclosure: native details/summary for commands and advanced configuration;
  open/closed/focus states, information still reachable without JavaScript.

## 6. Motion

150ms ease-out opacity and 1px press/hover transform only on actionable controls.
Tabs change selection immediately; panels do not morph height or block input.
No looping fake terminal typing; demo remains readable from first paint.
Reduced-motion disables transform/transition and smooth scroll. Copy feedback uses
stable-width labels and a reserved status row, no layout shift.

## 7. Accessibility and personas

New Windows users must know curl.exe downloads while Node runs the installer,
PowerShell 7 differs from built-in 5.1, and CMD install does not imply legacy TUI
support. Existing Desktop users must find credential/config sharing boundaries.
Keyboard users can reach platform choice, copy and disclosures with visible focus;
screen-reader users get tab/panel names and live feedback. Chinese and English
have equal content. Native Windows installation is not inferred from browser QA.

## 8. Validation and debt

Build both routes; drive all tabs/copy success/failure/no-JS/disclosures and
keyboard selection in real Chrome at 375/768/1280 in dark/light, reduced motion.
Audit mobile/desktop with Lighthouse Node API attached to real Chrome. Keep
screenshots and reports outside source. The visual-qa/review-work commands and
brand/redesign reference files are not provided in this environment; record actual
browser checks instead of claiming those unavailable workflows ran.
Website remains on independent `site`; `main` and runtime remain untouched.
