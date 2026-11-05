# Selective file checkpoints

This feature is an explicit, local file workflow, separate from conversation
branching. It does not undo shell commands, network requests or external effects.

1. `/checkpoint save <path>` captures one file before work, or its absence.
2. After checking the intended changes, `/checkpoint seal <id>` captures the
   expected post-work content once. An unsealed checkpoint cannot restore.
3. `/checkpoint show <id>` previews before/after content and the target path.
4. `/checkpoint restore <id>` is a preview; confirmation is a separate menu leaf
   or `/checkpoint restore <id> confirm`.
5. Restoration requires current bytes and file mode to equal the sealed state.
   Later edits, symlinks, non-regular files, out-of-workspace paths and oversized
   files are refused. No force option. Checkpoints retain both byte snapshots.

Storage is private under DSH_HOME/tui-checkpoints (otherwise ~/.dsh). Each
workspace has its own namespace. Files are bounded to 1 MiB. Records are created
exclusively and replaced atomically under a per-record lock. Restoration uses
same-directory temporary files and atomic replacement (exclusive creation when
restoring a previously deleted file). Original modes are restored.

The command refuses while the agent is running. Close external writers before
restoring: portable Node filesystems have no compare-and-swap rename against
arbitrary external processes. Revalidation immediately before mutation detects
ordinary later edits, but cannot guarantee exclusion of a simultaneous editor.
Both snapshots remain available after restoration for recovery. No whole-tree
snapshot, automatic tool interception, binary diff display or external rollback
is implied. This design limits the initial feature to user-selected files.
