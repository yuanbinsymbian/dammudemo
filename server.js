// Express HTTP server and WebSocket game gateway
// HTTP 服务与 WebSocket 游戏网关
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const mysql = require('mysql2/promise');
// Douyin OpenAPI credential SDK — used to acquire access_token (xToken)
// 抖音凭据 SDK：用于获取 access_token（xToken）
let OpenDyCred = null;
try { OpenDyCred = require("@open-dy/open_api_credential"); } catch (e) { OpenDyCred = null; console.log("cred_require_error", { pkg: "@open-dy/open_api_credential", err: String(e && e.message || e), ts: Date.now() }); }
const CredentialClient = OpenDyCred && (OpenDyCred.default || OpenDyCred) || null;
let OpenApiSdk;
// Douyin OpenAPI SDK — business APIs (live info, task start, round status)
// 抖音 OpenAPI SDK：包含直播信息、任务启动、对局状态同步等接口
try { OpenApiSdk = require("@open-dy/open_api_sdk"); } catch (e) { OpenApiSdk = null; console.log("sdk_require_error", { pkg: "@open-dy/open_api_sdk", err: String(e && e.message || e), ts: Date.now() }); }
// SDK 客户端：用于调用开放平台业务接口
const SdkClient = OpenApiSdk && (OpenApiSdk.default || OpenApiSdk) || null;
const RoundSyncStatusRequest = OpenApiSdk && OpenApiSdk.RoundSyncStatusRequest || null;
const UploadUserGroupInfoRequest = OpenApiSdk && OpenApiSdk.UploadUserGroupInfoRequest || null;
const RoundUploadUserResultRequest = OpenApiSdk && OpenApiSdk.RoundUploadUserResultRequest || null;
const RoundUploadRankListRequest = OpenApiSdk && OpenApiSdk.RoundUploadRankListRequest || null;
const RoundCompleteUploadUserResultRequest = OpenApiSdk && OpenApiSdk.RoundCompleteUploadUserResultRequest || null;

// Basic server setup
// 基本服务器配置
const app = express();
const PORT = 8000;
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const WS_HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS || "20000", 10);
const WS_HEARTBEAT_IDLE_TIMEOUT_MS = parseInt(process.env.WS_HEARTBEAT_IDLE_TIMEOUT_MS || "120000", 10);
const MYSQL_HOST = process.env.MYSQL_HOST || "mysqld9a067bf9939.rds.ivolces.com";
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || "3306", 10);
const MYSQL_USER = process.env.MYSQL_USER || "yykjzhc";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "yuanyekeji$DSZ";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "dev";
// 创建连接池
const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true, // 无可用连接时等待
  connectionLimit: 100,      // 最大连接数
  queueLimit: 0             // 等待队列无限制
});

const DEBUG_ROOMID = process.env.DEBUG_ROOM_ID || process.env.DEBUG_ROOMID || process.env.DEBUG_ROOM_ID_STR || "1123456789999999999";

app.get("/v1/ping", (req, res) => {
  res.send("ok");
});

// WebSocket server
// WebSocket 服务器
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

function wsSend(socket, message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try { socket.send(typeof message === "string" ? message : JSON.stringify(message)); } catch (_) {}
}

async function wsBroadcast(message, roomId) {
  const target = roomId !== undefined && roomId !== null ? String(roomId) : null;
  try {
    if (message && typeof message !== "string" && message.open_id) {
      const cur = await selectUserCoreStats(String(message.open_id));
      const scoreObj = cur && cur.length > 0 ? cur[0] : null;
      message.score = scoreObj;
    }
  } catch (_) {}
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && (!target || client.roomId === target)) {
      console.log("ws_broadcast", {client: client.roomId, message: JSON.stringify(message), ts: Date.now() });
      try { client.send(typeof message === "string" ? message : JSON.stringify(message)); } catch (_) {}
    }
  });
}

