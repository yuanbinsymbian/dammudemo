import sdk from '@open-dy/open_api_sdk'
import credPkg from '@open-dy/open_api_credential'

const Client = sdk?.default ?? sdk
const Cred = credPkg?.default ?? credPkg
const clientKey = process.env.DOUYIN_APP_ID
const clientSecret = process.env.DOUYIN_APP_SECRET

const c = new Client({ clientKey, clientSecret })
const own = Object.keys(c)
const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(c))
const methods = Array.from(new Set([...(own || []), ...(proto || [])]))
  .filter((k) => typeof c[k] === 'function')
  .sort()

let tokenRes
try {
  const cred = new Cred({ clientKey, clientSecret })
  tokenRes = await cred.getClientToken()
} catch (e) {
  tokenRes = { error: String(e?.message || e) }
}

// HTTP POST token fetch per official docs
const tokenUrl = 'https://developer.toutiao.com/api/apps/v2/token'
let httpTokenRes
try {
  const payload = { appid: clientKey, secret: clientSecret, grant_type: 'client_credential' }
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  httpTokenRes = await resp.json()
} catch (e) {
  httpTokenRes = { error: String(e?.message || e) }
}

const httpAccessToken = httpTokenRes?.data?.access_token
const httpExpiresIn = httpTokenRes?.data?.expires_in
const httpExpAt = httpExpiresIn ? (Date.now() + Number(httpExpiresIn) * 1000) : null
const preview = (s) => (typeof s === 'string' && s.length > 16) ? (s.slice(0,8) + '...' + s.slice(-8)) : (s || '')

console.log('http_get_token_result', {
  err_no: httpTokenRes?.err_no ?? null,
  err_tips: httpTokenRes?.err_tips ?? null,
  access_token_preview: preview(httpAccessToken),
  expires_in: httpExpiresIn ?? null,
  expires_at: httpExpAt ?? null,
  expires_at_iso: httpExpAt ? new Date(httpExpAt).toISOString() : null
})

console.log('http_get_token_body', httpTokenRes)
console.log(JSON.stringify({ methods, tokenRes }, null, 2))