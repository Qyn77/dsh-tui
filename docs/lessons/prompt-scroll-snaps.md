# Prompt / scroll snap regression

## Summary

The bug looked like the message list was locked to the top or bottom, but the actual interaction between the custom prompt cursor and the terminal's alt-screen scrollback made the symptom feel like a scroll regression.

## Symptom

After the custom cursor change in `b273ade...`, the TUI seemed to snap back to the top or bottom whenever the user tried to scroll. The user reported that the view had only two states: stuck at the tail or stuck at the head.

## Root cause

1. The custom prompt cursor used a timer-driven rerender loop in the active prompt.
2. That rerender churn was frequent enough to disturb the Ink render cycle and the terminal's alt-screen state.
3. The terminal's own scrollback indicator and alt-screen buffer then appeared to “pull” the view back to the beginning or end.
4. In practice, the scroll bug was not a pure math bug in `useMessageListScroll`; it was an interaction bug between a rapidly rerendering prompt and the terminal host short-lived viewport state.

## Why the first fix was wrong

A simpler “fix” was to keep adding scroll-state guardrails while leaving the timer-driven rerender alive. That treated the symptom, not the cause. The system kept re-rendering during typing and while the chat log was visible, so the terminal kept reasserting its own viewport state.

## Correct fix

- Keep the custom cursor, but do not drive it with a 500ms timer.
- Render a stable custom `▌` instead of a blinking state atom.
- Preserve inline editing, but keep the prompt as a stable, low-churn component.
- Treat terminal alt-screen / scrollback behavior as an external system constraint, not as the source of truth for the TUI's own scroll math.

## Invariant to keep

Never couple a terminal UI's interactive state to a timer-driven rerender loop unless the timer is explicitly required for a true animation. Prompt input should be stable and deterministic; the log scroll should not be re-anchored by a blinking cursor.

## Related files

- `src/components/Prompt.tsx`
- `src/hooks/useMessageListScroll.ts`
- `src/components/MessageList.tsx`

## Follow-up (resolved elsewhere)

The "only two states: stuck at the tail or stuck at the head" symptom
recorded above turned out to have a second, independent cause in the
message list itself: one constant served as both the scroll step and the
size of the mounted window, so a single `PageUp` jumped to the first entry.
The timer churn described here was real and the fix stands, but the scroll
math *was* also broken. See [Message list scroll](message-list-scroll.md).
