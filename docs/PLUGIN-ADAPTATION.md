# Plugin adaptation contract for dsh-tui

This document defines the integration model for non-core plugins in the dsh terminal UI.

## Core principle

The TUI is not a general-purpose plugin host. It is a presentation layer over the real dsh agent runtime.

That means:

- the agent still lives in dsh
- tools still run in dsh
- file operations and chat remain the primary workflow
- the TUI only renders state that dsh exposes through events or session metadata

## Supported pattern: event-driven plugin integration

The supported plugin model is the A pattern:

1. the plugin augments dsh behavior
2. dsh emits a canonical event or status update
3. the TUI reducer converts that update into UI state
4. the renderer shows the plugin data without replacing the conversation surface

Examples of compatible plugin data:

- token usage and cost updates
- model or resource health metadata
- tool execution lifecycle summaries
- session-level diagnostics and status changes

## Unsupported pattern: independent terminal UI

The following patterns are explicitly out of scope for the current TUI:

- custom side panels or multi-pane plugin layouts
- a plugin hosting a separate renderer inside the terminal
- browser-like or host-managed UI state that bypasses dsh
- any plugin that tries to become the de facto runtime for the agent

These are not rejected as impossible, but they are not the baseline contract for this project.

## Minimum compatibility requirement

For a plugin to be considered compatible with the TUI, it must satisfy all of these:

- it improves dsh rather than replacing it
- it emits structured state or events that fit the existing session model
- it keeps the core chat loop readable and stable
- it does not break prompt editing, scroll behavior, or agent execution
- it does not steal focus from the primary conversation surface

## Acceptance checklist

Before shipping a plugin integration, confirm:

- the user can still chat normally
- file operations still work without relying on TUI-specific logic
- tool execution still flows through dsh
- plugin telemetry remains supplemental and compact
- the UI state is derived from dsh events, not from a separate plugin runtime

This keeps the TUI stable and ensures the system remains an agent console, not a general terminal app shell.