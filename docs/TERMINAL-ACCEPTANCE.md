# Native terminal acceptance — follow-up release

## Automated evidence (2026-11-06)

`node scripts/terminal-pty-check.mjs` passed all 12 configured emulator profiles
on a **macOS Unix PTY**: apple, vscode, generic, iterm2, windows-terminal, vte,
konsole, kitty, ghostty, wezterm, alacritty, warp. This exercises protocol
policies on one host; it is not native Windows/Linux emulator certification.

The script covers fragmented paste, coalesced controls, Ctrl-C draft clearing,
image-import trigger, F2 mode toggle, pointer events, resize, nested command
menus, F3 search, F4 message actions, F5 attachments, diagnostics and shutdown.
Every profile restored raw mode and terminal modes, with zero model submissions.
Clipboard bytes come from an injected fixture, not the operating-system clipboard.

## Native checks still pending

Installed application metadata was read, without driving their GUI:

| App | Installed version | Native interaction acceptance |
| --- | --- | --- |
| Terminal.app | 2.15 (470.2) | Pending |
| VS Code | 1.143.1 | Pending |
| Other emulators/transports | Not inventoried as installed apps | Pending |

In each actual terminal, run `node scripts/terminal-acceptance.mjs` and retain
its JSON alongside `/terminal` diagnostics. The script only emits allowlisted
host/version facts and marks each interactive check `not-run`. Update the result
only after observing it. Never include raw environment variables or API keys.

1. Paste multiline text and verify no accidental submission.
2. Import an image with Ctrl-V. Terminal.app Command-V without forwarded input
   remains unsupported by the user's no-system-permission decision. VS Code
   Command-V is checked separately; the OS clipboard is not covered by PTY tests.
3. Click a completed task to disclose and collapse; F2 permits native selection.
4. Page/wheel through a long answer; input remains fixed and the reading anchor
   survives streaming updates and resize.
5. Try F3 search, F4 actions and F5 attachment removal/undo at 120×31, 80×24 and
   a short/narrow window. Some laptops require Fn for function keys.
6. Exit normally and after an error. Check echo, cursor, mouse selection and
   bracketed paste are restored in the shell.

Native GUI automation is unavailable in the current agent tool environment.
These checks are release acceptance work, not silently considered passed.
