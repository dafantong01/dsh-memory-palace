/**
 * 归档正文的块分类与过滤（纯函数，供 palace_search 与回归测试共用）。
 *
 * 归档文件里每个 turn 由若干块组成：
 *   ### 用户（user） · …          → user
 *   ### 助手思考（assistant reasoning） → assistant-reasoning
 *   ### 助手（assistant） · …     → assistant
 *   ### 附件（attachment） · …    → assistant（附件来自助手消息，只放索引）
 *   ### 助手调用工具 / ### 工具返回 → tool
 *   ### 系统（system） · …        → system
 *
 * blockKind 初始为 other。工具返回里的代码围栏可能原样引用旧归档，
 * 里面的结构行不能被当成当前轮的块头；`## TURN` 处也重置 kind。
 */

export function classifyArchiveLine(line) {
  const text = String(line || '')
  if (text.startsWith('### 用户（')) return 'user'
  if (text.startsWith('### 助手思考')) return 'assistant-reasoning'
  if (text.startsWith('### 助手（')) return 'assistant'
  if (text.startsWith('### 附件（')) return 'assistant'
  if (text.startsWith('### 助手调用工具') || text.startsWith('### 工具返回')) return 'tool'
  if (text.startsWith('### 系统（')) return 'system'
  return null
}

/** 代码围栏行：切换围栏状态；围栏内的结构行只当正文。 */
export function isFenceLine(line) {
  return String(line || '').trimStart().startsWith('```')
}

/** 当前块是否命中 speaker / includeReasoning 过滤。 */
export function lineKindAllowed(kind, { speaker = '', includeReasoning = true } = {}) {
  if (kind === 'assistant-reasoning' && includeReasoning === false) return false
  if (!speaker) return true
  if (speaker === 'user') return kind === 'user'
  if (speaker === 'assistant') {
    return kind === 'assistant' || (includeReasoning !== false && kind === 'assistant-reasoning')
  }
  return true
}
