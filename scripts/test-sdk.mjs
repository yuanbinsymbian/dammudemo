import sdk from '@open-dy/open_api_sdk'

const Client = sdk?.default ?? sdk
const clientKey = process.env.DOUYIN_APP_ID
const clientSecret = process.env.DOUYIN_APP_SECRET

const c = new Client({ clientKey, clientSecret })
const own = Object.keys(c)
const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(c))
const methods = Array.from(new Set([...(own || []), ...(proto || [])]))
  .filter((k) => typeof c[k] === 'function')
  .sort()

console.log(JSON.stringify({ methods }, null, 2))