import json
import unittest

from handler import MemStore, Relay


class Net:
    """Fake connections: records what each one was sent."""

    def __init__(self):
        self.out, self.gone = {}, set()

    def post(self, conn, obj):
        if conn in self.gone:
            return False
        self.out.setdefault(conn, []).append(obj)
        return True

    def last(self, conn, typ=None):
        msgs = [m for m in self.out.get(conn, []) if typ is None or m["type"] == typ]
        return msgs[-1] if msgs else None


class RelayTest(unittest.TestCase):
    def setUp(self):
        self.net, self.store = Net(), MemStore()
        self.r = Relay(self.store, self.net.post)

    def pair(self, screen="S1", admin="A1"):
        self.r.handle(screen, {"action": "register"})
        code = self.net.last(screen, "code")["code"]
        self.r.handle(admin, {"action": "pair", "code": code})
        return code, self.net.last(admin, "paired")

    def test_pairing_gives_both_sides_the_session(self):
        code, paired = self.pair()
        self.assertEqual(len(code), 6)
        self.assertEqual(self.net.last("S1", "paired")["session"], paired["session"])
        self.assertEqual(paired["screens"], 1)
        self.assertNotIn("key", self.net.last("S1", "paired"))          # the screen never gets the admin key

    def test_code_works_once_and_lowercase_is_accepted(self):
        self.r.handle("S1", {"action": "register"})
        code = self.net.last("S1", "code")["code"]
        self.r.handle("A1", {"action": "pair", "code": code.lower()})
        self.assertIsNotNone(self.net.last("A1", "paired"))
        self.r.handle("A2", {"action": "pair", "code": code})
        self.assertEqual(self.net.last("A2", "error")["error"], "bad_code")

    def test_guessing_is_limited(self):
        for _ in range(10):
            self.r.handle("A1", {"action": "pair", "code": "AAAAAA"})
        self.r.handle("A1", {"action": "pair", "code": "AAAAAA"})
        self.assertEqual(self.net.last("A1", "error")["error"], "too_many_attempts")

    def test_state_and_mouth_reach_screens_only_from_the_admin(self):
        _, paired = self.pair()
        self.r.handle("A1", {"action": "state", "state": {"face": "x"}})
        self.r.handle("A1", {"action": "m", "v": [10, 20, 30]})
        self.assertEqual(self.net.last("S1", "state")["state"], {"face": "x"})
        self.assertEqual(self.net.last("S1", "m")["v"], [10, 20, 30])
        self.r.handle("S1", {"action": "m", "v": [255, 255, 255]})       # a screen cannot drive the others
        self.r.handle("S1", {"action": "state", "state": {"face": "evil"}})
        self.assertEqual(self.net.last("S1", "m")["v"], [10, 20, 30])
        self.assertEqual(self.net.last("S1", "state")["state"], {"face": "x"})

    def test_sequence_numbers_are_passed_on_when_valid(self):
        self.pair()
        self.r.handle("A1", {"action": "m", "v": [1, 2, 3], "n": 7})
        self.assertEqual(self.net.last("S1", "m")["n"], 7)
        self.r.handle("A1", {"action": "m", "v": [1, 2, 3], "n": "x"})
        self.assertNotIn("n", self.net.last("S1", "m"))

    def test_bad_mouth_values_are_dropped(self):
        self.pair()
        for v in ([1, 2], [1, 2, 300], [1, 2, "x"], "abc", [1.5, 2, 3]):
            self.r.handle("A1", {"action": "m", "v": v})
        self.assertIsNone(self.net.last("S1", "m"))

    def test_oversized_state_is_refused(self):
        self.pair()
        self.r.handle("A1", {"action": "state", "state": {"x": "y" * 70000}})
        self.assertEqual(self.net.last("A1", "error")["error"], "too_large")
        self.assertIsNone(self.net.last("S1", "state"))

    def test_late_screen_gets_the_saved_state(self):
        self.pair()
        self.r.handle("A1", {"action": "state", "state": {"face": "x"}})
        session = self.net.last("S1", "paired")["session"]
        self.r.handle("S2", {"action": "screen", "session": session})
        self.assertEqual(self.net.last("S2", "state")["state"], {"face": "x"})
        self.r.handle("A1", {"action": "m", "v": [1, 2, 3]})
        self.assertEqual(self.net.last("S2", "m")["v"], [1, 2, 3])

    def test_admin_resume_needs_the_key(self):
        _, paired = self.pair()
        self.r.handle("A9", {"action": "admin", "session": paired["session"], "key": "wrong"})
        self.assertEqual(self.net.last("A9", "error")["error"], "unknown_session")
        self.r.handle("A9", {"action": "admin", "session": paired["session"], "key": paired["key"]})
        self.assertEqual(self.net.last("A9", "ready")["screens"], 1)

    def test_second_screen_joins_the_same_session(self):
        _, paired = self.pair()
        self.r.handle("S2", {"action": "register"})
        code = self.net.last("S2", "code")["code"]
        self.r.handle("A1", {"action": "pair", "code": code, "session": paired["session"], "key": paired["key"]})
        self.assertEqual(self.net.last("A1", "paired")["session"], paired["session"])
        self.assertEqual(self.net.last("A1", "paired")["screens"], 2)

    def test_gone_screens_are_dropped(self):
        self.pair()
        self.net.gone.add("S1")
        self.r.handle("A1", {"action": "m", "v": [1, 2, 3]})
        self.assertEqual(self.store.screens(self.net.last("A1", "paired")["session"]), [])

    def test_end_tells_screens_and_forgets_the_session(self):
        _, paired = self.pair()
        self.r.handle("A1", {"action": "end"})
        self.assertIsNotNone(self.net.last("S1", "ended"))
        self.r.handle("S3", {"action": "screen", "session": paired["session"]})
        self.assertEqual(self.net.last("S3", "error")["error"], "unknown_session")

    def test_admin_hears_when_screens_come_and_go(self):
        _, paired = self.pair()
        self.r.handle("S2", {"action": "screen", "session": paired["session"]})
        self.assertEqual(self.net.last("A1", "screens")["n"], 2)
        self.r.disconnect("S2")
        self.assertEqual(self.net.last("A1", "screens")["n"], 1)
        self.r.disconnect("S1")
        self.assertEqual(self.net.last("A1", "screens")["n"], 0)

    def test_mouth_with_nobody_listening_tells_the_admin_to_pause(self):
        self.pair()
        self.r.disconnect("S1")
        self.r.handle("A1", {"action": "m", "v": [1, 2, 3]})
        self.assertEqual(self.net.last("A1", "screens")["n"], 0)

    def test_junk_is_ignored(self):
        for body in (None, [], "x", {"action": "nope"}, {"action": "state"}, {"action": "pair"}):
            self.r.handle("X", body)


if __name__ == "__main__":
    unittest.main()
