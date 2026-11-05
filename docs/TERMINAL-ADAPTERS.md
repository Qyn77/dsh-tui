# Terminal adapters: implementation and acceptance plan

Approved on 2026-11-05. Baseline: `225ff3a` (remote main). This document is the
implementation checklist; SPEC remains the rendering contract.

## Goal and boundary

One terminal service owns environment detection, input normalization, terminal
mode transitions, clipboard transport and diagnostics. App, Prompt and
MessageList consume semantic operations; they do not select terminal brands or
construct control sequences. Ink remains the renderer and raw-mode owner; the adapter decodes legacy key flags. Session
reducers, task hit testing and layout arithmetic remain independent of adapters.

Adapters share VT protocol implementations. A terminal profile describes
policy and evidence, not an assertion that a setting is enabled. Host clipboard
backends and transports compose with the terminal profile rather than creating
an implementation for every terminal/OS combination.

## Coverage

| Profile | First acceptance focus |
| --- | --- |
| Apple Terminal | SGR clicks/wheel, selection mode, paste, resize |
| VS Code | intercepted keys, local/remote operation, click disclosure |
| iTerm2 | pointer policy, clipboard and notifications |
| Windows Terminal | host versus WSL, intercepted Ctrl-V |
| VTE / Konsole | Wayland/X11 helpers, baseline VT |
| Kitty / Ghostty / WezTerm / Alacritty / Warp | shared VT plus per-profile evidence |
| Generic VT | unknown terminal, keyboard fallback, no invented capabilities |
| tmux / SSH / WSL overlays | passthrough, host/client boundaries, conservative defaults |

Matching uses explicit override, recognized environment evidence, then generic
fallback. TERM alone (especially xterm-256color) does not identify an emulator.
Nested transports must not be mistaken for the outer emulator. Capabilities
separate expected support, requested modes and observed input; unknown is valid.
No automatic modification of user terminal settings or global shortcuts.

## Public boundary

The terminal service exposes a profile/capability snapshot, semantic input
subscriptions, interaction mode, screen enter/suspend/resume/dispose, clipboard
image reading, text-copy encoding, notification encoding, appearance detection,
frame bounds and a diagnostic snapshot. Side effects use injected streams/helpers.
The Ink integration owns one raw-event subscription. It normalizes fragmented
control sequences before Ink dispatch and publishes pointer/navigation events;
ordinary keys retain the existing Ink-compatible key flags. Pasted escape sequences never become commands.

Clipboard results distinguish empty, unsupported and failed. Images remain
independent draft attachments. An empty bracketed paste is not universal proof
of an image paste. A terminal-owned shortcut producing no bytes cannot be
intercepted by this process. Explicit image import and file paths remain usable.
SSH clipboard helpers run on the remote host, not the client; do not claim a
client image transport. WSL clipboard bridging requires explicit opt-in.
Extended keyboard protocols are not enabled without a complete negotiation and
key decoder; baseline compatibility must not regress to obtain extra keys.

## Milestones (commit after validation)

- [x] M1: profile registry, deterministic detection, capability/transport model,
      generic fallback, fixture coverage for every named profile.
- [x] M2: shared input stream decoder and mode lifecycle, bounded buffering,
      paste/OSC isolation, suspend/resume/dispose tests.
- [ ] M3: wire Ink/App/Prompt/MessageList through the boundary; route clipboard,
      notifications and appearance through it; preserve task and scroll logic.
- [ ] M4: expose diagnostics and override, document host limitations and manual
      acceptance matrix; run full automated tests, typecheck, lint, build, pack.

## Regression gates

1. Input replay: every byte split of SGR, Home/End, UTF-8 text and paste markers;
   multiple reports in one chunk; pasted control sequences; empty and text paste.
2. Modes: enter/exit, selection toggles, editor handoff, repeated cleanup, startup
   failure; no duplicated subscriptions or modes left enabled after disposal.
3. UI: click expands only the intended task; wheel only scrolls history; native
   selection remains available; text never submits during paste; image cache
   paths never enter the prompt; resize preserves drafts and fixed chrome.
4. Platforms: injected host helper tests, SSH restrictions, WSL opt-in, tmux
   wrapping and ambiguous environment fallback.
5. Run existing tests and actual PTY replay. PTY evidence is not equivalent to
   Terminal.app/VS Code/Windows GUI acceptance. Record each environment as
   automated, manually verified, or pending; never label all terminals verified
   just because every profile has a unit test.

## Manual matrix

For each terminal record emulator/version, OS, transport and user settings.
Exercise: typing Chinese/emoji, multiline paste, image import, task disclosure,
scroll while streaming, selection toggle, resize narrow/short and restore,
external editor return, Ctrl-C/normal exit. Use the diagnostic command to report
capabilities without transcript contents, clipboard contents or environment secrets.

## Research references

- Apple mouse reporting: https://support.apple.com/en-mide/guide/terminal/trmlc69728a5/mac
- VS Code key interception: https://code.visualstudio.com/docs/terminal/advanced
- Windows Terminal bindings: https://learn.microsoft.com/en-us/windows/terminal/customize-settings/key-bindings
- Kitty keyboard negotiation: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
- Ghostty VT reference: https://ghostty.org/docs/vt/reference
- WezTerm sequences: https://wezterm.org/escape-sequences.html
- Alacritty bindings: https://alacritty.org/config-alacritty-bindings.html
- Warp fullscreen apps: https://docs.warp.dev/terminal/more-features/full-screen-apps
- VTE paste: https://gnome.pages.gitlab.gnome.org/vte/gtk4/method.Terminal.paste_text.html
- tmux clipboard transport: https://github.com/tmux/tmux/wiki/Clipboard

These sources describe protocols/configuration, not a completed device test.
