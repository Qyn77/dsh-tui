/**
 * UI-facing types for the dsh TUI bundle. These describe the rendering tree
 * derived from the live session log, not anything that crosses the agent
 * boundary — the model still sees the canonical `SessionEvent` stream.
 * @module @deepseek-ai/dsh-tui/types
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  CallId,
  ContentBlock,
  TokenUsage,
  ToolResultMessage,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TodoItem, TurnEndReason } from '@deepseek-ai/dsh-session'
// Type-only, for the `tool/code-dispatch*` declarations this file's reducer
// projects. `@deepseek-ai/dsh-tools` augments `SessionEventMap` with them, so
// the import is what puts those two event types in the program at all — unlike
// `compaction/*`, `plan/mode` and `hook/*` below, this vocabulary belongs to a
// package that is already a peer, so copying it here would be a second
// declaration of something the tree can simply be told about.
import type {} from '@deepseek-ai/dsh-tools/types'
// Same reasoning for `approval/*`. `@deepseek-ai/dsh-user-approval` is a peer
// dependency — `ApprovalPrompt` and `useApprovalRequests` already import its
// `ApprovalOutcome` — so its augmentation is one import away rather than a
// copy. SPEC §3.2.1 spent three revisions asserting the opposite.
import type {} from '@deepseek-ai/dsh-user-approval'

/**
 * The bridge that ran a hook. Mirrors `HookDialect` in
 * `@deepseek-ai/dsh-hook-protocol` — see the note on {@link SessionEventMap}
 * below for why this package copies the vocabulary instead of importing it.
 */
export type HookDialect = 'claude-code' | 'codex'

/**
 * Session events the TUI renders that other plugins add to `SessionEventMap`:
 * `@deepseek-ai/dsh-compaction` for `compaction/*`,
 * `@deepseek-ai/dsh-plan-mode` for `plan/mode`,
 * `@deepseek-ai/dsh-hook-protocol` for `hook/*`, and
 * `@deepseek-ai/dsh-tool-workflow` for `tool-workflow/*`.
 *
 * None of those four is a dependency of this package, which is the point.
 * `dsh-base` mounts no hook bridge and does not depend on one, so a hard peer
 * would make every install warn about a package most assemblies will never
 * have — for a feature that draws nothing until a user inserts a bridge. The
 * TUI instead renders whatever shows up on the session it is already reading,
 * the same way it renders MCP-bridged tools by parsing their names and
 * depending on `dsh-mcp-client` not at all (`docs/SPEC.md` §1.12).
 *
 * The cost is that these declarations are copies and can drift. For `hook/*`
 * the copy is verbatim from `packages/hooks/hook-protocol/lib/types/types.d.ts`
 * at `0.1.0-rc.7`, which is the version line this package pins; a drift shows
 * up as a field the renderer reads and no emitter sets, i.e. `undefined`, which
 * every branch below already handles.
 *
 * `tool-workflow/*` is copied from that package's `lib/types/types.d.ts` at the
 * same version, with its branded `WorkflowRunId` widened to `string` and its
 * two closed unions (`WorkflowAgentOutcome`, `WorkflowStopReason`) widened the
 * same way. That widening is deliberate and matches `hook/result.decision`:
 * these words are printed, never switched on, and a build that pattern-matched
 * `'completed' | 'failed' | 'cancelled'` would fail to compile against a
 * version that adds a fourth — for a value it was only ever going to display.
 */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'compaction/start': { trigger: 'auto' | 'manual' }
    'compaction/summary': { tokensBefore: number; tokensAfter: number }
    'compaction/prune': { removedSeqs: readonly number[] }
    'compaction/end': { ok: boolean }
    'plan/mode': { enabled: boolean }
    'hook/invoked': {
      turn: number
      point: string
      dialect: HookDialect
      matcher?: string
      handlerId: string
    }
    'hook/result': {
      turn: number
      point: string
      handlerId: string
      decision: string
      exitCode?: number
      stderrSummary?: string
      durationMs: number
    }
    'tool-workflow/run-start': { runId: string; name: string }
    'tool-workflow/agent-start': {
      runId: string
      seq: number
      label: string
      phase?: string
      childId: string
    }
    'tool-workflow/agent-end': { runId: string; seq: number; outcome: string }
    'tool-workflow/run-end': { runId: string; stopReason: string }
  }
}

/**
 * Fate of a tool call.
 *
 * `cancelled` is not a failure: it means the turn ended while the call was
 * still in flight, so no result was ever reported. It exists because the
 * alternative was claiming `ok` for a tool the user interrupted — see the
 * `turn/end` case in `state.ts`. The glyph and color are fixed by
 * `docs/SPEC.md` §1.4.
 */
