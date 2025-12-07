const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const CredentialClient = require("@open-dy/open_api_credential");
let OpenApiSdk;
try { OpenApiSdk = require("@open-dy/open_api_sdk"); } catch (_) { OpenApiSdk = null; }
const SdkClient = OpenApiSdk && (OpenApiSdk.default || OpenApiSdk) || null;
const TaskStartRequest = OpenApiSdk && OpenApiSdk.TaskStartRequest || null;
const WebcastmateInfoRequest = OpenApiSdk && OpenApiSdk.WebcastmateInfoRequest || null;

const app = express();
const PORT = 8000;
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const WS_HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS || "20000", 10);
const WS_HEARTBEAT_IDLE_TIMEOUT_MS = parseInt(process.env.WS_HEARTBEAT_IDLE_TIMEOUT_MS || "120000", 10);
 

app.get("/v1/ping", (req, res) => {
  res.send("ok");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "welcome", ts: Date.now() }));
  socket.isAlive = true;
  let lastSeen = Date.now();
  socket.on("pong", () => { socket.isAlive = true; lastSeen = Date.now(); console.log("ws_pong", { roomId: socket.roomId || null, openId: socket.openId || null, ts: Date.now() }); });
  const hb = setInterval(() => {
    if (Date.now() - lastSeen > WS_HEARTBEAT_IDLE_TIMEOUT_MS) {
      console.log("ws_timeout", { roomId: socket.roomId || null, openId: socket.openId || null, ts: Date.now() });
      try { socket.terminate(); } catch (_) {}
      clearInterval(hb);
      return;
    }
    try { socket.ping(); console.log("ws_ping", { roomId: socket.roomId || null, openId: socket.openId || null, ts: Date.now() }); } catch (_) {}
  }, WS_HEARTBEAT_INTERVAL_MS);
  socket.on("close", (code, reason) => {
    try { clearInterval(hb); } catch (_) {}
    console.log("ws_close", { roomId: socket.roomId || null, openId: socket.openId || null, code, reason: reason ? reason.toString() : null, ts: Date.now() });
  });
  socket.on("error", (err) => {
    try { clearInterval(hb); } catch (_) {}
    console.log("ws_error", { roomId: socket.roomId || null, openId: socket.openId || null, err: String(err && err.message || err), ts: Date.now() });
  });

  socket.on("message", (msg) => {
    const text = msg.toString();
    socket.isAlive = true; lastSeen = Date.now();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {}
    if (data && data.type) {
      console.log("ws_uplink", { type: String(data.type), raw: text, ts: Date.now() });
    } else {
      console.log("ws_uplink", { type: "unknown", raw: text, ts: Date.now() });
    }

    if (data && data.type === "ping") {
      socket.isAlive = true; lastSeen = Date.now();
      const pong = { type: "pong", ts: Date.now() };
      console.log("ws_downlink", { type: "pong", roomId: socket.roomId || null, ts: pong.ts });
      socket.send(JSON.stringify(pong));
      return;
    }
    if (!data && text && text.trim().toLowerCase() === "ping") {
      socket.isAlive = true; lastSeen = Date.now();
      const pong = { type: "pong", ts: Date.now() };
      console.log("ws_downlink", { type: "pong", roomId: socket.roomId || null, ts: pong.ts });
      socket.send(JSON.stringify(pong));
      return;
    }

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
          console.log("ws_downlink", { type: "joined", roomId: ridStr, ts: Date.now() });
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
      console.log("ws_downlink", { type: "joined", roomId: String(socket.roomId), ts: Date.now() });
      socket.send(JSON.stringify({ type: "joined", roomId: socket.roomId, roomIdStr: String(socket.roomId) }));
      return;
    }
    if (data && data.type === "leave") {
      console.log("ws_leave", { roomId: socket.roomId || null, openId: socket.openId || null, ts: Date.now() });
      delete socket.roomId;
      console.log("ws_downlink", { type: "left", roomId: socket.roomId || null, ts: Date.now() });
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
    if (data && data.type === "startgame") {
      (async () => {
        const roomId = String(data.roomId || socket.roomId || "");
        const appid = process.env.DOUYIN_APP_ID;
        if (!roomId || !appid) {
          socket.send(JSON.stringify({ type: "startgame_failed", reason: !roomId ? "missing roomId" : "missing appid" }));
          return;
        }
        let msgTypes = data.msgTypes;
        if (!msgTypes) msgTypes = ["live_comment", "live_gift", "live_like"];
        if (typeof msgTypes === "string") msgTypes = [msgTypes];
        if (!Array.isArray(msgTypes)) msgTypes = ["live_comment"];
        const results = [];
        for (const mt of msgTypes) {
          const res = await startLiveDataTask(appid, roomId, String(mt));
          results.push({ msgType: String(mt), res });
        }
        console.log("ws_startgame", { roomId, msgTypes, ts: Date.now() });
        socket.send(JSON.stringify({ type: "startgame_ok", roomId, results }));
      })();
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
      console.log("live_info_error", { reason: "invalid token", ts: Date.now() });
      return res.status(400).json({ err_no: 40001, err_tips: "invalid token", data: null });
    }
    const body = await fetchLiveInfoByToken(token, xToken);
    if (body && body.errcode === 0) {
      const info = body && body.data && body.data.info;
      console.log("live_info_ok", { roomId: info && (info.room_id_str || info.room_id) || null, ts: Date.now() });
    } else {
      console.log("live_info_error", { errcode: body && body.errcode, errmsg: body && body.errmsg, status_code: body && body.status_code, body, ts: Date.now() });
    }
    return res.status(200).json(body);
  } catch (e) {
    console.log("live_info_error", { reason: "exception", err: String(e && e.message || e), ts: Date.now() });
    return res.status(500).json({ err_no: -1, err_tips: "internal error", data: null });
  }
});


