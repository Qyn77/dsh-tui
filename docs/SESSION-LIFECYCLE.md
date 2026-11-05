# Session tabs and remote attachment review (dsh 0.2.1-rc.5)

## Verified local contracts

`dsh-agent` exposes `AgentRegistry.create/resume/get/list` and owned
`AgentHandle.dispose`. A bare registry Agent is not an owned handle. Resuming
creates a local writable agent; it is not a remote attachment operation.
`dispose` drains the loop, unregisters the agent and unwinds scoped services.
The TUI currently has one approval/input owner, one model-selection reference,
and shell working-directory changes affect the process.

## Implemented tab boundary

Tabs track visited session IDs in this TUI process. Switching uses the existing
idle-only resume transaction, releases the previous handle and loads the chosen
session; drafts remain keyed by session ID. New and close are explicit actions.
Closing removes the tab, not its durable session, and cannot close the last tab.
No background agent execution is claimed. Parallel live tabs would need separate
approval routing, per-session model references, notifications and cwd ownership.
Tab order is local UI state, not an edit to the durable log.

## Remote attachment boundary

The pinned plugin-facing agent registry is process-local. The installed tree
contains dsh-api-gateway, dsh-api-remote-access and Typert reflection, which
provide transport/access building blocks; it does not contain dsh-api-session
or a Client composition. The access README references session/follow and
session/control in a different composition. No ready-to-use authenticated
attach/reconnect/ownership-lease operation is exposed by the local Agent API. Building
an HTTP proxy over `resume` would create another writer, not attach to an existing
running agent. This release therefore does not introduce a pretend `/attach`.

A real remote feature needs an upstream or separately scoped runtime bridge:
- authenticated transport with explicit session owner and read/write capability;
- single input/approval writer, observer clients and lease transfer;
- event sequence/replay cursor, gap detection and reconnect snapshot;
- idempotent input IDs and acknowledgement before retry;
- client disconnect must not dispose the remote owned agent;
- attachment transfer and remote/local path separation;
- protocol version negotiation and compatible deployment tests.

SSH remains supported as a way to run the TUI remotely. It is not reconnecting
to a previously running session. Remote attachment and parallel live sessions
remain dependency-gated; their investigation is complete, their runtime features
are not implemented or accepted by PTY replay.
