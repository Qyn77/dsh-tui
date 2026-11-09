#!/usr/bin/env bash
set -euo pipefail
# This bootstrap can be piped to bash; Node runs from a file, not stdin.
command -v node >/dev/null 2>&1 || { echo 'Install Node >= 22.19 (with npm): https://nodejs.org/ , then reopen your terminal.' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo 'curl is required to download the installer.' >&2; exit 1; }
setup_dir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-tui-bootstrap.XXXXXX")"
trap 'rm -rf "$setup_dir"' EXIT
curl --fail --show-error --silent --location --connect-timeout 15 --max-time 120 \
  'https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs' -o "$setup_dir/install.mjs"
node "$setup_dir/install.mjs" "$@"