export type ToolStatus = 'running' | 'ok' | 'error' | 'cancelled'

/**
 * One tool call a `run_code` program dispatched from inside itself.
 *
 * Code Mode runs the model's program in a worker and bridges each tool it calls
 * back through the session as a `tool/code-dispatch-start` / `tool/code-dispatch`
 * pair. Those are log-only — `deriveMessages()` ignores them, so a sub-call
 * never re-enters model context — which means the transcript is the *only*
 * place they can ever be seen. Without them a `run_code` entry is a single
 * opaque row: the program read four files and edited one, and the screen said
 * `run_code(…) ✓`.
 *
 * A sub-call is not a {@link UiEntry}. It hangs inside the parent tool entry,
 * paired by `subCallId`, and that placement is the whole design: an entry of its
 * own would carry the `marginTop` every entry carries, so a program with ten
 * dispatches would spend ten blank rows saying nothing, and `tool/result`'s
 * "close the most recent running tool" heuristic would start closing sub-calls
 * instead of the `run_code` that owns them. Nested inside, the parent stays the
 * one running tool, exactly as the log says it is.
 */
export interface SubCall {
  /** `<parent>:code:<n>` — pairs the start event with its settlement. */
  subCallId: CallId
  /** The tool's registered name, rendered through the same `parseToolName` an MCP call is. */
  name: string
  /** The dispatched arguments, JSON-normalized before dispatch by the emitter. */
  args: string
  /**
   * The settlement's model-facing content, in `tool/result`'s own vocabulary.
   * Absent while the sub-call is still running.
   */
  content?: readonly ContentBlock[]
  status: ToolStatus
}

/**
 * One agent inside a workflow run.
 *
 * `seq` is the emitter's own member sequence and is what pairs `agent-start`
 * with `agent-end` — not position in this array, which a dropped start event
 * would silently shift.
 *
 * `outcome` is a bare `string` for the reason `hook/result.decision` is: the
 * TUI prints it and never branches on it, so a version that grows a fourth
 * outcome should render, not fail to compile.
 */
export interface WorkflowMember {
  seq: number
  /** The agent's display label, e.g. `review:bugs`. */
  label: string
  /** The phase it was declared in, when the workflow declared phases. */
  phase?: string
  /** Set by `agent-end`. Absent while the member is still running. */
  outcome?: string
}

