"""Relay for Funny Faces: pairs display screens with an admin page and forwards what the admin sends.

API Gateway WebSocket -> this Lambda -> DynamoDB. The admin sends the character/settings (rarely) and the
mouth values (about 15 a second); every paired screen receives them. Messages are JSON with an "action".

Items in the table (key "pk"):
  conn#<connection id>  {role: admin|screen, session, attempts, ttl}   session is indexed (by-session)
  code#<CODE>           {conn, ttl}                                      a screen waiting to be paired
  sess#<session id>     {key, state, ttl}                                key proves who the admin is
"""
import hmac
import json
import os
import secrets
import time

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"      # no 0/O, 1/I/L
CODE_LEN = 6
CODE_TTL = 600
CONN_TTL = 6 * 3600
SESSION_TTL = 30 * 86400
MAX_STATE = 60_000
MAX_ATTEMPTS = 10


def _now():
    return int(time.time())


class Relay:
    def __init__(self, store, post):
        self.store = store          # see MemStore for the interface
        self.post = post            # post(connection_id, dict) -> False if the connection is gone

    # -- helpers
    def _send(self, conn, obj):
        if not self.post(conn, obj):
            self.store.del_conn(conn)
            return False
        return True

    def _error(self, conn, code):
        self._send(conn, {"type": "error", "error": code})

    def _admin(self, conn):
        c = self.store.get_conn(conn)
        return c if c and c.get("role") == "admin" and c.get("session") else None

    def _fan_out(self, session, obj):
        for s in self.store.screens(session):
            self._send(s, obj)

    # -- entry point
    def handle(self, conn, body):
        action = body.get("action") if isinstance(body, dict) else None
        fn = {"register": self.register, "pair": self.pair, "admin": self.admin, "screen": self.screen,
              "state": self.state, "m": self.mouth, "end": self.end, "ping": lambda c, b: None}.get(action)
        if fn:
            fn(conn, body)

    # -- a display asks for a code
    def register(self, conn, body):
        for _ in range(5):
            code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))
            if self.store.put_code(code, conn, _now() + CODE_TTL):
                break
        else:
            return self._error(conn, "busy")
        self.store.put_conn(conn, {"role": "screen", "code": code, "ttl": _now() + CONN_TTL})
        self._send(conn, {"type": "code", "code": code, "expires": CODE_TTL})

    # -- the admin enters a screen's code
    def pair(self, conn, body):
        me = self.store.get_conn(conn) or {}
        if me.get("attempts", 0) >= MAX_ATTEMPTS:
            return self._error(conn, "too_many_attempts")
        code = str(body.get("code", "")).strip().upper()
        entry = self.store.take_code(code) if len(code) == CODE_LEN else None
        if not entry or entry["ttl"] < _now():
            self.store.put_conn(conn, {**me, "role": me.get("role", "admin"), "attempts": me.get("attempts", 0) + 1,
                                       "ttl": _now() + CONN_TTL})
            return self._error(conn, "bad_code")
        session, key = body.get("session"), body.get("key")
        sess = self.store.get_sess(session) if isinstance(session, str) else None
        if not (sess and isinstance(key, str) and hmac.compare_digest(sess["key"], key)):
            session, key = secrets.token_urlsafe(16), secrets.token_urlsafe(16)
            sess = {"key": key, "state": ""}
        self.store.put_sess(session, {**sess, "admin": conn, "ttl": _now() + SESSION_TTL})
        self.store.put_conn(conn, {"role": "admin", "session": session, "attempts": 0, "ttl": _now() + CONN_TTL})
        screen = entry["conn"]
        self.store.put_conn(screen, {"role": "screen", "session": session, "ttl": _now() + CONN_TTL})
        self._send(screen, {"type": "paired", "session": session})
        if sess.get("state"):
            self._send(screen, {"type": "state", "state": json.loads(sess["state"])})
        count = len(set(self.store.screens(session)) | {screen})       # the index may not show the new screen yet
        self._send(conn, {"type": "paired", "session": session, "key": key, "screens": count})

    # -- reconnects
    def admin(self, conn, body):
        session, key = body.get("session"), body.get("key")
        sess = self.store.get_sess(session) if isinstance(session, str) else None
        if not (sess and isinstance(key, str) and hmac.compare_digest(sess["key"], key)):
            return self._error(conn, "unknown_session")
        self.store.put_conn(conn, {"role": "admin", "session": session, "attempts": 0, "ttl": _now() + CONN_TTL})
        self.store.put_sess(session, {**sess, "admin": conn, "ttl": _now() + SESSION_TTL})
        self._send(conn, {"type": "ready", "screens": len(self.store.screens(session))})

    def screen(self, conn, body):
        session = body.get("session")
        sess = self.store.get_sess(session) if isinstance(session, str) else None
        if not sess:
            return self._error(conn, "unknown_session")
        self.store.put_conn(conn, {"role": "screen", "session": session, "ttl": _now() + CONN_TTL})
        self._send(conn, {"type": "paired", "session": session})
        if sess.get("state"):
            self._send(conn, {"type": "state", "state": json.loads(sess["state"])})
        self._tell_admin(session, add=conn)

    def _tell_admin(self, session, add=None, drop=None):
        """Let the admin know how many screens are listening, so it can stop sending to nobody."""
        sess = self.store.get_sess(session)
        if not (sess and sess.get("admin")):
            return
        ids = set(self.store.screens(session))
        if add:
            ids.add(add)
        ids.discard(drop)
        self.post(sess["admin"], {"type": "screens", "n": len(ids)})

    # -- admin to screens (each message is its own Lambda call, so they can arrive out of order: "n" lets
    #    a screen ignore anything older than what it has already shown)
    @staticmethod
    def _seq(body):
        n = body.get("n")
        return {"n": n} if isinstance(n, int) and not isinstance(n, bool) and 0 <= n < 2**31 else {}

    def state(self, conn, body):
        me = self._admin(conn)
        st = body.get("state")
        if not me or not isinstance(st, dict):
            return self._error(conn, "not_admin")
        raw = json.dumps(st, separators=(",", ":"))
        if len(raw) > MAX_STATE:
            return self._error(conn, "too_large")
        sess = self.store.get_sess(me["session"])
        if sess:
            self.store.put_sess(me["session"], {**sess, "state": raw, "ttl": _now() + SESSION_TTL})
        self._fan_out(me["session"], {"type": "state", "state": st, **self._seq(body)})

    def mouth(self, conn, body):
        me = self._admin(conn)
        v = body.get("v")
        if not me or not (isinstance(v, list) and len(v) == 3 and all(isinstance(x, int) and 0 <= x <= 255 for x in v)):
            return
        if not self.store.screens(me["session"]):
            self._send(conn, {"type": "screens", "n": 0})
            return
        self._fan_out(me["session"], {"type": "m", "v": v, **self._seq(body)})

    def end(self, conn, body):
        me = self._admin(conn)
        if not me:
            return
        self._fan_out(me["session"], {"type": "ended"})
        self.store.del_sess(me["session"])

    def disconnect(self, conn):
        c = self.store.get_conn(conn)
        self.store.del_conn(conn)
        if c and c.get("role") == "screen" and c.get("session"):
            self._tell_admin(c["session"], drop=conn)


