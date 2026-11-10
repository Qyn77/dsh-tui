"""Deterministic synchronization tests for the Unix PTY acceptance driver."""
import importlib.util
import os
from pathlib import Path
import sys
import threading
import time
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('pty_driver', Path(__file__).parents[1] / 'scripts' / 'terminal-pty-check.py')
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class ReadUntilTests(unittest.TestCase):
    def test_waits_for_delayed_fragmented_fresh_output(self):
        read, write = os.pipe()
        output = bytearray(b'Automatic from an earlier frame')
        start = len(output)
        def produce():
            time.sleep(0.15)  # longer than the old fixed 120 ms read
            os.write(write, b'Auto')
            time.sleep(0.03)
            os.write(write, b'matic')
        thread = threading.Thread(target=produce)
        thread.start()
        try:
            driver.read_until(read, output, b'Automatic', start, timeout=1)
            self.assertEqual(output[start:], b'Automatic')
        finally:
            thread.join()
            os.close(read)
            os.close(write)

    def test_old_output_cannot_satisfy_a_new_phase(self):
        read, write = os.pipe()
        output = bytearray(b'Automatic')
        try:
            with self.assertRaisesRegex(AssertionError, 'Automatic'):
                driver.read_until(read, output, b'Automatic', len(output), timeout=0.02)
        finally:
            os.close(read)
            os.close(write)

    def test_waits_until_overlay_disappears_from_latest_frame(self):
        read, write = os.pipe()
        output = bytearray(b'\x1b[GSelect a message\nAsk dsh anything')
        def produce():
            time.sleep(0.03)
            os.write(write, b'\x1b[GAsk dsh anything')
        thread = threading.Thread(target=produce)
        thread.start()
        try:
            driver.read_until(read, output, b'Ask dsh anything', 0, timeout=1,
                              absent=(b'Select a message',))
            self.assertTrue(output.endswith(b'\x1b[GAsk dsh anything'))
        finally:
            thread.join()
            os.close(read)
            os.close(write)

    def test_eof_fails_without_spinning_until_deadline(self):
        read, write = os.pipe()
        os.close(write)
        try:
            with self.assertRaisesRegex(AssertionError, 'closed'):
                driver.read_until(read, bytearray(), b'Automatic', 0, timeout=1)
        finally:
            os.close(read)

    def test_event_wait_drains_frames_to_avoid_blocking_the_child(self):
        read, write = os.pipe()
        frames_read, frames_write = os.pipe()
        frames = bytearray()
        def produce():
            os.write(frames_write, b'x' * 131072)
            os.write(write, b'escape\n')
        thread = threading.Thread(target=produce)
        thread.start()
        try:
            driver.read_until(read, bytearray(), b'escape\n', 0, timeout=1,
                              drain=(frames_read, frames))
            self.assertGreater(len(frames), 0)
        finally:
            thread.join(timeout=1)
            for fd in (read, write, frames_read, frames_write):
                os.close(fd)


if __name__ == '__main__':
    unittest.main()
