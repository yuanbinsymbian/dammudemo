// Express HTTP server and WebSocket game gateway
// HTTP 服务与 WebSocket 游戏网关
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
// Douyin OpenAPI credential SDK — used to acquire access_token (xToken)
// 抖音凭据 SDK：用于获取 access_token（xToken）
const CredentialClient = require("@open-dy/open_api_credential");
let OpenApiSdk;
// Douyin OpenAPI SDK — business APIs (live info, task start, round status)
// 抖音 OpenAPI SDK：包含直播信息、任务启动、对局状态同步等接口
try { OpenApiSdk = require("@open-dy/open_api_sdk"); } catch (_) { OpenApiSdk = null; }
// SDK 客户端：用于调用开放平台业务接口
const SdkClient = OpenApiSdk && (OpenApiSdk.default || OpenApiSdk) || null;
const TaskStartRequest = OpenApiSdk && OpenApiSdk.TaskStartRequest || null;
const WebcastmateInfoRequest = OpenApiSdk && OpenApiSdk.WebcastmateInfoRequest || null;
const RoundSyncStatusRequest = OpenApiSdk && OpenApiSdk.RoundSyncStatusRequest || null;
const UploadUserGroupInfoRequest = OpenApiSdk && OpenApiSdk.UploadUserGroupInfoRequest || null;

// Basic server setup
// 基本服务器配置
const app = express();
const PORT = 8000;
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const WS_HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS || "20000", 10);
const WS_HEARTBEAT_IDLE_TIMEOUT_MS = parseInt(process.env.WS_HEARTBEAT_IDLE_TIMEOUT_MS || "120000", 10);
 

app.get("/v1/ping", (req, res) => {
  res.send("ok");
});

// WebSocket server
// WebSocket 服务器
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

