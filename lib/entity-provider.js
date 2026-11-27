import { extractExplicitEntities } from './trivia.js'

function cleanEntities(values) {
  const out = []
  for (const raw of Array.isArray(values) ? values : []) {
    const s = String(raw || '').trim().replace(/^[@＠]/, '').replace(/^[「“"']|[」”"']$/g, '')
    if (!s || s.length > 32) continue
    if (/^(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.\w+)$/i.test(s)) continue
    if (!out.includes(s)) out.push(s)
    if (out.length >= 10) break
  }
  return out
}

/**
 * 可选实体识别 provider。off/失败时只返回显式结构实体，不阻塞写入。
 * 不记录 key、不把 key 放进请求体；只放在 provider 要求的请求头里。
 */
export async function resolveCaptureEntities(cfg, text, { fetchImpl = globalThis.fetch } = {}) {
  const explicit = extractExplicitEntities(text)
  const provider = cfg?.triviaEntityProvider
  const endpoint = String(cfg?.triviaEntityEndpoint || '').trim()
  const key = String(cfg?.triviaEntityKey || '')
  const model = String(cfg?.triviaEntityModel || '').trim()
  if (provider !== 'remote' || !endpoint || !key || typeof fetchImpl !== 'function') return explicit
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4500)
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Ocp-Apim-Subscription-Key': key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ documents: [{ id: '1', language: 'zh', text }], ...(model ? { model } : {}) }),
      signal: controller.signal,
    })
    if (!res.ok) return explicit
    const data = await res.json().catch(() => null)
    const list = data?.results?.[0]?.entities || data?.entities || data?.data || []
    const remote = []
    for (const item of Array.isArray(list) ? list : []) {
      const value = typeof item === 'string' ? item : item?.text ?? item?.name ?? item?.word ?? item?.entity
      if (value) remote.push(value)
    }
    return cleanEntities([...explicit, ...remote])
  } catch {
    return explicit
  } finally {
    clearTimeout(timer)
  }
}
