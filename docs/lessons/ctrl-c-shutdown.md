# Lessons from debugging Ctrl-C shutdown

This note records the reusable engineering lessons from the Ctrl-C shutdown
bug in `dsh-tui`. It is an investigation note, not a replacement for the
behavioral contract in [SPEC.md](./SPEC.md).

## Symptom

The application had an Ink `useInput` handler for Ctrl-C, the source and built
bundle both contained the handler, and its pure dispatch tests passed. In the
live TUI, however, pressing Ctrl-C while idle appeared to do nothing.

The misleading part was that several independent stages could produce the
same visible symptom:

1. the terminal might not deliver the keystroke;
2. Ink might parse it differently than expected;
3. the application handler might not run;
4. the handler might choose the wrong agent-state branch;
5. the exit request might run but stall during teardown.

Treating “Ctrl-C does nothing” as a single failure delayed the diagnosis.

## What actually happened

Ink enables terminal raw mode. In raw mode, Ctrl-C arrives as byte `0x03`, not
as a process-level `SIGINT`. Ink 5.2.1 parses that byte as:

```text
input = "c"
key.ctrl = true
```

The application-level `useInput` callback received this exact pair, the agent
status was `idle`, and the handler called the launcher-provided `ctx.appExit`.
The bug was therefore not in key detection or state dispatch.

The problem was teardown ordering. The callback requested disposal of the
Cordis application tree while Ink was still mounted and while Ink's input
event was still being dispatched. That shutdown path stalled. A later Enter
event could make the pending exit complete, which made the failure look
intermittent even though it was deterministic.

The reliable order is:

```text
Ctrl-C keypress
  -> decide cancel or exit
  -> when idle, unmount Ink and restore the terminal
  -> request host shutdown through ctx.appExit(0)
```

In code, the two effects must remain explicit and ordered:

```ts
closeUi()
exit(0)
```

When a turn is running, neither exit effect runs; the handler only calls
`agent.cancel({ kind: 'user' })`.

## Approaches that did not solve it

### Listening for `SIGINT`

A `process.on('SIGINT', ...)` listener is not the primary Ctrl-C path while
Ink owns a raw TTY. The terminal forwards `0x03` as input instead of converting
it into a signal. Signal handling is still useful outside raw mode, but it
cannot replace Ink input handling here.

### Checking only source and bundle contents

Verifying that `src/renderer.tsx` and `lib/index.js` contain `useInput` rules out
a stale build, but it says nothing about runtime delivery or teardown. A
present handler is not necessarily an effective handler.

### Testing only the pure branch function

Unit tests correctly proved “running cancels” and “idle requests exit”, but
the original dependency surface represented shutdown as one operation. It did
not express the required UI-before-host ordering. The fix made `closeUi` and
`exit` separate injectable effects and added a test that asserts their call
order.

### Changing Ink versions before observing runtime input

The installed Ink parser already handled `0x03` correctly. Upgrading or
downgrading would have introduced a dependency change without addressing the
actual lifecycle problem. Inspect and observe the current version before
bisecting dependencies.

## A better diagnostic sequence

Use this order for future terminal-input bugs:

1. Confirm the profile resolves to the working tree rather than a registry
   package.
2. Rebuild because the launcher reads `lib/index.js`, not TypeScript source.
3. Reproduce in a real PTY; non-TTY unit tests cannot model raw-mode behavior.
4. Inspect the installed input parser to establish the expected byte and key
   shape.
5. Add temporary logging at successive boundaries: raw input callback,
   application handler, state branch, and exit hook.
6. Compare the broken path with a known-good equivalent such as `/exit`.
7. Check cleanup ordering and ownership before changing dependencies or adding
   fallback signals.
8. Remove diagnostic output, encode the discovered invariant in a test, then
   run tests, typecheck, build, and one final PTY smoke test.

For this bug, the decisive evidence was:

| Boundary | Observed result |
|---|---|
| Profile link | Resolved to the local repository |
| Built bundle | Contained the current Ctrl-C handler |
| Ink input | `input="c"`, `key.ctrl=true` |
| Agent branch | `status=idle` |
| Host request | Invoked but did not finish promptly |
| `/exit` comparison | Exited successfully |
| Fixed PTY smoke | Immediate exit code `0`, cursor restored |

## General principles

- A shutdown request and UI teardown are different operations. Model both when
  their ordering matters.
- Release the innermost resource owner first. Ink owns raw stdin and cursor
  state, so Ink must clean those up before its host is disposed.
- An event handler can be correct in isolation and still deadlock the lifecycle
  around it.
- Compare a failing path with a working path that promises the same behavior;
  the differences often expose hidden ordering requirements.
- Keep lifecycle effects injectable. Pure tests should verify not only which
  effects occur, but also which effects must not occur and in what order.
- Finish terminal fixes with a real PTY smoke test. Typechecking and unit tests
  cannot prove raw-mode delivery or terminal restoration.

## Permanent contract

The normative behavior remains in [SPEC.md](./SPEC.md), Part 1:

- Ctrl-C while running cancels the in-flight turn.
- Ctrl-C while idle unmounts Ink first and then follows the launcher exit path.
- `process.exit` remains confined to the process-facing modules allowed by the
  repository conventions.
