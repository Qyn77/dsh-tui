#!/usr/bin/env python3
"""Replay a compiled terminal-pty fixture through a real Unix PTY (not GUI acceptance)."""
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time


def read_until(master, output, expected, start, timeout=3, absent=(), drain=None):
    """Wait for this phase's rendered bytes, never a token from an older frame."""
    tokens = expected if isinstance(expected, tuple) else (expected,)
    deadline = time.monotonic() + timeout
    def ready():
        fresh = output[start:]
        # Ink begins a replacement frame with cursor-to-column-one after the
        # previous frame's erase sequence. Negative conditions apply to that
        # new frame, not an overlay that was visible earlier in this phase.
        frame = fresh.rsplit(b'\x1b[G', 1)[-1]
        return all(token in frame for token in tokens) and not any(token in frame for token in absent)
    while not ready():
        remaining = deadline - time.monotonic()
        readable = select.select([master] + ([drain[0]] if drain else []), [], [], max(0, remaining))[0]
        if remaining <= 0 or not readable:
            raise AssertionError(f'Timed out waiting for {expected!r}; fresh output: {output[start:].decode(errors="replace")[-4000:]!r}')
        if drain and drain[0] in readable:
            try:
                drain[1].extend(os.read(drain[0], 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
        if master not in readable:
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b''
        if not chunk:
            raise AssertionError(f'PTY closed while waiting for {expected!r}; fresh output: {bytes(output[start:])[-2000:]!r}')
        output.extend(chunk)


def run(profile, entry):
    with tempfile.TemporaryDirectory(prefix='dsh-pty-home-') as home:
        master, slave = pty.openpty()
        events_read, events_write = os.pipe()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 31, 120, 0, 0))
        env = {k: v for k, v in os.environ.items() if k not in ('TMUX', 'STY', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT')}
        env.update(DSH_HOME=home, DSH_TUI_TERMINAL=profile, TERM='xterm-256color', FORCE_COLOR='0', DSH_PTY_EVENTS_FD=str(events_write))
        process = subprocess.Popen(['node', entry], stdin=slave, stdout=slave, stderr=slave, env=env, pass_fds=(events_write,))
        os.close(slave)
        os.close(events_write)
        output = bytearray()
        events = bytearray()

        def read_for(seconds):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                if select.select([master], [], [], max(0, until - time.monotonic()))[0]:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if not chunk:
                        break
                    output.extend(chunk)

        def send(data, expected=None, delay=0.12, absent=()):
            start = len(output)
            event_start = len(events)
            os.write(master, data)
            if data == b'\x1b':
                # A visible placeholder also exists behind an open overlay;
                # it cannot prove Escape left the decoder's pending buffer.
                read_until(events_read, events, b'escape\n', event_start, drain=(master, output))
            if expected is not None:
                read_until(master, output, expected, start, absent=absent)
            else:
                # Protocol fragments need separate OS writes, including fragments
                # which intentionally produce no frame. UI transitions wait below.
                read_for(delay)

        try:
            read_until(master, output, b'Ask dsh anything', 0)
            send(b'erase burst', b'erase burst')
            send(b'\x01\x0b', b'Ask dsh anything')  # Ctrl-A + Ctrl-K in one OS write
            # Split paste markers and CRLF, then clear the draft without exiting.
            for chunk in [b'\x1b[20', b'0~PTY first\r', b'\nsecond', b'\x1b[201', b'~']:
                send(chunk)
            assert b'second' in output
            send(b'\x03', b'Ask dsh anything')
            send(b'\x16')  # injected clipboard provider, never the system clipboard
            send(b'\x1b[12~')  # F2
            send(b'\x1b[<64;5;5M')
            send(b'\x1b[<0;5;5M')
            send(b'\x1b[F')
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
            # Popen's slave stream is not a controlling terminal, so ioctl does
            # not deliver the foreground process group's SIGWINCH for us.
            process.send_signal(signal.SIGWINCH)
            read_until(events_read, events, b'resize:80x24\n', 0, drain=(master, output))
            send(b'/theme', b'/theme')
            send(b'\r', b'Automatic')
            send(b'light', b'/theme light', absent=(b'Automatic',))
            send(b'\r', (b'/theme light', b'Ask dsh anything'))
            send(b'/sessions', b'/sessions')
            send(b'\r', b'Rename session')
            send(b'rename', b'/sessions rename')
            send(b'\r', b'Current')
            send(b'\r', b'Enter a new title')  # current session
            send(b'\r', b'/sessions rename')  # editable title
            send(b'\x03', b'Ask dsh anything')  # discard title, no session write
            send(b'\x1bOR', b'Search conversation')  # F3: search
            send(b'answer 01', b'2. assistant')
            send(b'\r', b'Ask dsh anything', absent=(b'Search conversation',))
            send(b'\x1bOS', b'Select a message')  # F4: message-first actions
            send(b'\r', b'Message actions')
            send(b'\x1b', b'Select a message')
            send(b'\x1b', b'Ask dsh anything', absent=(b'Select a message',))
            send(b'\x1b[15~', b'No draft attachments')  # F5: attachment manager
            send(b'\x1b', b'Ask dsh anything', absent=(b'No draft attachments',))
            send(b'/terminal', b'/terminal')
            send(b'\r', (b'Terminal adapter diagnostics', b'Ask dsh anything'))
            send(b'/exit', b'/exit')
            send(b'\r', b'TERMINAL_PTY_RESULT=')
            process.wait(timeout=3)
            read_for(0.1)
            text = output.decode(errors='replace')
            match = re.search(r'TERMINAL_PTY_RESULT=(\{[^\r\n]+\})', text)
            assert match, text[-2000:]
            result = json.loads(match.group(1))
            assert process.returncode == 0, text[-2000:]
            assert result['submissions'] == 0, result
            assert result['imageReads'] == 1, result
            assert result['seen']['paste-end'] == 1, result
            assert result['seen']['pointer'] == 2, result
            assert result['seen']['interaction-toggle'] == 1, result
            assert result['diagnostics']['adapter'] == profile, result
            assert result['diagnostics']['requestedMode'] == 'inactive', result
            assert not result['raw'], result
            assert result['dimensions'] == {'columns': 80, 'rows': 24}, result
            assert '\x1b[?2004l' in text and '\x1b[?1049l' in text, result
            print(f'PASS {profile}: paste, coalesced controls, Ctrl-C draft clear, image trigger, F2, pointer, resize, nested menus, F3 search, F4 actions, F5 attachments, /terminal, /exit; raw mode restored')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            os.close(master)
            os.close(events_read)


if __name__ == '__main__':
    for terminal in (sys.argv[2:] or ['apple', 'vscode', 'generic', 'iterm2', 'windows-terminal', 'vte', 'konsole', 'kitty', 'ghostty', 'wezterm', 'alacritty', 'warp']):
        run(terminal, os.path.abspath(sys.argv[1]))