class MemStore:
    """In-memory store for tests."""

    def __init__(self):
        self.conns, self.codes, self.sessions = {}, {}, {}

    def get_conn(self, c): return self.conns.get(c)
    def put_conn(self, c, item): self.conns[c] = item
    def del_conn(self, c): self.conns.pop(c, None)

    def put_code(self, code, conn, ttl):
        if code in self.codes:
            return False
        self.codes[code] = {"conn": conn, "ttl": ttl}
        return True

    def take_code(self, code): return self.codes.pop(code, None)
    def get_sess(self, s): return self.sessions.get(s)
    def put_sess(self, s, item): self.sessions[s] = item
    def del_sess(self, s): self.sessions.pop(s, None)

    def screens(self, session):
        return [c for c, i in self.conns.items() if i.get("session") == session and i.get("role") == "screen"]


class DynamoStore:
    def __init__(self, table):
        from boto3.dynamodb.conditions import Key
        self.t, self.Key = table, Key
        self._screens = {}

    def get_conn(self, c): return self.t.get_item(Key={"pk": "conn#" + c}).get("Item")

    def put_conn(self, c, item):
        item = {k: v for k, v in item.items() if v is not None}
        self.t.put_item(Item={"pk": "conn#" + c, **item})
        self._screens.clear()

    def del_conn(self, c):
        self.t.delete_item(Key={"pk": "conn#" + c})
        self._screens.clear()

    def put_code(self, code, conn, ttl):
        try:
            self.t.put_item(Item={"pk": "code#" + code, "conn": conn, "ttl": ttl},
                            ConditionExpression="attribute_not_exists(pk)")
            return True
        except self.t.meta.client.exceptions.ConditionalCheckFailedException:
            return False

    def take_code(self, code):
        r = self.t.delete_item(Key={"pk": "code#" + code}, ReturnValues="ALL_OLD")
        return r.get("Attributes")

    def get_sess(self, s): return self.t.get_item(Key={"pk": "sess#" + s}).get("Item")
    def put_sess(self, s, item): self.t.put_item(Item={"pk": "sess#" + s, **item})
    def del_sess(self, s): self.t.delete_item(Key={"pk": "sess#" + s})

    def screens(self, session):
        hit = self._screens.get(session)
        if hit and hit[0] > time.time():
            return hit[1]
        r = self.t.query(IndexName="by-session", KeyConditionExpression=self.Key("session").eq(session))
        ids = [i["pk"][5:] for i in r["Items"] if i.get("role") == "screen"]
        if ids:                                                 # never remember "nobody": the index lags a moment
            self._screens[session] = (time.time() + 1, ids)     # warm containers reuse a list for a second
        return ids


_store = None


def handler(event, context):
    global _store
    import boto3
    rc = event["requestContext"]
    route, conn = rc["routeKey"], rc["connectionId"]
    api = boto3.client("apigatewaymanagementapi", endpoint_url=f"https://{rc['domainName']}/{rc['stage']}")

    def post(c, obj):
        try:
            api.post_to_connection(ConnectionId=c, Data=json.dumps(obj, separators=(",", ":")).encode())
            return True
        except api.exceptions.GoneException:
            return False

    if _store is None:                  # kept between calls so its short screen-list cache works
        _store = DynamoStore(boto3.resource("dynamodb").Table(os.environ["TABLE"]))
    relay = Relay(_store, post)
    if route == "$disconnect":
        relay.disconnect(conn)
    elif route not in ("$connect",):
        raw = event.get("body") or ""
        if len(raw) <= 70_000:
            try:
                relay.handle(conn, json.loads(raw))
            except ValueError:
                pass
    return {"statusCode": 200}
