// 世界榜单模块
// World Rankings Module

const http = require('http');
const https = require('https');
const mysql = require('mysql2/promise');
// 如果 Node.js 版本低于 18，需要导入 node-fetch
// const fetch = require('node-fetch');

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

// 查询数据库所有按积分从高到底排序后的用户榜单数据
async function queryWorldRankings() {
  try {
    const [results] = await pool.query('SELECT open_id, points, streak FROM user_core_stats ORDER BY points DESC');
    return results;
  } catch (err) {
    console.error('查询用户榜单数据失败:', err);
    throw err;
  }
}

// 处理世界榜单数据
// Process World Rankings
async function processWorldRankings(accessToken,appId) {
    //0. 生成排行榜版本号，格式：vYYYYMMDDHHMMSS
    const worldRankVersion = `v${Date.now()}`;
    console.log('开始处理世界榜单数据',worldRankVersion,appId,accessToken);

    if (!accessToken || !appId) {
      console.error('accessToken or appId is missing');
      return;
    }
    let isOnlineVersion = false;    //TODO如何确定线上表单
    const completeTime = Math.floor(Date.now() / 1000);

    //1. 调用setWorldRankVersion方法设置当前生效的世界榜单版本
    await setWorldRankVersion(accessToken, appId, worldRankVersion, isOnlineVersion);

    //2.从数据库获取所有按积分从高到底排序后的用户榜单数据
    const worldRankings = await queryWorldRankings();
    const formattedUserList = worldRankings.map((user, index) => ({
        open_id: user.open_id,
        score: user.points,
        winning_streak_count: user.streak,
        rank: index + 1,
        winning_points: user.points
    }));

    //3.调用uploadUserResult(上报用户世界榜单的累计战绩)接口上报用户世界榜单数据,分批次上报，每批次上报50个，直到所有数据都上报完成
    for (let i = 0; i < formattedUserList.length; i += 50) {
      const batch = formattedUserList.slice(i, i + 50);
      await uploadUserResult(accessToken, appId, worldRankVersion, isOnlineVersion, batch);
    }

    //4.取formattedUserList前150名，并调用uploadRankList(上传世界榜单列表数据)上报前150名用户的世界榜单数据
    const top150 = formattedUserList.slice(0, 150);
    await uploadRankList(accessToken, appId, worldRankVersion, isOnlineVersion, top150, completeTime);

    //5. 调用completeUploadUserResult方法完成用户世界榜单的累计战绩上报
    await completeUploadUserResult(accessToken, appId, worldRankVersion, isOnlineVersion, completeTime);
}

// 导出模块方法
module.exports = {
    processWorldRankings
};


// 设置当前生效的世界榜单版本
// curl --location --request POST '/api/gaming_con/world_rank/set_valid_version' \
// --header 'content-type: application/json' \
// --header 'access-token: 0801121846735352506a356a6' \
// --data '{"world_rank_version":"V0kCvQVqOP","is_online_version":false,"app_id":"bXEjvgFISZ"}'
// # 此示例仅为模板，请修改为更加符合业务规则的调用示例，方便开发者查看
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-scores-rank/world-list-version
async function setWorldRankVersion(accessToken, appid, worldRankVersion, isOnlineVersion) {
  try {
    const url = 'https://webcast.bytedance.com/api/gaming_con/world_rank/set_valid_version';
    const headers = { 'content-type': 'application/json', 'access-token': String(accessToken) };
    const payload = { appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion) };
    console.log('http_task_start_call', { url, appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = await resp.json();
    console.log('http_set_world_rank_version_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_set_world_rank_version_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

// 完成用户世界榜单的累计战绩上报
// curl --location --request POST '/api/gaming_con/world_rank/complete_upload_user_result' \
// --header 'content-type: application/json' \
// --header 'access-token: 0801121846735352506a356a6' \
// --data '{"is_online_version":false,"complete_time":2519234890606564341,"app_id":"8Gipc1Cao8","world_rank_version":"rrVxpkURmX"}'
// # 此示例仅为模板，请修改为更加符合业务规则的调用示例，方便开发者查看
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-scores-rank/user-world-record
async function completeUploadUserResult(accessToken, appid, worldRankVersion, isOnlineVersion, completeTime) {
  try {
    const url = 'https://webcast.bytedance.com/api/gaming_con/world_rank/complete_upload_user_result';
    const headers = { 'content-type': 'application/json', 'access-token': String(accessToken) };
    const payload = { appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), complete_time: Number(completeTime) };
    console.log('http_task_start_call', { url, appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), complete_time: Number(completeTime), ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = await resp.json();
    console.log('http_complete_upload_user_result_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_complete_upload_user_result_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}


// 上传世界榜单列表数据
// curl --location --request POST '/api/gaming_con/world_rank/upload_rank_list' \
// --header 'content-type: application/json' \
// --header 'access-token: 0801121846735352506a356a6' \
// --data '{"rank_list":[{"score":5316598502278640221,"winning_streak_count":2809039452027624321,"rank":3163002412413921291,"open_id":"hziOvucUZH","winning_points":1907238680085811867}],"is_online_version":false,"app_id":"3Ljxxc5msd","world_rank_version":"bYpzFLXqax"}'
// # 此示例仅为模板，请修改为更加符合业务规则的调用示例，方便开发者查看
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-scores-rank/upload-data
async function uploadRankList(accessToken, appid, worldRankVersion, isOnlineVersion, rankList ,completeTime) {
  try {
    const url = 'https://webcast.bytedance.com/api/gaming_con/world_rank/upload_rank_list';
    const headers = { 'content-type': 'application/json', 'access-token': String(accessToken) };
    const payload = { appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), rank_list: rankList };
    console.log('http_task_start_call', { url, appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), rank_list: rankList, ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = await resp.json();
    console.log('http_upload_rank_list_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_upload_rank_list_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}


//上报用户世界榜单的累计战绩
// curl --location --request POST '/api/gaming_con/world_rank/upload_user_result' \
// --header 'content-type: application/json' \
// --header 'access-token: 0801121846735352506a356a6' \
// --data '{"app_id":"QRhD1ibbRl","world_rank_version":"KNlBRbZOxd","user_list":[{"winning_streak_count":1363705477050438810,"rank":4241213472403767291,"open_id":"kDxaG64OzK","winning_points":8677470803433107307,"score":3388699603875155063}],"is_online_version":false}'
// # 此示例仅为模板，请修改为更加符合业务规则的调用示例，方便开发者查看
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-scores-rank/user-world-scores
async function uploadUserResult(accessToken, appid, worldRankVersion, isOnlineVersion, userList) {
  try {
    const url = 'https://webcast.bytedance.com/api/gaming_con/world_rank/upload_user_result';
    const headers = { 'content-type': 'application/json', 'access-token': String(accessToken) };
    const payload = { appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), user_list: userList };
    console.log('http_task_start_call', { url, appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), user_list: userList, ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = await resp.json();
    console.log('http_upload_user_result_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_upload_user_result_error', { err: String(e && e.message || e), ts: Date.now() });
    return { err_no: -1, err_msg: String(e && e.message || e), data: null };
  }
}