/** Visible entry in the chat list. The reducer grows a list of these. */
export type UiEntry =
  | { kind: 'user'; message: UserMessage }
  | {
    kind: 'assistant'
    turn: number
    step: number
    text: string
    finalized: boolean
    usage?: TokenUsage
  }
  | {
    kind: 'tool'
    callId: CallId
    name: string
    args: string
    turn: number
    step: number
    result?: ToolResultMessage
    error?: { name: string; code: string }
    status: ToolStatus
    /**
     * Sub-dispatches this call made from inside a Code Mode program, in
     * dispatch order. Empty or absent for every native call — see
     * {@link SubCall} for why they live here rather than beside the entry.
     */
    subCalls?: readonly SubCall[]
  }
  | { kind: 'compaction'; stage: 'start' | 'summary' | 'end' | 'prune'; text?: string }
  | { kind: 'plan'; enabled: boolean; at: number }
  /**
   * One hook run, opened by `hook/invoked` and closed by `hook/result`.
   *
   * Paired on `handlerId` rather than on "the most recent open one", which is
   * how {@link ToolStatus} entries are closed. The events carry the id
   * precisely so a pair can be correlated, and hooks at one point run as a
   * group — several may be open at once, so the tool heuristic would close the
   * wrong row.
   *
   * `status` exists for the same reason it does on a tool: an invocation whose
   * result never arrives must not keep claiming to be running. The protocol
   * documents the pair as turn-enclosed, so `turn/end` is where that is
   * settled.
   *
   * `decision` is deliberately a bare `string`. The emitter types it that way
   * because the vocabulary is open — `pass`, `stop`, and the five values a hook
   * can express (`approve`/`allow`/`block`/`deny`/`ask`) are what exist today,
   * and a bridge may add to it. See `hookTone` in `hook-runs.ts` for what an
   * unrecognized one is treated as.
   */
  | {
    kind: 'hook'
    /** Correlates this row's `hook/invoked` with its `hook/result`. */
    handlerId: string
    /** The hook point (`PreToolUse`, `Stop`, …) — the emitter's word, untranslated. */
    point: string
    dialect: HookDialect
    turn: number
    /** The matcher-group pattern that selected it; absent for match-all. */
    matcher?: string
    /** Set by `hook/result`. Absent while the run is still open. */
    decision?: string
    exitCode?: number
    stderrSummary?: string
    durationMs?: number
    status: 'running' | 'done' | 'cancelled'
  }
  /**
   * One approval question, opened by `approval/asked` and closed by
   * `approval/decided`.
   *
   * The live question is **not** this entry — it is `ApprovalPrompt`, a card
   * beside the Prompt driven by a Cordis waterfall that never touches the log
   * (§3.2.1). This is the audit record the pair leaves behind, and it exists
   * because that card is transient: without the row, a session you resume has
   * no trace that anything was ever authorised, and a turn where you denied a
   * tool reads as a tool that simply did not run.
   *
   * Paired on `id`, the way a hook run is on `handlerId` and for the same
   * reason: the service issues one per `request()` call, several can be open,
   * and closing the newest would attribute one decision to another question.
   */
  | {
    kind: 'approval'
    /** Correlates `approval/asked` with the `approval/decided` that always follows. */
    id: string
    /** The tool the question was about. */
    toolName: string
    /** The exact call, when the asker had one — what the card resolved arguments through. */
    callId?: CallId
    /** The asker's own explanation, e.g. a hook's permission-decision reason. */
    reason?: string
    /**
     * Set by `approval/decided`: `allowed-once`, `rejected`, `cancelled` or
     * `unavailable`. A bare `string` on `hook/result.decision`'s reasoning —
     * printed, never switched on.
     */
    outcome?: string
    status: 'running' | 'done' | 'cancelled'
  }
  /**
   * A switch of the session's approval policy.
   *
   * Its own entry rather than a `note` because it is durable and replayable:
   * the last such event in the log *is* the session's override, so a resumed
   * transcript that dropped it would show a session behaving under a policy
   * nothing on screen accounts for.
   */
  | {
    kind: 'approval-policy'
    /** `ask` or `never` — the emitter's word, printed untranslated. */
    policy: string
    /** True when the override was seeded into a child at delegation, not switched at runtime. */
    delegated: boolean
  }
  /**
   * One workflow run, opened by `tool-workflow/run-start` and closed by
   * `tool-workflow/run-end`, with a row per member agent in between.
   *
   * This is the sub-agent-shaped feature the roadmap kept calling blocked, and
   * finding it meant looking past the name. `@deepseek-ai/dsh-subagent` emits
   * exactly one session event, `subagent/descriptor`, and it is appended to the
   * **child's** log — the parent session never sees it, so there is nothing
   * there for this transcript to draw. `@deepseek-ai/dsh-tool-workflow` is the
   * package that writes into "its calling parent Session", and its four events
   * are the whole visible surface of a fan-out.
   *
   * A run is one entry with nested members, for the same reason a Code Mode
   * program is ({@link SubCall}): the members belong to the run, they arrive
   * interleaved with nothing else, and twelve entries would spend twelve blank
   * `marginTop` rows separating rows that are one thing. Unlike a sub-call, a
   * member cannot be nested inside a tool entry — the events carry a `runId`
   * and no `callId`, so there is no sound way to pair a run to the `Workflow`
   * tool call that started it, and inventing one by recency would attach the
   * run to whatever tool happened to be open.
   */
  | {
    kind: 'workflow'
    /** Correlates the run's four event types. Runs may overlap; this is why. */
    runId: string
    /** The workflow's declared `meta.name`, the emitter's own word. */
    name: string
    members: readonly WorkflowMember[]
    /**
     * The emitter's own stop word, set by `tool-workflow/run-end`. Absent when
     * the run never reported one — including a run this build closed itself at
     * `turn/end`, which must not put a word in the emitter's mouth.
     */
    stopReason?: string
    /**
     * Whether the run is still open. Separate from {@link stopReason} for the
     * reason the hook entry keeps `status` separate from `decision`: a run cut
     * off at the turn boundary is definitely over and definitely has no stop
     * word, and collapsing the two would force this build to invent one.
     */
    status: 'running' | 'done' | 'cancelled'
  }
  /**
   * The model's task list, as of the most recent `todo/write`.
   *
   * The event carries a whole-list snapshot and the protocol declares
   * latest-write-wins on replay, so this entry holds the list itself rather
   * than a diff — there is no incremental state to keep.
   *
   * Consecutive writes collapse into one entry (see the `todo/write` case in
   * `state.ts`) instead of appending a near-identical copy per checked box.
   * The list is *current state*, not an event, and a transcript that repeated
   * it once per item would bury the conversation it belongs to.
   */
  | { kind: 'todo'; todos: readonly TodoItem[] }
  /**
   * A free-floating remark. `tone` is what keeps a failed turn from looking
   * like a compaction notice: untoned notes are incidental and dim, an
   * `error` note is a turn that failed, and a `warn` note is a turn the user
   * or the runtime stopped on purpose.
   */
  | { kind: 'note'; text: string; tone?: 'error' | 'warn' }
  /**
   * Context the runtime handed the model on the user's behalf.
   *
   * `plugin`/`form` describe a plugin injection and `skill` a user-explicit
   * skill invocation; they are mutually exclusive, and a row that has neither
   * is an injection from a source this surface has no vocabulary for yet.
   *
   * A skill row carries no `preview` on purpose. The payload is a rendered
   * `<skill_content>` block, and `@deepseek-ai/dsh-skill` puts the name in the
   * message source precisely so consumers label the row from metadata instead
   * of sampling model-facing markup at the user.
   */
  | { kind: 'runtime-context'; plugin?: string; form?: string; skill?: string; preview: string }
  /**
   * A slash command and what it printed. Commands never reach the model, so
   * they produce no session event and the reducer cannot mint this — it is
   * appended locally by the App (see `useSessionEvents`' `appendEntry`).
   *
   * It lives in the log rather than on stderr because the REPL runs inside
   * the alternate screen: a stderr write there is either erased by Ink's next
   * frame or interleaved into one, which is how `/help` and `/status` came to
   * print nothing a user could read.
   */
  | { kind: 'command'; input: string; text: string; failed: boolean }
  /**
   * A `!` shell escape and what it printed. Like `command`, this is appended
   * locally rather than projected from an event — a `!` command runs outside the
   * session entirely.
   *
   * The outcome is kept in fields rather than baked into `output` so the
   * "exit 1" / "timed out" / "truncated" suffixes stay translatable and stay out
   * of the state layer. `output` is the program's own bytes and is never
   * localized.
   */
  | {
    kind: 'shell'
    /** The line as typed, without the sigil. */
    command: string
    /** Interleaved stdout and stderr, already clamped. */
    output: string
    /** `null` when the child died from a signal, or could not start at all. */
    exitCode: number | null
    signal?: string
    timedOut: boolean
    truncated: boolean
    /** `true` when the command and its output were queued for the model (`!!`). */
    injected: boolean
  }

