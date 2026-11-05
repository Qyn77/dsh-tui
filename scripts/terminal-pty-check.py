#!/usr/bin/env python3
"""Replay a compiled terminal-pty fixture through a real Unix PTY (not GUI acceptance)."""
import errno
import fcntl
import json
import os
import pty
import re
import select
import struct
import subprocess
import sys
import tempfile
import termios
import time


def run(profile, entry):
    with tempfile.TemporaryDirectory(prefix='dsh-pty-home-') as home:
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 31, 120, 0, 0))
        env = {k: v for k, v in os.environ.items() if k not in ('TMUX', 'STY', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT')}
        env.update(DSH_HOME=home, DSH_TUI_TERMINAL=profile, TERM='xterm-256color', FORCE_COLOR='0')
        process = subprocess.Popen(['node', entry], stdin=slave, stdout=slave, stderr=slave, env=env)
        os.close(slave)
        output = bytearray()

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

        def send(data, delay=0.12):
            os.write(master, data)
            read_for(delay)

        try:
            read_for(0.8)
            assert b'Ask dsh anything' in output, output.decode(errors='replace')[-2000:]
            burst_start = len(output)
            send(b'erase burst')
            send(b'\x01\x0b')  # Ctrl-A + Ctrl-K in one OS write
            assert b'Ask dsh anything' in output[burst_start:]
            # Split paste markers and CRLF, then clear the draft without exiting.
            for chunk in [b'\x1b[20', b'0~PTY first\r', b'\nsecond', b'\x1b[201', b'~']:
                send(chunk)
            assert b'second' in output
            send(b'\x03')
            send(b'\x16')  # injected clipboard provider, never the system clipboard
            send(b'\x1b[12~')  # F2
            send(b'\x1b[<64;5;5M')
            send(b'\x1b[<0;5;5M')
            send(b'\x1b[F')
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
            read_for(0.15)
            send(b'/terminal')
            send(b'\r', 0.25)
            assert b'Terminal adapter diagnostics' in output
            send(b'/exit')
            send(b'\r', 0.3)
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
            assert '\x1b[?2004l' in text and '\x1b[?1049l' in text, result
            print(f'PASS {profile}: paste, coalesced controls, Ctrl-C draft clear, image trigger, F2, pointer, resize, /terminal, /exit; raw mode restored')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            os.close(master)


if __name__ == '__main__':
    for terminal in ('apple', 'vscode', 'generic'):
        run(terminal, os.path.abspath(sys.argv[1]))