// Handle incoming WebSocket connection: heartbeat, join/leave, and gameplay events
// 处理 WebSocket 连接：心跳、加入/离开、玩法事件
wss.on("connection", (socket) => {
  wsSend(socket, { type: "welcome", ts: Date.now() });
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
      wsSend(socket, pong);
      return;
    }
    if (!data && text && text.trim().toLowerCase() === "ping") {
      socket.isAlive = true; lastSeen = Date.now();
      const pong = { type: "pong", ts: Date.now() };
      console.log("ws_downlink", { type: "pong", roomId: socket.roomId || null, ts: pong.ts });
      wsSend(socket, pong);
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
        wsSend(socket, { type: "joined", roomId: socket.roomId, roomIdStr: ridStr });
        return;
      }
      (async () => {
        console.log("ws_join_token_call", { tokenLen: tk.length, ts: Date.now() });
        const r = await fetchLiveInfoByToken(String(data.token));
        const info = r && r.data && r.data.info;
        if (info && (info.room_id_str || info.roomId !== undefined)) {
          const ridStr = info.room_id_str || String(info.roomId);
          socket.roomId = ridStr;
          if (data.openId) socket.openId = String(data.openId);
          else if (info.anchor_open_id) socket.openId = String(info.anchor_open_id);
          console.log("ws_join", { roomId: ridStr, openId: socket.openId || null, via: "token_liveinfo", ts: Date.now() });
          console.log("ws_downlink", { type: "joined", roomId: ridStr, ts: Date.now() });
          wsSend(socket, { type: "joined", roomId: socket.roomId, roomIdStr: ridStr });
        } else {
          const dbg = process.env.DEBUG_ROOM_ID || process.env.DEBUG_ROOMID || process.env.DEBUG_ROOM_ID_STR || null;
          if (dbg) {
            const ridStr = String(dbg);
            socket.roomId = ridStr;
            if (data.openId) socket.openId = String(data.openId);
            console.log("ws_join", { roomId: ridStr, openId: socket.openId || null, via: "debug_room_env", ts: Date.now() });
            console.log("ws_downlink", { type: "joined", roomId: ridStr, ts: Date.now() });
            wsSend(socket, { type: "joined", roomId: socket.roomId, roomIdStr: ridStr });
          } else {
            wsSend(socket, { type: "join_failed", body: r });
          }
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
      wsSend(socket, { type: "joined", roomId: socket.roomId, roomIdStr: String(socket.roomId) });
      return;
    }
    if (data && data.type === "leave") {
      console.log("ws_leave", { roomId: socket.roomId || null, openId: socket.openId || null, ts: Date.now() });
      delete socket.roomId;
      console.log("ws_downlink", { type: "left", roomId: socket.roomId || null, ts: Date.now() });
      wsSend(socket, { type: "left" });
      return;
    }
    // Room chat relay (server-side broadcast to room members)
    // 房间聊天转发（服务端向房间成员广播）
    if (data && data.type === "say" && data.roomId && data.payload) {
      const target = String(data.roomId);
      wsBroadcast({ type: "message", payload: data.payload }, target);
      return;
    }
    // Start live data push tasks for selected msg types via SDK
    // 通过 SDK 启动指定消息类型的直播数据推送任务
    if (data && data.type === "startgame") {
      (async () => {
        const roomId = String(data.roomId || socket.roomId || "");
        const appid = process.env.DOUYIN_APP_ID;
        if (!roomId || !appid) {
          wsSend(socket, { type: "startgame_failed", reason: !roomId ? "missing roomId" : "missing appid" });
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
        wsSend(socket, { type: "startgame_ok", roomId, results });
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
        let roundId = Number(roundIdRaw);
        const startTime = Number(startTimeRaw || Math.floor(Date.now() / 1000));
        const appid = process.env.DOUYIN_APP_ID;
        const anchorOpenId = socket.openId ? String(socket.openId) : undefined;
        if (!roomId || !appid || !startTime) {
          wsSend(socket, { type: "startRound_failed", reason: !roomId ? "missing roomId" : (!startTime ? "missing startTime" : "missing appid") });
          return;
        }
        if (!roundId || Number.isNaN(roundId) || roundId <= 0) {
          const prev = CURRENT_ROUND.get(String(roomId)) || 0;
          roundId = Number(prev) + 1 || 1;
        }
        const res = await roundSyncStatusStart({ appid, roomId, roundId, startTime, anchorOpenId });
        try { CURRENT_ROUND.set(String(roomId), Number(roundId)); } catch (_) {}
        console.log("ws_startRound", { roomId, roundId, startTime, ts: Date.now() });
        wsSend(socket, { type: "startRound_ok", roomId, roundId, body: res });
      })();
      return;
    }
    // Finish round: parse identifiers and timing
    // 回合结束：解析房间、对局与结算时间
    if (data && data.type === "finishRound") {
      (async () => {
        const roomId = String(data.roomId || socket.roomId || "");
        const roundIdRaw = data.roundId !== undefined ? data.roundId : data.RoundId;
        let roundId = Number(roundIdRaw || (CURRENT_ROUND.get(String(roomId)) || 0));
        const appid = process.env.DOUYIN_APP_ID;
        const anchorOpenId = socket.openId ? String(socket.openId) : undefined;
        const endTime = Math.floor(Date.now() / 1000);

        // Prefer client-provided group results
        // 优先使用客户端传入的分组胜负结果
        const inputGroupResults = Array.isArray(data.groupResults) ? data.groupResults : (Array.isArray(data.group_result_list) ? data.group_result_list : (Array.isArray(data.groupResultList) ? data.groupResultList : null));
        const groupResultList = (inputGroupResults || []).map((item) => {
          const gid = item.groupId !== undefined ? item.groupId : item.group_id;
          let res = item.result;
          if (typeof res === "string") {
            const r = res.trim().toLowerCase();
            res = (
              r === "unknown" ? 0 :
              (r === "victory" || r === "win") ? 1 :
              (r === "fail" || r === "lose") ? 2 :
              (r === "tie" || r === "draw") ? 3 : 0
            );
          }
          if (res !== 0 && res !== 1 && res !== 2 && res !== 3) res = 0;
          return { groupId: String(gid), result: Number(res) };
        });
        

        // Validate required fields
        // 校验必填参数
        if (!roomId || !appid) {
          wsSend(socket, { type: "finishRound_failed", reason: !roomId ? "missing roomId" : "missing appid" });
          return;
        }
        if (!roundId || Number.isNaN(roundId) || roundId <= 0) {
          const prev = CURRENT_ROUND.get(String(roomId)) || 0;
          roundId = prev ? Number(prev) : 1;
        }

        // Report round end status to Douyin via SDK
        // 通过 SDK 上报对局结束状态到抖音服务器
        const res = await roundSyncStatusEnd({ appid, roomId, roundId, endTime, groupResultList, anchorOpenId });

        // Update user stats based on participants' results
        // 根据参与用户的输赢与积分，更新用户积分与连胜
        const users = Array.isArray(data.users) ? data.users : [];
        for (const u of users) {
          const oid = String(u.openId || u.userOpenId || "");
          const pts = Number(u.addPoints || u.points || 0);
          const isWin = u.isWin === true ? true : (u.isWin === false ? false : null);
          if (oid) await updateUserStats(oid, pts, isWin);
        }

        // Build per-user round result payload and upload to Douyin ranking
        // 构建本局用户结果并上报到抖音排行榜
        try {
          const ranked = [...users].map((u) => ({
            openId: String(u.openId || u.userOpenId || ""),
            score: Number(u.addPoints || u.points || 0),
            // isWin: !!(u.isWin || (winner && typeof u.groupId === "string" && String(u.groupId).trim().toLowerCase() === w))
            isWin: Number(u.isWin || 0)
          })).filter((x) => x.openId);
          ranked.sort((a, b) => b.score - a.score);
          const cur_in_mysql = await selectUserCoreStats(oid);
          const withRank = ranked.map((x, idx) => ({
            openId: x.openId,
            roundResult: x.isWin === true ? 1 : (x.isWin === false ? 2 : 0),
            score: x.score,
            rank: idx + 1,
            // winningStreakCount: (USER_CORE_STATS.get(x.openId) && USER_CORE_STATS.get(x.openId).streak) || 0,
            winningStreakCount: (cur_in_mysql && cur_in_mysql.length > 0 ? cur_in_mysql[0].streak : 0) || 0,
            winningPoints: ""
          }));
          if (withRank.length > 0) {
            await roundUploadUserResultBatch({ appid, roomId, roundId, anchorOpenId, userList: withRank });
            await roundUploadRankList({ appid, roomId, roundId, anchorOpenId, rankList: withRank.slice(0, 150) });
            await roundCompleteUploadUserResult({ appid, roomId, roundId, anchorOpenId, completeTime: Math.floor(Date.now() / 1000) });
          }
        } catch (_) {}

        // Clear current round state and respond
        // 清理当前对局状态并返回结果
        try { CURRENT_ROUND.delete(String(roomId)); } catch (_) {}
        console.log("ws_finishRound", { roomId, roundId/*, winner: winner || null*/, ts: Date.now() });
        wsSend(socket, { type: "finishRound_ok", roomId, roundId, body: res });
      })();
      return;
    }
  wsBroadcast(text);
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
        console.log("current_round_dump", { size: CURRENT_ROUND ? CURRENT_ROUND.size : 0, entries: Array.from(CURRENT_ROUND.entries()), ts: Date.now() });
        console.log("live_data_round_cursor", { roomId: ridStr, roundId, ts: Date.now() });
        if (roundId) {
          const arr = Array.isArray(body) ? body : (Array.isArray(body.data) ? body.data : null);
          const item = arr && arr[0] ? arr[0] : null;
          const openId = item && item.sec_openid ? String(item.sec_openid) : null;
          const content = item && item.content !== undefined ? String(item.content) : null;
          const gid = groupIdFromMessage(content);
          console.log("live_comment_gid_parse", { roomId: ridStr, roundId, openId, content, gid, ts: Date.now() });
          if (openId && gid) {
            const r = recordUserGroup(appid, openId, ridStr, roundId, gid);
            if (r && r.err_no !== 0) {
              console.log("group_record_error", { roomId: ridStr, roundId, openId, gid, body: r, ts: Date.now() });
            } else {
              console.log("group_record_ok", { roomId: ridStr, roundId, openId, gid, ts: Date.now() });
              if (ridStr !== DEBUG_ROOMID){
                const up = await uploadUserGroupInfo({ appid, openId, roomId: ridStr, roundId, groupId: gid });
                if (up && (up.errcode === 0 || up.err_no === 0)) console.log("group_upload_ok", { roomId: ridStr, roundId, openId, gid, ts: Date.now() });
                else console.log("group_upload_error", { roomId: ridStr, roundId, openId, gid, body: up, ts: Date.now() });
              }else{
                console.log("group_upload_skip", { roomId: ridStr, roundId, openId, gid, ts: Date.now() });
              }
              //下发一个事件，加入分组
              const msg = { type: "live_data", room_id: roomId, round_id: roundId, msg_type:"group_push", group_id: gid, open_id: openId, data: body, ts: Date.now() };
              // console.log("ws_broadcast", { message: msg, ts: Date.now() });
              wsBroadcast(msg, roomId);
            }
          }
        }
      }
    } catch (_) {}
    const ridStr = roomId ? String(roomId) : null;
    let roundIdForPayload = 0;
    if (ridStr) roundIdForPayload = (CURRENT_ROUND && CURRENT_ROUND.get(ridStr)) ? Number(CURRENT_ROUND.get(ridStr)) : 0;
    const arr = Array.isArray(body) ? body : (Array.isArray(body.data) ? body.data : null);
    const item = arr && arr[0] ? arr[0] : null;
    const openIdPayload = item && (item.sec_openid || item.open_id) ? String(item.sec_openid || item.open_id) : null;
    const appidForPayload = process.env.DOUYIN_APP_ID || "";
    const gidRes = getUserGroupId(appidForPayload, openIdPayload || "", ridStr || "", roundIdForPayload || 0);
    const groupIdPayload = gidRes && gidRes.group_id ? gidRes.group_id : null;
    const payload = { type: "live_data", room_id: ridStr, round_id: roundIdForPayload, group_id: groupIdPayload, open_id: openIdPayload || null, msg_type: headerMsgType || null, msg_id: item && item.msg_id || null, nickname: item && item.nickname || null, avatar_url: item && item.avatar_url || null, message_ts: item && item.timestamp || null, data: body, ts: Date.now() };
    if (roomId) {
      wsBroadcast(payload, roomId);
    } else {
      wsBroadcast(payload);
    }
    return res.status(200).json({ err_no: 0, err_msg: "success", data: "" });
  } catch (e) {
    return res.status(500).json({ err_no: -1, err_msg: "internal error", data: null });
  }
});

