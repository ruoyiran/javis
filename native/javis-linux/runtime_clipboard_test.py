import io
import subprocess
import unittest
from unittest.mock import patch

from runtime_keyboard_test import runtime


def available(*commands):
    return lambda command: f"/usr/bin/{command}" if command in commands else None


class ClipboardProcess:
    def __init__(self, command, exit_code, writes):
        self.command = command
        self.exit_code = exit_code
        self.stdin = ClipboardInput(command, writes)

    def poll(self):
        return self.exit_code


class ClipboardInput(io.StringIO):
    def __init__(self, command, writes):
        super().__init__()
        self.command = command
        self.writes = writes

    def close(self):
        self.writes.append((self.command, self.getvalue()))
        super().close()


class RuntimeClipboardTest(unittest.TestCase):
    def test_paste_capability_requires_x11_hotkey_and_matching_clipboard_writer(self):
        cases = (
            ({"XDG_SESSION_TYPE": "x11", "DISPLAY": ":1"}, ("xdotool", "xclip"), True),
            ({"XDG_SESSION_TYPE": "x11", "DISPLAY": ":1"}, ("xclip",), False),
            ({"XDG_SESSION_TYPE": "x11", "DISPLAY": ":1"}, ("xdotool", "wl-copy"), False),
            ({"XDG_SESSION_TYPE": "wayland", "WAYLAND_DISPLAY": "wayland-0", "DISPLAY": ":1"},
             ("xdotool", "wl-copy", "xclip"), False),
            ({"WAYLAND_DISPLAY": "wayland-0", "DISPLAY": ":1"}, ("xdotool", "wl-copy", "xclip"), False),
            ({"DISPLAY": ":1"}, ("xdotool", "xsel"), True),
            ({"XDG_SESSION_TYPE": "x11"}, ("xdotool", "xclip"), False),
        )
        for environment, commands, expected in cases:
            with self.subTest(environment=environment, commands=commands), \
                 patch.dict(runtime.os.environ, environment, clear=True), \
                 patch.object(runtime.shutil, "which", available(*commands)):
                self.assertEqual(runtime.handshake_response()["supports"]["actions"]["pasteText"], expected)

    def test_paste_without_key_route_leaves_clipboard_untouched(self):
        cases = (
            ({"XDG_SESSION_TYPE": "x11", "DISPLAY": ":1"}, ("xclip",)),
            ({"XDG_SESSION_TYPE": "wayland", "WAYLAND_DISPLAY": "wayland-0", "DISPLAY": ":1"},
             ("xdotool", "wl-copy", "xclip")),
        )
        for environment, commands in cases:
            with self.subTest(environment=environment), \
                 patch.dict(runtime.os.environ, environment, clear=True), \
                 patch.object(runtime.shutil, "which", available(*commands)), \
                 patch.object(runtime, "read_clipboard", side_effect=AssertionError("read clipboard")), \
                 patch.object(runtime, "write_clipboard", side_effect=AssertionError("write clipboard")):
                with self.assertRaisesRegex(RuntimeError, "unsupported capability"):
                    runtime.paste_text("sample")

    def test_x11_read_uses_x11_selection_and_falls_back_to_xsel(self):
        reads = []

        def run(command, **_):
            reads.append(command[0])
            if command[0] == "xclip":
                return subprocess.CompletedProcess(command, 1, "")
            return subprocess.CompletedProcess(command, 0, command[0])

        with patch.dict(runtime.os.environ, {"XDG_SESSION_TYPE": "x11", "DISPLAY": ":1"}, clear=True), \
             patch.object(runtime.shutil, "which", available("wl-paste", "xclip", "xsel")), \
             patch.object(runtime.subprocess, "run", side_effect=run):
            self.assertEqual(runtime.read_clipboard(), "xsel")
        self.assertEqual(reads, ["xclip", "xsel"])

    def test_x11_write_ignores_wayland_utility(self):
        writes = []
        commands = []

        def popen(command, **_):
            commands.append(command[0])
            return ClipboardProcess(command[0], 0, writes)

        with patch.dict(runtime.os.environ, {"XDG_SESSION_TYPE": "x11", "DISPLAY": ":1"}, clear=True), \
             patch.object(runtime.shutil, "which", available("wl-copy", "xclip")), \
             patch.object(runtime.subprocess, "run", side_effect=AssertionError("ran wl-copy")), \
             patch.object(runtime.subprocess, "Popen", side_effect=popen), \
             patch.object(runtime.time, "sleep", return_value=None):
            runtime.write_clipboard("sample")
        self.assertEqual(commands, ["xclip"])
        self.assertEqual(writes, [("xclip", "sample")])

    def test_x11_write_falls_back_after_xclip_failure(self):
        writes = []
        commands = []

        def popen(command, **_):
            commands.append(command[0])
            return ClipboardProcess(command[0], 1 if command[0] == "xclip" else 0, writes)

        with patch.dict(runtime.os.environ, {"XDG_SESSION_TYPE": "x11", "DISPLAY": ":1"}, clear=True), \
             patch.object(runtime.shutil, "which", available("xclip", "xsel")), \
             patch.object(runtime.subprocess, "Popen", side_effect=popen), \
             patch.object(runtime.time, "sleep", return_value=None):
            runtime.write_clipboard("sample")
        self.assertEqual(commands, ["xclip", "xsel"])
        self.assertEqual(writes, [("xclip", "sample"), ("xsel", "sample")])

    def test_wayland_read_and_write_stay_on_wayland_selection(self):
        calls = []

        def run(command, **kwargs):
            calls.append(command[0])
            return subprocess.CompletedProcess(command, 0, "previous")

        with patch.dict(runtime.os.environ, {"XDG_SESSION_TYPE": "wayland", "WAYLAND_DISPLAY": "wayland-0", "DISPLAY": ":1"}, clear=True), \
             patch.object(runtime.shutil, "which", available("wl-paste", "wl-copy", "xclip", "xsel")), \
             patch.object(runtime.subprocess, "run", side_effect=run), \
             patch.object(runtime.subprocess, "Popen", side_effect=AssertionError("ran X11 utility")):
            self.assertEqual(runtime.read_clipboard(), "previous")
            runtime.write_clipboard("sample")
        self.assertEqual(calls, ["wl-paste", "wl-copy"])


if __name__ == "__main__":
    unittest.main()
