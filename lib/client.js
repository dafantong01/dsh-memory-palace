window.__ModuleLoader__.load({
  id: 'dsh-memory-palace',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/memory-palace-api'

    const s = {
      root: { padding: '24px 20px 8px', fontSize: '13px', lineHeight: 1.65, color: 'var(--dsh-text, #222)' },
      page: { maxWidth: '820px', margin: '0 auto', width: '100%', boxSizing: 'border-box' },
      header: { margin: '0 0 14px' },
      title: { fontSize: '18px', fontWeight: 600, margin: 0, letterSpacing: '0.01em' },
      subtitle: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '12px', opacity: 0.72, wordBreak: 'break-all' },
      row: { margin: '2px 0' },
      muted: { opacity: 0.65 },
      bar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: 0 },
      btn: { padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
      btnPrimary: { padding: '5px 16px', borderRadius: '6px', border: '1px solid transparent', background: 'var(--dsh-accent, #3b6ef5)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600 },
      btnSecondary: { padding: '5px 14px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
      input: { width: '84px', padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', fontSize: '13px', boxSizing: 'border-box' },
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
      card: { border: '1px solid rgba(128,128,128,.22)', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px', background: 'var(--dsh-bg-elevated, transparent)', boxSizing: 'border-box' },
      cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' },
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
      range: { flex: '1 1 90px', minWidth: '80px', maxWidth: '180px', verticalAlign: 'middle', accentColor: 'var(--dsh-accent, #3b6ef5)' },
      subHead: { fontSize: '12px', fontWeight: 600, opacity: 0.7, letterSpacing: '0.02em', margin: '10px 0 4px' },
      details: { marginTop: '10px', borderTop: '1px solid rgba(128,128,128,.15)', paddingTop: '8px' },
      summary: { cursor: 'pointer', fontSize: '12px', opacity: 0.7, userSelect: 'none', marginBottom: '2px' },
      sticky: { position: 'sticky', bottom: 0, zIndex: 5, marginBottom: '4px' },
      stickyTop: { position: 'sticky', top: 0, zIndex: 5, marginBottom: '10px', paddingTop: '2px', background: 'var(--dsh-bg, #fff)' },
      actionCard: { border: '1px solid rgba(128,128,128,.22)', borderRadius: '10px', padding: '10px 14px', background: 'var(--dsh-bg-elevated, rgba(128,128,128,.08))', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 -4px 16px rgba(128,128,128,.12)', boxSizing: 'border-box' },
      actionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' },
      events: { display: 'flex', flexDirection: 'column', gap: '3px' },
      eventLine: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', opacity: 0.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 },
      empty: { fontSize: '12px', opacity: 0.55, padding: '2px 0' },
      tableHead: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px', gap: '4px 12px', padding: '0 0 5px', borderBottom: '1px solid rgba(128,128,128,.18)', fontSize: '11px', opacity: 0.6, letterSpacing: '0.02em' },
      archiveRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px', gap: '2px 12px', padding: '7px 0', alignItems: 'start' },
      archiveMain: { minWidth: 0 },
      archiveMeta: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '11px', opacity: 0.6, marginBottom: '1px' },
      archiveFile: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', lineHeight: 1.55, wordBreak: 'break-all', opacity: 0.9 },
      archiveRight: { textAlign: 'right', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', lineHeight: 1.55, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
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
      return h('div', { style: s.field },
        h('span', { style: s.label }, props.label),
        h('div', { style: s.ctrlRow },
          h('input', {
            style: props.wide ? { ...s.input, width: '100%' } : s.input,
            value: props.value, disabled: props.disabled,
            onChange: (e) => props.onChange(e.target.value),
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

    function useStatus(sessionId) {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [statsLoading, setStatsLoading] = React.useState(false)
      const load = React.useCallback(async () => {
        if (!sessionId) return
        // 第一段：轻量视图，秒开（不含统计，后端不解码日志）。
        try {
          const res = await fetch(`${API}?sessionId=${encodeURIComponent(sessionId)}`)
          const body = await res.json()
          if (!res.ok) throw new Error(body.error || String(res.status))
          setData(body)
          setErr('')
        } catch (e) { setErr(String(e && e.message ? e.message : e)); return }
        // 第二段：后台补统计与真实窗口；只合并这几个字段，不覆盖用户正在编辑的表单。
        setStatsLoading(true)
        try {
          const res2 = await fetch(`${API}?sessionId=${encodeURIComponent(sessionId)}&stats=1`)
          const full = await res2.json()
          if (res2.ok) {
            setData((prev) => (prev ? {
              ...prev,
              stats: full.stats,
              contextWindowTokens: full.contextWindowTokens,
              retentionCapBytes: full.retentionCapBytes,
              retentionCapTokens: full.retentionCapTokens,
              partial: false,
            } : full))
          }
        } catch { /* 统计失败不影响配置页使用 */ } finally { setStatsLoading(false) }
      }, [sessionId])
      React.useEffect(() => { load() }, [load])
      return { data, err, load, statsLoading }
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

    /** 百分比字段：滑块 + 输入框联动，拖动时输入框跟着变。 */
    function PctField(props) {
      const value = Number(props.value)
      const safe = Number.isFinite(value) ? value : props.min
      return h('div', { style: s.field },
        h('span', { style: s.label }, props.label),
        h('div', { style: s.ctrlRow },
          h('input', {
            type: 'range', min: props.min, max: props.max, step: 1,
            value: safe, disabled: props.disabled,
            style: s.range,
            onChange: (e) => props.onChange(e.target.value),
          }),
          h('input', {
            style: { ...s.input, width: '68px' }, value: props.value, disabled: props.disabled,
            onChange: (e) => props.onChange(e.target.value),
          }),
          h('span', { style: s.muted }, '%')),
        props.suffix ? h('div', { style: s.hint }, props.suffix) : null)
    }

    /** 整数滑块字段：数字框 + 滑块联动，用于 1–30 这类小整数。disabled 时不可编辑并整体变淡。 */
    function IntSlider(props) {
      const raw = Number(props.value)
      const safe = Number.isFinite(raw) ? Math.min(Math.max(raw, props.min), props.max) : props.min
      return h('div', { style: { ...s.field, opacity: props.disabled ? 0.5 : 1 } },
        h('span', { style: s.label }, props.label),
        h('div', { style: s.ctrlRow },
          h('input', {
            type: 'number', min: props.min, max: props.max, step: 1,
            style: { ...s.input, width: '68px' }, value: props.value, disabled: props.disabled,
            onChange: (e) => props.onChange(e.target.value),
          }),
          h('input', {
            type: 'range', min: props.min, max: props.max, step: 1,
            value: safe, disabled: props.disabled,
            style: s.range,
            onChange: (e) => props.onChange(e.target.value),
          })),
        props.suffix ? h('div', { style: s.hint }, props.suffix) : null)
    }

    function Check(props) {
      return h('div', { style: { ...s.checkRow, opacity: props.disabled ? 0.6 : 1 } },
        h('span', { style: s.checkLabel }, props.label),
        h('input', {
          type: 'checkbox', checked: props.value, disabled: props.disabled,
          style: { marginTop: '3px', flexShrink: 0, accentColor: 'var(--dsh-accent, #3b6ef5)' },
          onChange: (e) => props.onChange(e.target.checked),
        }))
    }

    function MemoryPalaceView(props) {
      const sessionId = props.sessionId || ''
      const { data, err, load, statsLoading } = useStatus(sessionId)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState('')
      const [form, setForm] = React.useState(null)
      const baseline = React.useRef(null)
      const initedFor = React.useRef(null)

      React.useEffect(() => {
        if (!data) return
        // 只在首次拿到配置时初始化表单；异步补统计会触发 data 更新，
        // 不能因此把用户正在编辑的内容重置掉。
        if (initedFor.current === data.sessionId && form !== null) return
        initedFor.current = data.sessionId
        const next = {
          triggerPressurePct: String(Math.round(data.triggerPressure * 100)),
          checkEveryTurns: String(data.checkEveryTurns),
          minBatchTurns: String(data.minBatchTurns),
          batchByteFractionPct: String(Math.round((data.batchByteFraction ?? 0.5) * 100)),
          retainFractionPct: String(Math.round((data.retainFraction || 0.12) * 100)),
          maxFileBytesMB: (Math.round(data.maxFileBytes / 100000) / 10).toFixed(1),
          name: String(data.name || ''),
          enableSteer: data.enableSteer,
          includeReasoning: data.includeReasoning,
          compactAfterArchive: data.compactAfterArchive === true,
          searchTurnLimit: String(data.searchTurnLimit ?? 12),
          groupByTurn: data.groupByTurn !== false,
          recallStrength: data.recallStrength || 'low',
          recursionMaxDepth: String(data.recursionMaxDepth ?? 1),
          recursionMaxWidth: String(data.recursionMaxWidth ?? 1),
        }
        setForm(next)
        baseline.current = JSON.stringify(next)
      }, [data])
      const dirty = form !== null && baseline.current !== null && JSON.stringify(form) !== baseline.current

      const run = async (fn, okText) => {
        setBusy(true); setMsg('')
        try {
          const out = await fn()
          await load()
          setMsg(okText || (typeof out === 'string' && out ? out : '已保存'))
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
          values.searchTurnLimit = limit
          values.groupByTurn = Boolean(form.groupByTurn)
          values.recallStrength = form.recallStrength
          values.recursionMaxDepth = depth
          values.recursionMaxWidth = width
          await post(sessionId, 'set', values)
          baseline.current = JSON.stringify(form) // 保存成功：当前表单成为新的基线
        })
      }

      if (!sessionId) {
        return h('div', { style: s.root },
          h('div', { style: s.page }, '没有会话上下文'))
      }
      if (!data || !form) {
        return h('div', { style: s.root },
          h('div', { style: s.page },
            h('div', { style: s.header }, h('div', { style: s.title }, '记忆回廊')),
            err ? h('p', { style: s.err }, err) : h('p', { style: s.muted }, '读取中…')))
      }

      const kb = (v) => `${Math.round(v / 1024)} KB`
      const pctNow = num(form.triggerPressurePct) ?? 0
      const triggerTokens = Math.round((pctNow / 100) * (data.contextWindowTokens || 0))
      const retainBytesNow = data.retentionCapBytes || 0
      const onOff = (v) => (v === undefined || v === null ? '未知' : (v ? '开' : '关'))
      const gateChip = (v) => h(Chip, { kind: v === true ? 'ok' : (v === false ? 'bad' : 'neutral') }, onOff(v))
      const gateWhy = () => {
        if (!data.enabled) return '全局总闸关闭'
        if (!data.sessionEnabled) return '本会话开关关闭'
        if (data.name === '') return '未命名'
        if (!data.injectNotice) return '自动提示关闭（不会主动 steer，仅工具可用）'
        return '未知原因'
      }
      const strengthIdx = Math.max(0, RECALL_KEYS.indexOf(form.recallStrength))
      const strengthNow = RECALL_KEYS[strengthIdx] || 'low'
      const recursionOn = strengthNow === 'high' || strengthNow === 'forced'

      return h('div', { style: s.root },
        h('div', { style: s.page },

          // ── 页头 ─────────────────────────────────────────────
          h('div', { style: s.header },
            h('div', { style: s.title }, '记忆回廊'),
            h('div', { style: s.subtitle },
              h('span', null, `当前会话：${data.name || data.sessionId || '未命名'}`),
              h('span', { style: s.muted }, '·'),
              h(Chip, { kind: data.sessionEnabled ? 'ok' : 'bad' }, data.sessionEnabled ? '已启用' : '未启用'),
              data.stats
                ? h('span', null, `· 归档 ${data.stats.archivedTurns} / ${data.stats.totalTurns} 轮`)
                : null,
              data.active ? h(Chip, { kind: 'ok' }, '生效中') : null)),

          // ── 状态卡片 ─────────────────────────────────────────
          h(Card, { title: '状态' },
            h('div', { style: s.switchRow },
              h(Switch, {
                value: data.sessionEnabled,
                disabled: busy,
                onChange: (on) => run(() => post(sessionId, on ? 'on' : 'off'), on ? '已开启本会话' : '已关闭本会话'),
              }),
              h(Chip, { kind: data.sessionEnabled ? 'ok' : 'bad' }, data.sessionEnabled ? '已启用' : '未启用'),
              h('span', { style: s.muted }, data.active ? '（生效中）' : (data.sessionEnabled ? (data.name ? '（全局被关）' : '（未命名，暂不归档）') : '（不会归档）'))),

            h('div', { style: s.gateRow },
              h('span', { style: s.gateLabel }, '生效门'),
              h('span', { style: s.gateItem }, '全局 enabled', gateChip(data.enabled)),
              h('span', { style: s.gateItem }, '本会话 sessionEnabled', gateChip(data.sessionEnabled)),
              h('span', { style: s.gateItem }, '自动提示 injectNotice', gateChip(data.injectNotice)),
              data.active
                ? h(Chip, { kind: 'ok' }, '当前生效')
                : h(Chip, { kind: 'bad' }, `未生效：${gateWhy()}`)),

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

          // ── 操作卡片：粘性顶部（保存按钮永远可见） ─────────────
          h('div', { style: s.stickyTop },
            h('div', { style: s.actionCard },
              h('div', { style: s.actionHead },
                h('div', { style: s.cardTitle }, '操作'),
                dirty ? h(Chip, { kind: 'warn' }, '有未保存修改') : h(Chip, { kind: 'ok' }, '已保存')),
              h('div', { style: s.bar },
                h('button', {
                  style: { ...s.btnPrimary, opacity: busy || !dirty ? 0.5 : 1, cursor: busy || !dirty ? 'default' : 'pointer' },
                  disabled: busy || !dirty, onClick: save,
                }, dirty ? '保存参数' : '已保存'),
                h('button', {
                  style: { ...s.btnSecondary, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' },
                  disabled: busy,
                  onClick: () => run(async () => {
                    const r = await post(sessionId, 'archive', {})
                    return r.message || '已发送归档指令'
                  }),
                }, '现在归档'),
                h('span', { style: { ...s.hint, flex: '1 1 240px' } },
                  '改完参数点「保存参数」；「现在归档」只是给模型发一条指令')),
              msg ? h('p', { style: { ...(msg.startsWith('已') ? s.ok : s.err), margin: '4px 0 0' } }, msg) : null,
              err ? h('p', { style: { ...s.err, margin: '4px 0 0' } }, err) : null)),

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
            h('div', { style: s.grid },
              h(PctField, {
                label: '触发阈值', value: form.triggerPressurePct, min: 20, max: 95,
                suffix: '20–95', disabled: busy,
                onChange: (v) => setForm({ ...form, triggerPressurePct: v }),
              }),
              h(PctField, {
                label: '无需归档比例', value: form.retainFractionPct, min: 2, max: 50,
                suffix: '2–50，建议 < 16（DSH 压缩尾部）', disabled: busy,
                onChange: (v) => setForm({ ...form, retainFractionPct: v }),
              }),
              h(PctField, {
                label: '批量兜底阈值', value: form.batchByteFractionPct, min: 5, max: 100,
                suffix: '可归档量达到无需归档量的该比例即触发（不看轮数）', disabled: busy,
                onChange: (v) => setForm({ ...form, batchByteFractionPct: v }),
              }),
              h(Field, {
                label: '检查频率（每 N 轮）', value: form.checkEveryTurns, disabled: busy,
                onChange: (v) => setForm({ ...form, checkEveryTurns: v }),
              }),
              h(Field, {
                label: '最小归档批量（轮）', value: form.minBatchTurns, disabled: busy,
                onChange: (v) => setForm({ ...form, minBatchTurns: v }),
              })),

            h('div', { style: s.derived },
              '按当前输入实时计算：会话估算到 ',
              h('b', null, triggerTokens.toLocaleString()),
              ` tokens 时触发归档（${pctNow}% × ${(data.contextWindowTokens || 0).toLocaleString()}）`),

            h('div', { style: s.subHead }, '行为开关'),
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
                label: '归档后压缩上下文（保留多少由 DSH 自己决定，可能压掉未归档的近期轮次）',
                value: form.compactAfterArchive, disabled: busy,
                onChange: (v) => setForm({ ...form, compactAfterArchive: v }),
              })),

            h('details', { style: s.details },
              h('summary', { style: s.summary }, '高级设置'),
              h('div', { style: { ...s.grid, marginTop: '8px' } },
                h(ROField, {
                  label: '保留字节（自动计算）',
                  value: `${Math.round(retainBytesNow / 1024).toLocaleString()} KB`,
                  hint: '窗口 × 保留比例 × 3 字节/token · 自动计算 · 只读',
                  title: '窗口 × 已填比例估算出的保留区字节数；这段不归档，其余较旧轮次才归档',
                }),
                h(ROField, {
                  label: '无需归档的近期文本量',
                  value: (data.retentionCapTokens || 0).toLocaleString(),
                  hint: `tokens · 窗口 × ${form.retainFractionPct}% · 自动计算 · 只读`,
                  title: '窗口 × 已填比例；这段不归档，其余较旧轮次才归档',
                }),
                h(Field, {
                  label: '单文件上限 MB', value: form.maxFileBytesMB, disabled: busy,
                  onChange: (v) => setForm({ ...form, maxFileBytesMB: v }),
                }),
                h(ROField, {
                  label: '估算窗口 tokens',
                  value: (data.contextWindowTokens || 0).toLocaleString(),
                  hint: '自动探测 · 只读',
                  title: '由插件从会话日志自动探测，不可修改；每次启动 DSH 后刷新',
                }),
                h(ROField, {
                  label: '文件名前缀',
                  value: data.selfNameSlug || '',
                  hint: '（跟随记忆名；要单独固定用 palace_config 设 selfNameSlug）',
                  title: '归档文件名前缀，跟随记忆名',
                })))),

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
        )
      )
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'memory-palace',
        order: 40,
        label: () => '记忆回廊',
        inject: (sessionId) => ({ sessionId }),
      }, MemoryPalaceView))
    }

    return { apply, inject: ['slots'] }
  },
})
