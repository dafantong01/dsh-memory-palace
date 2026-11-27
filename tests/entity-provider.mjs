import assert from 'node:assert/strict'
import { resolveCaptureEntities } from '../lib/entity-provider.js'

const cfg = {
  triviaEntityProvider: 'remote',
  triviaEntityEndpoint: 'https://example.invalid/entities',
  triviaEntityKey: 'secret-key',
}
let seen = null
const fetchOk = async (url, init) => {
  seen = { url, init }
  return {
    ok: true,
    json: async () => ({ results: [{ entities: [{ text: 'Alice' }, { text: '面对疾风吧' }] }] }),
  }
}
const got = await resolveCaptureEntities(cfg, '我的网名叫小明，Alice说部署完成', { fetchImpl: fetchOk })
assert.deepEqual(got, ['小明', 'Alice', '面对疾风吧'])
assert.equal(seen.url, cfg.triviaEntityEndpoint)
assert.equal(seen.init.headers['Ocp-Apim-Subscription-Key'], 'secret-key')
assert.ok(!JSON.stringify(seen.init.body).includes('secret-key'))
assert.ok(JSON.stringify(seen.init.body).includes('我的网名'))

const failed = await resolveCaptureEntities(cfg, '我的网名叫小明', { fetchImpl: async () => ({ ok: false }) })
assert.deepEqual(failed, ['小明'])

const off = await resolveCaptureEntities({ ...cfg, triviaEntityProvider: 'off' }, '我的网名叫小明', { fetchImpl: fetchOk })
assert.deepEqual(off, ['小明'])

const noKey = await resolveCaptureEntities({ ...cfg, triviaEntityKey: '' }, '我的网名叫小明', { fetchImpl: fetchOk })
assert.deepEqual(noKey, ['小明'])
console.log('SUMMARY entity-provider 12/12')