// Handle incoming WebSocket connection: heartbeat, join/leave, and gameplay events
// 处理 WebSocket 连接：心跳、加入/离开、玩法事件
wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "welcome", ts: Date.now() }));
  socket.isAlive = true;
  let lastSeen = Date.now();
  socket.on("pong", () => { socket.isAlive = true; lastSeen = Date.now(); console.log("ws_pong", { roomId: socket.roomId || null, openId: socket.openId || null, ts: Date.now() }); });
  // Heartbeat management: keep-alive ping and idle timeout termination
  // 心跳管理：保持连接并在空闲超时后断开
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

  // WebSocket message processing: supports ping, join/leave, chat relay, startgame, and startRound
  // WebSocket 消息处理：支持 ping、join/leave、聊天转发、startgame、startRound
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

    // Join by cloud token: resolve room info via SDK and cache roomId/openId on connection
    // 通过云端 token 加入：使用 SDK 获取房间信息，并在连接上缓存 roomId/openId
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
          else if (info.anchor_open_id) socket.openId = String(info.anchor_open_id);
          console.log("ws_join", { roomId: ridStr, openId: socket.openId || null, via: "token_liveinfo", ts: Date.now() });
          console.log("ws_downlink", { type: "joined", roomId: ridStr, ts: Date.now() });
          socket.send(JSON.stringify({ type: "joined", roomId: socket.roomId, roomIdStr: ridStr }));
        } else {
          socket.send(JSON.stringify({ type: "join_failed", body: r }));
        }
      })();
      return;
    }
    // Join explicitly by roomId
    // 通过 roomId 显式加入
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
    // Room chat relay (server-side broadcast to room members)
    // 房间聊天转发（服务端向房间成员广播）
    if (data && data.type === "say" && data.roomId && data.payload) {
      const target = String(data.roomId);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.roomId === target) {
          client.send(JSON.stringify({ type: "message", payload: data.payload }));
        }
      });
      return;
    }
    // Start live data push tasks for selected msg types via SDK
    // 通过 SDK 启动指定消息类型的直播数据推送任务
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
    // Start a game round: sync status via SDK (status=1) and mark CURRENT_ROUND for this room
    // 开始对局：通过 SDK 同步状态（status=1），并记录该房间当前轮次
    if (data && data.type === "startRound") {
      (async () => {
        const roomId = String(data.roomId || socket.roomId || "");
        const roundIdRaw = data.roundId !== undefined ? data.roundId : data.RoundId;
        const startTimeRaw = data.startTime !== undefined ? data.startTime : data.StartTime;
        const roundId = Number(roundIdRaw);
        const startTime = Number(startTimeRaw || Math.floor(Date.now() / 1000));
        const appid = process.env.DOUYIN_APP_ID;
        const anchorOpenId = socket.openId ? String(socket.openId) : undefined;
        if (!roomId || !appid || !roundId || !startTime) {
          socket.send(JSON.stringify({ type: "startRound_failed", reason: !roomId ? "missing roomId" : (!roundId ? "missing roundId" : (!startTime ? "missing startTime" : "missing appid")) }));
          return;
        }
        const res = await roundSyncStatusStart({ appid, roomId, roundId, startTime, anchorOpenId });
        try { CURRENT_ROUND.set(String(roomId), Number(roundId)); } catch (_) {}
        console.log("ws_startRound", { roomId, roundId, startTime, ts: Date.now() });
        socket.send(JSON.stringify({ type: "startRound_ok", roomId, roundId, body: res }));
      })();
      return;
    }
    // Finish round: parse identifiers and timing
    // 回合结束：解析房间、对局与结算时间
    if (data && data.type === "finishRound") {
      (async () => {
        const roomId = String(data.roomId || socket.roomId || "");
        const roundIdRaw = data.roundId !== undefined ? data.roundId : data.RoundId;
        const roundId = Number(roundIdRaw || (CURRENT_ROUND.get(String(roomId)) || 0));
        const appid = process.env.DOUYIN_APP_ID;
        const anchorOpenId = socket.openId ? String(socket.openId) : undefined;
        const endTime = Math.floor(Date.now() / 1000);

        // Winner normalization (Red/Blue) for group_result_list
        // 胜者归一化（Red/Blue），用于构造 group_result_list
        let winner = data.winnerGroup || data.winner || "";
        const w = String(winner || "").trim().toLowerCase();
        if (w === "red") winner = "Red"; else if (w === "blue") winner = "Blue";

        // Build group_result_list for round status sync
        // 构造 group_result_list 以便同步对局状态
        let groupResultList;
        if (winner === "Red") groupResultList = [{ groupId: "Red", result: 1 }, { groupId: "Blue", result: 2 }];
        else if (winner === "Blue") groupResultList = [{ groupId: "Blue", result: 1 }, { groupId: "Red", result: 2 }];
        else groupResultList = [{ groupId: "Red", result: 3 }, { groupId: "Blue", result: 3 }];

        // Validate required fields
        // 校验必填参数
        if (!roomId || !appid || !roundId) {
          socket.send(JSON.stringify({ type: "finishRound_failed", reason: !roomId ? "missing roomId" : (!roundId ? "missing roundId" : "missing appid") }));
          return;
        }

        // Report round end status to Douyin via SDK
        // 通过 SDK 上报对局结束状态到抖音服务器
        const res = await roundSyncStatusEnd({ appid, roomId, roundId, endTime, groupResultList, anchorOpenId });

        // Update user stats based on participants' results
        // 根据参与用户的输赢与积分，更新用户积分与连胜
        const users = Array.isArray(data.users) ? data.users : (Array.isArray(data.participants) ? data.participants : []);
        for (const u of users) {
          const oid = String(u.openId || u.userOpenId || "");
          const pts = Number(u.deltaPoints || u.points || 0);
          const isWin = !!(u.isWin || (winner && typeof u.groupId === "string" && String(u.groupId).trim().toLowerCase() === w));
          if (oid) updateUserStats(oid, pts, isWin);
        }

        // Clear current round state and respond
        // 清理当前对局状态并返回结果
        try { CURRENT_ROUND.delete(String(roomId)); } catch (_) {}
        console.log("ws_finishRound", { roomId, roundId, winner: winner || null, ts: Date.now() });
        socket.send(JSON.stringify({ type: "finishRound_ok", roomId, roundId, body: res }));
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
// 直播间信息代理
// REST: Live room info proxy — resolve via SDK using token/xToken and return normalized room_id
// 通过 SDK 使用 token/xToken 查询直播信息，并归一化 room_id
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


// Live data callback endpoint: record group from comments and broadcast payload to clients
// 直播数据回调：从评论中记录分组，并将消息广播到客户端
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/douyincloud/guide
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
    // Attempt to record user group for current round when receiving live_comment
    // 收到评论消息时，尝试为当前轮次记录用户分组
    try {
      const appid = process.env.DOUYIN_APP_ID || "";
      if (appid && roomId && headerMsgType === "live_comment") {
        const ridStr = String(roomId);
        const roundId = CURRENT_ROUND && CURRENT_ROUND.get(ridStr);
        if (roundId) {
          let openId = null;
          try {
            openId = (body && body.user_open_id) || (body && body.open_id) || (body && body.user && body.user.open_id) ||
              (body && body.data && body.data.user_open_id) || (body && body.data && body.data.user && body.data.user.open_id) || null;
            if (openId) openId = String(openId);
          } catch (_) {}
          let content = null;
          try {
            content = (body && body.content) || (body && body.text) || (body && body.msg_content) ||
              (body && body.data && body.data.content) || (body && body.data && body.data.text) ||
              (body && body.comment && body.comment.text) || null;
            if (content !== null && content !== undefined) content = String(content);
          } catch (_) {}
          const gid = groupIdFromMessage(content);
          if (openId && gid) {
            const r = recordUserGroup(appid, openId, ridStr, roundId, gid);
            if (r && r.err_no !== 0) {
              console.log("group_record_error", { roomId: ridStr, roundId, openId, gid, body: r, ts: Date.now() });
            } else {
              console.log("group_record_ok", { roomId: ridStr, roundId, openId, gid, ts: Date.now() });
              const up = await uploadUserGroupInfo({ appid, openId, roomId: ridStr, roundId, groupId: gid });
              if (up && (up.errcode === 0 || up.err_no === 0)) console.log("group_upload_ok", { roomId: ridStr, roundId, openId, gid, ts: Date.now() });
              else console.log("group_upload_error", { roomId: ridStr, roundId, openId, gid, body: up, ts: Date.now() });
            }
          }
        }
      }
    } catch (_) {}
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

// Audience camp selection push (developer endpoint)
// 观众选择阵营推送（开发者提供接口）：记录并返回最终分组
// 注意！！！！这里没有采用抖音给的分组，如果有冲突，保留了原有分组
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/audience-camp-dev
app.post("/api/user_group/push", async (req, res) => {
  try {
    const hMsgType = req.headers["x-msg-type"] ? String(req.headers["x-msg-type"]) : null;
    if (hMsgType && hMsgType !== "user_group_push") {
      return res.status(200).json({ errcode: 40001, errmsg: "invalid msg type" });
    }
    const appid = req.body && req.body.app_id ? String(req.body.app_id) : "";
    const openId = req.body && req.body.open_id ? String(req.body.open_id) : "";
    const roomId = (req.body && req.body.room_id ? String(req.body.room_id) : (req.headers["x-roomid"] ? String(req.headers["x-roomid"]) : ""));
    const requestedGroup = req.body && req.body.group_id ? String(req.body.group_id) : "";
    if (!appid || !openId || !roomId || !requestedGroup) {
      return res.status(200).json({ errcode: 40001, errmsg: "invalid params" });
    }
    const roundId = (CURRENT_ROUND && CURRENT_ROUND.get(String(roomId))) ? Number(CURRENT_ROUND.get(String(roomId))) : 0;
    const key = makeUserRoundKey(appid, openId, roomId, roundId);
    const prev = USER_ROUND_GROUP.get(key);
    let finalGroup = requestedGroup;
    if (prev && prev !== requestedGroup) {
      finalGroup = prev;
      console.log("user_group_conflict", { roomId, roundId, openId, requested: requestedGroup, prev, ts: Date.now() });
    } else {
      USER_ROUND_GROUP.set(key, finalGroup);
      console.log("user_group_set", { roomId, roundId, openId, groupId: finalGroup, ts: Date.now() });
    }
    const status = roundId ? 1 : 2;
    return res.status(200).json({ errcode: 0, errmsg: "success", data: { round_id: roundId, round_status: status, group_id: finalGroup } });
  } catch (e) {
    return res.status(200).json({ errcode: 1, errmsg: "internal error" });
  }
});

// Audience camp query (developer endpoint)
// 查询观众阵营数据（开发者提供）：返回用户在直播间的最新分组
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/viewer-data-query-dev
app.post("/api/user_group/query", async (req, res) => {
  try {
    const hMsgType = req.headers["x-msg-type"] ? String(req.headers["x-msg-type"]) : null;
    if (hMsgType && hMsgType !== "user_group") {
      return res.status(200).json({ errcode: 40001, errmsg: "invalid msg type" });
    }
    const secret = process.env.DOUYIN_CALLBACK_SECRET || "";
    const rawBodyStr = JSON.stringify(req.body || {});
    if (!verifySignature(req, rawBodyStr, secret)) {
      return res.status(200).json({ errcode: 40004, errmsg: "invalid signature" });
    }
    const appid = req.body && req.body.app_id ? String(req.body.app_id) : "";
    const openId = req.body && req.body.open_id ? String(req.body.open_id) : "";
    const roomId = req.body && req.body.room_id ? String(req.body.room_id) : "";
    if (!appid || !openId || !roomId) {
      return res.status(200).json({ errcode: 40001, errmsg: "invalid params" });
    }
    let roundId = CURRENT_ROUND && CURRENT_ROUND.get(String(roomId)) ? Number(CURRENT_ROUND.get(String(roomId))) : 0;
    let roundStatus = roundId ? 1 : 2;
    if (!roundId) {
      const latest = findLatestRoundId(appid, openId, roomId);
      if (latest) { roundId = latest; roundStatus = 2; }
    }
    const key = makeUserRoundKey(appid, openId, roomId, roundId);
    const gid = USER_ROUND_GROUP.get(key) || "";
    const userGroupStatus = gid ? 1 : 0;
    return res.status(200).json({ errcode: 0, errmsg: "success", data: { round_id: roundId, round_status: roundStatus, user_group_status: userGroupStatus, group_id: gid } });
  } catch (e) {
    return res.status(200).json({ errcode: 1, errmsg: "internal error" });
  }
});


// Access token cache and fetcher
// access_token 缓存与获取
// Credential cache and SDK client singletons
// 凭据缓存与 SDK 客户端单例
let ACCESS_TOKEN = null;
let ACCESS_TOKEN_EXPIRES_AT = 0;
let credentialClient = null;
let openApiClient = null;

// Lazily initialize OpenAPI SDK client using app credentials
// 按需初始化 OpenAPI SDK 客户端（使用应用凭据）
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/sdk-overview
function getOpenApiClient() {
  if (!SdkClient) return null;
  if (openApiClient) return openApiClient;
  const appid = process.env.DOUYIN_APP_ID;
  const secret = process.env.DOUYIN_APP_SECRET;
  if (!appid || !secret) return null;
  try { openApiClient = new SdkClient({ clientKey: appid, clientSecret: secret }); } catch (_) { openApiClient = null; }
  return openApiClient;
}

// Acquire and cache access_token (xToken), with early refresh near expiry
// 获取并缓存 access_token（xToken），在临近过期时提前刷新
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/interface-request-credential/get-access-token
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

// SDK-only live info fetch using WebcastmateInfoRequest; supports override xToken and token-based join flow
// 仅使用 SDK（WebcastmateInfoRequest）获取直播信息；支持覆盖 xToken 与基于 token 的加入流程
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/live-info
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
      // Refresh xToken if missing, then invoke SDK
      // 若缺少 xToken，则刷新令牌后调用 SDK
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
      // Use existing xToken to invoke SDK
      // 使用已有 xToken 调用 SDK
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

// SDK-only live data task start; strictly call taskStart per official docs
// 仅使用 SDK 启动直播数据任务；严格调用 taskStart 方法
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/data-open/start-task
async function startLiveDataTask(appid, roomid, msgType) {
  const client = getOpenApiClient();
  if (client && typeof client.taskStart === "function") {
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
        let sdkRes = await client.taskStart(buildReq(at2.access_token));
        if (sdkRes && typeof sdkRes.err_no === "number" && sdkRes.err_no !== 0) {
          const at3 = await fetchAccessToken(true);
          if (at3 && at3.access_token) sdkRes = await client.taskStart(buildReq(at3.access_token));
        }
        console.log("sdk_call_ok", { api: "taskStart", ts: Date.now() });
        return sdkRes;
      }
      let sdkRes = await client.taskStart(buildReq(accessToken));
      if (sdkRes && typeof sdkRes.err_no === "number" && sdkRes.err_no !== 0) {
        const at3 = await fetchAccessToken(true);
        if (at3 && at3.access_token) sdkRes = await client.taskStart(buildReq(at3.access_token));
      }
      console.log("sdk_call_ok", { api: "taskStart", ts: Date.now() });
      return sdkRes;
    } catch (e) {
      console.log("sdk_call_error", { api: "taskStart", err: String(e && e.message || e), ts: Date.now() });
    }
  }
  return { err_no: 40023, err_msg: "sdk_unavailable", data: null };
}

// SDK-only round status sync (start): status=1, optional anchorOpenId, inject xToken
// 仅使用 SDK 同步对局开始状态：status=1，可选主播 openId，自动注入 xToken
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/sync-game-state
async function roundSyncStatusStart({ appid, roomId, roundId, startTime, anchorOpenId }) {
  const client = getOpenApiClient();
  const hasRoundSyncLower = client && typeof client.roundSyncStatus === "function";
  const hasRoundSyncUpper = client && typeof client.RoundSyncStatus === "function";
  const hasGamingConRound = client && typeof client.gamingConRoundSyncStatus === "function";
  if (client && (hasRoundSyncLower || hasRoundSyncUpper || hasGamingConRound)) {
    try {
      const at = await fetchAccessToken(false);
      const xToken = at && at.access_token ? at.access_token : null;
      const buildReq = (xt) => {
        const base = { appId: String(appid), roomId: String(roomId), roundId: Number(roundId), startTime: Number(startTime), status: 1, xToken: xt };
        if (anchorOpenId) base.anchorOpenId = String(anchorOpenId);
        return RoundSyncStatusRequest ? new RoundSyncStatusRequest(base) : base;
      };
      if (!xToken) {
        const at2 = await fetchAccessToken(true);
        if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
        const req = buildReq(at2.access_token);
        const sdkRes = hasRoundSyncLower ? await client.roundSyncStatus(req) : (hasRoundSyncUpper ? await client.RoundSyncStatus(req) : await client.gamingConRoundSyncStatus(req));
        console.log("sdk_call_ok", { api: hasRoundSyncLower ? "roundSyncStatus" : (hasRoundSyncUpper ? "RoundSyncStatus" : "gamingConRoundSyncStatus"), ts: Date.now() });
        return sdkRes;
      }
      const req = buildReq(xToken);
      const sdkRes = hasRoundSyncLower ? await client.roundSyncStatus(req) : (hasRoundSyncUpper ? await client.RoundSyncStatus(req) : await client.gamingConRoundSyncStatus(req));
      console.log("sdk_call_ok", { api: hasRoundSyncLower ? "roundSyncStatus" : (hasRoundSyncUpper ? "RoundSyncStatus" : "gamingConRoundSyncStatus"), ts: Date.now() });
      return sdkRes;
    } catch (e) {
      console.log("sdk_call_error", { api: "roundSyncStatus", err: String(e && e.message || e), ts: Date.now() });
    }
  }
  return { err_no: 40023, err_msg: "sdk_unavailable", data: null };
}

// Round status sync (end)
// 对局结束状态同步
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/sync-game-state
async function roundSyncStatusEnd({ appid, roomId, roundId, endTime, groupResultList, anchorOpenId }) {
  const client = getOpenApiClient();
  const hasRoundSyncLower = client && typeof client.roundSyncStatus === "function";
  const hasRoundSyncUpper = client && typeof client.RoundSyncStatus === "function";
  const hasGamingConRound = client && typeof client.gamingConRoundSyncStatus === "function";
  if (client && (hasRoundSyncLower || hasRoundSyncUpper || hasGamingConRound)) {
    try {
      const at = await fetchAccessToken(false);
      const xToken = at && at.access_token ? at.access_token : null;
      const buildReq = (xt) => {
        const base = { appId: String(appid), roomId: String(roomId), roundId: Number(roundId), endTime: Number(endTime), status: 2, xToken: xt, groupResultList: Array.isArray(groupResultList) ? groupResultList : [] };
        if (anchorOpenId) base.anchorOpenId = String(anchorOpenId);
        return RoundSyncStatusRequest ? new RoundSyncStatusRequest(base) : base;
      };
      // Refresh xToken if missing, then invoke SDK
      // 若缺少 xToken，则刷新令牌后调用 SDK
      if (!xToken) {
        const at2 = await fetchAccessToken(true);
        if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
        const req = buildReq(at2.access_token);
        const sdkRes = hasRoundSyncLower ? await client.roundSyncStatus(req) : (hasRoundSyncUpper ? await client.RoundSyncStatus(req) : await client.gamingConRoundSyncStatus(req));
        console.log("sdk_call_ok", { api: hasRoundSyncLower ? "roundSyncStatus" : (hasRoundSyncUpper ? "RoundSyncStatus" : "gamingConRoundSyncStatus"), ts: Date.now() });
        return sdkRes;
      }
      // Use existing xToken to invoke SDK
      // 使用已有 xToken 调用 SDK
      const req = buildReq(xToken);
      const sdkRes = hasRoundSyncLower ? await client.roundSyncStatus(req) : (hasRoundSyncUpper ? await client.RoundSyncStatus(req) : await client.gamingConRoundSyncStatus(req));
      console.log("sdk_call_ok", { api: hasRoundSyncLower ? "roundSyncStatus" : (hasRoundSyncUpper ? "RoundSyncStatus" : "gamingConRoundSyncStatus"), ts: Date.now() });
      return sdkRes;
    } catch (e) {
      console.log("sdk_call_error", { api: "roundSyncStatus", err: String(e && e.message || e), ts: Date.now() });
    }
  }
  return { err_no: 40023, err_msg: "sdk_unavailable", data: null };
}

// Upload user group info to Douyin server after group assignment
// 将用户分组结果上报抖音服务器
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/report-camp-data
async function uploadUserGroupInfo({ appid, openId, roomId, roundId, groupId }) {
  const client = getOpenApiClient();
  const hasLower = client && typeof client.uploadUserGroupInfo === "function";
  const hasUpper = client && typeof client.UploadUserGroupInfo === "function";
  const hasGamingCon = client && typeof client.gamingConRoundUploadUserGroupInfo === "function";
  if (client && (hasLower || hasUpper || hasGamingCon)) {
    try {
      const at = await fetchAccessToken(false);
      const xToken = at && at.access_token ? at.access_token : null;
      const buildReq = (xt) => {
        const base = { appId: String(appid), groupId: String(groupId), openId: String(openId), roomId: String(roomId), roundId: Number(roundId), xToken: xt };
        return UploadUserGroupInfoRequest ? new UploadUserGroupInfoRequest(base) : base;
      };
      const ensureCall = async (req) => hasLower ? client.uploadUserGroupInfo(req) : (hasUpper ? client.UploadUserGroupInfo(req) : client.gamingConRoundUploadUserGroupInfo(req));
      if (!xToken) {
        const at2 = await fetchAccessToken(true);
        if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
        const req = buildReq(at2.access_token);
        const sdkRes = await ensureCall(req);
        console.log("sdk_call_ok", { api: hasLower ? "uploadUserGroupInfo" : (hasUpper ? "UploadUserGroupInfo" : "gamingConRoundUploadUserGroupInfo"), ts: Date.now() });
        return sdkRes;
      }
      const req = buildReq(xToken);
      const sdkRes = await ensureCall(req);
      console.log("sdk_call_ok", { api: hasLower ? "uploadUserGroupInfo" : (hasUpper ? "UploadUserGroupInfo" : "gamingConRoundUploadUserGroupInfo"), ts: Date.now() });
      return sdkRes;
    } catch (e) {
      console.log("sdk_call_error", { api: "uploadUserGroupInfo", err: String(e && e.message || e), ts: Date.now() });
    }
  }
  return { err_no: 40023, err_msg: "sdk_unavailable", data: null };
}

// Map user comment text to a game group: "1"/"左" → Blue, "2"/"右" → Red
// 弹幕文本到分组映射："1"/"左" → Blue，"2"/"右" → Red
function groupIdFromMessage(msg) {
  const s = String(msg || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "1" || s === "左") return "Blue";
  if (s === "2" || s === "右") return "Red";
  return null;
}

// Global user-round group assignments: key = appId|openId|roomId|roundId, value = groupId
// 全局用户分组存储：键为 appId|openId|roomId|roundId，值为 groupId
const USER_ROUND_GROUP = new Map();
const CURRENT_ROUND = new Map();

// Key builder for USER_ROUND_GROUP
// 构造用户分组键（USER_ROUND_GROUP）
function makeUserRoundKey(appid, openId, roomId, roundId) {
  return [String(appid), String(openId), String(roomId), String(roundId)].join("|");
}

// Record a user's group for a specific round; conflicts if existing group differs
// 记录某局的用户分组；若已存在且不同，则返回冲突错误
function recordUserGroup(appid, openId, roomId, roundId, groupId) {
  const gid = String(groupId);
  if (!gid) return { err_no: 40001, err_msg: "invalid group", data: null };
  const key = makeUserRoundKey(appid, openId, roomId, roundId);
  const prev = USER_ROUND_GROUP.get(key);
  if (prev && prev !== gid) return { err_no: 40002, err_msg: "group conflict", data: { prev, requested: gid } };
  USER_ROUND_GROUP.set(key, gid);
  return { err_no: 0, err_msg: "ok", data: { group_id: gid } };
}

// Compute and verify signature for Douyin callbacks/queries
// 计算与校验抖音回调/查询请求的签名
function computeSignature(headerMap, bodyStr, secret) {
  const keys = Object.keys(headerMap || {}).sort();
  const kv = keys.map((k) => `${k}=${String(headerMap[k])}`);
  const urlParams = kv.join("&");
  const raw = urlParams + String(bodyStr || "") + String(secret || "");
  const md5 = crypto.createHash("md5").update(Buffer.from(raw, "utf8")).digest();
  return Buffer.from(md5).toString("base64");
}

function verifySignature(req, bodyStr, secret) {
  if (!secret) return true;
  const h = req.headers || {};
  const headerMap = {
    "x-msg-type": String(h["x-msg-type"] || ""),
    "x-nonce-str": String(h["x-nonce-str"] || ""),
    "x-roomid": String(h["x-roomid"] || ""),
    "x-timestamp": String(h["x-timestamp"] || ""),
  };
  const sig = String(h["x-signature"] || "");
  const calc = computeSignature(headerMap, String(bodyStr || ""), String(secret));
  return sig && calc && sig === calc;
}

// Find latest round id recorded for a user in a room
// 查询用户在房间内最近的对局 ID
function findLatestRoundId(appid, openId, roomId) {
  let latest = 0;
  const prefix = `${String(appid)}|${String(openId)}|${String(roomId)}|`;
  for (const key of USER_ROUND_GROUP.keys()) {
    if (key.startsWith(prefix)) {
      const parts = key.split("|");
      const rid = Number(parts[3] || 0);
      if (rid > latest) latest = rid;
    }
  }
  return latest;
}

// No public route for access_token; use fetchAccessToken() internally only.
// 不提供公开的 access_token 路由；仅在内部使用 fetchAccessToken()

// Global user core stats: points and win-streak per openId
// 全局用户核心数据：按 openId 存储积分与连胜
const USER_CORE_STATS = new Map();

// Update user's points and streak based on match result
// 根据胜负更新用户积分与连胜
function updateUserStats(openId, deltaPoints, isWin) {
  const oid = String(openId || "");
  if (!oid) return { err_no: 40001, err_msg: "invalid openId", data: null };
  const inc = Number(deltaPoints || 0);
  const cur = USER_CORE_STATS.get(oid) || { points: 0, streak: 0 };
  let points = Number(cur.points || 0);
  let streak = Number(cur.streak || 0);
  if (isWin) {
    points += Math.max(0, inc);
    streak = streak + 1;
  } else {
    const reduce = Math.max(1, Math.floor(streak * 0.2));
    streak = Math.max(0, streak - reduce);
  }
  const next = { points, streak };
  USER_CORE_STATS.set(oid, next);
  return { err_no: 0, err_msg: "ok", data: next };
}