// Audience camp selection push (developer endpoint)
// 观众选择阵营推送（开发者提供接口）：记录并返回最终分组
// 注意！！！！这里采用抖音给的分组，如果有冲突，以抖音的分组为准
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/audience-camp-dev
app.post("/api/user_group/push", async (req, res) => {
  try {
    const hMsgType = req.headers["x-msg-type"] ? String(req.headers["x-msg-type"]) : null;
    console.log("user_group_push_in", {
      msgType: hMsgType || null,
      headersRoomId: req.headers["x-roomid"] ? String(req.headers["x-roomid"]) : null,
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      ts: Date.now()
    });
    if (hMsgType && hMsgType !== "user_group_push") {
      console.log("user_group_push_invalid_msgtype", { msgType: hMsgType, ts: Date.now() });
      return res.status(200).json({ errcode: 40001, errmsg: "invalid msg type" });
    }
    const appid = req.body && req.body.app_id ? String(req.body.app_id) : "";
    const openId = req.body && req.body.open_id ? String(req.body.open_id) : "";
    const roomId = (req.body && req.body.room_id ? String(req.body.room_id) : (req.headers["x-roomid"] ? String(req.headers["x-roomid"]) : ""));
    const requestedGroup = req.body && req.body.group_id ? String(req.body.group_id) : "";
    if (!appid || !openId || !roomId || !requestedGroup) {
      console.log("user_group_push_invalid_params", { appidOk: !!appid, openIdOk: !!openId, roomIdOk: !!roomId, groupOk: !!requestedGroup, ts: Date.now() });
      return res.status(200).json({ errcode: 40001, errmsg: "invalid params" });
    }
    console.log("user_group_push_parsed", { appid, openId, roomId, requestedGroup, ts: Date.now() });
    const roundId = (CURRENT_ROUND && CURRENT_ROUND.get(String(roomId))) ? Number(CURRENT_ROUND.get(String(roomId))) : 0;
    const key = makeUserRoundKey(appid, openId, roomId, roundId);
    const prev = USER_ROUND_GROUP.get(key);
    let finalGroup = requestedGroup;
    if (prev && prev !== requestedGroup) {
      finalGroup = requestedGroup;
      USER_ROUND_GROUP.set(key, finalGroup);
      console.log("user_group_overwrite", { roomId, roundId, openId, requested: requestedGroup, prev, ts: Date.now() });
    } else {
      USER_ROUND_GROUP.set(key, finalGroup);
      console.log("user_group_set", { roomId, roundId, openId, groupId: finalGroup, ts: Date.now() });
    }
    const status = roundId ? 1 : 2;
    console.log("user_group_push_out", { roomId, roundId, status, finalGroup, ts: Date.now() });
    try {
      //const msg = { type: "group_push", room_id: roomId, round_id: roundId, group_id: finalGroup, open_id: openId, data: req.body || {}, ts: Date.now() };
      const msg = { type: "live_data", room_id: roomId, round_id: roundId, msg_type:"group_push", group_id: finalGroup, open_id: openId, data: req.body || {}, ts: Date.now() };
      wsBroadcast(msg, roomId);
      console.log("ws_group_push_broadcast", { roomId, roundId, groupId: finalGroup, openId, ts: Date.now() });
    } catch (e) {
      console.log("ws_group_push_broadcast_error", { err: String(e && e.message || e), ts: Date.now() });
    }
    return res.status(200).json({ errcode: 0, errmsg: "success", data: { round_id: roundId, round_status: status, group_id: finalGroup } });
  } catch (e) {
    console.log("user_group_push_error", { err: String(e && e.message || e), ts: Date.now() });
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
    console.log("user_group_query_in", {
      msgType: hMsgType || null,
      headersRoomId: req.headers["x-roomid"] ? String(req.headers["x-roomid"]) : null,
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      ts: Date.now()
    });
    if (!verifySignature(req, rawBodyStr, secret)) {
      console.log("user_group_query_sig_error", { ts: Date.now() });
      return res.status(200).json({ errcode: 40004, errmsg: "invalid signature" });
    }
    const appid = req.body && req.body.app_id ? String(req.body.app_id) : "";
    const openId = req.body && req.body.open_id ? String(req.body.open_id) : "";
    const roomId = req.body && req.body.room_id ? String(req.body.room_id) : "";
    if (!appid || !openId || !roomId) {
      console.log("user_group_query_invalid_params", { appidOk: !!appid, openIdOk: !!openId, roomIdOk: !!roomId, ts: Date.now() });
      return res.status(200).json({ errcode: 40001, errmsg: "invalid params" });
    }
    console.log("user_group_query_parsed", { appid, openId, roomId, ts: Date.now() });
    let roundId = CURRENT_ROUND && CURRENT_ROUND.get(String(roomId)) ? Number(CURRENT_ROUND.get(String(roomId))) : 0;
    let roundStatus = roundId ? 1 : 2;
    if (!roundId) {
      const latest = findLatestRoundId(appid, openId, roomId);
      if (latest) { roundId = latest; roundStatus = 2; }
    }
    console.log("user_group_query_round", { roundId, roundStatus, ts: Date.now() });
    const key = makeUserRoundKey(appid, openId, roomId, roundId);
    const gid = USER_ROUND_GROUP.get(key) || "";
    const userGroupStatus = gid ? 1 : 0;
    console.log("user_group_query_gid", { key, gid, userGroupStatus, ts: Date.now() });
    return res.status(200).json({ errcode: 0, errmsg: "success", data: { round_id: roundId, round_status: roundStatus, user_group_status: userGroupStatus, group_id: gid } });
  } catch (e) {
    console.log("user_group_query_error", { err: String(e && e.message || e), ts: Date.now() });
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
  if (!SdkClient) { console.log("sdk_client_unavailable", { reason: "missing SdkClient export", ts: Date.now() }); return null; }
  if (openApiClient) return openApiClient;
  const appid = process.env.DOUYIN_APP_ID;
  const secret = process.env.DOUYIN_APP_SECRET;
  if (!appid || !secret) { console.log("sdk_client_env_missing", { appid: !!appid, secret: !!secret, ts: Date.now() }); return null; }
  try { openApiClient = new SdkClient({ clientKey: appid, clientSecret: secret }); } catch (e) { openApiClient = null; console.log("sdk_client_init_error", { err: String(e && e.message || e), ts: Date.now() }); }
  return openApiClient;
}

// Acquire and cache access_token (xToken), with early refresh near expiry
// 获取并缓存 access_token（xToken），在临近过期时提前刷新
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/interface-request-credential/get-access-token
async function fetchAccessToken(force = false) {
  const now = Date.now();
  if (!force && ACCESS_TOKEN && ACCESS_TOKEN_EXPIRES_AT - now > 60_000) {
    try {
      console.log("access_token_cache_hit", {
        tokenLen: ACCESS_TOKEN ? String(ACCESS_TOKEN).length : 0,
        expires_at: ACCESS_TOKEN_EXPIRES_AT,
        expires_at_iso: new Date(ACCESS_TOKEN_EXPIRES_AT).toISOString(),
        ms_left: ACCESS_TOKEN_EXPIRES_AT - now,
        ts: Date.now()
      });
    } catch (_) {}
    return { access_token: ACCESS_TOKEN, expires_at: ACCESS_TOKEN_EXPIRES_AT };
  }
  const appid = process.env.DOUYIN_APP_ID;
  const secret = process.env.DOUYIN_APP_SECRET;
  if (!appid || !secret) {
    return { err_no: 40020, err_tips: "missing appid or secret", data: null };
  }
  const tokenUrl = 'https://developer.toutiao.com/api/apps/v2/token';
  let httpTokenRes = null;
  try {
    console.log("http_get_token_start", { ts: Date.now(), url: tokenUrl });
    const payload = { appid: String(appid), secret: String(secret), grant_type: 'client_credential' };
    const resp = await fetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    httpTokenRes = await resp.json();
  } catch (e) {
    httpTokenRes = { err_no: -1, err_tips: String(e && e.message || e) };
    console.log("http_get_token_error", { err: String(e && e.message || e), ts: Date.now() });
  }
  const accessToken = httpTokenRes && httpTokenRes.data && httpTokenRes.data.access_token;
  const expiresIn = httpTokenRes && httpTokenRes.data && httpTokenRes.data.expires_in;
  const httpExpAt = expiresIn ? (Date.now() + Number(expiresIn) * 1000) : null;
  const preview = (s) => (typeof s === 'string' && s.length > 16) ? (s.slice(0,8) + '...' + s.slice(-8)) : (s || '');
  console.log('http_get_token_result', {
    err_no: (httpTokenRes && httpTokenRes.err_no) || null,
    err_tips: (httpTokenRes && httpTokenRes.err_tips) || null,
    access_token_preview: preview(accessToken),
    expires_in: expiresIn || null,
    expires_at: httpExpAt || null,
    expires_at_iso: httpExpAt ? new Date(httpExpAt).toISOString() : null,
    ts: Date.now()
  });
  if (!accessToken) return httpTokenRes || { err_no: 40020, err_tips: "access_token unavailable", data: null };
  ACCESS_TOKEN = accessToken;
  const ttl = (expiresIn || 7200) * 1000;
  ACCESS_TOKEN_EXPIRES_AT = Date.now() + Math.max(ttl - 300_000, 60_000);
  try {
    const realExp = Date.now() + ttl;
    const s = String(ACCESS_TOKEN || "");
    const preview = s.length > 16 ? (s.slice(0, 8) + "..." + s.slice(-8)) : s;
    console.log("access_token_set", {
      tokenPreview: preview,
      expires_in: expiresIn || 7200,
      real_expires_at: realExp,
      real_expires_at_iso: new Date(realExp).toISOString(),
      virtual_expires_at: ACCESS_TOKEN_EXPIRES_AT,
      virtual_expires_at_iso: new Date(ACCESS_TOKEN_EXPIRES_AT).toISOString(),
      ts: Date.now()
    });
  } catch (_) {}
  return { access_token: ACCESS_TOKEN, expires_at: ACCESS_TOKEN_EXPIRES_AT };
}

// SDK-only live info fetch using WebcastmateInfoRequest; supports override xToken and token-based join flow
// 仅使用 SDK（WebcastmateInfoRequest）获取直播信息；支持覆盖 xToken 与基于 token 的加入流程
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/live-info
async function fetchLiveInfoByToken(token, overrideXToken) {
  try {
    let xt = overrideXToken;
    if (!xt) {
      const at = await fetchAccessToken(true);
      xt = at && at.access_token ? at.access_token : null;
      if (!xt) return at || { err_no: 40020, err_tips: "access_token unavailable", data: null };
    }
    const url = 'https://webcast.bytedance.com/api/webcastmate/info';
    const payload = { token: String(token) };
    const headers = { 'content-type': 'application/json', 'x-token': String(xt) };
    console.log("http_webcastmateInfo_call", { url, hasXToken: !!xt, xTokenLen: String(xt).length, ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const raw = await resp.text();
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = { err_no: -1, err_tips: "invalid json", raw }; }
    try {
      const info = body && body.data && body.data.info;
      const m = raw && raw.match(/"room_id"\s*:\s*"?(\d+)"?/);
      if (info) {
        if (m) { info.room_id_str = m[1]; info.roomId = m[1]; }
        else if (info.roomId !== undefined && info.roomId !== null) { const asStr = typeof info.roomId === "string" ? info.roomId : String(info.roomId); info.room_id_str = asStr; info.roomId = asStr; }
        else if (info.room_id !== undefined && info.room_id !== null) { const asStr = typeof info.room_id === "string" ? info.room_id : String(info.room_id); info.room_id_str = asStr; info.roomId = asStr; }
      }
    } catch (_) {}
    console.log("http_webcastmateInfo_res", { body, ts: Date.now() });
    return body;
  } catch (e) {
    const dbg = process.env.DEBUG_ROOM_ID || process.env.DEBUG_ROOMID || process.env.DEBUG_ROOM_ID_STR || null;
    if (dbg) {
      const ridStr = String(dbg);
      console.log("http_webcastmateInfo_error", { err_tips: String(e && e.message || e), fallback_room_id: ridStr, ts: Date.now() });
      return { errcode: 0, errmsg: "debug_room", data: { info: { room_id_str: ridStr, room_id: ridStr } } };
    }
    console.log("http_webcastmateInfo_error", { err_tips: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_tips: String(e && e.message || e), data: null };
  }
}

// SDK-only live data task start; strictly call taskStart per official docs
// 仅使用 SDK 启动直播数据任务；严格调用 taskStart 方法
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/data-open/start-task
async function startLiveDataTask(appid, roomid, msgType) {
  try {
    const at = await fetchAccessToken(false);
    let xToken = at && at.access_token ? at.access_token : null;
    if (!xToken) {
      const at2 = await fetchAccessToken(true);
      if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
      xToken = at2.access_token;
    }
    const url = 'https://webcast.bytedance.com/api/live_data/task/start';
    const headers = { 'content-type': 'application/json', 'access-token': String(xToken) };
    const payload = { appid: String(appid), msg_type: String(msgType), roomid: String(roomid) };
    console.log('http_task_start_call', { url, appid: String(appid), roomid: String(roomid), msg_type: String(msgType), ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = await resp.json();
    console.log('http_task_start_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_task_start_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

// SDK-only round status sync (start): status=1, optional anchorOpenId, inject xToken
// 仅使用 SDK 同步对局开始状态：status=1，可选主播 openId，自动注入 xToken
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/sync-game-state
async function roundSyncStatusStart({ appid, roomId, roundId, startTime, anchorOpenId }) {
  try {
    const at = await fetchAccessToken(false);
    let xToken = at && at.access_token ? at.access_token : null;
    if (!xToken) {
      const at2 = await fetchAccessToken(true);
      if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
      xToken = at2.access_token;
    }
    const url = 'https://webcast.bytedance.com/api/gaming_con/round/sync_status';
    const headers = { 'content-type': 'application/json', 'x-token': String(xToken) };
    const payload = { app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), start_time: Number(startTime), status: 1 };
    if (anchorOpenId) payload.anchor_open_id = String(anchorOpenId);
    console.log('http_round_sync_start_call', { url, app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), start_time: Number(startTime), status: 1, ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const raw = await resp.text();
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = { err_no: -1, err_msg: 'invalid json', raw }; }
    console.log('http_round_sync_start_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_round_sync_start_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

// Round status sync (end)
// 对局结束状态同步
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/sync-game-state
async function roundSyncStatusEnd({ appid, roomId, roundId, endTime, groupResultList, anchorOpenId }) {
  try {
    const at = await fetchAccessToken(false);
    let xToken = at && at.access_token ? at.access_token : null;
    if (!xToken) {
      const at2 = await fetchAccessToken(true);
      if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
      xToken = at2.access_token;
    }
    const url = 'https://webcast.bytedance.com/api/gaming_con/round/sync_status';
    const headers = { 'content-type': 'application/json', 'x-token': String(xToken) };
    const list = Array.isArray(groupResultList) ? groupResultList.map((it) => ({ group_id: String(it.groupId !== undefined ? it.groupId : it.group_id), result: Number(it.result !== undefined ? it.result : 0) })) : [];
    const payload = { app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), end_time: Number(endTime), status: 2, group_result_list: list };
    if (anchorOpenId) payload.anchor_open_id = String(anchorOpenId);
    console.log('http_round_sync_end_call', { url, app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), end_time: Number(endTime), status: 2, group_count: list.length, ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const raw = await resp.text();
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = { err_no: -1, err_msg: 'invalid json', raw }; }
    console.log('http_round_sync_end_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_round_sync_end_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

// Upload per-user round result list (batched by 50)
// 上报本局用户的结果列表（按 50 条分批）
async function roundUploadUserResultBatch({ appid, roomId, roundId, anchorOpenId, userList }) {
  const CHUNK = 50;
  for (let i = 0; i < userList.length; i += CHUNK) {
    const slice = userList.slice(i, i + CHUNK);
    await roundUploadUserResult({ appid, roomId, roundId, anchorOpenId, userList: slice });
  }
}

// Upload per-user round result via SDK
// 通过 SDK 上报用户的对局结果
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-scores-rank/user-data-report
async function roundUploadUserResult({ appid, roomId, roundId, anchorOpenId, userList }) {
  try {
    const at = await fetchAccessToken(false);
    let xToken = at && at.access_token ? at.access_token : null;
    if (!xToken) {
      const at2 = await fetchAccessToken(true);
      if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
      xToken = at2.access_token;
    }
    const url = 'https://webcast.bytedance.com/api/gaming_con/round/upload_user_result';
    const headers = { 'content-type': 'application/json', 'x-token': String(xToken) };
    const list = Array.isArray(userList) ? userList.map((u) => ({
      open_id: String(u.openId || u.userOpenId || ''),
      round_result: Number(u.roundResult !== undefined ? u.roundResult : (u.isWin === true ? 1 : (u.isWin === false ? 2 : 0))),
      score: Number(u.score || 0),
      rank: Number(u.rank || 0),
      winning_streak_count: Number(u.winningStreakCount || 0),
      winning_points: String(u.winningPoints || '')
    })).filter((x) => x.open_id) : [];
    const payload = { app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), user_list: list };
    if (anchorOpenId) payload.anchor_open_id = String(anchorOpenId);
    console.log('http_round_upload_user_result_call', { url, app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), count: list.length, ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const raw = await resp.text();
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = { err_no: -1, err_msg: 'invalid json', raw }; }
    console.log('http_round_upload_user_result_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_round_upload_user_result_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

// Upload round rank list (Top N up to 150) after round ends
// 在回合结束后上报榜单列表（最多 Top150）
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-scores-rank/game-list-report
async function roundUploadRankList({ appid, roomId, roundId, anchorOpenId, rankList }) {
  try {
    const at = await fetchAccessToken(false);
    let xToken = at && at.access_token ? at.access_token : null;
    if (!xToken) {
      const at2 = await fetchAccessToken(true);
      if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
      xToken = at2.access_token;
    }
    const url = 'https://webcast.bytedance.com/api/gaming_con/round/upload_rank_list';
    const headers = { 'content-type': 'application/json', 'x-token': String(xToken) };
    const list = Array.isArray(rankList) ? rankList.map((x) => ({
      open_id: String(x.openId || x.userOpenId || ''),
      score: Number(x.score || 0),
      rank: Number(x.rank || 0)
    })).filter((u) => u.open_id) : [];
    const payload = { app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), rank_list: list };
    if (anchorOpenId) payload.anchor_open_id = String(anchorOpenId);
    console.log('http_round_upload_rank_list_call', { url, app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), count: list.length, ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const raw = await resp.text();
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = { err_no: -1, err_msg: 'invalid json', raw }; }
    console.log('http_round_upload_rank_list_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_round_upload_rank_list_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

// Mark completion of user result upload for current round
// 标记本局用户对局数据上报完成
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-scores-rank/finish-user-data-report
async function roundCompleteUploadUserResult({ appid, roomId, roundId, anchorOpenId, completeTime }) {
  try {
    const at = await fetchAccessToken(false);
    let xToken = at && at.access_token ? at.access_token : null;
    if (!xToken) {
      const at2 = await fetchAccessToken(true);
      if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
      xToken = at2.access_token;
    }
    const url = 'https://webcast.bytedance.com/api/gaming_con/round/complete_upload_user_result';
    const headers = { 'content-type': 'application/json', 'x-token': String(xToken) };
    const payload = { app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), complete_time: Number(completeTime) };
    if (anchorOpenId) payload.anchor_open_id = String(anchorOpenId);
    console.log('http_round_complete_upload_call', { url, app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), complete_time: Number(completeTime), ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const raw = await resp.text();
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = { err_no: -1, err_msg: 'invalid json', raw }; }
    console.log('http_round_complete_upload_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_round_complete_upload_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

// Upload user group info to Douyin server after group assignment
// 将用户分组结果上报抖音服务器
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-team-select/report-camp-data
async function uploadUserGroupInfo({ appid, openId, roomId, roundId, groupId }) {
  try {
    const at = await fetchAccessToken(false);
    let xToken = at && at.access_token ? at.access_token : null;
    if (!xToken) {
      const at2 = await fetchAccessToken(true);
      if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
      xToken = at2.access_token;
    }
    const url = 'https://webcast.bytedance.com/api/gaming_con/round/upload_user_group_info';
    const headers = { 'content-type': 'application/json', 'x-token': String(xToken) };
    const payload = { app_id: String(appid), group_id: String(groupId), open_id: String(openId), room_id: String(roomId), round_id: Number(roundId) };
    console.log('http_upload_user_group_call', { url, app_id: String(appid), room_id: String(roomId), round_id: Number(roundId), group_id: String(groupId), open_id: String(openId), ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const raw = await resp.text();
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = { err_no: -1, err_msg: 'invalid json', raw }; }
    console.log('http_upload_user_group_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_upload_user_group_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
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
  if (roomId !== DEBUG_ROOMID) {
    const prev = USER_ROUND_GROUP.get(key);
    if (prev && prev !== gid) return { err_no: 40002, err_msg: "group conflict", data: { prev, requested: gid } };
  }
  USER_ROUND_GROUP.set(key, gid);
  return { err_no: 0, err_msg: "ok", data: { group_id: gid } };
}

function getUserGroupId(appid, openId, roomId, roundId) {
  const app = String(appid);
  const oid = String(openId);
  const rid = String(roomId);
  let r = roundId !== undefined && roundId !== null ? Number(roundId) : 0;
  if (!r) {
    const cur = CURRENT_ROUND && CURRENT_ROUND.get(rid) ? Number(CURRENT_ROUND.get(rid)) : 0;
    r = cur || findLatestRoundId(app, oid, rid);
  }
  const key = makeUserRoundKey(app, oid, rid, r);
  const gid = USER_ROUND_GROUP.get(key) || "";
  return { group_id: gid, round_id: r };
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

function getSdkMethod(client, lower, upper, alt) {
  let fn = null; let api = null;
  if (client && lower && typeof client[lower] === "function") { fn = client[lower]; api = lower; }
  else if (client && upper && typeof client[upper] === "function") { fn = client[upper]; api = upper; }
  else if (client && alt && typeof client[alt] === "function") { fn = client[alt]; api = alt; }
  return { fn, api };
}

async function callSdkWithToken({ client, lower, upper, alt, buildReq, logCtx }) {
  const { fn, api } = getSdkMethod(client, lower, upper, alt);
  console.log("sdk_call_in", { lower, upper, alt, client_ok: !!client, api_selected: api || null, ts: Date.now() });
  if (!fn) {
    console.log("sdk_method_missing", { lower, upper, alt, ts: Date.now() });
    return { err_no: 40023, err_msg: "sdk_unavailable", data: null };
  }
  try {
    const at = await fetchAccessToken(false);
    const xToken = at && at.access_token ? at.access_token : null;
    const xtStr = xToken ? String(xToken) : "";
    const xtPreview = xtStr.length > 16 ? (xtStr.slice(0,8) + "..." + xtStr.slice(-8)) : xtStr;
    const xtFull = process.env.DEBUG_LOG_XTOKEN === '1';
    console.log("sdk_token", { api, hasToken: !!xToken, tokenLen: xtStr.length, token: xtFull ? xtStr : xtPreview, ts: Date.now() });
    if (!xToken) {
      const at2 = await fetchAccessToken(true);
      if (!at2 || !at2.access_token) return at2 || { err_no: 40020, err_msg: "access_token unavailable", data: null };
      const xt2 = String(at2.access_token);
      const xt2Preview = xt2.length > 16 ? (xt2.slice(0,8) + "..." + xt2.slice(-8)) : xt2;
      console.log("sdk_token_refresh", { api, tokenLen: xt2.length, token: xtFull ? xt2 : xt2Preview, ts: Date.now() });
      const req = buildReq(at2.access_token);
      try { console.log("sdk_request", { api, req, ts: Date.now() }); } catch (_) {}
      const sdkRes = await fn.call(client, req);
      try { console.log("sdk_call_res", { api, body: sdkRes, ts: Date.now() }); } catch (_) {}
      console.log("sdk_call_ok", Object.assign({ api, ts: Date.now() }, logCtx || {}));
      return sdkRes;
    }
    const req = buildReq(xToken);
    try { console.log("sdk_request", { api, req, ts: Date.now() }); } catch (_) {}
    const sdkRes = await fn.call(client, req);
    try { console.log("sdk_call_res", { api, body: sdkRes, ts: Date.now() }); } catch (_) {}
    console.log("sdk_call_ok", Object.assign({ api, ts: Date.now() }, logCtx || {}));
    return sdkRes;
  } catch (e) {
    console.log("sdk_call_error", { api: api, err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

// Global user core stats: points and win-streak per openId
// 全局用户核心数据：按 openId 存储积分与连胜
const USER_CORE_STATS = new Map();
async function selectUserCoreStats(openId) {
  try {
    // 获取连接 + 执行查询（一步到位）
    const [rows, fields] = await pool.execute(
      'SELECT * FROM user_core_stats WHERE open_id = ? ORDER BY points DESC', // SQL 语句
      [String(openId || "")] // 占位符参数（无则传空数组）
    );
    console.log('查询UserCoreStats数据:', rows);
    return rows;
  } catch (err) {
    console.error('查询异常：', err);
    return null;
  }
}
async function updateUserCoreStats(openId, points, streak) {
  try {
    // 获取连接 + 执行查询（一步到位）
    const [rows, fields] = await pool.execute(
      'INSERT INTO user_core_stats (open_id, points, streak) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE points = ?, streak = ?', // SQL 语句
      [String(openId || ""), points, streak, points, streak] // 占位符参数（无则传空数组）
    );
    console.log('更新UserCoreStats数据:', rows);
    return rows;
  } catch (err) {
    console.error('更新异常：', err);
    return null;
  }
}

// Update user's points and streak based on match result
// 根据胜负更新用户积分与连胜
async function updateUserStats(openId, addPoints, isWin) {
  const oid = String(openId || "");
  if (!oid) return { err_no: 40001, err_msg: "invalid openId", data: null };
  const inc = Number(addPoints || 0);
  // const cur = USER_CORE_STATS.get(oid) || { points: 0, streak: 0 };
  const cur_in_mysql = await selectUserCoreStats(oid);
  const cur = cur_in_mysql && cur_in_mysql.length > 0 ? cur_in_mysql[0] : { points: 0, streak: 0 };

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
  // USER_CORE_STATS.set(oid, next);
  await updateUserCoreStats(oid, points, streak);
  return { err_no: 0, err_msg: "ok", data: next };
}
