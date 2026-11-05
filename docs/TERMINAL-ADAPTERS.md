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
- [x] M3: wire Ink/App/Prompt/MessageList through the boundary; route clipboard,
      notifications and appearance through it; preserve task and scroll logic.
- [x] M4: expose diagnostics and override, document host limitations and manual
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

## Configuration and diagnostics

Run `/terminal` to inspect the live adapter without exporting transcript or
clipboard content. Its JSON field names are stable diagnostic identifiers:
`pointerSupport` is an expected capability, `requestedMode` is a mode request
(not an acknowledgement), and `observed` records received event categories.
An invalid override is reported as a boolean; its raw value is never printed.

Override example (restart required):

```sh
DSH_TUI_TERMINAL=apple dsh --profile tui-rc5
DSH_TUI_TERMINAL=vscode dsh --profile tui-rc5
DSH_TUI_TERMINAL=generic dsh --profile tui-rc5
```

Accepted IDs: `generic`, `apple`, `vscode`, `iterm2`, `windows-terminal`,
`vte`, `konsole`, `kitty`, `ghostty`, `wezterm`, `alacritty`, `warp`.
An invalid ID falls back to automatic detection. TERM_PROGRAM can be inherited;
there is no claim that brand detection overrides user terminal settings.

- `/mouse on|off|auto` and F2 change interaction without changing the profile.
- `/activity` opens task details when clicks are intercepted by the terminal.
- Ctrl-V imports images only when forwarded; file paths provide a fallback.
- SSH host clipboard reads require `DSH_TUI_REMOTE_CLIPBOARD=host`.
- WSL Windows clipboard reads require `DSH_TUI_WSL_CLIPBOARD=windows`.
- tmux wraps OSC 52; server `set-clipboard`/passthrough settings still matter.
  GNU screen clipboard writes return unsupported instead of printing raw OSC.
- Desktop notifications fall back to bell under multiplexers.
- Extended keyboard protocols remain off; legacy VT input is the baseline.

## Code map

- `src/terminal/adapters/profiles.ts`: environment evidence and host/transport overlays.
- `input.ts`: one incremental UTF-8, VT, paste and mouse decoder.
- `modes.ts`: reversible screen, mouse, wrap, paste and cursor lifecycle.
- `service.ts`: composition, clipboard/notification/appearance operations and diagnostics.
- `src/terminal/TerminalProvider.tsx`: one Ink event subscription, semantic hooks.

Add a profile policy and detection fixture to support another emulator. Add new
protocol handling in the shared decoder, not in Prompt or MessageList. Layout,
scroll geometry and task-hit testing remain shared UI behavior.

## Repeatable PTY check

On macOS/Linux with Python 3 and installed development dependencies:

```sh
pnpm run test:terminal
```

This builds the production App/Ink/adapter into a temporary fixture and replays
input in a real PTY for apple/vscode/generic profiles. It checks split paste and
CRLF, draft-clearing Ctrl-C, an injected image-read action, F2, pointer events,
resize, `/terminal`, `/exit`, and terminal-mode restoration. The model is a
deterministic fixture; the clipboard provider is injected, and DSH_HOME is
temporary. It neither sends model requests nor accesses the user's clipboard.
The script cleans its temporary output and session files.

## Acceptance record

| Surface | Automated evidence | Native GUI acceptance |
| --- | --- | --- |
| Apple Terminal / VS Code | Profile, input, click disclosure, paste frame tests + real PTY replay | Pending on actual Terminal.app and VS Code |
| Generic | Conservative fallback, no empty-paste guessing, PTY replay | Depends on host; pending |
| iTerm2 / Kitty / Ghostty / WezTerm / Alacritty / Warp / VTE / Konsole | Profile detection, shared decoder and mode contract tests | Pending |
| Windows Terminal | Profile, shared input and task click frame tests; injected host helper | Pending on Windows/PowerShell |
| SSH / WSL / tmux / screen | Host access policy, overrides, conservative mode and copy/notification routing | Pending end-to-end on those transports |

The implementation is complete at the adapter boundary. This table deliberately
keeps simulated profile coverage separate from terminal-application validation.

Final automated gate: 105 test files / 1,549 tests pass; TypeScript and runtime
build pass; lint has no errors (warning-level diagnostics remain);
package verification passes with 106 allowed files. The real PTY fixture passes
for apple, vscode and generic. Native GUI rows above remain pending.

Integration regression evidence: the first full run exposed five failures in
Ctrl-J newline handling, Ctrl-C draft clearing, Escape palette/cancellation
ordering and the approval test's Escape deadline. The adapter now preserves LF
as text, snapshots subscribers per event and tests the 25 ms Escape window; all
previously failing cases pass. These are adapter contract regressions, not proof
of a native terminal's Command-V behavior.

### User decision: Terminal.app image shortcut

Native Command-V interception would require additional host integration and
system permissions. The user declined that approach: retain Ctrl-V, no native
keyboard monitor or permission request. Terminal.app Command-V image paste is
**not implemented**, rather than merely waiting for GUI acceptance. Do not use
PTY-injected paste events as evidence that this shortcut works.
