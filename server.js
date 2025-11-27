const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = 8000;
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const WS_BACKEND_PATH = process.env.WS_BACKEND_PATH || "/ws/backend";
const WS_ON_CONNECT_PATH = process.env.WS_ON_CONNECT_PATH || "/ws/on_connect";
const WS_GATEWAY_BASE = process.env.WS_GATEWAY_BASE || "https://ws-push.dyc.ivolces.com";

app.get("/v1/ping", (req, res) => {
  res.send("ok");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "welcome", ts: Date.now() }));

  socket.on("message", (msg) => {
    const text = msg.toString();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {}
    if (data && data.type === "join" && data.token && !data.roomId) {
      const tk = String(data.token);
      if (tk.startsWith("DEBUG_")) {
        const ridStr = tk.slice(6);
        socket.roomId = ridStr;
        if (data.openId) socket.openId = String(data.openId);
        console.log("ws_join", { roomId: ridStr, openId: socket.openId || null, via: "debug_token", ts: Date.now() });
        socket.send(JSON.stringify({ type: "joined", roomId: socket.roomId, roomIdStr: ridStr }));
        return;
      }
      (async () => {
        const r = await fetchLiveInfoByToken(String(data.token));
        const info = r && r.data && r.data.info;
        if (info && (info.room_id_str || info.room_id !== undefined)) {
          const ridStr = info.room_id_str || String(info.room_id);
          socket.roomId = ridStr;
          if (data.openId) socket.openId = String(data.openId);
          console.log("ws_join", { roomId: ridStr, openId: socket.openId || null, via: "token_liveinfo", ts: Date.now() });
          socket.send(JSON.stringify({ type: "joined", roomId: socket.roomId, roomIdStr: ridStr }));
        } else {
          socket.send(JSON.stringify({ type: "join_failed", body: r }));
        }
      })();
      return;
    }
    if (data && data.type === "join" && data.roomId) {
      socket.roomId = String(data.roomId);
      if (data.openId) socket.openId = String(data.openId);
      console.log("ws_join", { roomId: socket.roomId, openId: socket.openId || null, via: "roomId", ts: Date.now() });
      socket.send(JSON.stringify({ type: "joined", roomId: socket.roomId, roomIdStr: String(socket.roomId) }));
      return;
    }
    if (data && data.type === "leave") {
      console.log("ws_leave", { roomId: socket.roomId || null, openId: socket.openId || null, ts: Date.now() });
      delete socket.roomId;
      socket.send(JSON.stringify({ type: "left" }));
      return;
    }
    if (data && data.type === "say" && data.roomId && data.payload) {
      const target = String(data.roomId);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.roomId === target) {
          client.send(JSON.stringify({ type: "message", payload: data.payload }));
        }
      });
      return;
    }
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(text);
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on ${PORT}`);
});

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ err_no: 40001, err_tips: "invalid json body", data: null });
  }
  if (err instanceof SyntaxError) {
    return res.status(400).json({ err_no: 40001, err_tips: "invalid body", data: null });
  }
  next(err);
});

// Live room info proxy
app.post("/api/live/info", async (req, res) => {
  try {
    const token = req.body && req.body.token;
    const xToken = req.body && req.body.xToken;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ err_no: 40001, err_tips: "invalid token", data: null });
    }
    let headerXToken = xToken;
    if (!headerXToken) {
      const at = await fetchAccessToken(false);
      if (at && at.access_token) {
        headerXToken = at.access_token;
      } else {
        return res.status(200).json(at || { err_no: 40020, err_tips: "access_token unavailable", data: null });
      }
    }
    const callOnce = async (xt) => {
      const r = await fetch("https://webcast.bytedance.com/api/webcastmate/info", {
        method: "POST",
        headers: { "content-type": "application/json", "x-token": xt },
        body: JSON.stringify({ token })
      });
      const b = await r.json().catch(() => ({}));
      try {
        const info = b && b.data && b.data.info;
        if (info && info.room_id !== undefined && info.room_id !== null) {
          const rid = info.room_id;
          b.data.info.room_id_str = typeof rid === "string" ? rid : String(rid);
        }
      } catch (_) {}
      return { ok: r.ok, body: b };
    };
    let first = await callOnce(headerXToken);
    const expired = first && first.body && (first.body.errcode === 40004 || /access token is expired/i.test(String(first.body.errmsg)));
    if (expired && !xToken) {
      const at2 = await fetchAccessToken(true);
      if (at2 && at2.access_token) {
        const second = await callOnce(at2.access_token);
        return res.status(200).json(second.body);
      }
    }
    return res.status(200).json(first.body);
  } catch (e) {
    return res.status(500).json({ err_no: -1, err_tips: "internal error", data: null });
  }
});

app.get(WS_BACKEND_PATH, async (req, res) => {
  const e = req.headers["x-tt-event-type"];
  if (e === "connect") {
    return res.status(200).json({ err_no: 0, err_msg: "success", data: "" });
  }
  if (e === "disconnect") {
    return res.status(200).json({ err_no: 0, err_msg: "success", data: "" });
  }
  return res.status(400).json({ err_no: 40001, err_msg: "invalid event", data: null });
});

app.post(WS_BACKEND_PATH, async (req, res) => {
  const e = req.headers["x-tt-event-type"];
  if (e !== "uplink") {
    return res.status(400).json({ err_no: 40001, err_msg: "invalid event", data: null });
  }
  const payload = req.body || {};
  const sessionId = req.headers["x-tt-sessionid"];
  const isPing = (p) => {
    if (typeof p === "string") return p.trim().toLowerCase() === "ping";
    if (p && typeof p.type === "string") return p.type.trim().toLowerCase() === "ping";
    return false;
  };
  if (sessionId && isPing(payload)) {
    await fetch(`${WS_GATEWAY_BASE}/ws/push_data`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-TT-WS-SESSIONIDS": JSON.stringify([String(sessionId)])
      },
      body: JSON.stringify({ type: "pong", ts: Date.now() })
    }).catch(() => {});
  }
  return res.status(200).json({ err_no: 0, err_msg: "success", data: payload });
});

app.post(WS_ON_CONNECT_PATH, async (req, res) => {
  const connId = req.headers["x-tt-ws-conn-id"];
  return res.status(200).json({ err_no: 0, err_msg: "success", data: String(connId || "") });
});

app.post("/api/ws/push", async (req, res) => {
  try {
    const base = WS_GATEWAY_BASE;
    const { sessionIds, openIds, payload } = req.body || {};
    if ((!Array.isArray(sessionIds) || sessionIds.length === 0) && (!Array.isArray(openIds) || openIds.length === 0)) {
      return res.status(400).json({ err_no: 40001, err_msg: "missing targets", data: null });
    }
    const headers = { "content-type": "application/json" };
    if (Array.isArray(sessionIds) && sessionIds.length > 0) headers["X-TT-WS-SESSIONIDS"] = JSON.stringify(sessionIds.map(String));
    if (Array.isArray(openIds) && openIds.length > 0) headers["X-TT-WS-OPENIDS"] = JSON.stringify(openIds.map(String));
    const r = await fetch(`${base}/ws/push_data`, { method: "POST", headers, body: JSON.stringify(payload ?? {}) });
    const b = await r.json().catch(() => ({}));
    return res.status(200).json(b);
  } catch (e) {
    return res.status(500).json({ err_no: -1, err_msg: "internal error", data: null });
  }
});

app.post("/api/ws/group/push", async (req, res) => {
  try {
    const base = WS_GATEWAY_BASE;
    const { groupName, groupValue, payload } = req.body || {};
    if (!groupName || !groupValue) {
      return res.status(400).json({ err_no: 40001, err_msg: "missing group", data: null });
    }
    const headers = { "content-type": "application/json", "X-TT-WS-GROUPNAME": String(groupName), "X-TT-WS-GROUPVALUE": String(groupValue) };
    const r = await fetch(`${base}/ws/group/push_data`, { method: "POST", headers, body: JSON.stringify(payload ?? {}) });
    const b = await r.json().catch(() => ({}));
    return res.status(200).json(b);
  } catch (e) {
    return res.status(500).json({ err_no: -1, err_msg: "internal error", data: null });
  }
});

app.post("/live_data_callback", async (req, res) => {
  try {
    const body = req.body || {};
    const roomId = String(
      (body && body.room_id) ||
        (body && body.data && body.data.room_id) ||
        (body && body.data && body.data.info && body.data.info.room_id) ||
        ""
    );
    console.log("live_data_callback", { roomId: roomId || null, ts: Date.now() });
    const payload = { type: "live_data", data: body };
    if (roomId) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
          client.send(JSON.stringify(payload));
        }
      });
    } else {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
      });
    }
    return res.status(200).json({ err_no: 0, err_msg: "success", data: "" });
  } catch (e) {
    return res.status(500).json({ err_no: -1, err_msg: "internal error", data: null });
  }
});

app.post("/api/ws/get_conn_id", async (req, res) => {
  try {
    const base = WS_GATEWAY_BASE;
    const { service_id, env_id, token } = req.body || {};
    if (!service_id || !env_id) {
      return res.status(400).json({ err_no: 40001, err_msg: "missing service_id or env_id", data: null });
    }
    const r = await fetch(`${base}/ws/get_conn_id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service_id: String(service_id), env_id: String(env_id), token })
    });
    const b = await r.json().catch(() => ({}));
    return res.status(200).json(b);
  } catch (e) {
    return res.status(500).json({ err_no: -1, err_msg: "internal error", data: null });
  }
});

