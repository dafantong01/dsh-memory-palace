window.__ModuleLoader__.load({
  id: '@dafantong01/dsh-memory-palace',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/memory-palace-api'

    const s = {
      root: { padding: '24px 20px 8px', fontSize: '13px', lineHeight: 1.65, color: 'var(--dsh-text, var(--dsw-alias-label-primary, #222))' },
      page: { maxWidth: '820px', margin: '0 auto', width: '100%', boxSizing: 'border-box' },
      header: { margin: '0 0 14px' },
      title: { fontSize: '18px', fontWeight: 600, margin: 0, letterSpacing: '0.01em' },
      subtitle: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '12px', opacity: 0.72, wordBreak: 'break-all' },
      row: { margin: '2px 0' },
      muted: { opacity: 0.65 },
      bar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: 0 },
      btn: { padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
      btnPrimary: { padding: '5px 16px', borderRadius: '6px', border: '1px solid transparent', background: 'var(--dsh-accent, var(--dsw-alias-brand-primary, #3b6ef5))', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600 },
      btnSecondary: { padding: '5px 14px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
      input: { width: '84px', padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box' },
      field: { display: 'flex', flexDirection: 'column', gap: '2px', margin: 0, minWidth: 0 },
      label: { fontSize: '12px', opacity: 0.75, lineHeight: 1.5 },
      ctrlRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 },
      hint: { fontSize: '12px', opacity: 0.6, lineHeight: 1.55, wordBreak: 'break-word' },
      list: { marginTop: '10px', borderTop: '1px solid rgba(128,128,128,.25)', paddingTop: '8px' },
      item: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', opacity: 0.85, wordBreak: 'break-all' },
      err: { color: '#b4534e' },
      ok: { color: '#2f8f4e' },
      switchRow: { display: 'flex', alignItems: 'center', gap: '10px', margin: '2px 0 8px', flexWrap: 'wrap' },
      derived: { margin: '8px 0 2px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(128,128,128,.10)', fontSize: '12px', lineHeight: 1.6 },
      card: { border: '1px solid rgba(128,128,128,.22)', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px', background: 'var(--dsh-bg-elevated, var(--dsw-alias-bg-l1, transparent))', boxSizing: 'border-box' },
      cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' },
      cardTitle: { fontSize: '12px', fontWeight: 600, opacity: 0.8, letterSpacing: '0.02em', margin: 0, lineHeight: 1.5 },
      cardAside: { fontSize: '12px', opacity: 0.6, lineHeight: 1.5, textAlign: 'right' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px 16px' },
      checks: { display: 'flex', flexDirection: 'column', gap: '2px' },
      checkRow: { display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '3px 0', minWidth: 0 },
      checkLabel: { flex: 1, minWidth: 0, lineHeight: 1.55 },
      gateRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', margin: '2px 0 6px', fontSize: '12px' },
      gateItem: { display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: 0.9 },
      gateLabel: { opacity: 0.7 },
      stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px', margin: '10px 0 4px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(128,128,128,.07)' },
      stat: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' },
      statLabel: { fontSize: '11px', opacity: 0.6, lineHeight: 1.5 },
      statValue: { fontSize: '15px', fontWeight: 600, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' },
      lastCheck: { fontSize: '12px', opacity: 0.6, lineHeight: 1.6, marginTop: '2px' },
      naming: { marginTop: '8px' },
      env: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px', opacity: 0.72 },
      code: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', wordBreak: 'break-all' },
      strengthHead: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' },
      range: { flex: '1 1 90px', minWidth: '80px', maxWidth: '180px', verticalAlign: 'middle', accentColor: 'var(--dsh-accent, var(--dsw-alias-brand-primary, #3b6ef5))' },
      subHead: { fontSize: '12px', fontWeight: 600, opacity: 0.7, letterSpacing: '0.02em', margin: '10px 0 4px' },
      details: { marginTop: '10px', borderTop: '1px solid rgba(128,128,128,.15)', paddingTop: '8px' },
      summary: { cursor: 'pointer', fontSize: '12px', opacity: 0.7, userSelect: 'none', marginBottom: '2px' },
      sticky: { position: 'sticky', bottom: 0, zIndex: 5, marginBottom: '4px' },
      stickyTop: { position: 'sticky', top: '38px', zIndex: 6, marginBottom: '10px', paddingTop: '2px', background: 'var(--dsh-bg, var(--dsw-alias-bg-base, transparent))' },
      actionCard: { border: '1px solid rgba(128,128,128,.22)', borderRadius: '10px', padding: '10px 14px', background: 'var(--dsh-bg-elevated, var(--dsw-alias-bg-l1, rgba(128,128,128,.08)))', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 -4px 16px rgba(128,128,128,.12)', boxSizing: 'border-box' },
      actionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' },
      events: { display: 'flex', flexDirection: 'column', gap: '3px' },
      eventLine: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', opacity: 0.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 },
      empty: { fontSize: '12px', opacity: 0.55, padding: '2px 0' },
      tableHead: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px', gap: '4px 12px', padding: '0 0 5px', borderBottom: '1px solid rgba(128,128,128,.18)', fontSize: '11px', opacity: 0.6, letterSpacing: '0.02em' },
      archiveRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px', gap: '2px 12px', padding: '7px 0', alignItems: 'start' },
      archiveMain: { minWidth: 0 },
      archiveMeta: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '11px', opacity: 0.6, marginBottom: '1px' },
      archiveFile: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', lineHeight: 1.55, wordBreak: 'break-all', opacity: 0.9 },
      archiveRight: { textAlign: 'right', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', lineHeight: 1.55, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
      coreRow: {
        margin: '10px 0', padding: '11px 12px',
        border: '1px solid rgba(128,128,128,.18)', borderRadius: '8px',
        background: 'rgba(128,128,128,.035)', minWidth: 0,
      },
      coreMeta: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', fontSize: '11px', opacity: 0.68, minWidth: 0 },
      coreContent: { whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: 1.65, marginTop: '8px', wordBreak: 'break-word', overflowWrap: 'anywhere' },
      coreActions: { display: 'flex', gap: '6px', marginTop: '9px', alignItems: 'center', flexWrap: 'wrap' },
      coreTag: { fontSize: '11px', opacity: 0.7, lineHeight: 1.5, wordBreak: 'break-word' },
      tinyCode: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '10px', opacity: 0.5, lineHeight: 1.5, whiteSpace: 'nowrap', flexShrink: 0 },
      linkBtn: { border: 'none', background: 'none', padding: 0, fontSize: '12px', cursor: 'pointer', color: 'var(--dsw-alias-link, var(--dsh-accent, var(--dsw-alias-brand-primary, #3b6ef5)))', fontWeight: 500 },
      editorBox: { background: 'rgba(128,128,128,.055)', border: '1px solid rgba(128,128,128,.18)', borderRadius: '8px', padding: '10px', marginBottom: '10px', minWidth: 0 },
      editorHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' },
      emptyBox: { border: '1px dashed rgba(128,128,128,.28)', borderRadius: '8px', padding: '18px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' },
      msg: { margin: '0 0 8px', lineHeight: 1.55, wordBreak: 'break-word', overflowWrap: 'anywhere' },
      tabHint: { fontSize: '12px', opacity: 0.6, lineHeight: 1.5, margin: '0 0 10px', paddingLeft: '1px' },
      btnDanger: { padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(180,83,78,.45)', background: 'transparent', color: '#b4534e', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
      docsLayout: { display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' },
      docsListPane: { flex: '1 1 260px', minWidth: 0, maxWidth: '330px', display: 'flex', flexDirection: 'column', gap: '8px' },
      docsListBox: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '56vh', overflowY: 'auto', padding: '4px', border: '0.5px solid rgba(128,128,128,.28)', borderRadius: '12px' },
      docsPreviewPane: { flex: '2 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
      docsSearchRow: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' },
      docsItem: { width: '100%', display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left', padding: '9px 12px', borderRadius: '8px', border: '0', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '13px', boxSizing: 'border-box' },
      docsItemActive: { background: 'rgba(128,128,128,.14)', boxShadow: 'inset 0 0 0 1px currentColor' },
      docsItemTitle: { fontWeight: 600, lineHeight: 1.45, wordBreak: 'break-word' },
      docsItemMeta: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px', opacity: 0.65 },
      docsSnippet: { fontSize: '12px', lineHeight: 1.45, opacity: 0.65, maxHeight: '2.9em', overflow: 'hidden', wordBreak: 'break-word' },
      docsTag: { display: 'inline-block', maxWidth: '100%', padding: '0 6px', borderRadius: '999px', background: 'rgba(128,128,128,.12)', fontSize: '11px', lineHeight: '1.7', whiteSpace: 'normal', wordBreak: 'break-word' },
      docsTitle: { fontSize: '16px', fontWeight: 600, lineHeight: 1.45, margin: 0, wordBreak: 'break-word' },
      docsMeta: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '11px', opacity: 0.85 },
      docsBody: { whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: 1.7, wordBreak: 'break-word', overflowWrap: 'anywhere', maxHeight: '52vh', overflowY: 'auto', padding: '10px 12px', borderRadius: '8px', background: 'rgba(128,128,128,.04)', border: '1px solid rgba(128,128,128,.12)' },
      modalBackdrop: { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: 'rgba(0,0,0,.38)' },
      modalCard: { width: 'min(680px, 100%)', maxHeight: '86vh', overflowY: 'auto', border: '1px solid rgba(128,128,128,.28)', borderRadius: '10px', padding: '16px', background: 'var(--dsw-alias-bg-base, var(--dsh-bg, #fff))', color: 'var(--dsh-text, var(--dsw-alias-label-primary, #222))', boxShadow: '0 12px 40px rgba(0,0,0,.28)', boxSizing: 'border-box' },
      modalTitle: { fontSize: '15px', fontWeight: 600, margin: '0 0 8px', lineHeight: 1.45 },
      modalText: { fontSize: '13px', lineHeight: 1.6, margin: '0 0 12px', wordBreak: 'break-word' },
      modalActions: { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '12px' },
      familyBlock: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
      familyList: { border: '1px solid rgba(128,128,128,.14)', borderRadius: '8px', overflow: 'hidden', minWidth: 0 },
      familyMember: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 10px', padding: '7px 10px', borderTop: '1px solid rgba(128,128,128,.10)', minWidth: 0 },
      familyMemberName: { fontWeight: 500, wordBreak: 'break-word' },
      familyMemberFolder: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', opacity: 0.6, wordBreak: 'break-all' },
    }

    const CHIP_TONES = {
      ok: { background: 'rgba(47,143,78,.12)', color: '#2f8f4e' },
      bad: { background: 'rgba(180,83,78,.12)', color: '#b4534e' },
      warn: { background: 'rgba(180,140,60,.15)', color: '#a06a1f' },
      neutral: { background: 'rgba(128,128,128,.12)', color: 'inherit' },
    }

    function Switch(props) {
      const on = Boolean(props.value)
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        disabled: props.disabled,
        onClick: () => props.onChange(!on),
        title: on ? '点击关闭' : '点击开启',
        style: {
          width: '46px', height: '24px', borderRadius: '12px', border: 'none', padding: 0,
          cursor: props.disabled ? 'default' : 'pointer', position: 'relative',
          background: on ? '#2f8f4e' : '#9a9a9a', opacity: props.disabled ? 0.6 : 1,
          transition: 'background .15s', flexShrink: 0,
        },
      }, h('span', {
        style: {
          position: 'absolute', top: '3px', left: on ? '25px' : '3px',
          width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
          transition: 'left .15s',
        },
      }))
    }

    /** 卡片容器：统一边框/圆角/内边距，可带标题与右上角统计。 */
    function Card(props) {
      return h('section', { style: s.card },
        props.title
          ? h('div', { style: s.cardHead },
            h('div', { style: s.cardTitle }, props.title),
            props.aside ? h('div', { style: s.cardAside }, props.aside) : null)
          : null,
        props.children)
    }

    /** 状态胶囊：启用绿 / 停用红 / 中性灰，背景 12% alpha。 */
    function Chip(props) {
      const tone = CHIP_TONES[props.kind] || CHIP_TONES.neutral
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', padding: '0 7px',
          borderRadius: '999px', fontSize: '12px', lineHeight: '1.7',
          fontWeight: 500, whiteSpace: 'nowrap', ...tone,
        },
      }, props.children)
    }

    /** 统计小格：上方 11px 灰标签，下方数值。 */
    function Stat(props) {
      return h('div', { style: s.stat },
        h('div', { style: s.statLabel }, props.label),
        h('div', { style: s.statValue }, props.value))
    }

    /** 单行文本输入：标签在上、输入框在下，长中文标签不会挤压输入。 */
    function Field(props) {
      const numeric = props.type === 'number'
      const clamp = (v) => {
        if (!numeric) return v
        const n = Number(v)
        if (!Number.isFinite(n)) return String(props.min ?? '')
        return String(Math.min(Math.max(Math.trunc(n), props.min ?? n), props.max ?? n))
      }
      return h('div', { style: s.field },
        h('span', { style: s.label }, props.label),
        h('div', { style: s.ctrlRow },
          h('input', {
            type: numeric ? 'number' : 'text',
            min: props.min, max: props.max, step: props.step || 1,
            style: props.wide ? { ...s.input, width: '100%' } : s.input,
            value: props.value, disabled: props.disabled,
            onChange: (e) => props.onChange(numeric ? clamp(e.target.value) : e.target.value),
            onBlur: numeric ? (e) => props.onChange(clamp(e.target.value)) : undefined,
          })),
        props.suffix ? h('div', { style: s.hint }, props.suffix) : null)
    }

    /** 只读展示字段：窗口、保留量、前缀等由后端自动计算/探测的值。 */
    function ROField(props) {
      return h('div', { style: s.field },
        h('span', { style: s.label }, props.label),
        h('div', { style: s.ctrlRow },
          h('input', {
            style: { ...s.input, width: props.width || '150px', opacity: 0.6, cursor: 'not-allowed' },
            value: props.value, readOnly: true, tabIndex: -1, title: props.title,
          })),
        props.hint ? h('div', { style: s.hint }, props.hint) : null)
    }

    const statsCache = new Map()

    function useStatus(sessionId) {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [statsLoading, setStatsLoading] = React.useState(false)
      const statsBusyRef = React.useRef(false)
      const mountAt = React.useRef(typeof performance !== 'undefined' ? performance.now() : Date.now())
      const reportPerf = React.useCallback((event, detail) => {
        if (!sessionId) return
        const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - mountAt.current)
        fetch(`${API}?sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, action: 'perf-log', event, ms, detail }),
        }).catch(() => {})
      }, [sessionId])
      const load = React.useCallback(async () => {
        if (!sessionId) return
        // 只取轻量视图；统计由配置页按需触发，避免首次切热记忆页签被日志解码阻塞。
        try {
          const res = await fetch(`${API}?sessionId=${encodeURIComponent(sessionId)}`)
          const body = await res.json()
          if (!res.ok) throw new Error(body.error || String(res.status))
          const cachedStats = statsCache.get(sessionId)
          setData(cachedStats ? {
            ...body,
            ...cachedStats,
            stats: cachedStats.stats,
            partial: false,
          } : body)
          setErr('')
          reportPerf('tab-status', { bytes: Number(body ? JSON.stringify(body).length : 0) })
        } catch (e) { setErr(String(e && e.message ? e.message : e)) }
      }, [sessionId, reportPerf])
      const loadStats = React.useCallback(async () => {
        if (!sessionId || statsBusyRef.current) return
        statsBusyRef.current = true
        setStatsLoading(true)
        try {
          const res2 = await fetch(`${API}?sessionId=${encodeURIComponent(sessionId)}&stats=1&fresh=1`)
          const full = await res2.json()
          if (res2.ok) {
            const cachedStats = {
              stats: full.stats,
              contextWindowTokens: full.contextWindowTokens,
              retentionCapBytes: full.retentionCapBytes,
              retentionCapTokens: full.retentionCapTokens,
            }
            statsCache.set(sessionId, cachedStats)
            setData((prev) => (prev ? {
              ...prev,
              ...cachedStats,
              partial: false,
            } : full))
            reportPerf('tab-stats', { bytes: Number(full ? JSON.stringify(full).length : 0) })
          }
        } catch { /* 统计失败不影响配置页使用 */ } finally { statsBusyRef.current = false; setStatsLoading(false) }
      }, [sessionId, reportPerf])
      React.useEffect(() => { load() }, [load])
      return { data, err, load, statsLoading, loadStats }
    }

    async function post(sessionId, action, values) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, action, values }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || String(res.status))
      return body
    }

    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined }

    /** 回忆强度档位：滑条索引 0–4 对应后端枚举值。 */
    const RECALL_KEYS = ['off', 'low', 'medium', 'high', 'forced']
    const RECALL_LABELS = ['关', '低', '中', '高', '强制']
    const RECALL_HINT = '关=只归档不读；低=优先读摘要；中=走摘要→检索→原文；高=允许递归；强制=每条消息后必须检索'
    // 这里的 user 是热记忆板块名，不是 message.role/source 的 user；profile 仅兼容旧缓存。
    const CORE_BOARD_ALIASES = { profile: 'user' }
    const normalizeCoreBoard = (board) => CORE_BOARD_ALIASES[String(board || '')] || String(board || '')
    const CORE_TABS = [
      { key: 'config', label: '通用配置' },
      { key: 'identity', label: '角色自我' },
      { key: 'user', label: '用户画像' },
      { key: 'rules', label: '规则铁律' },
      { key: 'memories', label: '关键记忆' },
      { key: 'documents', label: '项目档案' },
      { key: 'archive', label: '记忆回廊' },
    ]
    const TAB_HINTS = {
      identity: '长期稳定的自我设定：身份、语气与风格',
      user: '用户偏好、习惯与沟通雷区',
      rules: '最高优先级的行为约束（默认层级为铁律）',
      memories: '值得留下的记忆：美好瞬间、重要的人与事、关系与感受，也包括工作决策和踩过的坑——不只记工作',
      documents: '会话级项目档案：标题、正文、标签与项目归属',
      archive: '长期记忆归档、检索策略与最近记录',
      config: '会话开关、命名与本地热记忆注入',
    }
    const CORE_TIERS = ['mind-seal', 'important', 'normal', 'minor']
    const TIER_LABELS = { 'mind-seal': '铁律', important: '重要', normal: '普通', minor: '次要' }
    const TIER_KINDS = { 'mind-seal': 'bad', important: 'warn', normal: 'neutral', minor: 'neutral' }
    const CORE_TIER_DEFAULT = { identity: 'important', user: 'normal', rules: 'mind-seal', memories: 'normal' }
    const shortId = (id) => {
      const v = String(id || '')
      return v.length > 14 ? `…${v.slice(-10)}` : v
    }
    const isOkMsg = (m) => String(m || '').startsWith('已')

    /** 百分比字段：滑块 + 输入框联动，拖动时输入框跟着变。 */
    function PctField(props) {
      const value = Number(props.value)
      const safe = Number.isFinite(value) ? value : props.min
      const clamp = (v) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return String(props.min)
        return String(Math.min(Math.max(Math.trunc(n), props.min), props.max))
      }
      return h('div', { style: s.field },
        h('span', { style: s.label }, props.label),
        h('div', { style: s.ctrlRow },
          h('input', {
            type: 'range', min: props.min, max: props.max, step: 1,
            value: safe, disabled: props.disabled,
            style: s.range,
            onChange: (e) => props.onChange(clamp(e.target.value)),
          }),
          h('input', {
            type: 'number', min: props.min, max: props.max, step: 1,
            style: { ...s.input, width: '68px' }, value: props.value, disabled: props.disabled,
            onChange: (e) => props.onChange(clamp(e.target.value)),
            onBlur: (e) => props.onChange(clamp(e.target.value)),
          }),
          h('span', { style: s.muted }, '%')),
        props.suffix ? h('div', { style: s.hint }, props.suffix) : null)
    }

    /** 整数滑块字段：数字框 + 滑块联动，用于 1–30 这类小整数。disabled 时不可编辑并整体变淡。 */
    function IntSlider(props) {
      const raw = Number(props.value)
      const safe = Number.isFinite(raw) ? Math.min(Math.max(raw, props.min), props.max) : props.min
      const clamp = (v, fallback = safe) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return fallback
        return Math.min(Math.max(Math.trunc(n), props.min), props.max)
      }
      return h('div', { style: { ...s.field, opacity: props.disabled ? 0.5 : 1 } },
        h('span', { style: s.label }, props.label),
        h('div', { style: s.ctrlRow },
          h('input', {
            type: 'number', min: props.min, max: props.max, step: 1,
            style: { ...s.input, width: '68px' }, value: props.value, disabled: props.disabled,
            onChange: (e) => props.onChange(String(clamp(e.target.value))),
            onBlur: (e) => props.onChange(String(clamp(e.target.value))),
          }),
          h('input', {
            type: 'range', min: props.min, max: props.max, step: 1,
            value: safe, disabled: props.disabled,
            style: s.range,
            onChange: (e) => props.onChange(String(clamp(e.target.value))),
          })),
        props.suffix ? h('div', { style: s.hint }, props.suffix) : null)
    }

    function Check(props) {
      return h('div', { style: { ...s.checkRow, opacity: props.disabled ? 0.6 : 1 } },
        h('span', { style: s.checkLabel }, props.label),
        h('input', {
          type: 'checkbox', checked: props.value, disabled: props.disabled,
          style: { marginTop: '3px', flexShrink: 0, accentColor: 'var(--dsh-accent, var(--dsw-alias-brand-primary, #3b6ef5))' },
          onChange: (e) => props.onChange(e.target.checked),
        }))
    }

    /** 单条记忆：元信息一行、正文可折叠、操作按钮。 */
    const tierOptionsFor = (section) => section === 'rules'
      ? CORE_TIERS.filter((t) => t === 'mind-seal' || t === 'important')
      : CORE_TIERS

    function ProjectSelect(props) {
      const projects = Array.isArray(props.projects) ? props.projects : []
      const value = String(props.value || '')
      const known = projects.some((p) => p.label === value)
      return h('select', {
        style: { ...s.input, width: '100%' },
        value,
        disabled: props.disabled,
        onChange: (e) => props.onChange(e.target.value),
      },
        h('option', { value: '' }, '不绑定项目 / 解绑'),
        value && !known ? h('option', { value }, `${value}（不存在或已停用）`) : null,
        projects.map((p) => h('option', { key: p.label, value: p.label },
          `${p.label}${p.enabled === false ? '（停用）' : ''}${p.archived ? '（已归档）' : ''}`)))
    }

    /** 条目内原位编辑：编辑已有条目时不再跳到板块顶部。 */
    function CoreEntryEditor(props) {
      const ed = props.editor || {}
      return h('div', { style: s.editorBox },
        h('div', { style: s.editorHead },
          h('div', { style: s.cardTitle }, '编辑条目'),
          h('span', { style: s.tinyCode, title: ed.id }, shortId(ed.id))),
        h('div', { style: s.field },
          h('span', { style: s.label }, '正文（Markdown）'),
          h('textarea', {
            style: { ...s.input, width: '100%', minHeight: '96px', boxSizing: 'border-box', resize: 'vertical' },
            value: ed.content || '',
            disabled: props.saving,
            autoFocus: true,
            onChange: (e) => props.onChange({ ...ed, content: e.target.value }),
            onKeyDown: (e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                props.onSave()
              }
            },
          })),
        h('div', { style: { ...s.grid, marginTop: '8px' } },
          h('div', { style: s.field },
            h('span', { style: s.label }, '层级 tier'),
            h('select', {
              style: { ...s.input, width: '100%' },
              value: ed.tier,
              disabled: props.saving,
              onChange: (e) => props.onChange({ ...ed, tier: e.target.value }),
            }, tierOptionsFor(ed.section).map((t) => h('option', { key: t, value: t }, `${TIER_LABELS[t] || t}（${t}）`)))),
          h('div', { style: s.field },
            h('span', { style: s.label }, '标签 tags'),
            h('input', {
              style: { ...s.input, width: '100%' },
              placeholder: '每个 ≤16 字，最多 8 个，逗号分隔',
              value: ed.tags || '',
              disabled: props.saving,
              onChange: (e) => props.onChange({ ...ed, tags: e.target.value }),
            })),
          h('div', { style: s.field },
            h('span', { style: s.label }, '项目 label（可选）'),
            h(ProjectSelect, {
              value: ed.projectLabel || '',
              projects: props.projects,
              disabled: props.saving,
              onChange: (v) => props.onChange({ ...ed, projectLabel: v }),
            }))),
        h('div', { style: s.hint }, '层级越高，注入越优先：铁律 > 重要 > 普通 > 次要'),
        props.error ? h('div', { role: 'alert', style: { ...s.msg, ...s.err, marginTop: '6px' } }, props.error) : null,
        h('div', { style: { ...s.bar, marginTop: '8px' } },
          h('button', {
            type: 'button',
            style: { ...s.btnPrimary, opacity: props.saving ? 0.6 : 1, cursor: props.saving ? 'default' : 'pointer' },
            disabled: props.saving,
            onClick: props.onSave,
          }, props.saving ? '保存中…' : '保存'),
          h('button', {
            type: 'button',
            style: s.btnSecondary,
            disabled: props.saving,
            onClick: props.onCancel,
          }, '取消')))
    }

    function CoreEntry(props) {
      const e = props.entry || {}
      const [open, setOpen] = React.useState(false)
      const [overflow, setOverflow] = React.useState(false)
      const bodyRef = React.useRef(null)
      const content = String(e.content || '')
      const tags = Array.isArray(e.tags) ? e.tags : []
      const contentStyle = !open
        ? { ...s.coreContent, maxHeight: '6.6em', overflow: 'hidden' }
        : s.coreContent
      React.useEffect(() => {
        const el = bodyRef.current
        if (!el) return
        if (!open) setOverflow(el.scrollHeight > el.clientHeight + 2)
      }, [content, open])
      if (props.editing) {
        return h(CoreEntryEditor, {
          editor: props.editor,
          projects: props.projects,
          saving: props.savingCore,
          error: props.editorError,
          onChange: props.onChangeEditor,
          onSave: props.onSaveEditor,
          onCancel: props.onCancelEditor,
        })
      }
      return h('div', { style: s.coreRow, title: `${e.id} · rev ${e.rev}` },
        h('div', { style: s.coreMeta },
          h('span', {
            style: { fontWeight: 700, fontSize: '12px' },
            title: '列表序号（按创建顺序稳定排序，编辑不会跳位）',
          }, `#${props.index + 1}`),
          h(Chip, { kind: TIER_KINDS[e.tier] || 'neutral' }, TIER_LABELS[e.tier] || e.tier || '普通'),
          h('span', { style: s.muted }, e.updated),
          e.projectLabel ? h(Chip, { kind: 'ok' }, `项目 ${e.projectLabel}`) : null,
          props.familyRole === 'child' && e.projectLabel
            ? h(Chip, { kind: 'warn' }, `子会话 ${props.sessionName || ''} 特有`)
            : null,
          tags.length
            ? h('span', {
              style: s.coreTag,
              title: tags.join(', '),
            }, tags.slice(0, 3).map((t) => `#${t}`).join(' ') + (tags.length > 3 ? ` +${tags.length - 3}` : ''))
            : null,
          h('span', {
            style: {
              ...s.tinyCode,
              marginLeft: 'auto',
              maxWidth: '55%',
              whiteSpace: 'normal',
              wordBreak: 'break-all',
              textAlign: 'right',
            },
            title: e.id,
          }, e.id),
          e.projectLabel
            ? h('span', {
              style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', flexShrink: 0 },
              title: e.budgetExcluded ? '关联项目档案已停用/归档，不注入' : '关联项目档案启用中',
            },
            h('span', {
              style: {
                width: '7px', height: '7px', borderRadius: '50%',
                background: e.budgetExcluded ? 'rgb(220,80,80)' : 'rgb(30,160,90)',
                boxShadow: e.budgetExcluded ? '0 0 0 2px rgba(220,80,80,.15)' : '0 0 0 2px rgba(30,160,90,.15)',
              },
            }),
            h('span', { style: { color: e.budgetExcluded ? 'rgb(220,80,80)' : 'rgb(30,160,90)' } },
              e.budgetExcluded ? '停用' : '启用'))
            : null),
        h('div', { ref: bodyRef, style: contentStyle }, content),
        props.savedId && props.savedId === e.id
          ? h('div', { style: { ...s.hint, color: s.ok.color } }, '已保存')
          : null,
        h('div', { style: s.coreActions },
          overflow
            ? h('button', {
              type: 'button',
              style: s.linkBtn,
              'aria-expanded': open,
              onClick: () => setOpen((v) => !v),
            }, open ? '收起' : '展开全文')
            : null,
          h('button', { type: 'button', style: s.btnSecondary, onClick: props.onInject }, '立即注入'),
          h('button', { type: 'button', style: s.btnSecondary, onClick: props.onEdit }, '编辑'),
          h('select', {
            style: { ...s.input, width: '96px', padding: '4px 6px' },
            value: '',
            title: '转移到其他板块',
            onChange: (ev) => {
              const to = ev.target.value
              ev.target.value = ''
              if (to) props.onMove(to)
            },
          },
          h('option', { value: '' }, '转移…'),
          CORE_TABS.filter((t) => ['identity', 'user', 'rules', 'memories'].includes(t.key) && t.key !== props.entry.board)
            .map((t) => h('option', { key: t.key, value: t.key }, t.label))),
          h('button', {
            type: 'button',
            style: s.btnDanger,
            title: '软删除到 .trash',
            onClick: props.onRemove,
          }, '删除')))
    }

    /** 归档 / 配置页共用的粘性保存条；只显示当前页需要的按钮。 */
    function SaveBar(props) {
      const disabled = props.busy || !props.dirty
      return h('div', { style: s.stickyTop },
        h('div', { style: s.actionCard },
          h('div', { style: s.actionHead },
            h('div', { style: s.cardTitle }, props.title),
            props.dirty ? h(Chip, { kind: 'warn' }, '有未保存修改') : h(Chip, { kind: 'ok' }, '已保存')),
          h('div', { style: s.bar },
            h('button', {
              type: 'button',
              style: { ...s.btnPrimary, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' },
              disabled,
              onClick: props.onSave,
            }, props.saveLabel),
            props.onArchive
              ? h('button', {
                type: 'button',
                style: { ...s.btnSecondary, opacity: props.busy ? 0.6 : 1, cursor: props.busy ? 'default' : 'pointer' },
                disabled: props.busy,
                onClick: props.onArchive,
              }, '现在归档')
              : null,
            h('span', { style: { ...s.hint, flex: '1 1 240px' } }, props.hint)),
          props.msg
            ? h('p', {
              role: 'status',
              'aria-live': 'polite',
              style: { ...s.msg, ...(isOkMsg(props.msg) ? s.ok : s.err), margin: '4px 0 0' },
            }, props.msg)
            : null,
          props.err
            ? h('p', { role: 'alert', style: { ...s.msg, ...s.err, margin: '4px 0 0' } }, props.err)
            : null))
    }

    /** 项目档案：memory-docs 的列表 / 预览 / 编辑 / 归档 / 删除。 */
    function DocsPanel(props) {
      const sessionId = props.sessionId || ''
      const [items, setItems] = React.useState([])
      const [total, setTotal] = React.useState(0)
      const [warnings, setWarnings] = React.useState([])
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [queryUsed, setQueryUsed] = React.useState('')
      const [searchActive, setSearchActive] = React.useState(false)
      const [refresh, setRefresh] = React.useState(0)
      const [selectedId, setSelectedId] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewMoreLoading, setPreviewMoreLoading] = React.useState(false)
      const [previewError, setPreviewError] = React.useState('')
      const [editor, setEditor] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [editorError, setEditorError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [confirm, setConfirm] = React.useState(null)
      const [confirmBusy, setConfirmBusy] = React.useState(false)
      const [confirmError, setConfirmError] = React.useState('')
      const [familyRole, setFamilyRole] = React.useState('independent')
      const [familyShareSupported, setFamilyShareSupported] = React.useState(false)

      // 档案启停/归档/改 label 后，通知配置页刷新项目下拉。
      React.useEffect(() => {
        try { props.onChanged?.() } catch { /* 刷新通知失败不影响文档页 */ }
      }, [items])

      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError('')
        const q = searchActive ? String(queryUsed || '').trim() : ''
        const url = q
          ? `${API}?action=docs-search&query=${encodeURIComponent(q)}&includeArchived=1&limit=20&sessionId=${encodeURIComponent(sessionId)}`
          : `${API}?action=docs-list&sessionId=${encodeURIComponent(sessionId)}&includeArchived=1&limit=50&offset=0`
        fetch(url)
          .then(async (r) => {
            const body = await r.json().catch(() => ({}))
            if (!r.ok || body.ok === false) throw new Error(body.error || `HTTP ${r.status}`)
            return body
          })
          .then((body) => {
            if (cancelled) return
            const list = Array.isArray(body.items) ? body.items : []
            setItems(list)
            setTotal(Number(body.total) || 0)
            setWarnings(Array.isArray(body.warnings) ? body.warnings : [])
            setFamilyRole(String(body.familyRole || 'independent'))
            setFamilyShareSupported(body.familyShareSupported === true)
            setSelectedId((cur) => (cur && list.some((x) => x.id === cur) ? cur : null))
            setLoading(false)
          })
          .catch((e) => {
            if (cancelled) return
            setError(String(e?.message || e))
            setLoading(false)
          })
        return () => { cancelled = true }
      }, [sessionId, refresh, searchActive, queryUsed])

      React.useEffect(() => {
        if (!selectedId) {
          setPreview(null)
          setPreviewError('')
          setPreviewLoading(false)
          return
        }
        let cancelled = false
        setPreview(null)
        setPreviewError('')
        setPreviewLoading(true)
        fetch(`${API}?action=docs-read&id=${encodeURIComponent(selectedId)}&maxChars=20000&sessionId=${encodeURIComponent(sessionId)}`)
          .then(async (r) => {
            const body = await r.json().catch(() => ({}))
            if (!r.ok || body.ok === false) throw new Error(body.error || `HTTP ${r.status}`)
            return body
          })
          .then((body) => {
            if (cancelled) return
            setPreview(body)
            setPreviewLoading(false)
          })
          .catch((e) => {
            if (cancelled) return
            setPreviewError(String(e?.message || e))
            setPreviewLoading(false)
          })
        return () => { cancelled = true }
      }, [sessionId, selectedId, refresh])

      const loadMorePreview = async () => {
        if (!preview?.nextOffset || previewMoreLoading) return
        setPreviewMoreLoading(true)
        try {
          const r = await fetch(`${API}?action=docs-read&id=${encodeURIComponent(selectedId)}&maxChars=20000&offset=${preview.nextOffset}&sessionId=${encodeURIComponent(sessionId)}`)
          const body = await r.json().catch(() => ({}))
          if (!r.ok || body.ok === false) throw new Error(body.error || `HTTP ${r.status}`)
          setPreview((cur) => cur ? { ...body, body: (cur.body || '') + (body.body || ''), offset: 0 } : body)
        } catch (e) {
          setPreviewError(String(e?.message || e))
        } finally {
          setPreviewMoreLoading(false)
        }
      }

      const fmtTime = (v) => String(v || '').replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '')
      const toggleDocEnabled = async (enabled) => {
        const target = preview?.doc
        if (!target || target.readOnly === true || preview?.readOnly === true || preview?.canEdit === false || saving || confirm) return
        setSaving(true)
        setNotice('')
        try {
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, action: 'docs-update', id: target.id, rev: target.rev, enabled }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
          setNotice(enabled ? '已启用' : '已停用')
          setRefresh((x) => x + 1)
        } catch (err) {
          setNotice(String(err?.message || err))
        } finally {
          setSaving(false)
        }
      }
      const startCreate = () => {
        if (editor || saving || confirm) return
        setNotice('')
        setEditorError('')
        setEditor({
          mode: 'create', id: '', rev: 0,
          title: '', content: '', description: '', tags: '', projectLabel: '', archived: false,
        })
      }
      const toggleFamilyShared = async (shared) => {
        const target = preview?.doc
        if (!target || target.readOnly === true || preview?.readOnly === true || preview?.canEdit === false || saving || confirm) return
        if (shared && !familyShareSupported) {
          setNotice('独立会话不能启用家族共用；成为母归属或加入家族后再打开。')
          return
        }
        setSaving(true)
        setNotice('')
        try {
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, action: 'docs-update', id: target.id, rev: target.rev, familyShared: shared }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
          setNotice(shared ? '已开启家族共用' : '已关闭家族共用')
          setRefresh((x) => x + 1)
        } catch (err) {
          setNotice(String(err?.message || err))
        } finally {
          setSaving(false)
        }
      }
      const startEdit = () => {
        if (editor || saving || confirm) return
        const p = preview
        if (!p || !p.doc || p.doc.readOnly === true || p.readOnly === true || p.canEdit === false) return
        setNotice('')
        setEditorError('')
        setEditor({
          mode: 'edit', id: p.doc.id, rev: p.doc.rev,
          title: p.doc.title || '', content: p.body || '',
          description: p.doc.description || '',
          tags: (p.doc.tags || []).join(', '),
          projectLabel: p.doc.projectLabel || '',
          archived: p.doc.archived === true,
        })
      }
      const cancelEditor = () => {
        if (saving) return
        setEditor(null)
        setEditorError('')
      }
      const saveEditor = async () => {
        if (!editor || saving) return
        const title = String(editor.title || '').trim()
        if (!title) { setEditorError('标题不能为空'); return }
        setSaving(true)
        setEditorError('')
        setNotice('')
        try {
          const payload = {
            sessionId,
            action: editor.mode === 'create' ? 'docs-create' : 'docs-update',
            title,
            content: String(editor.content || ''),
            description: String(editor.description || ''),
            tags: String(editor.tags || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean),
            projectLabel: String(editor.projectLabel || '').trim(),
          }
          if (editor.mode === 'edit') {
            payload.id = editor.id
            payload.rev = editor.rev
          }
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok || body.ok === false) {
            if (body.conflict === true || body.code === 'conflict') {
              setEditorError('文档已被其他会话修改，请刷新后重试')
              return
            }
            throw new Error(body.error || `HTTP ${res.status}`)
          }
          const savedId = body.doc?.id || body.id || editor.id || null
          setNotice('已保存')
          setEditor(null)
          setEditorError('')
          if (editor.mode === 'create') {
            setQuery('')
            setSearchActive(false)
            setQueryUsed('')
          }
          if (savedId) setSelectedId(savedId)
          setRefresh((x) => x + 1)
        } catch (e) {
          setEditorError(String(e?.message || e))
        } finally {
          setSaving(false)
        }
      }

      const runSearch = () => {
        const q = String(query || '').trim()
        setNotice('')
        if (!q) {
          setSearchActive(false)
          setQueryUsed('')
          setRefresh((x) => x + 1)
          return
        }
        setSearchActive(true)
        setQueryUsed(q)
        setRefresh((x) => x + 1)
      }
      const clearSearch = () => {
        setQuery('')
        setSearchActive(false)
        setQueryUsed('')
        setRefresh((x) => x + 1)
      }
      const reload = () => setRefresh((x) => x + 1)
      const openConfirm = (action) => {
        const doc = preview?.doc
        if (!doc || editor || saving || confirm) return
        setNotice('')
        setConfirmError('')
        setConfirm({
          action,
          doc: { id: doc.id, title: doc.title || doc.id, rev: doc.rev, archived: doc.archived === true },
        })
      }
      const cancelConfirm = () => {
        if (confirmBusy) return
        setConfirm(null)
        setConfirmError('')
      }
      const runConfirm = async () => {
        if (!confirm || confirmBusy) return
        setConfirmBusy(true)
        setConfirmError('')
        try {
          let res
          if (confirm.action === 'remove') {
            res = await fetch(API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId, action: 'docs-remove', id: confirm.doc.id }),
            })
          } else {
            res = await fetch(API, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(props.coreConfirmToken ? { 'x-memory-palace-confirm': props.coreConfirmToken } : {}),
              },
              body: JSON.stringify({
                sessionId, action: 'docs-update', id: confirm.doc.id, rev: confirm.doc.rev,
                archived: confirm.action === 'archive',
              }),
            })
          }
          const body = await res.json().catch(() => ({}))
          if (!res.ok || body.ok === false) {
            if (body.conflict === true || body.code === 'conflict') {
              setConfirmError('文档已被其他会话修改，请刷新后重试')
              return
            }
            throw new Error(body.error || `HTTP ${res.status}`)
          }
          if (confirm.action === 'remove') {
            setNotice('已删除')
            setSelectedId(null)
            setPreview(null)
          } else {
            setNotice(confirm.action === 'archive' ? '已归档' : '已取消归档')
          }
          setConfirm(null)
          setConfirmError('')
          setRefresh((x) => x + 1)
        } catch (e) {
          setConfirmError(String(e?.message || e))
        } finally {
          setConfirmBusy(false)
        }
      }

      const editorModal = editor
        ? h('div', { style: s.modalBackdrop, role: 'presentation' },
          h('div', {
            style: s.modalCard,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': editor.mode === 'create' ? '新建项目档案' : '编辑项目档案',
          },
            h('div', { style: s.editorHead },
              h('div', { style: s.modalTitle }, editor.mode === 'create' ? '新建文档' : '编辑文档'),
              editor.id ? h('span', { style: s.tinyCode, title: editor.id }, `rev ${editor.rev} · ${shortId(editor.id)}`) : null),
            h('div', { style: s.field },
              h('span', { style: s.label }, '标题'),
              h('input', {
                style: { ...s.input, width: '100%' },
                value: editor.title,
                disabled: saving,
                autoFocus: true,
                placeholder: '文档标题（必填，最多 200 字）',
                onChange: (e) => setEditor({ ...editor, title: e.target.value }),
              })),
            h('div', { style: { ...s.grid, marginTop: '8px' } },
              h('div', { style: s.field },
                h('span', { style: s.label }, '所属项目（projectLabel，可选）'),
                h('input', {
                  style: { ...s.input, width: '100%' },
                  value: editor.projectLabel,
                  disabled: saving,
                  placeholder: '留空=不绑定项目；最多 5 个英文单词',
                  onChange: (e) => setEditor({ ...editor, projectLabel: e.target.value }),
                })),
              h('div', { style: s.field },
                h('span', { style: s.label }, '标签 tags'),
                h('input', {
                  style: { ...s.input, width: '100%' },
                  value: editor.tags,
                  disabled: saving,
                  placeholder: '逗号分隔，最多 24 个',
                  onChange: (e) => setEditor({ ...editor, tags: e.target.value }),
                }))),
            h('div', { style: { ...s.field, marginTop: '8px' } },
              h('span', { style: s.label }, '描述'),
              h('textarea', {
                style: { ...s.input, width: '100%', minHeight: '56px', boxSizing: 'border-box', resize: 'vertical' },
                value: editor.description,
                disabled: saving,
                placeholder: '一句话摘要（可选，最多 4000 字）',
                onChange: (e) => setEditor({ ...editor, description: e.target.value }),
              })),
            h('div', { style: { ...s.field, marginTop: '8px' } },
              h('span', { style: s.label }, '正文（Markdown）'),
              h('textarea', {
                style: { ...s.input, width: '100%', minHeight: '220px', boxSizing: 'border-box', resize: 'vertical' },
                value: editor.content,
                disabled: saving,
                placeholder: '文档正文，支持 Markdown',
                onChange: (e) => setEditor({ ...editor, content: e.target.value }),
              })),
            h('div', { style: s.hint }, '保存后列表会刷新；更新基于 rev，冲突时不会覆盖。'),
            editorError ? h('div', { role: 'alert', style: { ...s.msg, ...s.err, marginTop: '6px' } }, editorError) : null,
            h('div', { style: s.modalActions },
              h('button', {
                type: 'button',
                style: { ...s.btnPrimary, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' },
                disabled: saving,
                onClick: saveEditor,
              }, saving ? '保存中…' : '保存'),
              h('button', {
                type: 'button',
                style: s.btnSecondary,
                disabled: saving,
                onClick: cancelEditor,
              }, '取消'))))
        : null

      const confirmModal = confirm
        ? h('div', {
          style: s.modalBackdrop,
          role: 'presentation',
          onClick: (e) => { if (e.target === e.currentTarget) cancelConfirm() },
        },
          h('div', {
            style: { ...s.modalCard, width: 'min(420px, 100%)' },
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': '确认操作',
          },
            h('div', { style: s.modalTitle },
              confirm.action === 'remove' ? '删除文档' : (confirm.action === 'archive' ? '归档文档' : '取消归档')),
            h('div', { style: s.modalText },
              confirm.action === 'remove'
                ? `确定删除「${confirm.doc.title}」？文档会移入 .trash，列表里不再显示。`
                : confirm.action === 'archive'
                  ? `确定归档「${confirm.doc.title}」？归档后列表仍显示，并带「已归档」标记。`
                  : `确定取消归档「${confirm.doc.title}」？`),
            confirmError ? h('div', { role: 'alert', style: { ...s.msg, ...s.err } }, confirmError) : null,
            h('div', { style: s.modalActions },
              h('button', {
                type: 'button',
                style: s.btnSecondary,
                disabled: confirmBusy,
                onClick: cancelConfirm,
              }, '取消'),
              h('button', {
                type: 'button',
                style: {
                  ...(confirm.action === 'remove' ? s.btnDanger : s.btnPrimary),
                  opacity: confirmBusy ? 0.6 : 1,
                  cursor: confirmBusy ? 'default' : 'pointer',
                },
                disabled: confirmBusy,
                onClick: runConfirm,
              }, confirmBusy ? '处理中…' : (confirm.action === 'remove' ? '删除' : (confirm.action === 'archive' ? '归档' : '取消归档'))))))
        : null

      const doc = preview && preview.doc ? preview.doc : null
      const body = preview && typeof preview.body === 'string' ? preview.body : ''
      const tags = doc && Array.isArray(doc.tags) ? doc.tags : []
      const canManage = Boolean(
        doc &&
        doc.readOnly !== true &&
        preview?.readOnly !== true &&
        preview?.canEdit !== false
      )

      const leftPane = h('div', { style: s.docsListPane },
        h('input', {
          style: { ...s.input, width: '100%' },
          value: query,
          placeholder: '搜索标题、正文、标签…',
          onChange: (e) => setQuery(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch() } },
        }),
        h('div', { style: s.docsSearchRow },
          h('button', {
            type: 'button',
            style: s.btnSecondary,
            disabled: loading && searchActive,
            onClick: runSearch,
          }, loading && searchActive ? '搜索中…' : '搜索'),
          (searchActive || query) ? h('button', { type: 'button', style: s.btnSecondary, onClick: clearSearch }, '清除') : null,
          h('button', { type: 'button', style: s.btnSecondary, disabled: loading, onClick: reload }, '刷新'),
          h('button', {
            type: 'button',
            style: { ...s.btnPrimary, padding: '4px 12px', marginLeft: 'auto', opacity: (editor || saving) ? 0.5 : 1, cursor: (editor || saving) ? 'default' : 'pointer' },
            disabled: Boolean(editor) || saving,
            onClick: startCreate,
          }, '新建档案')),
        loading && items.length === 0
          ? h('div', { style: s.empty }, '读取中…')
          : error
            ? h('div', { style: s.emptyBox },
              h('div', { role: 'alert', style: s.err }, error),
              h('button', { type: 'button', style: s.btnSecondary, onClick: reload }, '重试'))
            : items.length === 0
              ? h('div', { style: s.emptyBox },
                h('div', { style: s.muted }, searchActive ? '没有匹配的文档。' : '还没有项目档案。'),
                searchActive
                  ? h('button', { type: 'button', style: s.btnSecondary, onClick: clearSearch }, '清除搜索')
                  : null)
              : h('div', { style: s.docsListBox },
                items.map((item) => {
                  const active = item.id === selectedId
                  return h('div', {
                    key: item.id,
                    style: {
                      ...s.docsItem,
                      ...(active ? s.docsItemActive : null),
                      opacity: (editor || saving) ? 0.6 : 1,
                      cursor: (editor || saving) ? 'default' : 'pointer',
                      outline: 'none',
                      boxShadow: 'none',
                    },
                    onMouseDown: (e) => { e.preventDefault() },
                    onClick: (e) => {
                      if (editor || saving) return
                      setSelectedId(active ? null : item.id)
                      setNotice('')
                    },
                  },
                    h('div', { style: s.docsItemTitle }, item.title || '(无标题)'),
                    h('div', { style: s.docsItemMeta },
                      h('span', null, fmtTime(item.updated)),
                      item.archived ? h(Chip, { kind: 'warn' }, '已归档') : null,
                      item.enabled === false && !item.archived ? h(Chip, { kind: 'bad' }, '已停用') : null,
                      item.familyShared === true ? h(Chip, { kind: 'ok' }, item.readOnly === true ? `家族共用 · ${item.ownerName || ''}` : '家族共用') : null,
                      item.readOnly === true ? h(Chip, { kind: 'warn' }, '只读') : null,
                      item.projectLabel ? h('span', { style: s.muted }, item.projectLabel) : null),
                    item.snippet ? h('div', { style: s.docsSnippet }, item.snippet) : null)
                }),
                total > items.length
                  ? h('div', { style: s.hint }, `显示前 ${items.length} / ${total} ${searchActive ? '条' : '篇'}`)
                  : null,
                warnings.length
                  ? h('div', { style: s.hint }, `有 ${warnings.length} 条读取警告`)
                  : null))

      const rightPane = h('div', { style: s.docsPreviewPane },
        previewLoading
          ? h('div', { style: s.empty }, '读取中…')
          : previewError
            ? h('div', { style: s.emptyBox },
              h('div', { role: 'alert', style: s.err }, previewError),
              h('button', { type: 'button', style: s.btnSecondary, onClick: reload }, '重试'))
            : !doc
              ? h('div', { style: s.emptyBox },
                h('div', { style: s.muted }, '从左侧选择一篇文档查看正文；新建请点左上方「新建」。'))
              : h(React.Fragment, null,
                h('div', { style: s.bar },
                  h('div', { style: { flex: '1 1 240px', minWidth: 0 } },
                    h('div', { style: s.docsTitle }, doc.title || '(无标题)'),
                    h('div', { style: s.docsMeta },
                      doc.archived ? h(Chip, { kind: 'warn' }, '已归档') : null,
                      doc.projectLabel ? h(Chip, { kind: 'ok' }, `项目 ${doc.projectLabel}`) : null,
                      doc.familyShared === true ? h(Chip, { kind: 'ok' }, doc.readOnly === true ? `家族共用 · 来自 ${doc.ownerName || '其他会话'}` : '家族共用') : null,
                      doc.readOnly === true ? h(Chip, { kind: 'warn' }, '只读') : null,
                      tags.map((t) => h('span', { key: t, style: s.docsTag, title: t }, `#${t}`)),
                      h('span', { style: { ...s.tinyCode, fontSize: '11px', opacity: 0.8 } }, `rev ${doc.rev}`),
                      h('span', { style: { opacity: 0.8 } }, `更新 ${fmtTime(doc.updated)}`))),
                  h('button', { type: 'button', style: s.btnSecondary, onClick: reload, title: '重新读取列表和当前文档' }, '刷新')),
                doc.description ? h('div', { style: { ...s.hint, maxHeight: '4.8em', overflow: 'hidden' }, title: doc.description }, doc.description) : null,
                doc.readOnly === true
                  ? h('div', { style: s.hint }, `这份项目档案由 ${doc.ownerName || '拥有者'} 开启家族共用；当前会话只读，启停、共用和归档由拥有者管理。`)
                  : null,
                h('div', { style: s.bar },
                  h('button', {
                    type: 'button',
                    role: 'switch',
                    'aria-checked': doc.enabled !== false && doc.archived !== true,
                    title: !canManage ? '只读：启停由拥有者管理' : (doc.archived ? '文档已归档，先取消归档' : (doc.enabled === false ? '点击启用项目档案' : '点击停用项目档案')),
                    disabled: !canManage || Boolean(editor) || saving || doc.archived,
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: (e) => { e.stopPropagation(); e.preventDefault(); if (!canManage) return; if (!doc.archived) toggleDocEnabled(doc.enabled === false) },
                    style: {
                      display: 'flex', alignItems: 'center', gap: '8px', border: 'none', background: 'transparent',
                      padding: '2px 0', cursor: (!canManage || editor || saving || doc.archived) ? 'default' : 'pointer',
                      opacity: (!canManage || editor || saving || doc.archived) ? 0.5 : 1, userSelect: 'none',
                      pointerEvents: !canManage ? 'none' : 'auto',
                    },
                  },
                  h('span', {
                    style: {
                      width: '38px', height: '20px', borderRadius: '999px', position: 'relative',
                      background: doc.archived ? 'rgba(128,128,128,.5)' : (doc.enabled === false ? 'rgba(239,68,68,.65)' : 'rgba(34,197,94,.85)'),
                      flexShrink: 0, transition: 'background .15s',
                    },
                  }, h('span', {
                    style: {
                      position: 'absolute', top: '2px', left: (doc.archived || doc.enabled === false) ? '2px' : '20px',
                      width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,.3)', transition: 'left .15s',
                    },
                  })),
                  h('span', { style: { fontSize: '12px', color: doc.archived ? 'var(--mn-faint, #888)' : (doc.enabled === false ? 'rgb(220,80,80)' : 'rgb(30,160,90)') } },
                    doc.archived ? '已归档' : (doc.enabled === false ? '已停用' : '已启用'))),
                  h('button', {
                    type: 'button',
                    role: 'switch',
                    'aria-checked': doc.familyShared === true,
                    title: !canManage ? '只读：家族共用由拥有者管理' : (familyShareSupported ? '开启后，全家族会话可只读使用这份项目档案及其项目热记忆' : '独立会话不能启用家族共用；成为母归属或加入家族后再打开'),
                    disabled: !canManage || !familyShareSupported || Boolean(editor) || saving || doc.archived,
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: (e) => { e.stopPropagation(); e.preventDefault(); if (canManage) toggleFamilyShared(doc.familyShared !== true) },
                    style: {
                      display: 'flex', alignItems: 'center', gap: '8px', border: 'none', background: 'transparent',
                      padding: '2px 0',
                      opacity: (!canManage || !familyShareSupported || editor || saving || doc.archived) ? 0.5 : 1,
                      cursor: (!canManage || !familyShareSupported || editor || saving || doc.archived) ? 'default' : 'pointer',
                      userSelect: 'none',
                      pointerEvents: !canManage ? 'none' : 'auto',
                    },
                  },
                  h('span', {
                    style: {
                      width: '38px', height: '20px', borderRadius: '999px', position: 'relative',
                      background: doc.familyShared === true ? 'rgba(59,110,245,.85)' : 'rgba(128,128,128,.45)',
                      flexShrink: 0, transition: 'background .15s',
                    },
                  }, h('span', {
                    style: {
                      position: 'absolute', top: '2px', left: doc.familyShared === true ? '20px' : '2px',
                      width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,.3)', transition: 'left .15s',
                    },
                  })),
                  h('span', { style: { fontSize: '12px', color: doc.familyShared === true ? 'rgb(44,90,210)' : 'var(--mn-faint, #888)' } }, '家族共用'),
                  h('span', { style: { fontSize: '12px', color: doc.familyShared === true ? 'rgb(44,90,210)' : 'var(--mn-faint, #888)' } }, doc.familyShared === true ? '开' : '关')),
                  canManage ? h('button', {
                    type: 'button',
                    style: s.btnPrimary,
                    disabled: Boolean(editor) || saving,
                    onClick: startEdit,
                  }, '编辑') : null,
                  canManage ? h('button', {
                    type: 'button',
                    style: s.btnSecondary,
                    disabled: Boolean(editor) || saving,
                    onClick: () => openConfirm(doc.archived ? 'unarchive' : 'archive'),
                  }, doc.archived ? '取消归档' : '归档') : null,
                  canManage ? h('button', {
                    type: 'button',
                    style: s.btnDanger,
                    disabled: Boolean(editor) || saving,
                    title: doc.archived === true ? '删除已归档档案' : '未归档档案不能删除，请先归档',
                    onClick: () => {
                      if (doc.archived !== true) {
                        setNotice('项目档案未归档，不能删除；请先归档')
                        return
                      }
                      openConfirm('remove')
                    },
                  }, '删除') : null),
                h('div', { style: s.docsBody }, body || '（空正文）'),
                preview?.nextOffset
                  ? h('div', { style: { ...s.bar, marginTop: '-4px' } },
                    h('span', { style: s.hint }, `已显示 ${(preview.body || '').length} / ${preview.totalChars || '?'} 字`),
                    h('button', {
                      type: 'button',
                      style: s.btnSecondary,
                      disabled: previewMoreLoading,
                      onClick: loadMorePreview,
                    }, previewMoreLoading ? '加载中…' : '加载更多'))
                  : null))

      return h(Card, {
        title: '项目档案',
        aside: loading ? '读取中…' : (error ? '读取失败' : (searchActive ? `搜索结果 ${total} 条` : `共 ${total} 篇`)),
      },
        notice ? h('div', {
          role: /不能删除|失败|错误|无权限|冲突|已被|必须独立|重复|不允许|已存在/.test(notice) ? 'alert' : 'status',
          'aria-live': 'assertive',
          style: {
            ...s.msg,
            ...(/不能删除|失败|错误|无权限|冲突|已被|必须独立|重复|不允许|已存在/.test(notice) ? s.err : s.ok),
            marginBottom: '8px',
            fontWeight: /不能删除/.test(notice) ? 600 : 400,
          },
        }, notice) : null,
        h('div', { style: s.docsLayout }, leftPane, rightPane),
        editorModal,
        confirmModal)
    }

    /** 记忆家族：独立 / 母归属 / 子会话；危险操作全部走页内确认。 */
    function FamilyCard(props) {
      const sessionId = props.sessionId || ''
      const active = props.active !== false
      const [status, setStatus] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [refresh, setRefresh] = React.useState(0)
      const [target, setTarget] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [actionError, setActionError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [confirm, setConfirm] = React.useState(null)
      const [confirmBusy, setConfirmBusy] = React.useState(false)
      const [confirmError, setConfirmError] = React.useState('')

      React.useEffect(() => {
        if (!active) return
        let cancelled = false
        setLoading(true)
        setError('')
        fetch(`${API}?action=family-status&sessionId=${encodeURIComponent(sessionId)}`)
          .then(async (r) => {
            const body = await r.json().catch(() => ({}))
            if (!r.ok || body.ok !== true) throw new Error(body.error || `HTTP ${r.status}`)
            return body
          })
          .then((body) => {
            if (cancelled) return
            setStatus(body)
            setLoading(false)
            setError('')
          })
          .catch((e) => {
            if (cancelled) return
            setError(String(e?.message || e))
            setLoading(false)
          })
        return () => { cancelled = true }
      }, [active, sessionId, refresh])

      const state = status && status.state && typeof status.state === 'object' ? status.state : null
      const membership = status ? status.membership : null
      const family = membership && membership.family ? membership.family : null
      const role = membership && family ? membership.role : 'independent'
      const families = state && state.families && typeof state.families === 'object' ? Object.values(state.families) : []
      const candidateSource = Array.isArray(status?.candidates) ? status.candidates : families
      const candidates = candidateSource
        .filter((f) => f && f.status === 'active' && f.rootSessionId !== sessionId)
        .sort((a, b) => String(a.displayName || a.rootFolder || '').localeCompare(String(b.displayName || b.rootFolder || '')))
      const selectedTarget = candidates.some((f) => f.rootSessionId === target) ? target : ''
      const targetFamily = candidates.find((f) => f.rootSessionId === selectedTarget) || null
      const targetName = targetFamily ? String(targetFamily.displayName || targetFamily.rootFolder || targetFamily.rootSessionId) : ''
      const familyName = family ? String(family.displayName || family.rootFolder || family.rootSessionId || '未命名家族') : ''
      const [familyNameDraft, setFamilyNameDraft] = React.useState('')
      React.useEffect(() => { setFamilyNameDraft(familyName) }, [familyName])
      const rootFolder = family ? String(family.rootFolder || '') : ''
      const members = family && Array.isArray(family.members) ? family.members : []
      const familyStatus = family ? String(family.status || '') : ''
      const canRestoreRoot = status?.canRestoreRoot === true
      const statusChip = familyStatus === 'active'
        ? h(Chip, { kind: 'ok' }, '活跃')
        : familyStatus === 'abdicated'
          ? h(Chip, { kind: 'warn' }, '已让位')
          : familyStatus === 'orphaned'
            ? h(Chip, { kind: 'warn' }, '根缺失')
            : familyStatus === 'migrating'
              ? h(Chip, { kind: 'warn' }, '迁移中')
              : familyStatus === 'dissolved'
                ? h(Chip, { kind: 'bad' }, '已解散')
                : null

      const postFamily = async (action, extra) => {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, action, ...(extra || {}) }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || body.ok !== true) throw new Error(body.error || `HTTP ${res.status}`)
        return body
      }
      const refreshFamily = () => setRefresh((x) => x + 1)
      const saveFamilyName = async () => {
        if (busy || !String(familyNameDraft || '').trim()) return
        setBusy('family-rename-name')
        setActionError('')
        setNotice('')
        try {
          await postFamily('family-rename-name', { name: String(familyNameDraft).trim() })
          setNotice('家族名已更新')
          refreshFamily()
        } catch (e) {
          setActionError(String(e?.message || e))
        } finally {
          setBusy('')
        }
      }
      const runDirect = async (action, okText) => {
        if (busy) return
        setBusy(action)
        setActionError('')
        setNotice('')
        try {
          await postFamily(action)
          setNotice(okText)
          refreshFamily()
        } catch (e) {
          setActionError(String(e?.message || e))
        } finally {
          setBusy('')
        }
      }
      const openConfirm = (action, extra) => {
        if (confirm || busy || confirmBusy) return
        setActionError('')
        setConfirmError('')
        setNotice('')
        setConfirm({ action, ...(extra || {}) })
      }
      const cancelConfirm = () => {
        if (confirmBusy) return
        setConfirm(null)
        setConfirmError('')
      }
      const runConfirm = async () => {
        if (!confirm || confirmBusy) return
        setConfirmBusy(true)
        setConfirmError('')
        setActionError('')
        try {
          let result = null
          if (confirm.action === 'join') result = await postFamily('family-join', { rootSessionId: confirm.target })
          else if (confirm.action === 'takeover') result = await postFamily('family-takeover', { familyId: confirm.target })
          else if (confirm.action === 'detach') result = await postFamily('family-detach')
          else if (confirm.action === 'detachCopy') result = await postFamily('family-detach', { copyMother: true })
          else if (confirm.action === 'abdicate') result = await postFamily('family-abdicate')
          else if (confirm.action === 'restoreRoot') result = await postFamily('family-restore-root')
          else if (confirm.action === 'dissolve') result = await postFamily('family-dissolve')
          else if (confirm.action === 'transferRoot') result = await postFamily('family-transfer', { newRootSessionId: confirm.target, newRootName: confirm.name })
          setNotice(
            confirm.action === 'join' ? '已加入家族' :
              confirm.action === 'takeover' ? '已接管家族，成为新母归属' :
              confirm.action === 'detach' ? `已脱离家族${result?.warning ? `；${result.warning}` : ''}` :
                confirm.action === 'detachCopy' ? `已脱离并复制母记忆${result?.copied !== undefined ? `；新增 ${result.copied} 条` : ''}${result?.warning ? `；${result.warning}` : ''}` :
                  confirm.action === 'abdicate' ? '已让位' :
                    confirm.action === 'restoreRoot' ? '已撤销让位，恢复母归属' :
                      confirm.action === 'transferRoot' ? `已转移根${result?.warning ? `；${result.warning}` : ''}` : '已解散家族'
          )
          if (confirm.action === 'join' || confirm.action === 'transferRoot') setTarget('')
          setConfirm(null)
          setConfirmError('')
          refreshFamily()
        } catch (e) {
          const text = String(e?.message || e)
          setConfirmError(text)
          setActionError(text)
        } finally {
          setConfirmBusy(false)
        }
      }

      const confirmMeta = confirm
        ? confirm.action === 'join'
          ? {
            title: '加入家族',
            text: `确定加入家族「${confirm.name || confirm.target || ''}」？母会话是「${confirm.rootFolder || confirm.target || ''}」，加入后本会话以它为母归属。`,
            label: '加入', buttonStyle: s.btnPrimary,
          }
          : confirm.action === 'takeover'
            ? {
              title: '接管家族',
              text: `家族「${confirm.name || confirm.target || ''}」的母归属目录/配置不可读。接管后本会话会成为新母归属，原根记录转入 formerRoot；确定继续？`,
              label: '接管', buttonStyle: s.btnDanger,
            }
          : confirm.action === 'detach'
            ? {
              title: '脱离家族',
              text: `确定脱离「${confirm.name || familyName}」？脱离后本会话恢复独立。`,
              label: '脱离', buttonStyle: s.btnDanger,
            }
            : confirm.action === 'detachCopy'
              ? {
                title: '脱离并复制母记忆',
                text: `确定脱离「${confirm.name || familyName}」并把母归属热记忆补到本会话？先恢复本会话个人热记忆，再按 id/正文去重，只补缺失，不覆盖已有；项目热记忆不动。`,
                label: '脱离并复制', buttonStyle: s.btnPrimary,
              }
              : confirm.action === 'abdicate'
              ? {
                title: '让位',
                text: `确定让位？家族「${confirm.name || familyName}」会变为已让位，成员保留但母归属失效。`,
                label: '让位', buttonStyle: s.btnDanger,
              }
              : confirm.action === 'restoreRoot'
                ? {
                  title: '撤销让位',
                  text: `确定恢复你为「${confirm.name || familyName}」的母归属？仅在新根尚未选出时可用；已选举则会被拒绝。`,
                  label: '撤销让位', buttonStyle: s.btnPrimary,
                }
              : confirm.action === 'transferRoot'
                ? {
                  title: '转移根',
                  text: `确定把母归属转移给「${confirm.name || confirm.target || ''}」？旧根会留在家族成为子会话，族核迁移到新根，旧根的个人备份保留。`,
                  label: '转移根', buttonStyle: s.btnDanger,
                }
                : {
                  title: '解散家族',
                  text: `确定解散「${confirm.name || familyName}」？所有成员会恢复独立。`,
                  label: '解散', buttonStyle: s.btnDanger,
                }
        : null

      const confirmModal = confirm && confirmMeta
        ? h('div', {
          style: s.modalBackdrop,
          role: 'presentation',
          onClick: (e) => { if (e.target === e.currentTarget) cancelConfirm() },
        },
          h('div', {
            style: { ...s.modalCard, width: 'min(430px, 100%)' },
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': confirmMeta.title,
          },
            h('div', { style: s.modalTitle }, confirmMeta.title),
            h('div', { style: s.modalText }, confirmMeta.text),
            confirmError ? h('div', { role: 'alert', style: { ...s.msg, ...s.err } }, confirmError) : null,
            h('div', { style: s.modalActions },
              h('button', {
                type: 'button',
                style: s.btnSecondary,
                disabled: confirmBusy,
                onClick: cancelConfirm,
              }, '取消'),
              h('button', {
                type: 'button',
                style: {
                  ...confirmMeta.buttonStyle,
                  opacity: confirmBusy ? 0.6 : 1,
                  cursor: confirmBusy ? 'default' : 'pointer',
                },
                disabled: confirmBusy,
                onClick: runConfirm,
              }, confirmBusy ? '处理中…' : confirmMeta.label))))
        : null

      const independentView = h('div', { style: s.familyBlock },
        h('div', { style: s.bar },
          h(Chip, { kind: 'neutral' }, '独立会话'),
          h('span', { style: s.hint }, '还没有加入任何记忆家族。')),
        h('div', { style: { ...s.bar, marginTop: '2px' } },
          h('span', { style: s.label }, '家族'),
          h('select', {
            style: { ...s.input, width: '260px', maxWidth: '100%' },
            value: '',
            disabled: Boolean(busy) || loading,
            onChange: (e) => {
              const value = e.target.value
              e.target.value = ''
              if (!value) return
              if (value === '__root__') {
                runDirect('family-root', '已设为母归属')
                return
              }
              const f = candidates.find((x) => x.rootSessionId === value)
              setTarget(value)
              if (f?.needsTakeover) openConfirm('takeover', { target: value, name: f.displayName || f.rootFolder || value, rootFolder: f.rootFolder || '' })
              else openConfirm('join', { target: value, name: f?.displayName || f?.rootFolder || value, rootFolder: f?.rootFolder || '' })
            },
          },
            h('option', { value: '' }, '为空（独立）'),
            h('option', { value: '__root__' }, '设为母归属'),
            candidates.map((f) => h('option', {
              key: f.rootSessionId,
              value: f.rootSessionId,
            }, `${f.needsTakeover ? '接管家族' : '加入家族'} ${f.displayName || f.rootFolder || f.rootSessionId}${f.rootFolder ? `（母会话 ${f.rootFolder}）` : ''}`)))),
        h('div', { style: s.hint }, '设为母归属会创建家族；选择已有家族会先确认再加入。母归属目录不可读的家族会标记为“接管”，接管后本会话成为新母归属。'))

      const rootView = h('div', { style: s.familyBlock },
        h('div', { style: s.bar },
          h(Chip, { kind: 'ok' }, '母归属'),
          h('span', { style: { fontWeight: 600, wordBreak: 'break-word', minWidth: 0 } }, familyName),
          statusChip,
          rootFolder ? h('span', { style: s.hint }, `文件夹：${rootFolder}`) : null),
        h('div', { style: { ...s.bar, marginTop: '2px' } },
          h('span', { style: s.label }, '家族名'),
          h('input', {
            type: 'text',
            value: familyNameDraft,
            disabled: busy === 'family-rename-name',
            style: { ...s.input, maxWidth: '260px' },
            onChange: (e) => setFamilyNameDraft(e.target.value),
          }),
          h('button', {
            type: 'button',
            style: { ...s.btnPrimary, opacity: busy === 'family-rename-name' ? 0.6 : 1 },
            disabled: busy === 'family-rename-name',
            onClick: saveFamilyName,
          }, busy === 'family-rename-name' ? '保存中…' : '保存家族名'),
          h('span', { style: s.hint }, '只改显示名，不改文件夹和 rootFolder')),
        h('div', { style: { ...s.bar, marginTop: '2px' } },
          h('span', { style: s.label }, '母会话'),
          h('input', {
            type: 'text',
            value: rootFolder || familyName,
            readOnly: true,
            disabled: true,
            title: '当前母会话的文件夹名，锁定不可改；需要更换请先让位/解散',
            style: { ...s.input, maxWidth: '260px', opacity: 0.65, cursor: 'not-allowed' },
          }),
          h('span', { style: s.hint }, '母会话锁定；子会话只能选择已有家族加入。')),
        familyStatus !== 'active'
          ? h('div', { style: s.hint },
            familyStatus === 'abdicated' ? '家族已让位；成员仍保留。新根尚未选出前，原母归属可以撤销让位；选出后只能重新加入，再由新母转移根。' :
              familyStatus === 'orphaned' ? '根目录/配置不可读；子会话下次对话会触发选举。' :
                familyStatus === 'migrating' ? '正在选举迁移；若长时间不变，检查 .family-journal.json。' :
                  familyStatus === 'dissolved' ? '家族已解散。' : '')
          : null,
        h('div', { style: s.familyList },
          h('div', { style: { ...s.familyMember, borderTop: 'none' } },
            h('span', { style: s.familyMemberName }, familyName),
            rootFolder ? h('span', { style: s.familyMemberFolder }, rootFolder) : null,
            h(Chip, { kind: 'ok' }, '母归属')),
          members.length === 0
            ? h('div', { style: { ...s.familyMember, opacity: 0.6 } }, '还没有成员。')
            : members.map((m) => h('div', {
              key: m.sessionId || m.folder,
              style: s.familyMember,
            },
              h('span', { style: s.familyMemberName }, m.name || m.folder || m.sessionId),
              m.folder ? h('span', { style: s.familyMemberFolder }, m.folder) : null))),
        members.length
          ? h('div', { style: { ...s.bar, marginTop: '2px' } },
            h('span', { style: s.label }, '转移根到'),
            h('select', {
              style: { ...s.input, width: '220px', maxWidth: '100%' },
              value: target,
              disabled: Boolean(busy) || loading || familyStatus !== 'active',
              onChange: (e) => setTarget(e.target.value),
            },
              h('option', { value: '' }, '选择成员…'),
              members.map((m) => h('option', { key: m.sessionId, value: m.sessionId }, m.name || m.folder || m.sessionId))),
            h('button', {
              type: 'button',
              style: s.btnSecondary,
              disabled: Boolean(busy) || loading || !target || familyStatus !== 'active',
              onClick: () => {
                const m = members.find((x) => x.sessionId === target)
                if (m) openConfirm('transferRoot', { target: m.sessionId, name: m.name || m.folder || m.sessionId })
              },
            }, '转移根'))
          : null,
        h('div', { style: { ...s.bar, marginTop: '2px' } },
          familyStatus === 'active'
            ? h('button', {
              type: 'button',
              style: s.btnSecondary,
              disabled: Boolean(busy) || loading,
              onClick: () => openConfirm('abdicate', { name: familyName }),
            }, '让位')
            : null,
          canRestoreRoot
            ? h('button', {
              type: 'button',
              style: s.btnPrimary,
              disabled: Boolean(busy) || loading,
              onClick: () => openConfirm('restoreRoot', { name: familyName }),
            }, busy === 'family-restore-root' ? '恢复中…' : '撤销让位')
            : null,
          (familyStatus === 'active' || familyStatus === 'abdicated')
            ? h('button', {
              type: 'button',
              style: s.btnDanger,
              disabled: Boolean(busy) || loading,
              onClick: () => openConfirm('dissolve', { name: familyName }),
            }, '解散')
            : null,
          familyStatus === 'dissolved'
            ? h('button', {
              type: 'button',
              style: s.btnPrimary,
              disabled: Boolean(busy) || loading,
              onClick: () => runDirect('family-root', '已重新设为母归属'),
            }, busy === 'family-root' ? '处理中…' : '重新设为母归属')
            : null,
          family?.formerRootSessionId
            ? h('button', {
              type: 'button',
              style: s.btnSecondary,
              disabled: Boolean(busy) || loading,
              onClick: () => {
                if (!window.confirm('确定清理旧根热核？只删除旧根 _core，保留归档；旧根会话必须已彻底删除。')) return
                runDirect('family-clean-former-core', '已清理旧根热核')
              },
            }, busy === 'family-clean-former-core' ? '清理中…' : '清理旧根热核')
            : null))

      const childView = h('div', { style: s.familyBlock },
        h('div', { style: s.bar },
          h(Chip, { kind: 'neutral' }, '子会话'),
          h('span', { style: s.hint }, '属于'),
          h('span', { style: { fontWeight: 600, wordBreak: 'break-word', minWidth: 0 } }, familyName),
          statusChip,
          rootFolder ? h('span', { style: s.familyMemberFolder }, rootFolder) : null),
        familyStatus !== 'active'
          ? h('div', { style: s.hint }, '母归属当前不是活跃状态；可以脱离。')
          : null,
        h('div', { style: { ...s.bar, marginTop: '2px' } },
          h('button', {
            type: 'button',
            style: s.btnSecondary,
            disabled: Boolean(busy) || loading,
            onClick: () => openConfirm('detach', { name: familyName }),
          }, '脱离'),
          h('button', {
            type: 'button',
            style: s.btnPrimary,
            disabled: Boolean(busy) || loading,
            onClick: () => openConfirm('detachCopy', { name: familyName }),
          }, '脱离并复制母记忆')))

      const rebuildBanner = family && family.rebuildPending
        ? h('div', { style: { ...s.msg, ...s.warn, marginBottom: '8px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '旧根热记忆缺失，需要重建吗？'),
          h('div', { style: { fontSize: '12px', marginBottom: '8px' } }, '重建会用长记忆/归档整理热记忆；不重建则保持为空。'),
          h('div', { style: s.bar },
            h('button', {
              type: 'button',
              style: s.btnPrimary,
              disabled: Boolean(busy) || loading,
              onClick: async () => {
                try { await postFamily('family-rebuild', { decision: 'yes' }); setNotice('已记录：同意重建热记忆'); refreshFamily() } catch (e) { setActionError(String(e?.message || e)) }
              },
            }, '重建热记忆'),
            h('button', {
              type: 'button',
              style: s.btnSecondary,
              disabled: Boolean(busy) || loading,
              onClick: async () => {
                try { await postFamily('family-rebuild', { decision: 'no' }); setNotice('已记录：保持为空'); refreshFamily() } catch (e) { setActionError(String(e?.message || e)) }
              },
            }, '保持为空')))
        : null

      const body = loading && !status
        ? h('div', { style: s.empty }, '读取中…')
        : error
          ? h('div', { style: s.emptyBox },
            h('div', { role: 'alert', style: s.err }, error),
            h('button', { type: 'button', style: s.btnSecondary, onClick: refreshFamily }, '重试'))
          : role === 'root'
            ? rootView
            : role === 'child'
              ? childView
              : independentView

      return h(Card, {
        title: '记忆家族',
        aside: loading ? '读取中…' : (error ? '读取失败' : (role === 'root' ? '母归属' : role === 'child' ? '子会话' : '独立会话')),
      },
        actionError ? h('div', { role: 'alert', style: { ...s.msg, ...s.err } }, actionError) : null,
        notice ? h('div', { role: 'status', 'aria-live': 'polite', style: { ...s.msg, ...s.ok } }, notice) : null,
        rebuildBanner,
        body,
        confirmModal)
    }

    function MemoryPalaceView(props) {
      const sessionId = props.sessionId || ''
      const { data, err, load, statsLoading, loadStats } = useStatus(sessionId)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState('')
      const [updateInfo, setUpdateInfo] = React.useState(null)
      const [updateCheckedAt, setUpdateCheckedAt] = React.useState(0)
      const [updateResult, setUpdateResult] = React.useState(null)
      const [updateOpen, setUpdateOpen] = React.useState(false)
      const [copyState, setCopyState] = React.useState('')
      const [checkingUpdate, setCheckingUpdate] = React.useState(false)
      const [installingUpdate, setInstallingUpdate] = React.useState(false)
      const [activeTab, setActiveTab] = React.useState('config')
      // 统计只由“计算统计/刷新统计”按钮触发；自动解码会话日志会阻塞宿主，导致页签卡在读取中。
      const [coreEntries, setCoreEntries] = React.useState(null)
      const [projects, setProjects] = React.useState([])
      const [candidates, setCandidates] = React.useState([])
      const tabCandidates = candidates.filter((c) => (c.section || 'memories') === activeTab)
      const [coreLoading, setCoreLoading] = React.useState(false)
      const [coreRefresh, setCoreRefresh] = React.useState(0)
      const [editor, setEditor] = React.useState(null)
      const [savedCoreId, setSavedCoreId] = React.useState('')
      const [savingCore, setSavingCore] = React.useState(false)
      const [form, setForm] = React.useState(null)
      const baseline = React.useRef(null)
      const initedFor = React.useRef(null)
      const tabRefs = React.useRef({})
      const editorBaseline = React.useRef('')
      const coreCache = React.useRef(new Map())

      React.useEffect(() => {
        if (!data) return
        // 只在首次拿到配置时初始化表单；异步补统计会触发 data 更新，
        // 不能因此把用户正在编辑的内容重置掉。
        if (initedFor.current === data.sessionId && form !== null) return
        initedFor.current = data.sessionId
        const next = {
          triggerPressurePct: String(Math.round(data.triggerPressure * 100)),
          checkEveryTurns: String(data.checkEveryTurns),
          cacheVerifyEvery: String(data.cacheVerifyEvery ?? 20),
          minBatchTurns: String(data.minBatchTurns),
          batchByteFractionPct: String(Math.round((data.batchByteFraction ?? 0.5) * 100)),
          retainFractionPct: String(Math.round((data.retainFraction || 0.12) * 100)),
          maxFileBytesMB: (Math.round(data.maxFileBytes / 100000) / 10).toFixed(1),
          name: String(data.name || ''),
          enableSteer: data.enableSteer,
          includeReasoning: data.includeReasoning,
          compactAfterArchive: data.compactAfterArchive === true,
          archiveTailTurns: String(data.archiveTailTurns ?? 2),
        summaryFallback: data.summaryFallback || 'own-then-family',
        summaryCandidateLimitEnabled: data.summaryCandidateLimitEnabled !== false,
        summaryCandidateLimit: String(data.summaryCandidateLimit ?? 12),
        summaryCandidateExtra: String(data.summaryCandidateExtra ?? 6),
        summaryCandidatePerMonth: String(data.summaryCandidatePerMonth ?? 3),
        summaryCandidateFloor: Number(data.summaryCandidateFloor) || 0,
          coreInjection: data.coreInjectionSetting || data.coreInjection || 'off',
          coreInjectionBudget: String(data.coreInjectionBudget ?? 10000),
          coreTierImportantTurns: String(data.coreTierImportantTurns ?? 5),
          coreTierImportantTokens: String(data.coreTierImportantTokens ?? 10000),
          coreTierNormalTurns: String(data.coreTierNormalTurns ?? 12),
          coreTierNormalTokens: String(data.coreTierNormalTokens ?? 30000),
          searchTurnLimit: String(data.searchTurnLimit ?? 12),
          groupByTurn: data.groupByTurn !== false,
          recallStrength: data.recallStrength || 'low',
          recursionMaxDepth: String(data.recursionMaxDepth ?? 1),
          recursionMaxWidth: String(data.recursionMaxWidth ?? 1),
        }
        setForm(next)
        baseline.current = JSON.stringify(next)
      }, [data])
      React.useEffect(() => {
        if (!sessionId) return
        if (!['identity', 'user', 'rules', 'memories'].includes(activeTab)) return
        let cancelled = false
        const cacheKey = `${sessionId}|${activeTab}`
        const cached = coreCache.current.get(cacheKey)
        if (cached) {
          setCoreEntries(cached)
          setCoreLoading(false)
        } else {
          setCoreEntries(null)
          setCoreLoading(true)
        }
        fetch(`${API}?action=core-list&sessionId=${encodeURIComponent(sessionId)}&section=${encodeURIComponent(activeTab)}`)
          .then(async (r) => {
            const body = await r.json().catch(() => ({}))
            if (!r.ok || body.ok === false) throw new Error(body.error || `HTTP ${r.status}`)
            return body
          })
          .then((body) => {
            const next = {
              ...body,
              entries: Array.isArray(body.entries) ? body.entries : [],
              total: Number(body.total) || 0,
              tokens: Number(body.tokens) || 0,
            }
            coreCache.current.set(cacheKey, next)
            if (!cancelled) setCoreEntries(next)
          })
          .catch((e) => {
            if (!cancelled && !cached) setCoreEntries({ ok: false, error: String(e?.message || e), entries: [], total: 0 })
          })
          .finally(() => { if (!cancelled) setCoreLoading(false) })
        return () => { cancelled = true }
      }, [activeTab, sessionId, coreRefresh])
      React.useEffect(() => {
        if (!sessionId || !['identity', 'user', 'rules', 'memories'].includes(activeTab)) { setCandidates([]); return }
        let cancelled = false
        fetch(`${API}?action=core-candidates&sessionId=${encodeURIComponent(sessionId)}`)
          .then((r) => r.json())
          .then((body) => { if (!cancelled) setCandidates(Array.isArray(body.items) ? body.items : []) })
          .catch(() => { if (!cancelled) setCandidates([]) })
        return () => { cancelled = true }
      }, [activeTab, sessionId, coreRefresh])
      React.useEffect(() => {
        if (!sessionId) { setProjects([]); return }
        let cancelled = false
        fetch(`${API}?action=projects-list&sessionId=${encodeURIComponent(sessionId)}`)
          .then((r) => r.json())
          .then((body) => { if (!cancelled) setProjects(Array.isArray(body.items) ? body.items : []) })
          .catch(() => { if (!cancelled) setProjects([]) })
        return () => { cancelled = true }
      }, [sessionId, coreRefresh])
      const editorChanged = Boolean(editor) && editorBaseline.current !== JSON.stringify({
        content: editor.content, tier: editor.tier, tags: editor.tags, projectLabel: editor.projectLabel,
      })
      const requestCloseEditor = () => {
        if (!editor) return true
        if (editorChanged && !window.confirm('有未保存的编辑，放弃修改？')) return false
        setEditor(null)
        editorBaseline.current = ''
        return true
      }
      const rememberEditor = (next) => {
        setEditor(next)
        editorBaseline.current = JSON.stringify({ content: next.content, tier: next.tier, tags: next.tags, projectLabel: next.projectLabel })
      }
      const openNewEditor = () => {
        if (!requestCloseEditor()) return
        setMsg('')
        setSavedCoreId('')
        rememberEditor({
          id: '', section: activeTab, content: '',
          tier: CORE_TIER_DEFAULT[activeTab] || 'normal', tags: '', projectLabel: '', projectLabelPrev: '',
        })
      }
      const openEditEditor = (e) => {
        if (editor && editor.id === e.id) return
        if (!requestCloseEditor()) return
        setMsg('')
        setSavedCoreId('')
        rememberEditor({
          id: e.id, rev: e.rev, section: e.board, content: e.content,
          tier: e.board === 'rules' && (e.tier === 'normal' || e.tier === 'minor') ? 'mind-seal' : e.tier,
          tags: (e.tags || []).join(', '), projectLabel: e.projectLabel || '', projectLabelPrev: e.projectLabel || '',
        })
      }
      const saveEditor = async () => {
        if (!editor || savingCore) return
        if (!String(editor.content).trim()) { setMsg('内容不能为空'); return }
        setSavingCore(true)
        try {
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              action: 'core-write',
              section: editor.section,
              id: editor.id || undefined,
              rev: editor.rev,
              content: editor.content,
              tier: editor.tier,
              projectLabel: editor.projectLabel,
        previousProjectLabel: editor.projectLabelPrev || '',
              tags: String(editor.tags || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean),
            }),
          })
          const body = await res.json()
          if (!res.ok || body.ok === false) throw new Error(body.error || String(res.status))
          setMsg(editor.id ? '' : '已保存')
          setSavedCoreId(editor.id || '')
          setEditor(null)
          editorBaseline.current = ''
          setCoreRefresh((x) => x + 1)
        } catch (e) {
          setMsg(String(e?.message || e))
        } finally {
          setSavingCore(false)
        }
      }
      const markInject = async (e) => {
        try {
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, action: 'core-pending', id: e.id, board: e.board }),
          })
          const body = await res.json()
          if (!res.ok || body.ok === false) throw new Error(body.error || String(res.status))
          setMsg('已排队：下一轮注入会带上这一条')
        } catch (err) {
          setMsg(String(err?.message || err))
        }
      }
      const candidateAction = async (item, action) => {
        try {
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, action, id: item.id }),
          })
          const body = await res.json()
          if (!res.ok || body.ok === false) throw new Error(body.error || String(res.status))
          setMsg(action === 'core-candidate-accept' ? '候选已保存' : '候选已忽略')
          setCandidates((prev) => prev.filter((c) => c.id !== item.id))
          if (action === 'core-candidate-accept') setCoreRefresh((x) => x + 1)
        } catch (err) {
          setMsg(String(err?.message || err))
        }
      }
      const removeEntry = async (e) => {
        const preview = String(e.content || '').trim().replace(/\s+/g, ' ').slice(0, 24)
        if (!window.confirm(`删除「${preview}${preview.length >= 24 ? '…' : ''}」？会软删到 .trash，不会立刻抹掉。`)) return
        try {
          const res = await fetch(API, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(data.coreConfirmToken ? { 'x-memory-palace-confirm': data.coreConfirmToken } : {}),
            },
            body: JSON.stringify({ sessionId, action: 'core-remove', id: e.id, board: e.board }),
          })
          const body = await res.json()
          if (!res.ok || body.ok === false) throw new Error(body.error || String(res.status))
          if (editor && editor.id === e.id) {
            setEditor(null)
            editorBaseline.current = ''
          }
          setMsg('已删除')
          setCoreRefresh((x) => x + 1)
        } catch (err) {
          setMsg(String(err?.message || err))
        }
      }
      const moveEntry = async (e, to) => {
        if (!to || to === e.board) return
        const targetLabel = CORE_TABS.find((t) => t.key === to)?.label || to
        if (!window.confirm(`确定把这条从「${CORE_TABS.find((t) => t.key === e.board)?.label || e.board}」转移到「${targetLabel}」？`)) return
        try {
          const res = await fetch(API, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(data.coreConfirmToken ? { 'x-memory-palace-confirm': data.coreConfirmToken } : {}),
            },
            body: JSON.stringify({ sessionId, action: 'core-move', id: e.id, from: e.board, to }),
          })
          const body = await res.json()
          if (!res.ok || body.ok === false) throw new Error(body.error || String(res.status))
          if (editor && editor.id === e.id) {
            setEditor(null)
            editorBaseline.current = ''
          }
          setMsg(`已转移到${targetLabel}`)
          setCoreRefresh((x) => x + 1)
        } catch (err) {
          setMsg(String(err?.message || err))
        }
      }
      React.useEffect(() => { setEditor(null); setMsg('') }, [sessionId])
      React.useEffect(() => {
        const el = tabRefs.current[activeTab]
        if (el && typeof el.scrollIntoView === 'function') {
          try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* 忽略滚动容器差异 */ }
        }
      }, [activeTab])
      const switchTab = (key) => {
        if (key === activeTab) return
        if (!requestCloseEditor()) return
        setMsg('')
        // 有缓存就立即显示缓存；没有才清空等加载，避免每次都闪空白。
        if (['identity', 'user', 'rules', 'memories'].includes(key)) {
          const cached = coreCache.current.get(`${sessionId}|${key}`)
          if (cached) {
            setCoreEntries(cached)
            setCoreLoading(false)
          } else {
            setCoreEntries(null)
            setCoreLoading(true)
          }
        }
        setActiveTab(key)
      }
      const dirty = form !== null && baseline.current !== null && JSON.stringify(form) !== baseline.current

      const run = async (fn, okText) => {
        setBusy(true); setMsg('')
        try {
          const out = await fn()
          await load()
          // fn 内部可能已经写入“已取消”等提示，不能用“已保存”覆盖。
          setMsg((prev) => prev || okText || (typeof out === 'string' && out ? out : '已保存'))
        } catch (e) { setMsg(String(e.message || e)) } finally { setBusy(false) }
      }

      const save = () => {
        // 先本地校验检索轮数：不合法就不发请求，也不让 run() 的“已保存”盖掉提示。
        const limit = Number(form.searchTurnLimit)
        if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
          setMsg('检索轮数必须是 1–30 的整数')
          return
        }
        // 递归轮次/宽度同样在 run() 外面校验，避免提示被“已保存”盖掉。
        const depth = Number(form.recursionMaxDepth)
        const width = Number(form.recursionMaxWidth)
        const depthOk = Number.isInteger(depth) && depth >= 1 && depth <= 5
        const widthOk = Number.isInteger(width) && width >= 1 && width <= 5
        if (!depthOk || !widthOk) {
          setMsg('递归轮次/宽度必须是 1–5 的整数')
          return
        }
        return run(async () => {
          const values = {}
          const pct = num(form.triggerPressurePct)
          if (pct !== undefined) values.triggerPressure = pct / 100
          const every = num(form.checkEveryTurns)
          if (every !== undefined) values.checkEveryTurns = every
          const verify = num(form.cacheVerifyEvery)
          if (verify !== undefined) values.cacheVerifyEvery = Math.min(Math.max(verify, 10), 100)
          const batch = num(form.minBatchTurns)
          if (batch !== undefined) values.minBatchTurns = batch
          const bf = num(form.batchByteFractionPct)
          if (bf !== undefined) values.batchByteFraction = bf / 100
          const mb = num(form.maxFileBytesMB)
          if (mb !== undefined) values.maxFileBytes = Math.round(mb * 1000000)
          values.name = String(form.name ?? '').trim()
          const rf = num(form.retainFractionPct)
          if (rf !== undefined) values.retainFraction = rf / 100
          values.enableSteer = Boolean(form.enableSteer)
          values.includeReasoning = Boolean(form.includeReasoning)
          values.compactAfterArchive = Boolean(form.compactAfterArchive)
        values.archiveTailTurns = Number(form.archiveTailTurns) || 0
        values.summaryFallback = form.summaryFallback || 'own-then-family'
        values.summaryCandidateLimitEnabled = Boolean(form.summaryCandidateLimitEnabled)
        values.summaryCandidateLimit = Number(form.summaryCandidateLimit) || 12
        values.summaryCandidateExtra = Number(form.summaryCandidateExtra) || 0
        values.summaryCandidatePerMonth = Number(form.summaryCandidatePerMonth) || 3
          values.coreInjection = form.coreInjection
          values.coreInjectionBudget = Number(form.coreInjectionBudget) || 10000
          values.coreTierImportantTurns = Number(form.coreTierImportantTurns) || 5
          values.coreTierImportantTokens = Number(form.coreTierImportantTokens) || 10000
          values.coreTierNormalTurns = Number(form.coreTierNormalTurns) || 12
          values.coreTierNormalTokens = Number(form.coreTierNormalTokens) || 30000
          values.searchTurnLimit = limit
          values.groupByTurn = Boolean(form.groupByTurn)
          values.recallStrength = form.recallStrength
          values.recursionMaxDepth = depth
          values.recursionMaxWidth = width
          await post(sessionId, 'set', values)
          baseline.current = JSON.stringify(form) // 保存成功：当前表单成为新的基线
        })
      }

      const checkUpdate = async (opts = {}) => {
        const keepOpen = opts && opts.keepOpen === true
        setCheckingUpdate(true)
        try {
          const res = await fetch(`${API}?action=check-update&sessionId=${encodeURIComponent(sessionId)}`)
          const body = await res.json()
          setUpdateInfo(body)
          setUpdateCheckedAt(Number(body?.checkedAt) || Date.now())
          setUpdateResult(null)
          if (!keepOpen) setUpdateOpen(Boolean(body?.ok && body?.hasUpdate))
        } catch (e) {
          setUpdateInfo({ ok: false, error: String(e?.message || e) })
          setUpdateResult(null)
        } finally {
          setCheckingUpdate(false)
        }
      }
      const installUpdate = async () => {
        if (!updateInfo?.ok || !updateInfo.hasUpdate || installingUpdate) return
        if (!window.confirm(`确认更新到 ${updateInfo.latestVersion}？更新后需要重启 DSH。`)) return
        setInstallingUpdate(true)
        try {
          const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, action: 'install-update', version: updateInfo.latestVersion }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
          setMsg(`已更新到 ${body.version}，请重启 DSH 生效`)
          await checkUpdate({ keepOpen: true })
          setUpdateResult({ ok: true, version: body.version })
          setUpdateOpen(true)
        } catch (e) {
          setMsg(`更新失败：${String(e?.message || e)}`)
          setUpdateResult({ ok: false, error: String(e?.message || e) })
          setUpdateOpen(true)
        } finally {
          setInstallingUpdate(false)
        }
      }

      const copyUpdateCommand = async (version) => {
        const cmd = `dsh plugin --profile <你的 profile> add @dafantong01/dsh-memory-palace@${version || 'latest'}`
        try {
          await navigator.clipboard.writeText(cmd)
          setCopyState('已复制')
        } catch {
          setCopyState('复制失败')
        }
        setTimeout(() => setCopyState(''), 2000)
      }

      if (!sessionId) {
        return h('div', { style: s.root },
          h('div', { style: s.page }, '没有会话上下文'))
      }
      if (!data || !form) {
        return h('div', { style: s.root },
          h('div', { style: s.page },
            h('div', { style: s.header }, h('div', { style: s.title }, '记忆宫殿')),
            err ? h('p', { style: s.err }, err) : h('p', { style: s.muted }, '读取中…')))
      }

      const kb = (v) => `${Math.round(v / 1024)} KB`
      const pctNow = num(form.triggerPressurePct) ?? 0
      const triggerTokens = Math.round((pctNow / 100) * (data.contextWindowTokens || 0))
      const retainBytesNow = data.retentionCapBytes || 0
      const coreBudget = Math.max(Number(data.coreInjectionBudget) || 10000, 1)
      const coreTokens = Number(coreEntries?.allTokens ?? coreEntries?.tokens) || 0
      const boardTokens = Number(coreEntries?.tokens) || 0
      const corePct = Math.min(100, Math.round((coreTokens / coreBudget) * 100))
      const coreOver = coreTokens > coreBudget
      const onOff = (v) => (v === undefined || v === null ? '未知' : (v ? '开' : '关'))
      const gateChip = (v) => h(Chip, { kind: v === true ? 'ok' : (v === false ? 'bad' : 'neutral') }, onOff(v))
      const gateWhy = () => {
        if (data.globalEnabled === false || (data.globalEnabled === undefined && !data.enabled)) return '全局总闸关闭'
        if (!data.sessionEnabled) return '本会话开关关闭'
        if (data.name === '') return '未命名'
        if (data.coreInjection === 'off') return '核心注入关闭'
        if (!data.injectNotice) return '自动提示关闭（不会主动 steer，仅工具可用）'
        return '未知原因'
      }
      const gateWarnings = []
      if (data.injectNotice === false) gateWarnings.push('未生效：自动提示关闭')
      if (data.coreInjection === 'off') gateWarnings.push('未生效：核心注入关闭')
      if (data.recallStrength === 'off') gateWarnings.push('只归档不回忆')
      if (data.nsMismatch) gateWarnings.push('命名与文件夹不一致')
      if (!data.active && gateWarnings.length === 0) gateWarnings.push(`未生效：${gateWhy()}`)
      const strengthIdx = Math.max(0, RECALL_KEYS.indexOf(form.recallStrength))
      const strengthNow = RECALL_KEYS[strengthIdx] || 'low'
      const recursionOn = strengthNow === 'high' || strengthNow === 'forced'

      const updateModal = updateOpen && updateInfo
        ? h('div', {
          style: {
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.38)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
          },
          onMouseDown: (e) => { if (e.target === e.currentTarget) setUpdateOpen(false) },
        },
          h('div', {
            role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件更新',
            style: {
              width: '100%', maxWidth: '520px', maxHeight: '84vh', overflow: 'auto',
              background: 'var(--dsh-bg, var(--dsw-alias-bg-base, #fff))', color: 'inherit',
              border: '1px solid rgba(128,128,128,.22)', borderRadius: '12px',
              boxShadow: '0 18px 60px rgba(0,0,0,.28)', padding: '16px 18px',
            },
          },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
              h('div', { style: { fontWeight: 600, fontSize: '15px' } }, updateInfo.pluginName || 'dsh-memory-palace'),
              h('button', { type: 'button', style: s.btnSecondary, onClick: () => setUpdateOpen(false) }, '关闭')),
            h('div', { style: { marginTop: '10px', fontSize: '13px', lineHeight: 1.65 } },
              h('div', null, `当前版本 ${updateInfo.currentVersion || '—'}`),
              h('div', { style: s.hint }, updateInfo.currentFeature || '当前版本功能说明'),
              h('div', { style: { marginTop: '8px' } }, `最新版本 ${updateInfo.latestVersion || '—'}`),
              h('div', { style: s.hint }, updateInfo.latestFeature || '最新版本功能说明'),
              h('div', { style: { fontWeight: 600, marginTop: '10px' } }, '更新说明'),
              h('div', { style: { whiteSpace: 'pre-wrap', maxHeight: '180px', overflow: 'auto' } }, updateInfo.updateNotes || '暂无更新说明'),
              h('div', { style: { ...s.hint, marginTop: '8px' } }, `来源：${updateInfo.installSource || '未识别'} · 检查于 ${updateCheckedAt ? new Date(updateCheckedAt).toLocaleTimeString() : '—'}`),
              updateResult?.ok
                ? h('div', { style: { color: 'rgb(28,130,80)', marginTop: '8px', fontWeight: 600 } }, `已更新到 ${updateResult.version}，请重启 DSH`)
                : null,
              updateResult?.ok === false
                ? h('div', { style: { color: 'rgb(180,60,50)', marginTop: '8px' } },
                  updateResult.error || '更新失败',
                  h('div', { style: { marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                    h('code', { style: { fontSize: '11px', wordBreak: 'break-all' } },
                      `dsh plugin --profile <你的 profile> add @dafantong01/dsh-memory-palace@${updateInfo.latestVersion || 'latest'}`),
                    h('button', { type: 'button', style: s.btnSecondary, onClick: () => copyUpdateCommand(updateInfo.latestVersion) }, copyState || '复制命令')))
                : null),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' } },
              h('button', { type: 'button', style: s.btnSecondary, onClick: () => setUpdateOpen(false) }, '稍后'),
              updateInfo.ok && updateInfo.hasUpdate
                ? h('button', {
                  type: 'button',
                  style: { ...s.btnPrimary, opacity: installingUpdate ? 0.6 : 1, cursor: installingUpdate ? 'default' : 'pointer' },
                  disabled: installingUpdate,
                  onClick: installUpdate,
                }, installingUpdate ? '更新中…' : '立即更新')
                : null)))
        : null

      return h('div', { style: s.root },
        updateModal,
        h('div', { style: s.page },

          // ── 页头 ─────────────────────────────────────────────
          h('div', { style: { ...s.header, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: s.title }, '记忆宫殿'),
              h('div', { style: s.subtitle },
                h('span', null, `当前会话：${data.name || data.sessionId || '未命名'}`),
                h('span', { style: s.muted }, '·'),
                h(Chip, { kind: data.sessionEnabled ? 'ok' : 'bad' }, data.sessionEnabled ? '已启用' : '未启用'),
                data.stats
                  ? h('span', null, `· 归档 ${data.stats.archivedTurns} / ${data.stats.totalTurns} 轮`)
                  : null,
                data.coreInjection !== 'off' && data.active ? h(Chip, { kind: 'ok' }, '生效中') : null)),
            activeTab === 'config'
              ? h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', minWidth: '260px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                  h('button', {
                    type: 'button',
                    style: { ...s.btnSecondary, opacity: checkingUpdate ? 0.6 : 1, cursor: checkingUpdate ? 'default' : 'pointer' },
                    disabled: checkingUpdate,
                    onClick: checkUpdate,
                  }, checkingUpdate ? '检查中…' : '检查更新'),
                  updateInfo
                    ? h('span', { style: { ...(updateInfo.ok ? s.hint : s.err), maxWidth: '240px' } },
                      updateInfo.ok
                        ? (updateInfo.hasUpdate
                          ? `${updateInfo.currentVersion} → ${updateInfo.latestVersion}（有新版本）`
                          : '已是最新')
                        : `失败：${updateInfo.error || '未知错误'}`)
                    : null,
                  updateInfo?.ok && updateInfo.hasUpdate
                    ? h('button', {
                      type: 'button',
                      style: { ...s.btnPrimary, opacity: installingUpdate ? 0.6 : 1, cursor: installingUpdate ? 'default' : 'pointer' },
                      disabled: installingUpdate,
                      onClick: installUpdate,
                    }, installingUpdate ? '更新中…' : '立即更新')
                    : null),
                false && updateInfo && (updateInfo.hasUpdate || updateResult)
                  ? h('div', {
                    style: {
                      border: '1px solid rgba(128,128,128,.18)', borderRadius: '8px', padding: '10px 12px',
                      fontSize: '12px', lineHeight: 1.65, minWidth: '280px', maxWidth: '380px',
                      background: 'rgba(128,128,128,.06)', textAlign: 'left',
                    },
                  },
                    h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, updateInfo.pluginName || 'dsh-memory-palace'),
                    h('div', null, `当前版本 ${updateInfo.currentVersion || '—'}`),
                    h('div', { style: s.hint }, updateInfo.currentFeature || '当前版本功能说明'),
                    h('div', { style: { marginTop: '4px' } }, `最新版本 ${updateInfo.latestVersion || '—'}`),
                    h('div', { style: s.hint }, updateInfo.latestFeature || '最新版本功能说明'),
                    h('div', { style: { fontWeight: 600, marginTop: '6px' } }, '更新说明'),
                    h('div', { style: { whiteSpace: 'pre-wrap', maxHeight: '150px', overflow: 'auto' } }, updateInfo.updateNotes || '暂无更新说明'),
                    h('div', { style: { ...s.hint, marginTop: '4px' } }, `来源：${updateInfo.installSource || '未识别'} · 检查于 ${updateCheckedAt ? new Date(updateCheckedAt).toLocaleTimeString() : '—'}`),
                    updateResult?.ok
                      ? h('div', { style: { color: 'rgb(28,130,80)', marginTop: '4px' } }, `已更新到 ${updateResult.version}，请重启 DSH`)
                      : null,
                    updateResult?.ok === false || updateInfo.ok === false
                      ? h('div', { style: { color: 'rgb(180,60,50)', marginTop: '4px' } },
                        updateResult?.error || updateInfo.error || '更新失败',
                        h('div', { style: { marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                          h('code', { style: { fontSize: '11px', wordBreak: 'break-all' } },
                            `dsh plugin --profile <你的 profile> add @dafantong01/dsh-memory-palace@${updateInfo.latestVersion || 'latest'}`),
                          h('button', {
                            type: 'button',
                            style: s.btnSecondary,
                            onClick: () => copyUpdateCommand(updateInfo.latestVersion),
                          }, copyState || '复制命令')))
                      : null)
                  : null)
              : null),

          // ── 横向子页签（框架） ───────────────────────────────
          h('div', {
            role: 'tablist',
            'aria-label': '记忆宫殿板块',
            style: {
              display: 'flex', gap: '2px', alignItems: 'stretch',
              borderBottom: '1px solid rgba(128,128,128,.18)',
              margin: '2px 0 8px', overflowX: 'auto', whiteSpace: 'nowrap',
              position: 'sticky', top: 0, zIndex: 7,
              background: 'var(--dsh-bg, var(--dsw-alias-bg-base, #fff))',
            },
          },
            CORE_TABS.map((t) => h('button', {
              key: t.key,
              type: 'button',
              role: 'tab',
              'aria-selected': activeTab === t.key,
              ref: (el) => { tabRefs.current[t.key] = el },
              onClick: () => switchTab(t.key),
              style: {
                background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
                padding: '8px 10px 7px', fontSize: '13px',
                color: activeTab === t.key ? 'var(--dsh-accent, var(--dsw-alias-brand-primary, #3b6ef5))' : 'var(--dsw-alias-label-secondary, #666)',
                borderBottom: activeTab === t.key ? '2px solid var(--dsh-accent, var(--dsw-alias-brand-primary, #3b6ef5))' : '2px solid transparent',
                fontWeight: activeTab === t.key ? 600 : 400,
              },
            }, t.label))),

          // 当前页签说明，帮助区分「归档」与「配置」
          h('div', { style: s.tabHint }, TAB_HINTS[activeTab] || ''),
          (activeTab === 'archive' || activeTab === 'config')
            ? h(React.Fragment, null,
            h('div', { style: { display: activeTab === 'config' ? 'block' : 'none' } },

          // ── 配置操作：粘性顶部（保存按钮永远可见） ───────────
          h(SaveBar, {
            title: '配置操作',
            saveLabel: '保存配置',
            hint: '保存会话、命名与记忆核心设置；归档参数会一并写入',
            dirty, busy, msg, err,
            onSave: save,
          }),

          // ── 状态卡片 ─────────────────────────────────────────
          h(Card, { title: '状态' },
            h('div', { style: s.switchRow },
              h(Switch, {
                value: data.sessionEnabled,
                disabled: busy,
                onChange: (on) => run(() => post(sessionId, on ? 'on' : 'off'), on ? '已开启本会话' : '已关闭本会话'),
              }),
              h(Chip, { kind: data.sessionEnabled ? 'ok' : 'bad' }, data.sessionEnabled ? '已启用' : '未启用'),
              ...gateWarnings.map((w, i) => h(Chip, { key: `gate-warning-${i}`, kind: 'bad' }, w))),

            h('div', { style: s.gateRow },
              h('span', { style: s.gateLabel }, '生效门'),
              h('span', { style: s.gateItem }, '全局 enabled', gateChip(data.enabled)),
              h('span', { style: s.gateItem }, '本会话 sessionEnabled', gateChip(data.sessionEnabled)),
              h('span', { style: s.gateItem }, '自动提示 injectNotice', gateChip(data.injectNotice)),
              h('span', { style: s.gateItem }, '核心注入 coreInjection', gateChip(data.coreInjection !== 'off')),
              h('span', { style: s.gateItem }, '记忆回廊 active', gateChip(data.active))),

            h('div', { style: { ...s.bar, marginBottom: '6px' } },
              h('button', {
                type: 'button',
                style: { ...s.btnSecondary, opacity: statsLoading ? 0.6 : 1, cursor: statsLoading ? 'default' : 'pointer' },
                disabled: statsLoading,
                onClick: loadStats,
              }, statsLoading ? '计算中…' : (data.stats ? '刷新统计' : '计算统计')),
              h('span', { style: s.hint }, '统计会解码会话日志，首次较慢；不点不影响其他页签')),

            data.stats
              ? h('div', { style: s.stats },
                h(Stat, { label: '总轮次', value: data.stats.totalTurns }),
                h(Stat, { label: '已归档', value: data.stats.archivedTurns }),
                h(Stat, { label: '待归档', value: data.stats.pendingTurns }),
                h(Stat, { label: '水位', value: data.stats.watermark }))
              : h('div', { style: s.stats },
                h(Stat, { label: '总轮次', value: statsLoading ? '计算中…' : '—' }),
                h(Stat, { label: '已归档', value: statsLoading ? '计算中…' : '—' }),
                h(Stat, { label: '待归档', value: statsLoading ? '计算中…' : '—' }),
                h(Stat, { label: '水位', value: statsLoading ? '计算中…' : '—' })),

            h('div', { style: s.lastCheck },
              data.lastCheckTurn
                ? `上次检查 turn ${data.lastCheckTurn}（${data.lastCheckAt}），实测占用 ${Math.round((data.lastPressure || 0) * 100)}%${data.lastPressureSource === 'log-sum' ? '（日志估算）' : ''}｜已归档到 turn ${data.archivedThroughTurn || 0}`
                : '还没有检查记录'),

            h('div', { style: s.naming },
              h(Field, {
                label: '记忆命名', value: form.name, wide: true, disabled: busy,
                suffix: '英文/数字/空格/下划线/连字符，首尾不能空格；留空 = 用会话ID 且不归档',
                onChange: (v) => setForm({ ...form, name: v }),
              })),

            h('div', { style: s.env },
              h('div', null, '工作区：', h('code', { style: s.code }, data.workspace)),
              h('div', null,
                '本会话文件夹：', h('code', { style: s.code }, data.nsLabel || ''),
                data.name ? null : h('span', { style: s.muted }, '（未命名，不会归档）')))),

          // ── 记忆核心 / 版本 ─────────────────────────────────
          h(Card, { title: '记忆核心（本地热记忆）' },
            h('div', { style: s.grid },
              h('div', { style: s.field },
                h('span', { style: s.label }, '注入模式'),
                h('div', { style: s.ctrlRow },
                  h('select', {
                    style: { ...s.input, width: '180px' },
                    value: form.coreInjection,
                    disabled: busy,
                    onChange: (e) => setForm({ ...form, coreInjection: e.target.value }),
                  },
                  h('option', { value: 'off' }, '关闭'),
                  h('option', { value: 'on' }, '开启'),
                  h('option', { value: 'test' }, '测试模式（仅本会话、加测试头）'),
                  data.familyRole === 'child'
                    ? h('option', { value: 'inherit' }, '跟随母归属（默认）')
                    : null)),
                h('div', { style: s.hint }, '子会话默认跟随母归属；开启前确认不会与其他记忆工具重复注入')),
              h('div', { style: s.bar },
                h(Field, {
                  label: 'important 轮数', value: form.coreTierImportantTurns, disabled: busy,
                  type: 'number', min: 1, max: 100,
                  suffix: '默认 5；达到即注入（1–100）',
                  onChange: (v) => setForm({ ...form, coreTierImportantTurns: v }),
                }),
                h(Field, {
                  label: 'important tokens', value: form.coreTierImportantTokens, disabled: busy,
                  type: 'number', min: 0, max: 200000,
                  suffix: '默认 10000（0–200000）',
                  onChange: (v) => setForm({ ...form, coreTierImportantTokens: v }),
                })),
              h('div', { style: s.bar },
                h(Field, {
                  label: 'normal 轮数', value: form.coreTierNormalTurns, disabled: busy,
                  type: 'number', min: 1, max: 200,
                  suffix: '默认 12；达到即注入（1–200）',
                  onChange: (v) => setForm({ ...form, coreTierNormalTurns: v }),
                }),
                h(Field, {
                  label: 'normal tokens', value: form.coreTierNormalTokens, disabled: busy,
                  type: 'number', min: 0, max: 500000,
                  suffix: '默认 30000（0–500000）',
                  onChange: (v) => setForm({ ...form, coreTierNormalTokens: v }),
                }))),
            h('div', { style: s.bar },
              h('button', {
                type: 'button',
                style: { ...s.btnSecondary, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' },
                disabled: busy,
                onClick: async () => {
                  try {
                    const r = await fetch(`${API}?action=core-debug&sessionId=${encodeURIComponent(sessionId)}`)
                    const d = await r.json()
                    setMsg(`已生成调试信息：${JSON.stringify({
                      counts: d.counts,
                      wouldInjectTokens: d.wouldInjectTokens,
                    })}`)
                  } catch (e) { setMsg(String(e?.message || e)) }
                },
              }, '查看注入调试'),
              h('span', { style: s.hint }, '修改后点上方「保存配置」'))),
          h(Card, { title: '高危配置（记忆核心）' },
            h('div', { style: { ...s.hint, color: 'rgb(180,90,20)', fontWeight: 600, marginBottom: '8px' } },
              '注入预算太小会截断铁律，太大增加每轮 token；修改后点上方「保存配置」。'),
            h(Field, {
              label: '注入预算 tokens', value: form.coreInjectionBudget, disabled: busy,
              type: 'number', min: 1000, max: 20000,
              suffix: '默认 10000；1000–20000；不足不强行塞满',
              onChange: (v) => setForm({ ...form, coreInjectionBudget: v }),
            })),
          h(FamilyCard, { sessionId, active: activeTab === 'config' })),

            h('div', { style: { display: activeTab === 'archive' ? 'block' : 'none' } },

          // ── 归档操作：粘性顶部（保存按钮永远可见） ─────────────
          h(SaveBar, {
            title: '归档操作',
            saveLabel: '保存参数',
            hint: '改完参数点「保存参数」；「现在归档」只是给模型发一条指令',
            dirty, busy, msg, err,
            onSave: save,
            onArchive: () => run(async () => {
              if (form.compactAfterArchive && !window.confirm(
                `当前已启用「归档后彻底压缩」：本次会归档除最后 ${Number(form.archiveTailTurns) || 0} 轮外的全部轮次；压缩只保留最近几条，未归档的近期轮次也可能被一起压掉。\n\n确定现在归档并压缩？`
              )) return '已取消归档'
              const r = await post(sessionId, 'archive', {})
              return r.message || '已发送归档指令'
            }),
          }),

          // ── 检索与回忆卡片 ───────────────────────────────────
          h(Card, { title: '检索与回忆' },
            h('div', { style: s.grid },
              h(IntSlider, {
                label: '检索轮数 limitTurns', value: form.searchTurnLimit, min: 1, max: 30,
                suffix: '按轮聚合时返回多少轮（1–30 整数）', disabled: busy,
                onChange: (v) => setForm({ ...form, searchTurnLimit: v }),
              }),
              h(Check, {
                label: '检索按轮聚合', value: form.groupByTurn, disabled: busy,
                onChange: (v) => setForm({ ...form, groupByTurn: v }),
              })),

            h('div', { style: { ...s.field, marginTop: '8px' } },
              h('div', { style: s.strengthHead },
                h('span', { style: s.label }, '回忆强度'),
                h(Chip, { kind: 'neutral' }, RECALL_LABELS[strengthIdx])),
              h('div', { style: s.ctrlRow },
                h('input', {
                  type: 'range', min: 0, max: 4, step: 1,
                  value: strengthIdx, disabled: busy,
                  style: { ...s.range, minWidth: '100px', maxWidth: '220px' },
                  onChange: (e) => setForm({ ...form, recallStrength: RECALL_KEYS[Number(e.target.value)] || 'low' }),
                })),
              h('div', { style: s.hint }, RECALL_HINT)),

            h('div', { style: { ...s.grid, marginTop: '8px' } },
              h(IntSlider, {
                label: '回忆预算（轮次）', value: form.recursionMaxDepth, min: 1, max: 5,
                suffix: 'recallBudgetRounds · 1–5 整数', disabled: busy || !recursionOn,
                onChange: (v) => setForm({ ...form, recursionMaxDepth: v }),
              }),
              h(IntSlider, {
                label: '回忆预算（每轮关键词）', value: form.recursionMaxWidth, min: 1, max: 5,
                suffix: 'recallBudgetKeywords · 1–5 整数', disabled: busy || !recursionOn,
                onChange: (v) => setForm({ ...form, recursionMaxWidth: v }),
              })),

            h('div', { style: { ...s.hint, marginTop: '6px' } },
              '预算是给模型的建议上限（插件不强制执行），只在「高/强制」档出现')),

          // ── 归档参数卡片 ─────────────────────────────────────
          h(Card, { title: '归档参数' },
            h('div', { style: s.derived },
              '按当前输入实时计算：会话估算到 ',
              h('b', null, triggerTokens.toLocaleString()),
              ` tokens 时触发归档（${pctNow}% × ${(data.contextWindowTokens || 0).toLocaleString()}）`),
            h('div', { style: s.hint }, '触发阈值、保留比例、批量/检查/压缩等参数已移至配置页的「高危配置」。'),
            h('details', { style: s.details },
              h('summary', { style: s.summary }, '只读估算'),
              h('div', { style: { ...s.grid, marginTop: '8px' } },
                h(ROField, {
                  label: '保留字节（自动计算）',
                  value: `${Math.round(retainBytesNow / 1024).toLocaleString()} KB`,
                  hint: '窗口 × 保留比例 × 3 字节/token · 自动计算 · 只读',
                }),
                h(ROField, {
                  label: '无需归档的近期文本量',
                  value: (data.retentionCapTokens || 0).toLocaleString(),
                  hint: `tokens · 窗口 × ${form.retainFractionPct}% · 自动计算 · 只读`,
                }),
                h(ROField, {
                  label: '估算窗口 tokens',
                  value: (data.contextWindowTokens || 0).toLocaleString(),
                  hint: '自动探测 · 只读',
                })))),

h(Card, { title: '高危配置（归档）' },
              h('div', { style: { ...s.hint, color: 'rgb(180,90,20)', fontWeight: 600, marginBottom: '8px' } },
                '修改前先确认影响：可能改变归档时机、上下文压缩、注入预算或缓存行为。'),
              h('div', { style: s.grid },
                h(PctField, {
                  label: '触发阈值', value: form.triggerPressurePct, min: 20, max: 95,
                  suffix: '20–95', disabled: busy,
                  onChange: (v) => setForm({ ...form, triggerPressurePct: v }),
                }),
                h(PctField, {
                  label: '无需归档比例', value: form.retainFractionPct, min: 2, max: 50,
                  suffix: '2–50，建议 < 16', disabled: busy,
                  onChange: (v) => setForm({ ...form, retainFractionPct: v }),
                }),
                h(PctField, {
                  label: '批量兜底阈值', value: form.batchByteFractionPct, min: 5, max: 100,
                  suffix: '可归档量比例', disabled: busy,
                  onChange: (v) => setForm({ ...form, batchByteFractionPct: v }),
                }),
                h(Field, {
                  label: '检查频率（每 N 轮）', value: form.checkEveryTurns, disabled: busy,
                  type: 'number', min: 1, max: 1000,
                  onChange: (v) => setForm({ ...form, checkEveryTurns: v }),
                }),
                h(Field, {
                  label: '最小归档批量（轮）', value: form.minBatchTurns, disabled: busy,
                  type: 'number', min: 1, max: 1000,
                  onChange: (v) => setForm({ ...form, minBatchTurns: v }),
                }),
                h(Field, {
                  label: '单文件上限 MB', value: form.maxFileBytesMB, disabled: busy,
                  type: 'number', min: 1, max: 5000,
                  onChange: (v) => setForm({ ...form, maxFileBytesMB: v }),
                }),
                h(Field, {
                  label: '缓存校准间隔（写入次数）', value: form.cacheVerifyEvery, disabled: busy,
                  type: 'number', min: 10, max: 100,
                  suffix: '10–100，默认 20；只统计实际追加/重建',
                  onChange: (v) => setForm({ ...form, cacheVerifyEvery: v }),
                })),
              h('div', { style: s.checks },
                h(Check, {
                  label: '自动提示（steer）', value: form.enableSteer, disabled: busy,
                  onChange: (v) => setForm({ ...form, enableSteer: v }),
                }),
                h(Check, {
                  label: '收录深度思考', value: form.includeReasoning, disabled: busy,
                  onChange: (v) => setForm({ ...form, includeReasoning: v }),
                }),
                h(Check, {
                  label: '归档后彻底压缩（只保留最近几条，未归档轮次也可能被压掉）',
                  value: form.compactAfterArchive, disabled: busy,
                  onChange: (v) => setForm({ ...form, compactAfterArchive: v }),
                })),
                h(Field, {
                  label: '彻底压缩时保留最后几轮', value: form.archiveTailTurns, disabled: busy,
                  type: 'number', min: 0, max: 100,
                  suffix: '默认 2；仅勾选上面选项并手动归档时生效（0–100）',
                  onChange: (v) => setForm({ ...form, archiveTailTurns: v }),
                }),
                h('div', { style: s.field },
                  h('span', { style: s.label }, '摘要未命中回退'),
                  h('select', {
                    style: { ...s.input, width: '100%' },
                    value: form.summaryFallback || 'own-then-family',
                    disabled: busy,
                    onChange: (e) => setForm({ ...form, summaryFallback: e.target.value }),
                  },
                    h('option', { value: 'own-then-family' }, '先本会话，再家族子会话'),
                    h('option', { value: 'own-then-family-ask' }, '先本会话→家族，候选都不相关再问用户'),
                    h('option', { value: 'own-only' }, '仅本会话（不查家族）'),
                    h('option', { value: 'full-search' }, '本会话未命中，直接全库搜'),
                    h('option', { value: 'ask-user' }, '本会话未命中，先问用户')),
                  h('div', { style: s.hint }, '先扫本会话摘要；没命中再按这里决定查家族、全库、问用户，或只返回本会话候选摘要。'),
                  h(Check, {
                    label: '候选摘要硬上限（默认开启；不勾选可一直翻到结束）',
                    value: form.summaryCandidateLimitEnabled, disabled: busy,
                    onChange: (v) => setForm({ ...form, summaryCandidateLimitEnabled: v }),
                  }),
                  h('div', { style: s.field },
                    h('span', { style: s.label }, '总候选月数上限'),
                    h('input', {
                      style: { ...s.input, width: '100%', opacity: 0.65 },
                      value: form.summaryCandidateLimitEnabled
                        ? `${Number(form.summaryCandidateFloor || 0) + (Number(form.summaryCandidateExtra) || 0)}（保底 ${Number(form.summaryCandidateFloor || 0)} + 增量 ${Number(form.summaryCandidateExtra) || 0}）`
                        : '不限制',
                      readOnly: true,
                      disabled: true,
                    })),
                  h('div', { style: { ...s.grid, marginTop: '8px' } },
                    h(IntSlider, {
                      label: '候选月数增量', value: form.summaryCandidateExtra, min: 0, max: 18,
                      suffix: '实际上限 = 保底月数 + 增量（0–18 整数）',
                      disabled: busy || !form.summaryCandidateLimitEnabled,
                      onChange: (v) => setForm({ ...form, summaryCandidateExtra: v }),
                    }),
                    h(IntSlider, {
                      label: '每月最多候选段数', value: form.summaryCandidatePerMonth, min: 1, max: 6,
                      suffix: '调高会增加候选与 token，调低可能漏掉同月其他类别（1–6 整数）',
                      disabled: busy || !form.summaryCandidateLimitEnabled,
                      onChange: (v) => setForm({ ...form, summaryCandidatePerMonth: v }),
                    })),
              ),
              ),

          // ── 最近事件卡片 ─────────────────────────────────────
          h(Card, { title: '最近事件' },
            Array.isArray(data.events) && data.events.length > 0
              ? h('div', { style: s.events },
                data.events.slice(-5).reverse().map((e, i) => h('div', {
                  key: i,
                  style: s.eventLine,
                }, `${e.t} [${e.kind}] ${e.detail}`)))
              : h('div', { style: s.empty }, '暂无事件')),

          // ── 归档列表卡片 ─────────────────────────────────────
          h(Card, {
            title: '最近归档',
            aside: `显示 ${data.archives.length} 条` + (data.totals ? ` · 共 ${data.totals.count} 份 ${(data.totals.bytes / 1024 / 1024).toFixed(2)} MB` : ''),
          },
            h('div', { style: s.tableHead },
              h('span', null, '文件'),
              h('span', { style: { textAlign: 'right' } }, '大小 / 轮次')),
            data.archives.length === 0
              ? h('div', { style: s.empty }, '还没有归档。')
              : data.archives.map((a, i) => h('div', {
                key: i,
                style: { ...s.archiveRow, borderTop: i === 0 ? 'none' : '1px solid rgba(128,128,128,.12)' },
              },
                h('div', { style: s.archiveMain },
                  h('div', { style: s.archiveMeta },
                    h('span', null, a.archivedAt),
                    h(Chip, { kind: 'neutral' }, a.category)),
                  h('div', { style: s.archiveFile }, a.file)),
                h('div', { style: s.archiveRight },
                  h('div', null, `${(a.bytes / 1024).toFixed(1)} KB`),
                  h('div', { style: s.muted }, `turn ${a.fromTurn}–${a.toTurn}`)))))
            ),
            
            )
            : activeTab === 'documents'
              ? h(DocsPanel, { sessionId, coreConfirmToken: data?.coreConfirmToken, onChanged: () => setCoreRefresh((x) => x + 1) })
              : h(Card, {
                  title: ((CORE_TABS.find((x) => x.key === activeTab) || {}).label || '记忆宫殿'),
                },
                  h('div', { style: s.bar },
                    h('button', {
                      type: 'button',
                      style: { ...s.btnSecondary, opacity: coreLoading ? 0.6 : 1, cursor: coreLoading ? 'default' : 'pointer' },
                      disabled: coreLoading,
                      onClick: () => setCoreRefresh((x) => x + 1),
                    }, '刷新'),
                    h('button', {
                      type: 'button',
                      style: {
                        ...s.btnPrimary, padding: '4px 12px',
                        opacity: (coreLoading || savingCore || !coreEntries || coreEntries.ok === false) ? 0.5 : 1,
                        cursor: (coreLoading || savingCore || !coreEntries || coreEntries.ok === false) ? 'default' : 'pointer',
                      },
                      disabled: coreLoading || savingCore || !coreEntries || coreEntries.ok === false,
                      onClick: openNewEditor,
                    }, '新增'),
                    editor ? h(Chip, { kind: 'warn' }, editor.id ? '编辑中' : '新增中') : null,
                    h('span', { style: s.hint },
                      coreLoading || !coreEntries
                        ? '读取中…'
                        : coreEntries.ok === false
                          ? '读取失败'
                          : `共 ${coreEntries.total} 条${coreEntries.truncated ? ' · 已截断' : ''}${coreEntries.errors?.length ? ` · ${coreEntries.errors.length} 个文件解析失败` : ''}`),
                    h('div', {
                      style: { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', minWidth: '190px', flex: '1 1 190px' },
                      title: '全局注入预算：所有板块共享 10000；进度条按全局合计，本板块数字只是该板块估算',
                    },
                      h('div', {
                        style: { flex: '1 1 100px', height: '6px', borderRadius: '3px', background: 'rgba(128,128,128,.18)', overflow: 'hidden' },
                      }, h('div', {
                        style: {
                          width: `${corePct}%`, height: '100%',
                          background: coreOver ? '#d9534f' : (corePct > 75 ? '#d08b2e' : 'var(--dsh-accent, var(--dsw-alias-brand-primary, #3b6ef5))'),
                        },
                      })),
                      h('span', { style: { ...s.hint, whiteSpace: 'nowrap', color: coreOver ? s.err.color : undefined } }, `全局 ${coreTokens}/${coreBudget} · 本板块 ${boardTokens}`))),
                  msg
                    ? h('div', {
                      role: 'status',
                      'aria-live': 'polite',
                      style: { ...s.msg, ...(isOkMsg(msg) ? s.ok : s.err) },
                    }, msg)
                    : null,
                  editor && editor.section === activeTab && !editor.id
                    ? h('div', { style: s.editorBox },
                      h('div', { style: s.editorHead },
                        h('div', { style: s.cardTitle }, editor.id ? '编辑条目' : '新增条目'),
                        editor.id ? h('span', { style: s.tinyCode, title: editor.id }, shortId(editor.id)) : null),
                      h('div', { style: s.field },
                        h('span', { style: s.label }, '正文（Markdown）'),
                        h('textarea', {
                          style: { ...s.input, width: '100%', minHeight: '96px', boxSizing: 'border-box', resize: 'vertical' },
                          placeholder: '条目正文（Markdown）',
                          value: editor.content,
                          disabled: savingCore,
                          autoFocus: true,
                          onChange: (e) => setEditor({ ...editor, content: e.target.value }),
                          onKeyDown: (e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                              e.preventDefault()
                              saveEditor()
                            }
                          },
                        })),
                      h('div', { style: { ...s.grid, marginTop: '8px' } },
                        h('div', { style: s.field },
                          h('span', { style: s.label }, '层级 tier'),
                          h('select', {
                            style: { ...s.input, width: '100%' },
                            value: editor.tier,
                            disabled: savingCore,
                            onChange: (e) => setEditor({ ...editor, tier: e.target.value }),
                          }, tierOptionsFor(editor.section).map((t) => h('option', { key: t, value: t }, `${TIER_LABELS[t] || t}（${t}）`)))),
                        h('div', { style: s.field },
                          h('span', { style: s.label }, '标签 tags'),
                          h('input', {
                            style: { ...s.input, width: '100%' },
                            placeholder: '每个 ≤16 字，最多 8 个，逗号分隔',
                            value: editor.tags,
                            disabled: savingCore,
                            onChange: (e) => setEditor({ ...editor, tags: e.target.value }),
                          })),
                        h('div', { style: { ...s.field, gridColumn: '1 / -1' } },
                          h('span', { style: s.label }, '项目 label（可选）'),
                          h(ProjectSelect, {
                            value: editor.projectLabel || '',
                            projects,
                            disabled: savingCore,
                            onChange: (v) => setEditor({ ...editor, projectLabel: v }),
                          }))),
                      h('div', { style: s.hint }, '层级越高，注入越优先：铁律 > 重要 > 普通 > 次要'),
                      h('div', { style: { ...s.bar, marginTop: '8px' } },
                        h('button', {
                          type: 'button',
                          style: { ...s.btnPrimary, opacity: savingCore ? 0.6 : 1, cursor: savingCore ? 'default' : 'pointer' },
                          disabled: savingCore,
                          onClick: saveEditor,
                        }, savingCore ? '保存中…' : '保存'),
                        h('button', {
                          type: 'button',
                          style: s.btnSecondary,
                          disabled: savingCore,
                          onClick: requestCloseEditor,
                        }, '取消')))
                    : null,
                  activeTab !== 'config' && tabCandidates.length
                    ? h('div', { style: { ...s.editorBox, marginBottom: '10px' } },
                      h('div', { style: s.editorHead },
                        h('div', { style: s.cardTitle }, '待确认记忆候选'),
                        h('span', { style: s.hint }, '模型提议，未写入；确认后才保存')),
                      tabCandidates.map((c) => h('div', { key: c.id, style: s.coreRow },
                        h('div', { style: s.coreMeta },
                          h(Chip, { kind: 'warn' }, c.kind || '候选'),
                          h('span', { style: s.muted }, `${c.section || 'memories'} · ${c.tier || 'normal'}`),
                          h('span', { style: s.muted }, `${Math.round((Number(c.confidence) || 0) * 100)}%`)),
                        h('div', { style: { ...s.coreContent, maxHeight: '5em', overflow: 'hidden' } }, c.proposedText || c.text),
                        c.proposedText && c.proposedText !== c.text
                          ? h('div', { style: s.hint }, `原句：${c.text}`)
                          : null,
                        h('div', { style: s.coreActions },
                          h('button', {
                            type: 'button',
                            style: s.btnPrimary,
                            onClick: () => candidateAction(c, 'core-candidate-accept'),
                          }, c.section === 'rules' ? '存为铁律' : '存为关键记忆'),
                          h('button', {
                            type: 'button',
                            style: s.btnSecondary,
                            onClick: () => candidateAction(c, 'core-candidate-dismiss'),
                          }, '忽略')))))
                    : null,
                  coreLoading || !coreEntries
                    ? h('div', { style: s.empty }, '读取中…')
                    : coreEntries.ok === false
                      ? h('div', { style: s.emptyBox },
                        h('div', { style: s.err }, coreEntries.error || '读取失败'),
                        h('button', { type: 'button', style: s.btnSecondary, onClick: () => setCoreRefresh((x) => x + 1) }, '重试'))
                      : coreEntries.entries.length === 0
                        ? (editor && editor.section === activeTab
                          ? null
                          : h('div', { style: s.emptyBox },
                            h('div', { style: s.muted }, '这个板块还没有条目。'),
                            h('button', { type: 'button', style: { ...s.btnPrimary, padding: '4px 12px' }, onClick: openNewEditor }, '新增第一条')))
                        : coreEntries.entries.map((e, i) => h(CoreEntry, {
                          key: e.id,
                          entry: e,
                          index: i,
                          editing: Boolean(editor && editor.id === e.id && editor.section === activeTab),
                          savedId: savedCoreId,
                          editor,
                          projects,
                          familyRole: data.familyRole,
                          sessionName: data.name,
                          savingCore,
                          onChangeEditor: setEditor,
                          onSaveEditor: saveEditor,
                          onCancelEditor: requestCloseEditor,
                          onEdit: () => openEditEditor(e),
                          onMove: (to) => moveEntry(e, to),
                          onRemove: () => removeEntry(e),
                          onInject: () => markInject(e),
                        })))
        )
      )
    }

    /** 回合底部：默认一行小字，展开才看注入明细。 */
    function TurnTail(props) {
      const [state, setState] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        if (!props.sessionId) return
        let cancelled = false
        let timer = null
        const load = () => {
          fetch(`${API}?action=core-inject-state&sessionId=${encodeURIComponent(props.sessionId)}`)
            .then((r) => r.json())
            .then((body) => { if (!cancelled && body && body.ok) setState(body) })
            .catch(() => { /* 静默：回合尾巴不报错 */ })
        }
        load()
        timer = setInterval(load, 2500)
        return () => { cancelled = true; if (timer) clearInterval(timer) }
      }, [props.sessionId])
      if (!state) return null
      const lastNormal = state.last
      const lastManual = state.lastManual
      const last = lastManual && (!lastNormal || (Date.parse(lastManual.at) || 0) >= (Date.parse(lastNormal.at) || 0))
        ? lastManual
        : lastNormal
      const tailTurn = Number(props.turn?.turn) || 0
      const injectedTurn = Number(last?.turn) || 0
      if (tailTurn && injectedTurn && tailTurn !== injectedTurn) return null
      const pending = Array.isArray(state.pending) ? state.pending.length : 0
      const retrieval = state.retrieval
      const archive = state.archive
      const writes = state.writes
      if (!last && pending === 0 && !retrieval && !archive && !writes) return null
      const tokens = last ? Number(last.tokens) || 0 : 0
      const line = pending > 0
        ? `[记忆宫殿]: 已排队 ${pending} 条，下一轮注入`
        : (last ? `[记忆宫殿]: 本回合注入 ${tokens} token记忆` : '[记忆宫殿]: 本回合未注入热记忆')
      const retrievalLine = retrieval && retrieval.turns > 0
        ? `本次查找了 ${retrieval.months?.join('/') || '档案'}/${retrieval.categories?.join('/') || '全部'} 共${retrieval.turns}轮 ${retrieval.tokens || 0} token`
        : ''
      const archiveLine = archive && archive.turns > 0
        ? `本次归档 turn ${archive.fromTurn || '?'}–${archive.toTurn || '?'} · ${archive.turns} 轮 · ${archive.categories} 个类别`
        : ''
      const writeItems = Array.isArray(writes?.items) ? writes.items : []
      const writeActions = { create: '写入', update: '更新', migration: '迁移', delete: '删除', move: '转移' }
      const actionCounts = {}
      for (const item of writeItems) {
        const action = writeActions[item.action] ? item.action : 'create'
        actionCounts[action] = (actionCounts[action] || 0) + 1
      }
      const actionText = Object.entries(actionCounts)
        .map(([action, count]) => `${writeActions[action]} ${count} 条`)
        .join(' · ')
      const writesLine = writes && writes.count > 0
        ? `[记忆宫殿]: 本回合${actionText || `写入 ${writes.count} 条`} · 约 ${writes.tokens || 0} tokens`
        : ''
      return h('div', { style: { marginTop: '8px', fontSize: '11px', opacity: 0.62 } },
        h('button', {
          type: 'button',
          style: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' },
          onClick: () => setOpen((v) => !v),
          'aria-expanded': open,
        }, `${open ? '▾' : '▸'} ${line}`),
        retrievalLine ? h('div', { style: { marginTop: '2px' } }, retrievalLine) : null,
        archiveLine ? h('div', { style: { marginTop: '2px' } }, archiveLine) : null,
        writesLine ? h('div', { style: { marginTop: '2px' } }, writesLine) : null,
        open
          ? h('div', { style: { marginTop: '4px', opacity: 0.85 } },
            last ? h('div', null, `预算 ${state.budget || 0} · 上次 ${last.at || ''}`) : null,
            last && Array.isArray(last.entries) && last.entries.length
              ? h('div', null, `条目：${last.entries.join('、')}`)
              : null,
            writeItems.length
              ? h('div', null, `操作：${writeItems.map((x) => `${writeActions[x.action] || '写入'} ${x.section}/${x.id} ${x.preview}`).join('；')}`)
              : null,
            retrieval ? h('div', null, `文件：${(retrieval.files || []).join('、') || '—'}`) : null,
            pending ? h('div', null, `待注入：${pending} 条（下一轮自动清除标记）`) : null)
          : null)
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'memory-palace',
        order: 40,
        label: () => '记忆宫殿',
        inject: (sessionId) => ({ sessionId }),
      }, MemoryPalaceView))
      try {
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'dsh-memory-palace/turn-tail',
          order: 80,
          inject: (sessionId) => ({ sessionId }),
        }, TurnTail))
      } catch { /* 宿主没有 turnTail 插槽时静默 */ }
    }

    return { apply, inject: ['slots'] }
  },
})