/**
 * State shape held by the TUI.
 *
 * `entries` and `status` are the two fields the render tree actually reads.
 * `currentTurn` and `lastReason` are projected faithfully from the log but have
 * no renderer, deliberately: a turn counter in the status bar tells the user
 * something they can already count in the log, and the number that *would* be
 * worth showing during a long turn is the step, which the session does not
 * surface. Both are kept because they are the honest projection of the events
 * and because dropping a field from an exported interface in an `rc` line is a
 * breaking change for no gain. Do not read this as "wiring in progress".
 */
export interface UiState {
  entries: UiEntry[]
  /** Current agent status. Drives the spinner and the `working`/`idle` label. */
  status: 'idle' | 'running'
  /** Turn number of the most recent `turn/start`. Projection only — nothing renders it. */
  currentTurn: number
  /** Reason carried by the most recent `turn/end`. Projection only — nothing renders it. */
  lastReason?: TurnEndReason
  /**
   * The approval policy the log has established so far, or undefined before any
   * `approval/policy` event has been seen.
   *
   * Projection only, and it exists to tell a *switch* from the session's
   * *initial* value. `dsh-permission-presets` seeds the knobs at session
   * construction — its `applyDefaults` appends `approval/policy` whenever the
   * session carries none — so in any assembly that mounts it, every boot log
   * opens with a policy event that nobody switched. Drawing a row for it put an
   * entry on screen before the user had done anything, which also took the
   * splash banner away: the banner draws only while `entries` is empty
   * (`renderer.tsx`), so the seed made it unreachable in exactly the assemblies
   * that ship presets, and none in the fixture-driven tests.
   *
   * The payload cannot answer this on its own — `dsh-user-approval` declares
   * `source?: 'delegation'` and nothing else, so a construction seed and a
   * runtime switch are byte-identical. Position in the log is the only signal,
   * and this field is how the reducer keeps it.
   */
  approvalPolicy?: string
}

/**
 * The text a user message carries, with any non-text blocks left out.
 *
 * A user message is usually one text block, but not always: attaching an image
 * puts `image` blocks beside it (see {@link userMessageImages}), and a message
 * that is *only* an image has no text at all. Callers that draw the message
 * must handle the empty string rather than assuming a line is there.
 */