// Access token cache and fetcher
let ACCESS_TOKEN = null;
let ACCESS_TOKEN_EXPIRES_AT = 0;

async function fetchAccessToken(force = false) {
  const now = Date.now();
  if (!force && ACCESS_TOKEN && ACCESS_TOKEN_EXPIRES_AT - now > 60_000) {
    return { access_token: ACCESS_TOKEN, expires_at: ACCESS_TOKEN_EXPIRES_AT };
  }
  const appid = process.env.DOUYIN_APP_ID;
  const secret = process.env.DOUYIN_APP_SECRET;
  if (!appid || !secret) {
    return { err_no: 40020, err_tips: "missing appid or secret", data: null };
  }
  const resp = await fetch("https://developer.toutiao.com/api/apps/v2/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appid, secret, grant_type: "client_credential" })
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.err_no !== 0 || !body.data || !body.data.access_token) {
    return body;
  }
  ACCESS_TOKEN = body.data.access_token;
  const ttl = (body.data.expires_in || 7200) * 1000;
  ACCESS_TOKEN_EXPIRES_AT = Date.now() + Math.max(ttl - 300_000, 60_000);
  return { access_token: ACCESS_TOKEN, expires_at: ACCESS_TOKEN_EXPIRES_AT };
}

async function fetchLiveInfoByToken(token, overrideXToken) {
  const doCall = async (xt) => {
    const r = await fetch("https://webcast.bytedance.com/api/webcastmate/info", {
      method: "POST",
      headers: { "content-type": "application/json", "x-token": xt },
      body: JSON.stringify({ token })
    });
    const b = await r.json().catch(() => ({}));
    try {
      const info = b && b.data && b.data.info;
      if (info && info.room_id !== undefined && info.room_id !== null) {
        const rid = info.room_id;
        b.data.info.room_id_str = typeof rid === "string" ? rid : String(rid);
      }
    } catch (_) {}
    return { ok: r.ok, body: b };
  };
  let headerXToken = overrideXToken;
  if (!headerXToken) {
    const at = await fetchAccessToken(false);
    if (at && at.access_token) headerXToken = at.access_token; else return at || { err_no: 40020, err_tips: "access_token unavailable", data: null };
  }
  const first = await doCall(headerXToken);
  const body = first.body;
  const expired = body && (body.errcode === 40004 || /access token is expired/i.test(String(body.errmsg)));
  if (expired && !overrideXToken) {
    const at2 = await fetchAccessToken(true);
    if (at2 && at2.access_token) {
      const second = await doCall(at2.access_token);
      return second.body;
    }
  }
  return body;
}

// No public route for access_token; use fetchAccessToken() internally only.