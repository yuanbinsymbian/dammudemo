const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = 8000;
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const WS_BACKEND_PATH = process.env.WS_BACKEND_PATH || "/ws/backend";

app.get("/v1/ping", (req, res) => {
  res.send("ok");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "welcome", ts: Date.now() }));

  socket.on("message", (msg) => {
    const text = msg.toString();
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
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
  const base = `${req.protocol}://${req.get("host")}`;
  const isPing = (p) => {
    if (typeof p === "string") return p.trim().toLowerCase() === "ping";
    if (p && typeof p.type === "string") return p.type.trim().toLowerCase() === "ping";
    return false;
  };
  if (sessionId && isPing(payload)) {
    await fetch(`${base}/ws/push_data`, {
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

// No public route for access_token; use fetchAccessToken() internally only.