app.post("/live_data_callback", async (req, res) => {
  try {
    const body = req.body || {};
    const headerRoomId = req.headers["x-roomid"] ? String(req.headers["x-roomid"]) : "";
    const headerMsgType = req.headers["x-msg-type"] ? String(req.headers["x-msg-type"]) : null;
    const roomId = headerRoomId || String(
      (body && body.room_id) ||
        (body && body.data && body.data.room_id) ||
        (body && body.data && body.data.info && body.data.info.room_id) ||
        ""
    );
    console.log("live_data_callback", { roomId: roomId || null, msgType: headerMsgType, payload: body, ts: Date.now() });
    const payload = { type: "live_data", msgType: headerMsgType, data: body };
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


// Access token cache and fetcher
let ACCESS_TOKEN = null;
let ACCESS_TOKEN_EXPIRES_AT = 0;
let credentialClient = null;
let openApiClient = null;

function getOpenApiClient() {
  if (!SdkClient) return null;
  if (openApiClient) return openApiClient;
  const appid = process.env.DOUYIN_APP_ID;
  const secret = process.env.DOUYIN_APP_SECRET;
  if (!appid || !secret) return null;
  try { openApiClient = new SdkClient({ clientKey: appid, clientSecret: secret }); } catch (_) { openApiClient = null; }
  return openApiClient;
}

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
  if (!credentialClient) credentialClient = new CredentialClient({ clientKey: appid, clientSecret: secret });
  let tokenRes = null;
  try { tokenRes = await credentialClient.getClientToken(); } catch (e) { tokenRes = { err_no: -1, err_tips: String(e && e.message || e) }; }
  const accessToken = tokenRes && (tokenRes.accessToken || (tokenRes.data && tokenRes.data.access_token));
  const expiresIn = tokenRes && (tokenRes.expiresIn || (tokenRes.data && tokenRes.data.expires_in));
  if (!accessToken) return tokenRes || { err_no: 40020, err_tips: "access_token unavailable", data: null };
  ACCESS_TOKEN = accessToken;
  const ttl = (expiresIn || 7200) * 1000;
  ACCESS_TOKEN_EXPIRES_AT = Date.now() + Math.max(ttl - 300_000, 60_000);
  return { access_token: ACCESS_TOKEN, expires_at: ACCESS_TOKEN_EXPIRES_AT };
}

async function fetchLiveInfoByToken(token, overrideXToken) {
  const client = getOpenApiClient();
  if (client && typeof client.webcastmateInfo === "function") {
    try {
      const at = await fetchAccessToken(false);
      const xToken = (overrideXToken || (at && at.access_token)) ? (overrideXToken || at.access_token) : null;
      const buildReq = (xt) => {
        const base = { token: String(token), xToken: xt };
        return WebcastmateInfoRequest ? new WebcastmateInfoRequest(base) : base;
      };
      if (!xToken) {
        const at2 = await fetchAccessToken(true);
        if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_tips: "access_token unavailable", data: null };
        const req = buildReq(at2.access_token);
        let sdkRes = await client.webcastmateInfo(req);
        let body = sdkRes || {};
        try {
          const info = body && body.data && body.data.info;
          const txt = JSON.stringify(body);
          const m = txt && txt.match(/"room_id"\s*:\s*"?(\d+)"?/);
          if (info) {
            if (m) { info.room_id_str = m[1]; info.room_id = m[1]; }
            else if (info.room_id !== undefined && info.room_id !== null) { const asStr = typeof info.room_id === "string" ? info.room_id : String(info.room_id); info.room_id_str = asStr; info.room_id = asStr; }
          }
        } catch (_) {}
        console.log("sdk_call_ok", { api: "webcastmateInfo", ts: Date.now() });
        return body;
      }
      const req = buildReq(xToken);
      let sdkRes = await client.webcastmateInfo(req);
      let body = sdkRes || {};
      try {
        const info = body && body.data && body.data.info;
        const txt = JSON.stringify(body);
        const m = txt && txt.match(/"room_id"\s*:\s*"?(\d+)"?/);
        if (info) {
          if (m) { info.room_id_str = m[1]; info.room_id = m[1]; }
          else if (info.room_id !== undefined && info.room_id !== null) { const asStr = typeof info.room_id === "string" ? info.room_id : String(info.room_id); info.room_id_str = asStr; info.room_id = asStr; }
        }
      } catch (_) {}
      console.log("sdk_call_ok", { api: "webcastmateInfo", ts: Date.now() });
      return body;
    } catch (e) {
      return { err_no: -1, err_tips: String(e && e.message || e), data: null };
    }
  }
  return { err_no: 40023, err_tips: "sdk_unavailable", data: null };
}

async function startLiveDataTask(appid, roomid, msgType) {
  const client = getOpenApiClient();
  const hasTaskStart = client && typeof client.taskStart === "function";
  const hasLiveDataTaskStart = client && typeof client.liveDataTaskStart === "function";
  if (client && (hasTaskStart || hasLiveDataTaskStart)) {
    try {
      const at = await fetchAccessToken(false);
      const accessToken = at && at.access_token;
      const buildReq = (tok) => {
        const base = { accessToken: tok, appid: String(appid), msgType: String(msgType), roomid: String(roomid) };
        return TaskStartRequest ? new TaskStartRequest(base) : base;
      };
      if (!accessToken) {
        const at2 = await fetchAccessToken(true);
        if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
        const req = buildReq(at2.access_token);
        let sdkRes = hasTaskStart ? await client.taskStart(req) : await client.liveDataTaskStart(req);
        if (sdkRes && typeof sdkRes.err_no === "number" && sdkRes.err_no !== 0) {
          const at3 = await fetchAccessToken(true);
          if (at3 && at3.access_token) {
            const req2 = buildReq(at3.access_token);
            sdkRes = hasTaskStart ? await client.taskStart(req2) : await client.liveDataTaskStart(req2);
          }
        }
        console.log("sdk_call_ok", { api: hasTaskStart ? "taskStart" : "liveDataTaskStart", ts: Date.now() });
        return sdkRes;
      }
      const req = buildReq(accessToken);
      let sdkRes = hasTaskStart ? await client.taskStart(req) : await client.liveDataTaskStart(req);
      if (sdkRes && typeof sdkRes.err_no === "number" && sdkRes.err_no !== 0) {
        const at3 = await fetchAccessToken(true);
        if (at3 && at3.access_token) {
          const req2 = buildReq(at3.access_token);
          sdkRes = hasTaskStart ? await client.taskStart(req2) : await client.liveDataTaskStart(req2);
        }
      }
      console.log("sdk_call_ok", { api: hasTaskStart ? "taskStart" : "liveDataTaskStart", ts: Date.now() });
      return sdkRes;
    } catch (e) {
      console.log("sdk_call_error", { api: hasTaskStart ? "taskStart" : "liveDataTaskStart", err: String(e && e.message || e), ts: Date.now() });
    }
  }
  return { err_no: 40023, err_msg: "sdk_unavailable", data: null };
}

// No public route for access_token; use fetchAccessToken() internally only.