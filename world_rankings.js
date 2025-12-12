// 世界榜单模块
// World Rankings Module

const http = require('http');
const https = require('https');


async function processWorldRankings() {
    console.log('开始获取世界榜单数据');
    //TODO 
}

// 导出模块方法
module.exports = {
    processWorldRankings
};



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



// curl --location --request POST '/api/gaming_con/world_rank/upload_rank_list' \
// --header 'content-type: application/json' \
// --header 'access-token: 0801121846735352506a356a6' \
// --data '{"rank_list":[{"score":5316598502278640221,"winning_streak_count":2809039452027624321,"rank":3163002412413921291,"open_id":"hziOvucUZH","winning_points":1907238680085811867}],"is_online_version":false,"app_id":"3Ljxxc5msd","world_rank_version":"bYpzFLXqax"}'
// # 此示例仅为模板，请修改为更加符合业务规则的调用示例，方便开发者查看
// 参考文档：https://developer.open-douyin.com/docs/resource/zh-CN/interaction/develop/server/live-room-scope/user-scores-rank/upload-data
async function uploadRankList(accessToken, appid, worldRankVersion, isOnlineVersion, rankList) {
  try {
    const url = 'https://webcast.bytedance.com/api/gaming_con/world_rank/upload_rank_list';
    const headers = { 'content-type': 'application/json', 'access-token': String(accessToken) };
    const payload = { appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), rank_list: Array.isArray(rankList) ? rankList : [] };
    console.log('http_task_start_call', { url, appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), rank_list: Array.isArray(rankList) ? rankList : [], ts: Date.now() });
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
    const payload = { appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), user_list: Array.isArray(userList) ? userList : [] };
    console.log('http_task_start_call', { url, appid: String(appid), world_rank_version: String(worldRankVersion), is_online_version: Boolean(isOnlineVersion), user_list: Array.isArray(userList) ? userList : [], ts: Date.now() });
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = await resp.json();
    console.log('http_upload_user_result_res', { body, ts: Date.now() });
    return body;
  } catch (e) {
    console.log('http_upload_user_result_error', { err: String(e && e.message || e), ts: Date.now() });
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


