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
console.log(JSON.stringify({ methods, tokenRes }, null, 2))