export function userMessageText(message: UserMessage): string {
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
}

/**
 * The images a user message carries, in content order.
 *
 * Read off the message rather than tracked beside it, which is what makes a
 * resumed transcript draw its attachments: the refs are in the durable log's
 * own `user/message` event, so replay needs no extra state.
 */
export function userMessageImages(message: UserMessage): ImageAttachmentRef[] {
  return message.content
    .filter((b): b is { type: 'image'; attachment: ImageAttachmentRef } => b.type === 'image')
    .map(b => b.attachment)
}

/**
 * Whether a resumed session's stored history is drawn on screen. `'hide'`
 * starts the transcript at this process's live work — the model still reads
 * the whole log, so nothing is lost to it, only to the screen.
 *
 * Lives here rather than in `settings.ts` because the i18n catalog types its
 * strings with it and `settings.ts` already imports the catalog's `isLang` —
 * the module graph has to stay acyclic at runtime, and this file imports
 * nothing local.
 */
export type HistoryPref = 'show' | 'hide'

/** Every value {@link HistoryPref} can be, for parsing and `/history` usage. */
export const HISTORY_PREFS: readonly HistoryPref[] = ['show', 'hide']

/**
 * One switchable permission preset, as the `permissions` projection advertises
 * it. Mirrors `PresetOption` in `@deepseek-ai/dsh-permission-presets/types` at
 * `0.1.0-rc.7` — that package and `dsh-session-projection` are deliberately
 * not dependencies (the StatusBar chip ships dark and draws nothing in an
 * assembly that mounts neither, the same stance §1.15 takes for hooks), so the
 * vocabulary is copied rather than imported. A drift shows up as a field the
 * view reads and no emitter sets, which the optional/unknown handling below
 * already covers.
 */
export interface PermissionPresetOption {
  /** Stable option value: the preset table key, or `custom`. */
  readonly value: string
  /** The display label a deployment configured. */
  readonly name: string
  /** One deployment-written sentence on what the value means. */
  readonly description?: string
}

/**
 * The `permissions` projection value: every switchable preset in table order
 * (plus a current-only `custom` option when the two knobs match no table row)
 * and the effective current value. A preset bundles the two independent knobs
 * — a sandbox mode and an approval policy; `danger-full-access` is the dsh-base
 * table key for sandbox-open / approval-never, i.e. the "do not ask, run
 * anything" stance.
 */
export interface PermissionPresetSelect {
  /** Switchable presets, plus `custom` exactly while it is current. */
  readonly options: readonly PermissionPresetOption[]
  /** The effective current value: a preset table key, or `custom`. */
  readonly currentValue: string
}

/**
 * The slice of `ctx.sessionProjections` this package reads. The real service's
 * `snapshot()` returns one consistent cut over every registered projection for
 * one session; only the `permissions` key is typed here.
 */
export interface PermissionProjectionReader {
  snapshot(session: unknown): {
    readonly values: { readonly permissions?: unknown }
  }
}

/**
 * The dsh-base preset-table key that means the sandbox is open and approval
 * never prompts. Written as data the deployment configured rather than an
 * enum: another assembly's table may name it differently, in which case its
 * chip simply renders without the danger treatment.
 */
export const DANGER_PRESET = 'danger-full-access'

/**
 * Narrow an unknown value to a {@link HistoryPref}.
 * @param value - anything, typically read out of `~/.dsh/tui.json`.
 */
export function isHistoryPref(value: unknown): value is HistoryPref {
  return value === 'show' || value === 'hide'
}

/** Filter the session log down to only the events the TUI cares about. */
export function isRenderable(event: SessionEvent): boolean {
  switch (event.type) {
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'user/message':
    case 'assistant/chunk':
    case 'assistant/message':
    case 'tool/call':
    case 'tool/result':
    case 'tool/code-dispatch-start':
    case 'tool/code-dispatch':
    case 'compaction/start':
    case 'compaction/end':
    case 'compaction/summary':
    case 'compaction/prune':
    case 'plan/mode':
    case 'hook/invoked':
    case 'hook/result':
    case 'approval/asked':
    case 'approval/decided':
    case 'approval/policy':
    case 'tool-workflow/run-start':
    case 'tool-workflow/agent-start':
    case 'tool-workflow/agent-end':
    case 'tool-workflow/run-end':
    case 'todo/write':
    case 'agent/inbox/spliced':
      return true
    default:
      return false
  }
}
