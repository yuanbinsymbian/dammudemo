const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = 8000;
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
    const resp = await fetch("https://webcast.bytedance.com/api/webcastmate/info", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-token": xToken || token
      },
      body: JSON.stringify({ token })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(200).json(body);
    }
    return res.status(200).json(body);
  } catch (e) {
    return res.status(500).json({ err_no: -1, err_tips: "internal error", data: null });
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

// No public route for access_token; use fetchAccessToken() internally only.