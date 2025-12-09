#!/usr/bin/env node
const OpenApiSdk = require('@open-dy/open_api_sdk');
const CredentialClient = require('@open-dy/open_api_credential');

async function main() {
  const [clientKey, clientSecret, appId, roomId, roundId, anchorOpenId] = process.argv.slice(2);
  if (!clientKey || !clientSecret || !appId || !roomId || !roundId) {
    console.log('usage: node scripts/test_sdk_round_upload.js <clientKey> <clientSecret> <appId> <roomId> <roundId> [anchorOpenId]');
    process.exit(1);
  }
  const cred = new CredentialClient({ clientKey, clientSecret });
  const { accessToken } = await cred.getClientToken();
  const Client = OpenApiSdk.default || OpenApiSdk;
  const sdk = new Client({ clientKey, clientSecret });
  const RoundUploadUserResultRequest = OpenApiSdk.RoundUploadUserResultRequest;
  const RoundUploadRankListRequest = OpenApiSdk.RoundUploadRankListRequest;
  const RoundCompleteUploadUserResultRequest = OpenApiSdk.RoundCompleteUploadUserResultRequest;

  const users = [
    { openId: 'user_a', roundResult: 1, score: 10, rank: 1, winningStreakCount: 2, winningPoints: '' },
    { openId: 'user_b', roundResult: 2, score: 6, rank: 2, winningStreakCount: 0, winningPoints: '' },
  ];
  const rankList = users.slice(0, 150);

  const reqUser = new RoundUploadUserResultRequest({ appId, roomId, roundId: Number(roundId), xToken: accessToken, userList: users, anchorOpenId });
  const resUser = await (sdk.roundUploadUserResult ? sdk.roundUploadUserResult(reqUser) : sdk.RoundUploadUserResult(reqUser));
  console.log('RoundUploadUserResult', resUser);

  const reqRank = new RoundUploadRankListRequest({ appId, roomId, roundId: Number(roundId), xToken: accessToken, rankList, anchorOpenId });
  const resRank = await (sdk.roundUploadRankList ? sdk.roundUploadRankList(reqRank) : sdk.RoundUploadRankList(reqRank));
  console.log('RoundUploadRankList', resRank);

  const reqDone = new RoundCompleteUploadUserResultRequest({ appId, roomId, roundId: Number(roundId), completeTime: Math.floor(Date.now() / 1000), xToken: accessToken, anchorOpenId });
  const resDone = await (sdk.roundCompleteUploadUserResult ? sdk.roundCompleteUploadUserResult(reqDone) : sdk.RoundCompleteUploadUserResult(reqDone));
  console.log('RoundCompleteUploadUserResult', resDone);
}

main().catch((e) => { console.error(e && e.message || e); process.exit(1); });