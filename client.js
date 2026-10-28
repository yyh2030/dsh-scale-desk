/**
 * scale-desk — browser half.
 *
 * One panel, four tabs: 量表库（定义与出处）/ 录入（手填与导入）/ 计分（宽表与
 * 每题明细）/ 校验（定义与数据问题）。Everything comes from the Host route; the
 * page never reads `_lab` itself and never computes a score on its own.
 */

window.__ModuleLoader__.load({
  id: '@local/scale-desk',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React

    const API = '/api/scale-desk'
    const ALL = '__all__'

    async function call(action, payload, query) {
      let url = API + '?action=' + encodeURIComponent(action)
      if (query) {
        const qs = new URLSearchParams(query).toString()
        if (qs) url += '&' + qs
      }
      const init = { headers: { 'x-scale-desk': '1' } }
      if (payload !== undefined) {
        init.method = 'POST'
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify({ action, payload })
      }
      const res = await fetch(url, init)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error((json.error && json.error.message) || 'HTTP ' + res.status)
      return json.data
    }

    /* ================================================================ *
     * styles
     * ================================================================ */

    const CSS = `
.sd-root{--sd-bg:var(--dsw-alias-bg-base,#fff);--sd-panel:var(--dsw-alias-bg-layer-1,#f7f7f8);--sd-raised:var(--dsw-alias-bg-layer-2,#f1f2f4);--sd-line:var(--dsw-alias-border-l1,rgba(0,0,0,.09));--sd-line2:var(--dsw-alias-border-l2,rgba(0,0,0,.16));--sd-text:var(--dsw-alias-label-primary,#16181d);--sd-text2:var(--dsw-alias-label-secondary,#5b6068);--sd-brand:var(--dsw-alias-brand-primary,#2f8f83);--sd-ok:var(--dsw-alias-state-success-primary,#148a62);--sd-warn:var(--dsw-alias-state-warn-primary,#b7791f);--sd-bad:var(--dsw-alias-state-error-primary,#c0392b);display:flex;flex-direction:column;height:100%;min-height:0;background:var(--sd-bg);color:var(--sd-text);font-size:13px;line-height:1.55;overflow:hidden}
.sd-root *{box-sizing:border-box}
.sd-top{display:flex;align-items:center;gap:12px;height:56px;padding:0 16px;border-bottom:1px solid var(--sd-line);flex:none;flex-wrap:nowrap;min-width:0}
.sd-brand{display:flex;align-items:baseline;gap:8px;min-width:0;flex:none}
.sd-brand strong{font-size:14px;font-weight:650;white-space:nowrap}
.sd-brand span{font-size:11.5px;color:var(--sd-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42ch}
.sd-stats{display:flex;gap:14px;align-items:center;margin-left:6px;min-width:0;overflow:hidden}
.sd-stat{display:flex;flex-direction:column;line-height:1.2;white-space:nowrap}
.sd-stat b{font-size:13px;font-variant-numeric:tabular-nums;font-weight:650}
.sd-stat span{font-size:10px;color:var(--sd-text2)}
.sd-stat.is-bad b{color:var(--sd-bad)}
.sd-stat.is-warn b{color:var(--sd-warn)}
.sd-actions{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none}
.sd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid transparent;font-size:12.5px;cursor:pointer;white-space:nowrap;background:transparent;color:var(--sd-text);font-family:inherit}
.sd-btn:disabled{opacity:.55;cursor:default}
.sd-btn-primary{background:var(--sd-brand);color:#fff}
.sd-btn-primary:hover:not(:disabled){filter:brightness(1.06)}
.sd-btn-outline{background:var(--sd-bg);border-color:var(--sd-line2)}
.sd-btn-outline:hover:not(:disabled){background:var(--sd-raised)}
.sd-btn-ghost{color:var(--sd-text2)}
.sd-btn-ghost:hover:not(:disabled){background:var(--sd-raised);color:var(--sd-text)}
.sd-btn-sm{height:24px;padding:0 9px;font-size:11.5px;border-radius:6px}
.sd-tabs{display:flex;align-items:center;gap:2px;margin:10px 16px 0;padding:3px;border-radius:9px;background:var(--sd-raised);border:1px solid var(--sd-line);width:max-content;flex:none}
.sd-tab{border:0;background:transparent;color:var(--sd-text2);padding:4px 14px;border-radius:7px;cursor:pointer;font-size:12.5px;white-space:nowrap;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
.sd-tab.is-active{background:var(--sd-bg);color:var(--sd-text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.sd-tab b{font-size:10.5px;font-weight:600;color:var(--sd-text2);font-variant-numeric:tabular-nums}
.sd-scroll{flex:1;min-height:0;overflow:auto;padding:12px 16px 40px}
.sd-card{border:1px solid var(--sd-line);border-radius:12px;background:var(--sd-panel);padding:13px 14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.sd-card-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sd-card-head h3{margin:0;font-size:13px;font-weight:650}
.sd-card-head .sd-note{margin-left:auto}
.sd-note{font-size:11.5px;color:var(--sd-text2)}
.sd-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px}
.sd-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(232px,1fr))}
.sd-lib{border:1px solid var(--sd-line);border-radius:11px;background:var(--sd-bg);padding:11px 12px;display:flex;flex-direction:column;gap:6px;cursor:pointer;text-align:left;min-width:0;font-family:inherit;color:var(--sd-text);transition:border-color .14s ease}
.sd-lib:hover{border-color:var(--sd-line2)}
.sd-lib.is-active{border-color:var(--sd-brand);box-shadow:0 0 0 1px color-mix(in oklab,var(--sd-brand) 40%,transparent)}
.sd-lib-top{display:flex;align-items:baseline;gap:7px}
.sd-lib-top b{font-size:13px;font-weight:650}
.sd-lib-top span{font-size:11px;color:var(--sd-text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-lib-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--sd-text2)}
.sd-lib-ver{font-size:10.5px;color:var(--sd-text2);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sd-chip{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:999px;border:1px solid var(--sd-line);background:var(--sd-raised);font-size:10.5px;color:var(--sd-text2);white-space:nowrap;font-variant-numeric:tabular-nums}
.sd-chip.is-brand{color:var(--sd-brand);border-color:color-mix(in oklab,var(--sd-brand) 40%,var(--sd-line));background:color-mix(in oklab,var(--sd-brand) 8%,transparent)}
.sd-badge{display:inline-flex;align-items:center;justify-content:center;height:18px;padding:0 6px;border-radius:5px;font-size:10.5px;font-weight:600;white-space:nowrap}
.sd-badge-ok{color:var(--sd-ok);background:color-mix(in oklab,var(--sd-ok) 12%,transparent)}
.sd-badge-warn{color:var(--sd-warn);background:color-mix(in oklab,var(--sd-warn) 14%,transparent)}
.sd-badge-bad{color:var(--sd-bad);background:color-mix(in oklab,var(--sd-bad) 12%,transparent)}
.sd-badge-info{color:var(--sd-text2);background:var(--sd-raised)}
.sd-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.sd-kv-item{border:1px solid var(--sd-line);border-radius:9px;background:var(--sd-bg);padding:7px 10px;display:flex;flex-direction:column;gap:2px;min-width:0}
.sd-kv-item span{font-size:10.5px;color:var(--sd-text2)}
.sd-kv-item b{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis}
.sd-table-wrap{border:1px solid var(--sd-line);border-radius:10px;overflow:auto;background:var(--sd-bg);max-height:62vh}
.sd-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;min-width:640px}
.sd-table th{position:sticky;top:0;z-index:1;background:var(--sd-bg);text-align:left;padding:7px 9px;border-bottom:1px solid var(--sd-line2);font-weight:600;white-space:nowrap;font-size:10.5px;color:var(--sd-text2)}
.sd-table td{padding:5px 9px;border-bottom:1px solid var(--sd-line);white-space:nowrap;vertical-align:middle;font-variant-numeric:tabular-nums}
.sd-table tbody tr{cursor:pointer}
.sd-table tbody tr:hover td{background:color-mix(in oklab,var(--sd-raised) 60%,transparent)}
.sd-table tbody tr.is-open td{background:color-mix(in oklab,var(--sd-brand) 7%,transparent)}
.sd-table th.is-score,.sd-table td.is-score{text-align:right}
.sd-table th.sd-sticky,.sd-table td.sd-sticky{position:sticky;left:0;background:var(--sd-bg);z-index:2;box-shadow:1px 0 0 var(--sd-line)}
.sd-table tbody tr:hover td.sd-sticky{background:color-mix(in oklab,var(--sd-raised) 60%,var(--sd-bg))}
.sd-id{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px}
.sd-cell{display:inline-flex;align-items:center;gap:3px;justify-content:flex-end}
.sd-cell i{font-style:normal;font-size:9.5px;color:var(--sd-warn)}
.sd-cell.is-bad{color:var(--sd-bad)}
.sd-cell.is-empty{color:var(--sd-text2);opacity:.55}
.sd-field{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sd-field label{font-size:11.5px;color:var(--sd-text2);white-space:nowrap}
.sd-form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px 12px}
.sd-form-grid label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--sd-text2)}
.sd-input,.sd-select{height:30px;padding:0 9px;border:1px solid var(--sd-line);border-radius:7px;background:var(--sd-bg);color:var(--sd-text);font-size:12.5px;outline:none;font-family:inherit;min-width:0}
.sd-input:focus,.sd-select:focus{border-color:var(--sd-brand)}
.sd-input.sd-id-input{width:88px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.sd-text-input{flex:1;min-width:0;height:26px;padding:0 7px;border:1px solid var(--sd-line);border-radius:6px;background:var(--sd-bg);color:var(--sd-text);font-size:11.5px;font-family:inherit;outline:none}
.sd-text-input:focus{border-color:var(--sd-brand)}
.sd-select{max-width:250px}
.sd-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10.5px;color:var(--sd-text2)}
.sd-matrix{display:flex;flex-direction:column;border:1px solid var(--sd-line);border-radius:10px;overflow:hidden;background:var(--sd-bg)}
.sd-item-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:5px 9px;border-bottom:1px solid var(--sd-line)}
.sd-item-row:last-child{border-bottom:0}
.sd-item-row.is-reverse{background:color-mix(in oklab,var(--sd-warn) 4%,transparent)}
.sd-item-no{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;color:var(--sd-text2);display:flex;align-items:center;gap:4px}
.sd-item-text{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-item-text.is-empty{color:var(--sd-text2);font-style:italic}
.sd-opts{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.sd-opt{min-width:28px;height:24px;padding:0 7px;border-radius:6px;border:1px solid var(--sd-line);background:var(--sd-bg);color:var(--sd-text2);font-size:11.5px;cursor:pointer;font-family:inherit;font-variant-numeric:tabular-nums}
.sd-opt:hover{border-color:var(--sd-line2);background:var(--sd-raised)}
.sd-opt.is-on{background:var(--sd-brand);border-color:var(--sd-brand);color:#fff;font-weight:600}
.sd-drop{display:flex;flex-direction:column;align-items:center;gap:4px;padding:22px;border:2px dashed var(--sd-line2);border-radius:12px;background:var(--sd-bg);cursor:pointer;text-align:center}
.sd-drop.is-over{border-color:var(--sd-brand);background:color-mix(in oklab,var(--sd-brand) 6%,var(--sd-bg))}
.sd-drop strong{font-size:12.5px}
.sd-drop span{font-size:11px;color:var(--sd-text2)}
.sd-file{border:1px solid var(--sd-line);border-radius:8px;background:var(--sd-bg);padding:6px 9px;font-size:11.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sd-issues{display:flex;flex-direction:column;gap:3px}
.sd-issue{display:flex;gap:7px;align-items:flex-start;padding:4px 0;font-size:12px;line-height:1.5}
.sd-issue .sd-badge{flex:none;margin-top:1px}
.sd-issue-body{flex:1;min-width:0}
.sd-issue-hint{font-size:11px;color:var(--sd-text2)}
.sd-split{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px;align-items:start}
.sd-empty{border:1px dashed var(--sd-line2);border-radius:12px;padding:28px 18px;text-align:center;color:var(--sd-text2);display:flex;flex-direction:column;align-items:center;gap:6px}
.sd-empty strong{color:var(--sd-text);font-size:13px}
.sd-toast{position:fixed;right:18px;bottom:18px;z-index:30;border:1px solid var(--sd-line2);border-radius:9px;background:var(--sd-bg);box-shadow:0 10px 30px rgba(0,0,0,.2);padding:8px 12px;font-size:12px;max-width:420px;color:var(--sd-text)}
.sd-toast.is-bad{border-color:color-mix(in oklab,var(--sd-bad) 45%,var(--sd-line));color:var(--sd-bad)}
.sd-alert{display:flex;gap:8px;align-items:flex-start;padding:8px 11px;border-radius:8px;font-size:12px;border:1px solid transparent;margin-bottom:8px}
.sd-alert-warn{color:var(--sd-warn);background:color-mix(in oklab,var(--sd-warn) 9%,transparent);border-color:color-mix(in oklab,var(--sd-warn) 24%,transparent)}
.sd-alert-bad{color:var(--sd-bad);background:color-mix(in oklab,var(--sd-bad) 8%,transparent);border-color:color-mix(in oklab,var(--sd-bad) 22%,transparent)}
.sd-alert-ok{color:var(--sd-ok);background:color-mix(in oklab,var(--sd-ok) 8%,transparent);border-color:color-mix(in oklab,var(--sd-ok) 22%,transparent)}
.sd-spin{width:11px;height:11px;border-radius:50%;border:2px solid color-mix(in oklab,currentColor 25%,transparent);border-top-color:currentColor;display:inline-block;animation:sd-spin .7s linear infinite}
@keyframes sd-spin{to{transform:rotate(360deg)}}
.sd-details{border:1px solid var(--sd-line);border-radius:9px;background:var(--sd-bg);padding:8px 10px}
.sd-details summary{cursor:pointer;font-size:11.5px;color:var(--sd-text2);outline:none}
@media (max-width:900px){
.sd-split{grid-template-columns:minmax(0,1fr)}
.sd-brand span{display:none}
.sd-stats{display:none}
.sd-scroll{padding:10px 10px 32px}
.sd-top{padding:0 10px}
.sd-tabs{margin:8px 10px 0}
}
`

    function insertStyles() {
      const mark = 'scale-desk'
      if (document.querySelector('style[data-plugin-css="' + mark + '"]')) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = mark
      tag.dataset.pluginCss = mark
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    /* ================================================================ *
     * small pieces
     * ================================================================ */

    const WAVE_LABEL = { T0: 'T0 基线', T1: 'T1 诱导后', T2: 'T2 干预后', imagery: '想象后', meta: 'AI 决策后', post: '事后问卷', end: '结束', week: '一周追踪' }
    const FLOW_KIND = { scale: '量表', task: '任务', paper: '纸质', demo: '人口学', audio: '音频', text: '书写', survey: '问卷', rest: '练习' }
    const LEVEL_TEXT = { bad: '高', warn: '中', info: '提示' }
    const STATUS_TEXT = { ok: '完成', prorated: '折算', incomplete: '未计分', absent: '未录', empty: '未录', partial: '部分', duplicate: '重复编号' }
    const STATUS_CLASS = { ok: 'ok', prorated: 'warn', incomplete: 'bad', absent: 'info', empty: 'info', partial: 'warn' }

    function waveName(wave) {
      return WAVE_LABEL[wave] || wave
    }

    function Btn({ children, onClick, kind, disabled, title, small }) {
      return h('button', {
        type: 'button',
        className: 'sd-btn ' + (kind ? 'sd-btn-' + kind : 'sd-btn-outline') + (small ? ' sd-btn-sm' : ''),
        onClick,
        disabled,
        title
      }, children)
    }

    function Badge({ level, children }) {
      return h('span', { className: 'sd-badge sd-badge-' + (level || 'info') }, children)
    }

    function Stat({ label, value, tone }) {
      return h('div', { className: 'sd-stat' + (tone ? ' is-' + tone : '') }, h('b', null, value), h('span', null, label))
    }

    function Empty({ title, children }) {
      return h('div', { className: 'sd-empty' }, h('strong', null, title), children ? h('span', null, children) : null)
    }

    function scoreText(value) {
      if (value === null || value === undefined) return '—'
      return String(value)
    }

    /* ================================================================ *
     * 量表库
     * ================================================================ */

    function LibraryTab({ data, toast, onOpenFolder, refresh }) {
      const [selected, setSelected] = useState(data.instruments[0] ? data.instruments[0].id : '')
      const [detail, setDetail] = useState(null)
      const [error, setError] = useState('')
      const [version, setVersion] = useState(0)
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState([])
      const [pasteText, setPasteText] = useState('')
      const [pasteIssues, setPasteIssues] = useState([])
      const [saveError, setSaveError] = useState('')
      const [busy, setBusy] = useState('')

      useEffect(() => {
        let alive = true
        setDetail(null)
        setError('')
        setEditing(false)
        setPasteText('')
        setPasteIssues([])
        setSaveError('')
        if (!selected) return () => { alive = false }
        call('definition', { id: selected })
          .then(value => { if (alive) setDetail(value) })
          .catch(err => { if (alive) setError(err.message) })
        return () => { alive = false }
      }, [selected, version])

      const instrument = data.instruments.find(item => item.id === selected)

      const parsePaste = useCallback(async () => {
        if (!pasteText.trim()) return
        setBusy('parse')
        setSaveError('')
        try {
          const parsed = await call('textsPreview', { scale: selected, text: pasteText })
          setPasteIssues(parsed.issues || [])
          if (parsed.items && parsed.items.length) {
            setDraft(prev => {
              const map = new Map(prev.map(entry => [entry.no, entry.text]))
              for (const entry of parsed.items) map.set(entry.no, entry.text)
              return [...map.entries()].map(([no, text]) => ({ no, text })).sort((a, b) => a.no - b.no)
            })
            if (!(parsed.issues || []).some(item => item.level === 'bad')) {
              toast('已填入 ' + parsed.items.length + ' 题，确认无误后点「保存题面」。')
            }
          }
        } catch (err) {
          setSaveError(err.message)
        } finally {
          setBusy('')
        }
      }, [pasteText, selected, toast])

      const saveTexts = useCallback(async () => {
        setBusy('save')
        setSaveError('')
        try {
          const result = await call('saveTexts', { scale: selected, items: draft })
          setEditing(false)
          setPasteText('')
          setPasteIssues([])
          setVersion(value => value + 1)
          toast('已保存 ' + result.scale + ' 的 ' + result.filled + '/' + result.itemCount + ' 题题面。')
          if (refresh) refresh()
        } catch (err) {
          setSaveError(err.message)
        } finally {
          setBusy('')
        }
      }, [draft, selected, toast, refresh])

      const [wavesEditing, setWavesEditing] = useState(false)
      const [wavesDraft, setWavesDraft] = useState([])
      const [waveError, setWaveError] = useState('')
      const [waveBusy, setWaveBusy] = useState('')

      const wavePrefix = list => {
        const first = (list || [])[0]
        return first ? String(first).replace(/\d+$/, '') : ''
      }
      const waveRows = detail
        ? detail.waves.map(name => ({ name, prefix: wavePrefix(detail.codes[name]) }))
        : []

      const startWaves = () => {
        setWavesDraft(waveRows.map(row => ({ ...row })))
        setWaveError('')
        setWavesEditing(true)
      }
      const addWave = () => {
        setWavesDraft(prev => {
          const numbers = prev.map(row => /^T(\d+)$/.exec(row.name)).filter(Boolean).map(match => Number(match[1]))
          const next = numbers.length ? Math.max(...numbers) + 1 : prev.length
          const name = numbers.length ? 'T' + next : ''
          const prefix = numbers.length ? 't' + next + '_' : ''
          return [...prev, { name, prefix }]
        })
      }
      const saveWaves = async () => {
        const names = wavesDraft.map(row => row.name.trim())
        if (!names.length) {
          setWaveError('至少保留一个波次')
          return
        }
        if (names.some(name => !name)) {
          setWaveError('波次名不能为空')
          return
        }
        if (new Set(names).size !== names.length) {
          setWaveError('波次名重复')
          return
        }
        setWaveBusy('save')
        setWaveError('')
        try {
          const result = await call('saveWaves', {
            scale: selected,
            waves: wavesDraft.map(row => ({ name: row.name.trim(), prefix: row.prefix.trim() }))
          })
          setWavesEditing(false)
          toast('已保存 ' + result.scale + ' 的波次：' + result.waves.join(' / '))
          setVersion(value => value + 1)
          if (refresh) refresh()
        } catch (err) {
          setWaveError(err.message)
        } finally {
          setWaveBusy('')
        }
      }

      const [creating, setCreating] = useState(false)
      const [createForm, setCreateForm] = useState({
        id: '', name: '', short: '', itemCount: '10', min: '1', max: '7',
        waves: 'T0', scoringType: 'sum', reverse: '', minAnswered: ''
      })
      const [createError, setCreateError] = useState('')
      const [editingMeta, setEditingMeta] = useState(false)
      const [metaForm, setMetaForm] = useState(null)
      const [metaError, setMetaError] = useState('')
      const [actionBusy, setActionBusy] = useState('')

      const updateCreate = (key, value) => setCreateForm(prev => ({ ...prev, [key]: value }))

      const submitCreate = async () => {
        setActionBusy('create')
        setCreateError('')
        try {
          const result = await call('createScale', {
            id: createForm.id.trim(),
            name: createForm.name.trim(),
            short: createForm.short.trim(),
            itemCount: Number(createForm.itemCount),
            min: Number(createForm.min),
            max: Number(createForm.max),
            waves: createForm.waves.split(/[,，\s]+/).map(part => part.trim()).filter(Boolean),
            scoringType: createForm.scoringType,
            reverse: createForm.reverse.split(/[,，\s]+/).map(Number).filter(Number.isInteger),
            minAnswered: createForm.minAnswered ? Number(createForm.minAnswered) : undefined
          })
          toast('已新建 ' + result.id + '（' + result.itemCount + ' 题，' + result.waves.join(' / ') + '）')
          setCreating(false)
          setCreateForm({ id: '', name: '', short: '', itemCount: '10', min: '1', max: '7', waves: 'T0', scoringType: 'sum', reverse: '', minAnswered: '' })
          setSelected(result.id)
          setVersion(value => value + 1)
          if (refresh) refresh()
        } catch (err) {
          setCreateError(err.message)
        } finally {
          setActionBusy('')
        }
      }

      const startMeta = () => {
        if (!instrument) return
        setMetaForm({
          name: instrument.name,
          short: instrument.short,
          version: instrument.version || '',
          notes: instrument.notes || '',
          instructions: instrument.instructions || '',
          scoringType: instrument.scoringType,
          reverse: instrument.reverse.join('、'),
          minAnswered: String(instrument.missing ? instrument.missing.minAnswered : ''),
          multiSub: Object.keys((detail && detail.scoring && detail.scoring.subscales) || {}).length > 1
        })
        setMetaError('')
        setEditingMeta(true)
      }

      const submitMeta = async () => {
        if (!instrument || !metaForm) return
        setActionBusy('meta')
        setMetaError('')
        try {
          const payload = {
            scale: instrument.id,
            name: metaForm.name,
            short: metaForm.short,
            version: metaForm.version,
            notes: metaForm.notes,
            instructions: metaForm.instructions
          }
          if (!metaForm.multiSub) {
            payload.scoringType = metaForm.scoringType
            payload.reverse = metaForm.reverse.split(/[,，\s]+/).map(Number).filter(Number.isInteger)
            payload.minAnswered = metaForm.minAnswered ? Number(metaForm.minAnswered) : undefined
          }
          await call('saveMeta', payload)
          toast('已保存 ' + instrument.id + ' 的基本信息')
          setEditingMeta(false)
          setVersion(value => value + 1)
          if (refresh) refresh()
        } catch (err) {
          setMetaError(err.message)
        } finally {
          setActionBusy('')
        }
      }

      const removeScale = async () => {
        if (!instrument) return
        if (!window.confirm('确定删除「' + instrument.short + '」？定义文件会删除，流程里引用它的步骤也会一并移除。')) return
        setActionBusy('delete')
        setMetaError('')
        try {
          const result = await call('deleteScale', { scale: instrument.id })
          toast('已删除 ' + result.removed + (result.flowRemoved ? '，并从流程移除 ' + result.flowRemoved + ' 步' : ''))
          setEditingMeta(false)
          setSelected('')
          setVersion(value => value + 1)
          if (refresh) refresh()
        } catch (err) {
          setMetaError(err.message)
        } finally {
          setActionBusy('')
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '量表库'),
            h('span', { className: 'sd-note' }, '定义存在 _lab/scales/defs；题面在下面直接编辑，不随插件分发'),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
              h(Btn, {
                children: creating ? '取消新建' : '新建量表',
                kind: creating ? 'ghost' : 'primary',
                small: true,
                onClick: () => { setCreating(value => !value); setCreateError('') }
              }),
              Btn({ children: '打开定义文件夹', kind: 'ghost', small: true, onClick: () => onOpenFolder('scales') })
            )
          ),
          h('div', { className: 'sd-grid' },
            data.instruments.map(item => {
              const recorded = Object.values(item.data || {}).reduce((sum, entry) => sum + entry.rows, 0)
              return h('button', {
                type: 'button',
                key: item.id,
                className: 'sd-lib' + (item.id === selected ? ' is-active' : ''),
                onClick: () => setSelected(item.id)
              },
                h('div', { className: 'sd-lib-top' }, h('b', null, item.short), h('span', null, item.name)),
                h('div', { className: 'sd-lib-meta' },
                  h('span', { className: 'sd-chip' }, item.itemCount + ' 题'),
                  h('span', { className: 'sd-chip' }, item.scoringType === 'mean' ? '均分' : '累加'),
                  h('span', { className: 'sd-chip' }, item.waves.join(' / ')),
                  h('span', { className: 'sd-chip is-brand' }, recorded + ' 份')
                ),
                h('div', { className: 'sd-lib-ver' }, item.version || '未写版本')
              )
            })
          )
        ),
        creating
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '新建量表'),
                h('span', { className: 'sd-note' }, '只建定义；题面之后在「编辑题面」里补，或直接粘贴'),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                  h(Btn, { children: actionBusy === 'create' ? '保存中…' : '创建', kind: 'primary', small: true, disabled: Boolean(actionBusy), onClick: submitCreate }),
                  h(Btn, { children: '取消', kind: 'ghost', small: true, disabled: Boolean(actionBusy), onClick: () => setCreating(false) })
                )
              ),
              createError ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, createError) : null,
              h('div', { className: 'sd-form-grid' },
                h('label', null, '量表 id', h('input', { className: 'sd-input', value: createForm.id, placeholder: 'MY_SCALE', onChange: event => updateCreate('id', event.target.value) })),
                h('label', null, '名称', h('input', { className: 'sd-input', value: createForm.name, placeholder: '中文全名', onChange: event => updateCreate('name', event.target.value) })),
                h('label', null, '简称', h('input', { className: 'sd-input', value: createForm.short, placeholder: '面板与列名用', onChange: event => updateCreate('short', event.target.value) })),
                h('label', null, '题量', h('input', { className: 'sd-input', type: 'number', min: 1, value: createForm.itemCount, onChange: event => updateCreate('itemCount', event.target.value) })),
                h('label', null, '取值下限', h('input', { className: 'sd-input', type: 'number', value: createForm.min, onChange: event => updateCreate('min', event.target.value) })),
                h('label', null, '取值上限', h('input', { className: 'sd-input', type: 'number', value: createForm.max, onChange: event => updateCreate('max', event.target.value) })),
                h('label', null, '波次（逗号分隔）', h('input', { className: 'sd-input', value: createForm.waves, placeholder: 'T0,T1', onChange: event => updateCreate('waves', event.target.value) })),
                h('label', null, '计分方式', h('select', { className: 'sd-select', value: createForm.scoringType, onChange: event => updateCreate('scoringType', event.target.value) },
                  h('option', { value: 'sum' }, '累加'),
                  h('option', { value: 'mean' }, '均分'),
                  h('option', { value: 'none' }, '不计分（只收集）')
                )),
                h('label', null, '反向题号（逗号分隔）', h('input', { className: 'sd-input', value: createForm.reverse, placeholder: '8,9,10', onChange: event => updateCreate('reverse', event.target.value) })),
                h('label', null, '缺失门槛（题数）', h('input', { className: 'sd-input', type: 'number', value: createForm.minAnswered, placeholder: '默认 80%', onChange: event => updateCreate('minAnswered', event.target.value) }))
              )
            )
          : null,
        error ? h('div', { className: 'sd-alert sd-alert-bad' }, error) : null,
        instrument && detail
          ? h('div', { className: 'sd-split' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } },
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' },
                    h('h3', null, instrument.short + ' · ' + instrument.name),
                    h('span', { className: 'sd-note' }, instrument.itemCount + ' 题，' + (instrument.scoringType === 'mean' ? '均分' : instrument.scoringType === 'none' ? '只收集' : '累加')),
                    h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                      h('span', { className: 'sd-chip' }, instrument.response.min + '–' + instrument.response.max + ' 计分'),
                      h(Btn, { children: editingMeta ? '取消' : '编辑信息', kind: 'outline', small: true, disabled: Boolean(actionBusy), onClick: () => (editingMeta ? setEditingMeta(false) : startMeta()) }),
                      h(Btn, { children: actionBusy === 'delete' ? '删除中…' : '删除量表', kind: 'ghost', small: true, disabled: Boolean(actionBusy), onClick: removeScale })
                    )
                  ),
                  h('div', { className: 'sd-kv' },
                    h('div', { className: 'sd-kv-item' }, h('span', null, '版本'), h('b', null, instrument.version || '—')),
                    h('div', { className: 'sd-kv-item' }, h('span', null, '缺失规则'), h('b', null, instrument.missing.rule === 'strict' ? '缺一题即不计分' : `比例折算，至少 ${instrument.missing.minAnswered} 题`)),
                    h('div', { className: 'sd-kv-item' }, h('span', null, '反向题'), h('b', null, instrument.reverse.length ? instrument.reverse.join('、') : '无')),
                    h('div', { className: 'sd-kv-item' }, h('span', null, '波次'), h('b', null, instrument.waves.map(waveName).join(' / ')))
                  ),
                  h('div', { className: 'sd-legend' },
                    Object.entries(detail.response.labels).map(([value, text]) =>
                      h('span', { key: value }, value + ' = ' + text)
                    )
                  ),
                  detail.instructions
                    ? h('details', { className: 'sd-details' },
                        h('summary', null, '指导语'),
                        h('div', { className: 'sd-note', style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, detail.instructions)
                      )
                    : null
                ),
                editingMeta && metaForm
                  ? h('div', { className: 'sd-card' },
                      h('div', { className: 'sd-card-head' },
                        h('h3', null, '基本信息与计分'),
                        h('span', { className: 'sd-note' }, metaForm.multiSub ? '多分量表：计分键只能在定义 JSON 里改' : '改完保存会重算 scores.csv'),
                        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                          h(Btn, { children: actionBusy === 'meta' ? '保存中…' : '保存', kind: 'primary', small: true, disabled: Boolean(actionBusy), onClick: submitMeta })
                        )
                      ),
                      metaError ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, metaError) : null,
                      h('div', { className: 'sd-form-grid' },
                        h('label', null, '名称', h('input', { className: 'sd-input', value: metaForm.name, onChange: event => setMetaForm(prev => ({ ...prev, name: event.target.value })) })),
                        h('label', null, '简称', h('input', { className: 'sd-input', value: metaForm.short, onChange: event => setMetaForm(prev => ({ ...prev, short: event.target.value })) })),
                        h('label', null, '版本', h('input', { className: 'sd-input', value: metaForm.version, onChange: event => setMetaForm(prev => ({ ...prev, version: event.target.value })) })),
                        metaForm.multiSub
                          ? null
                          : h('label', null, '计分方式', h('select', {
                              className: 'sd-select',
                              value: metaForm.scoringType,
                              onChange: event => setMetaForm(prev => ({ ...prev, scoringType: event.target.value }))
                            },
                              h('option', { value: 'sum' }, '累加'),
                              h('option', { value: 'mean' }, '均分'),
                              h('option', { value: 'none' }, '不计分（只收集）')
                            )),
                        metaForm.multiSub
                          ? null
                          : h('label', null, '反向题号（逗号分隔）', h('input', { className: 'sd-input', value: metaForm.reverse, onChange: event => setMetaForm(prev => ({ ...prev, reverse: event.target.value })) })),
                        metaForm.multiSub
                          ? null
                          : h('label', null, '缺失门槛（题数）', h('input', { className: 'sd-input', type: 'number', value: metaForm.minAnswered, onChange: event => setMetaForm(prev => ({ ...prev, minAnswered: event.target.value })) }))
                      ),
                      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--sd-text2)' } },
                        '计分说明',
                        h('textarea', {
                          className: 'sd-input',
                          style: { height: 54, padding: 6, resize: 'vertical', fontSize: 11.5 },
                          value: metaForm.notes,
                          onChange: event => setMetaForm(prev => ({ ...prev, notes: event.target.value }))
                        })
                      ),
                      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--sd-text2)' } },
                        '指导语',
                        h('textarea', {
                          className: 'sd-input',
                          style: { height: 72, padding: 6, resize: 'vertical', fontSize: 11.5 },
                          value: metaForm.instructions,
                          onChange: event => setMetaForm(prev => ({ ...prev, instructions: event.target.value }))
                        })
                      )
                    )
                  : null,
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' },
                    h('h3', null, '题目与反向标记'),
                    h('span', { className: 'sd-note' }, editing ? '改完点「保存题面」，只动文字，不动反向标记与计分键' : '题目只存在本机 _lab，不随插件分发'),
                    h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                      editing
                        ? [
                            h(Btn, {
                              key: 'save',
                              children: busy === 'save' ? '保存中…' : '保存题面',
                              kind: 'primary',
                              small: true,
                              disabled: Boolean(busy),
                              onClick: saveTexts
                            }),
                            h(Btn, {
                              key: 'cancel',
                              children: '取消',
                              kind: 'ghost',
                              small: true,
                              disabled: Boolean(busy),
                              onClick: () => {
                                setEditing(false)
                                setDraft([])
                                setPasteText('')
                                setPasteIssues([])
                                setSaveError('')
                              }
                            })
                          ]
                        : Btn({
                            children: '编辑题面',
                            kind: 'outline',
                            small: true,
                            onClick: () => {
                              setDraft(detail.items.map(item => ({ no: item.no, text: item.text || '' })))
                              setEditing(true)
                            }
                          })
                    )
                  ),
                  editing
                    ? h('div', { className: 'sd-card', style: { background: 'var(--sd-bg)' } },
                        h('details', { className: 'sd-details' },
                          h('summary', null, '从 Word / Excel 粘贴题目（题号 + 题目，一行一题）'),
                          h('textarea', {
                            className: 'sd-input',
                            style: { width: '100%', height: 130, marginTop: 8, padding: 8, fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 11.5, resize: 'vertical' },
                            value: pasteText,
                            placeholder: '1\t第 1 题的文字\n2\t第 2 题的文字\n（也可以只贴题目，按题号顺序自动排）',
                            onChange: event => setPasteText(event.target.value)
                          }),
                          h('div', { style: { display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' } },
                            Btn({
                              children: busy === 'parse' ? '解析中…' : '解析并填入',
                              kind: 'outline',
                              small: true,
                              disabled: Boolean(busy) || !pasteText.trim(),
                              onClick: parsePaste
                            }),
                            h('span', { className: 'sd-note' }, '解析只填进下面的输入框，还要点「保存题面」才落盘')
                          ),
                          pasteIssues.length
                            ? h('div', { className: 'sd-issues', style: { marginTop: 8 } },
                                pasteIssues.map((item, index) => h('div', { className: 'sd-issue', key: index },
                                  h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : item.level === 'warn' ? 'warn' : 'info') }, item.level === 'bad' ? '高' : item.level === 'warn' ? '中' : '提示'),
                                  h('span', { className: 'sd-issue-body' }, item.text)
                                ))
                              )
                            : null
                        )
                      )
                    : null,
                  saveError ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, saveError) : null,
                  detail.instructions
                    ? h('details', { className: 'sd-details' },
                        h('summary', null, '指导语'),
                        h('div', { className: 'sd-note', style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, detail.instructions)
                      )
                    : null,
                  h('div', { className: 'sd-matrix' },
                    detail.items.map(item => {
                      const current = editing
                        ? (draft.find(entry => entry.no === item.no) || { text: '' })
                        : item
                      return h('div', { className: 'sd-item-row' + (item.reverse ? ' is-reverse' : ''), key: item.no },
                        h('span', { className: 'sd-item-no' }, String(item.no), item.reverse ? h('span', { className: 'sd-badge sd-badge-warn' }, '反') : null),
                        editing
                          ? h('input', {
                              className: 'sd-input sd-text-input',
                              value: current.text || '',
                              placeholder: '第 ' + item.no + ' 题（可留空）',
                              onChange: event => {
                                const value = event.target.value
                                setDraft(prev => prev.map(entry => entry.no === item.no ? { ...entry, text: value } : entry))
                              }
                            })
                          : h('span', { className: 'sd-item-text' + (item.text ? '' : ' is-empty') }, item.text || ('第 ' + item.no + ' 题（文本未录入）')),
                        h('span', { className: 'sd-note' }, detail.codes[instrument.waves[0]] ? detail.codes[instrument.waves[0]][item.no - 1] : '')
                      )
                    })
                  ),
                  h('div', { className: 'sd-note' }, editing
                    ? '题号与反向标记固定；换中文版就整份替换文字。保存后「录入 → 答题纸」立刻用新题面。'
                    : '题目文本可选，点「编辑题面」逐题填，或从 Word 表格粘进来。')
                )
              ),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } },
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' },
                    h('h3', null, '波次与导出码'),
                    h('span', { className: 'sd-note' }, wavesEditing ? '已有作答的波次不能改名或删除' : detail.waves.map(waveName).join(' / ')),
                    h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                      wavesEditing
                        ? [
                            h(Btn, { key: 'add', children: '添加波次', kind: 'ghost', small: true, disabled: Boolean(waveBusy), onClick: addWave }),
                            h(Btn, { key: 'save', children: waveBusy === 'save' ? '保存中…' : '保存波次', kind: 'primary', small: true, disabled: Boolean(waveBusy), onClick: saveWaves }),
                            h(Btn, {
                              key: 'cancel',
                              children: '取消',
                              kind: 'ghost',
                              small: true,
                              disabled: Boolean(waveBusy),
                              onClick: () => { setWavesEditing(false); setWaveError('') }
                            })
                          ]
                        : h(Btn, { children: '编辑波次', kind: 'outline', small: true, onClick: startWaves })
                    )
                  ),
                  waveError ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, waveError) : null,
                  h('div', { className: 'sd-matrix' },
                    (wavesEditing ? wavesDraft : waveRows).map((row, index) => {
                      const recorded = ((instrument.data || {})[row.name] || {}).rows || 0
                      return h('div', {
                        className: 'sd-item-row',
                        key: index,
                        style: { gridTemplateColumns: '92px minmax(0,1fr) auto' }
                      },
                        wavesEditing
                          ? h('input', {
                              className: 'sd-input',
                              style: { height: 26, fontSize: 11.5, width: 84 },
                              value: row.name,
                              placeholder: 'T3',
                              onChange: event => setWavesDraft(prev => prev.map((entry, at) => at === index ? { ...entry, name: event.target.value } : entry))
                            })
                          : h('span', { className: 'sd-item-no' }, row.name),
                        wavesEditing
                          ? h('input', {
                              className: 'sd-text-input',
                              value: row.prefix,
                              placeholder: '导出码前缀，如 t3_ftps_',
                              onChange: event => setWavesDraft(prev => prev.map((entry, at) => at === index ? { ...entry, prefix: event.target.value } : entry))
                            })
                          : h('span', { className: 'sd-note' }, row.prefix
                              ? row.prefix + '01 … ' + row.prefix + String(instrument.itemCount).padStart(2, '0')
                              : '无导出码，导入时按列名 / 题号匹配'),
                        h('span', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                          h('span', { className: 'sd-chip' }, recorded + ' 份'),
                          wavesEditing && recorded === 0
                            ? h('button', {
                                type: 'button',
                                className: 'sd-chip',
                                style: { cursor: 'pointer', height: 22 },
                                title: '删除这个波次',
                                onClick: () => setWavesDraft(prev => prev.filter((_, at) => at !== index))
                              }, '删除')
                            : null
                        )
                      )
                    })
                  ),
                  h('div', { className: 'sd-note' }, wavesEditing
                    ? '波次名会进文件名与分数列名；导出码由前缀加 01…NN 自动生成，与题量对齐。'
                    : '同一份量表在多个阶段测，就是同一份定义下多个波次；点「编辑波次」增删。')
                ),
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' }, h('h3', null, '计分键')),
                  detail.scoring.subscales.map(sub => h('div', { key: sub.key, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                    h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                      h('b', { style: { fontSize: 12 } }, sub.label),
                      h('span', { className: 'sd-chip' }, sub.items.length + ' 题'),
                      sub.range ? h('span', { className: 'sd-chip' }, '范围 ' + sub.range[0] + '–' + sub.range[1]) : null,
                      sub.multiplier !== 1 ? h('span', { className: 'sd-chip' }, '×' + sub.multiplier) : null,
                      sub.descriptive ? h('span', { className: 'sd-chip' }, '描述性') : null
                    ),
                    h('div', { className: 'sd-note mono' }, '题号 ' + sub.items.join('、')),
                    h('div', { className: 'sd-note' }, sub.minAnswered ? '至少答 ' + sub.minAnswered + ' 题' : '')
                  ))
                ),
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' }, h('h3', null, '出处与授权')),
                  h('div', { style: { fontSize: 11.5, color: 'var(--sd-text2)', display: 'flex', flexDirection: 'column', gap: 6 } },
                    h('div', null, h('b', { style: { color: 'var(--sd-text)' } }, '来源：'), instrument.source || '—'),
                    h('div', null, h('b', { style: { color: 'var(--sd-text)' } }, '授权：'), instrument.license || '—'),
                    instrument.notes ? h('div', null, h('b', { style: { color: 'var(--sd-text)' } }, '计分说明：'), instrument.notes) : null,
                    h('div', { className: 'sd-mono' }, instrument.file || '')
                  )
                )
              )
            )
          : null
      )
    }

    /* ================================================================ *
     * 录入
     * ================================================================ */

    function answerSheetRows(data, scaleId, wave) {
      const missingKey = scaleId + '_' + wave + '_缺失'
      return data.scores.rows
        .filter(row => row.cells[missingKey] && row.cells[missingKey].status !== 'absent')
        .map(row => ({
          id: row.id,
          missing: row.cells[missingKey].value,
          status: row.cells[missingKey].status
        }))
    }

    function SheetEntry({ data, busy, onSave, onClear, toast, initial }) {
      const firstScale = initial && initial.scale && data.instruments.some(item => item.id === initial.scale)
        ? initial.scale
        : (data.instruments[0] ? data.instruments[0].id : '')
      const firstInstrument = data.instruments.find(item => item.id === firstScale) || data.instruments[0]
      const firstWave = initial && initial.wave && firstInstrument && firstInstrument.waves.includes(initial.wave)
        ? initial.wave
        : (firstInstrument ? firstInstrument.waves[0] : 'T0')
      const [scaleId, setScaleId] = useState(firstScale)
      const instrument = data.instruments.find(item => item.id === scaleId) || data.instruments[0]
      const [wave, setWave] = useState(firstWave)
      const [id, setId] = useState(initial && initial.id ? initial.id : '')
      const [values, setValues] = useState({})
      const [loaded, setLoaded] = useState(null)
      const [result, setResult] = useState(null)
      const [error, setError] = useState('')

      useEffect(() => {
        if (!instrument) return
        if (!instrument.waves.includes(wave)) setWave(instrument.waves[0])
      }, [scaleId])

      const def = instrument
      const answered = def ? Object.values(values).filter(value => String(value).trim() !== '').length : 0
      const missing = def ? def.itemCount - answered : 0

      const load = useCallback(async targetId => {
        if (!def) return
        const clean = String(targetId || id).trim()
        if (!/^\d{5}$/.test(clean)) {
          setError('编号要 5 位数字，如 11002')
          return
        }
        setError('')
        try {
          const answer = await call('answer', { id: clean, scale: def.id, wave })
          setId(clean)
          setValues(answer.values || {})
          setLoaded(answer.exists)
          setResult(null)
          if (!answer.exists) toast('这个编号在这份量表里还没有记录，填完保存即新建。')
        } catch (err) {
          setError(err.message)
        }
      }, [def, wave, id, toast])

      const save = async () => {
        if (!def) return
        const clean = String(id).trim()
        if (!/^\d{5}$/.test(clean)) {
          setError('编号要 5 位数字，如 11002')
          return
        }
        setError('')
        try {
          const saved = await onSave({ id: clean, scale: def.id, wave, values })
          setValues(saved.values || values)
          setLoaded(true)
          setResult(saved.scored)
          const bits = Object.entries(saved.scored.subs).map(([key, sub]) => {
            const meta = (def.subscales || []).find(item => item.key === key)
            const label = meta ? meta.label : key
            return sub.score === null ? label + ' 未计分' : label + ' ' + sub.score
          })
          const filled = Object.values(saved.values || values).filter(value => String(value).trim() !== '').length
          toast(bits.length
            ? '已保存 ' + clean + '：' + bits.join('，')
            : '已保存 ' + clean + '：' + filled + '/' + def.itemCount + ' 题')
        } catch (err) {
          setError(err.message)
        }
      }

      const clearOne = async () => {
        if (!def) return
        const clean = String(id).trim()
        if (!/^\d{5}$/.test(clean)) return
        try {
          await onClear({ id: clean, scale: def.id, wave })
          setValues({})
          setLoaded(false)
          setResult(null)
          toast('已删除 ' + clean + ' 的 ' + def.short + ' ' + wave + ' 作答。')
        } catch (err) {
          setError(err.message)
        }
      }

      const recorded = def ? answerSheetRows(data, def.id, wave) : []

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-field' },
            h('label', null, '量表'),
            h('select', {
              className: 'sd-select',
              value: def ? def.id : '',
              onChange: event => { setScaleId(event.target.value); setValues({}); setResult(null); setLoaded(null) }
            }, data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short + '（' + item.itemCount + ' 题）'))),
            h('label', null, '波次'),
            h('select', {
              className: 'sd-select',
              style: { maxWidth: 130 },
              value: wave,
              onChange: event => { setWave(event.target.value); setValues({}); setResult(null); setLoaded(null) }
            }, (def ? def.waves : []).map(item => h('option', { key: item, value: item }, waveName(item)))),
            h('label', null, '编号'),
            h('input', {
              className: 'sd-input sd-id-input',
              value: id,
              placeholder: '11002',
              inputMode: 'numeric',
              onChange: event => setId(event.target.value.replace(/[^\d]/g, '').slice(0, 5)),
              onKeyDown: event => { if (event.key === 'Enter') load() }
            }),
            Btn({ children: '载入', kind: 'outline', onClick: () => load(), disabled: busy }),
            Btn({ children: loaded ? '保存修改' : '保存', kind: 'primary', onClick: save, disabled: busy || !def }),
            loaded ? Btn({ children: '删除这份', kind: 'ghost', onClick: clearOne, disabled: busy }) : null
          ),
          error ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, error) : null,
          h('div', { className: 'sd-legend' },
            h('span', null, '已答 ' + answered + ' / ' + (def ? def.itemCount : 0) + (missing ? '（缺 ' + missing + ' 题）' : '')),
            def ? h('span', null, def.missing.rule === 'strict' ? '缺失规则：缺一题即不计分' : '缺失规则：比例折算，至少 ' + def.missing.minAnswered + ' 题') : null,
            def && def.reverse.length ? h('span', null, '橙底 = 反向题：' + def.reverse.join('、')) : null
          )
        ),
        def
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' }, h('h3', null, def.short + ' · ' + waveName(wave)),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                  h('span', { className: 'sd-note' }, '按题型作答；选错再点一次取消')
                )
              ),
              def.instructions
                ? h('details', { className: 'sd-details' },
                    h('summary', null, '指导语'),
                    h('div', { className: 'sd-note', style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, def.instructions)
                  )
                : null,
              h('div', { className: 'sd-matrix' },
                Array.from({ length: def.itemCount }, (_, index) => {
                  const no = index + 1
                  const entry = def.items.find(item => item.no === no) || { no, kind: 'likert', options: [] }
                  const kind = entry.kind || 'likert'
                  const current = values[no] === undefined ? '' : String(values[no])
                  const reverse = def.reverse.includes(no)
                  const itemText = entry.text || ''
                  const setValue = next => {
                    setValues(prev => {
                      const draft = { ...prev }
                      if (next === '' || next === null || next === undefined) delete draft[no]
                      else draft[no] = String(next)
                      return draft
                    })
                  }
                  return h('div', { className: 'sd-item-row' + (reverse ? ' is-reverse' : ''), key: no },
                    h('span', { className: 'sd-item-no' }, String(no)),
                    h('span', {
                      className: 'sd-item-text' + (itemText ? '' : ' is-empty'),
                      title: itemText || '第 ' + no + ' 题（文本未录入）'
                    }, itemText || '第 ' + no + ' 题'),
                    h('div', { className: 'sd-opts' },
                      kind === 'text'
                        ? h('input', {
                            className: 'sd-input',
                            style: { width: 280, height: 26, fontSize: 11.5 },
                            value: current,
                            maxLength: entry.maxLength || 2000,
                            placeholder: entry.maxLength ? '文本，最多 ' + entry.maxLength + ' 字' : '文本',
                            onChange: event => setValue(event.target.value)
                          })
                        : kind === 'choice' || kind === 'multi'
                          ? (entry.options || []).map(option => {
                              const selected = kind === 'multi'
                                ? current.split(',').map(part => part.trim()).filter(Boolean).includes(option.value)
                                : current === option.value
                              return h('button', {
                                key: option.value,
                                type: 'button',
                                className: 'sd-opt' + (selected ? ' is-on' : ''),
                                title: option.value,
                                onClick: () => {
                                  if (kind === 'multi') {
                                    const parts = current.split(',').map(part => part.trim()).filter(Boolean)
                                    const next = selected
                                      ? parts.filter(part => part !== option.value)
                                      : [...parts, option.value]
                                    setValue(next.join(','))
                                  } else {
                                    setValue(selected ? '' : option.value)
                                  }
                                }
                              }, option.label)
                            })
                          : kind === 'number'
                            ? h('input', {
                                className: 'sd-input',
                                type: 'number',
                                min: entry.min === null || entry.min === undefined ? undefined : entry.min,
                                max: entry.max === null || entry.max === undefined ? undefined : entry.max,
                                style: { width: 120, height: 26, fontSize: 11.5, textAlign: 'right' },
                                value: current,
                                placeholder: [entry.min, entry.max].filter(value => value !== null && value !== undefined).join('–'),
                                onChange: event => setValue(event.target.value)
                              })
                            : Math.round(def.response.max - def.response.min + 1) > 12
                              ? h('input', {
                                  className: 'sd-input',
                                  type: 'number',
                                  min: def.response.min,
                                  max: def.response.max,
                                  style: { width: 96, height: 26, fontSize: 11.5, textAlign: 'right' },
                                  value: current,
                                  placeholder: def.response.min + '–' + def.response.max,
                                  onChange: event => setValue(event.target.value)
                                })
                              : Array.from({ length: Math.round(def.response.max - def.response.min + 1) }, (_, offset) => {
                                  const value = def.response.min + offset
                                  const on = current === String(value)
                                  return h('button', {
                                    key: value,
                                    type: 'button',
                                    className: 'sd-opt' + (on ? ' is-on' : ''),
                                    title: def.response.labels[value] || '',
                                    onClick: () => setValue(on ? '' : String(value))
                                  }, String(value))
                                })
                    )
                  )
                })
              )
            )
          : null,
        result
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' }, h('h3', null, '这份的分数')),
              h('div', { className: 'sd-kv' },
                Object.values(result.subs).map(sub => h('div', { className: 'sd-kv-item', key: sub.key },
                  h('span', null, def ? (def.subscales.find(item => item.key === sub.key) || {}).label || sub.key : sub.key),
                  h('b', null, sub.score === null ? '未计分' : String(sub.score)),
                  h('span', null, '答 ' + sub.answered + ' / ' + (sub.answered + sub.missing))
                ))
              )
            )
          : null,
        def
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '已录 ' + def.short + ' ' + waveName(wave)),
                h('span', { className: 'sd-note' }, recorded.length + ' 人')
              ),
              recorded.length
                ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                    recorded.map(row => h('button', {
                      type: 'button',
                      key: row.id,
                      className: 'sd-chip',
                      style: { cursor: 'pointer', height: 24, fontFamily: 'ui-monospace,Consolas,monospace' },
                      title: '缺 ' + (row.missing ?? 0) + ' 题',
                      onClick: () => load(row.id)
                    }, row.id + (row.missing ? ' ·缺' + row.missing : '')))
                  )
                : h('div', { className: 'sd-note' }, '还没有人录这个量表。左边填编号与作答，或到「导入」里传问卷平台导出。')
            )
          : null
      )
    }

    function ImportPanel({ data, toast, onImported }) {
      const [files, setFiles] = useState([])
      const [text, setText] = useState('')
      const [previews, setPreviews] = useState([])
      const [focus, setFocus] = useState(0)
      const [manual, setManual] = useState({})
      const [mode, setMode] = useState('merge')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [over, setOver] = useState(false)
      const fileRef = useRef(null)

      const readFiles = useCallback(async fileList => {
        const list = Array.from(fileList || [])
        const next = []
        for (const file of list) {
          const buffer = await file.arrayBuffer()
          const bytes = new Uint8Array(buffer)
          let binary = ''
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
          next.push({ name: file.name || '文件 ' + (next.length + 1), base64: btoa(binary) })
        }
        setFiles(next)
        setText('')
        setPreviews([])
        setFocus(0)
        setError('')
        if (fileRef.current) fileRef.current.value = ''
      }, [])

      const sources = () => {
        if (files.length) return files.map(file => ({ name: file.name, base64: file.base64 }))
        if (text.trim()) return [{ name: '粘贴的文本', text }]
        return []
      }

      const previewAll = async () => {
        const list = sources()
        if (!list.length) {
          setError('先选导出文件（CSV / TSV / Excel），或粘贴表格文本')
          return
        }
        setBusy('preview')
        setError('')
        const results = []
        for (const source of list) {
          try {
            const payload = source.base64
              ? { data: source.base64, filename: source.name }
              : { text: source.text, filename: source.name }
            const next = await call('importPreview', payload)
            results.push({ ...source, status: 'ok', data: next, imported: false, auto: true })
          } catch (err) {
            results.push({ ...source, status: 'error', error: err.message })
          }
        }
        setPreviews(results)
        const firstOk = results.findIndex(item => item.status === 'ok')
        setFocus(firstOk >= 0 ? firstOk : 0)
        setBusy('')
      }

      const previewWithTarget = async index => {
        const entry = previews[index]
        if (!entry) return
        const choice = manual[index] || {}
        if (!choice.scale || !choice.wave) {
          setError('先给这份文件选一个量表与波次')
          return
        }
        setBusy('preview-' + index)
        setError('')
        try {
          const payload = entry.base64
            ? { data: entry.base64, filename: entry.name, scale: choice.scale, wave: choice.wave }
            : { text: entry.text, filename: entry.name, scale: choice.scale, wave: choice.wave }
          const next = await call('importPreview', payload)
          setPreviews(prev => prev.map((item, at) => at === index ? { ...item, status: 'ok', data: next, auto: false, error: '' } : item))
          setFocus(index)
        } catch (err) {
          setError(entry.name + '：' + err.message)
        } finally {
          setBusy('')
        }
      }

      const applyEntry = async entry => {
        if (entry.auto) {
          const result = await call('importFile', {
            data: entry.base64 || undefined,
            text: entry.text || undefined,
            filename: entry.name,
            mode
          })
          return { multi: true, result }
        }
        const result = await call('importApply', {
          data: entry.base64 || undefined,
          text: entry.text || undefined,
          filename: entry.name,
          scale: entry.data.scale,
          wave: entry.data.wave,
          mode,
          mapping: entry.data.mapping
        })
        return { multi: false, result }
      }

      const importAt = async index => {
        const entry = previews[index]
        if (!entry || entry.status !== 'ok' || entry.imported) return
        setBusy('apply-' + index)
        setError('')
        try {
          const outcome = await applyEntry(entry)
          if (outcome.multi) {
            const bits = outcome.result.results.map(item => item.short + ' ' + waveName(item.wave) + ' ' + item.imported + ' 行')
            toast('已导入 ' + entry.name + '：' + bits.join('，'))
          } else {
            const result = outcome.result
            toast('已导入 ' + entry.name + '：' + result.imported + ' 行到 ' + result.scale + ' ' + waveName(result.wave) + '（现共 ' + result.total + ' 人）')
          }
          setPreviews(prev => prev.map((item, at) => at === index ? { ...item, imported: true } : item))
          if (onImported) onImported()
        } catch (err) {
          setError(entry.name + '：' + err.message)
        } finally {
          setBusy('')
        }
      }

      const importAll = async () => {
        const pending = previews
          .map((entry, index) => ({ entry, index }))
          .filter(item => item.entry.status === 'ok' && !item.entry.imported)
        if (!pending.length) return
        setBusy('apply-all')
        setError('')
        let done = 0
        const failed = []
        for (const item of pending) {
          try {
            const result = await applyEntry(item.entry)
            done += 1
            setPreviews(prev => prev.map((entry, index) => index === item.index ? { ...entry, imported: true } : entry))
          } catch (err) {
            failed.push(item.entry.name + '：' + err.message)
          }
        }
        setBusy('')
        if (done) toast('已导入 ' + done + ' 个文件')
        if (failed.length) setError(failed.join('；'))
        if (onImported) onImported()
      }

      const focused = previews[focus]
      const headers = focused && focused.status === 'ok' ? focused.data.header : []
      const okCount = previews.filter(item => item.status === 'ok' && !item.imported).length

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '导入问卷平台导出'),
            h('span', { className: 'sd-note' }, 'Excel（.xlsx）、CSV、TSV 都认；UTF-8 与 GBK 都试一遍')
          ),
          h('div', {
            className: 'sd-drop' + (over ? ' is-over' : ''),
            role: 'button',
            tabIndex: 0,
            onDragOver: event => { event.preventDefault(); setOver(true) },
            onDragLeave: () => setOver(false),
            onDrop: event => {
              event.preventDefault()
              setOver(false)
              readFiles(event.dataTransfer.files)
            },
            onClick: () => fileRef.current && fileRef.current.click()
          },
            h('strong', null, '把导出文件拖到这里，或点一下选文件（可多选）'),
            h('span', null, 'QuestionPro 选「Data Export / Raw Data」那一份；一份文件里常有多组量表，会按题码自动全部导入')
          ),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: '.xlsx,.csv,.tsv,.txt',
            multiple: true,
            style: { display: 'none' },
            onChange: event => readFiles(event.target.files)
          }),
          files.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                files.map((file, index) => h('div', { className: 'sd-file', key: index },
                  h('span', null, h('b', null, file.name)),
                  h('span', { className: 'sd-note' }, Math.round((file.base64.length * 0.75) / 1024) + ' KB'),
                  h(Btn, {
                    children: '移除',
                    kind: 'ghost',
                    small: true,
                    onClick: () => setFiles(prev => prev.filter((_, at) => at !== index))
                  })
                ))
              )
            : null,
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
            h('details', { className: 'sd-details', style: { flex: '1 1 320px' } },
              h('summary', null, text ? '粘贴的文本（' + text.length + ' 字符）' : '也可以直接粘贴表格文本'),
              h('textarea', {
                className: 'sd-input',
                style: { width: '100%', height: 110, marginTop: 8, padding: 8, fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 11.5, resize: 'vertical' },
                value: text,
                placeholder: '编号,t0_ftps_01,...',
                onChange: event => { setText(event.target.value); setFiles([]); setPreviews([]) }
              })
            ),
            h('div', { style: { display: 'flex', gap: 6 } },
              Btn({ children: busy === 'preview' ? '识别中…' : '预览全部', kind: 'outline', onClick: previewAll, disabled: Boolean(busy) || !sources().length }),
              previews.length
                ? Btn({ children: '清空', kind: 'ghost', onClick: () => { setPreviews([]); setFiles([]); setText(''); setError('') } })
                : null
            )
          )
        ),
        error ? h('div', { className: 'sd-alert sd-alert-bad' }, error) : null,
        previews.length
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '待导入 ' + previews.length + ' 份'),
                h('span', { className: 'sd-note' }, '点一行看它的映射；每份可以单独导入'),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                  Btn({ children: busy === 'apply-all' ? '导入中…' : '导入全部可识别（' + okCount + '）', kind: 'primary', small: true, disabled: Boolean(busy) || !okCount, onClick: importAll })
                )
              ),
              h('div', { className: 'sd-table-wrap', style: { maxHeight: 'none' } },
                h('table', { className: 'sd-table', style: { minWidth: 720 } },
                  h('thead', null, h('tr', null,
                    h('th', null, '文件'),
                    h('th', null, '工作表'),
                    h('th', null, '识别为'),
                    h('th', { className: 'is-score' }, '行'),
                    h('th', { className: 'is-score' }, '匹配'),
                    h('th', null, '状态'),
                    h('th', null, '')
                  )),
                  h('tbody', null, previews.map((entry, index) => {
                    const ok = entry.status === 'ok'
                    return h('tr', {
                      key: index,
                      className: focus === index ? 'is-open' : '',
                      onClick: () => setFocus(index)
                    },
                      h('td', { className: 'sd-mono' }, entry.name),
                      h('td', { className: 'sd-note' }, ok ? entry.data.sheet || '—' : ''),
                      h('td', null, ok
                        ? (entry.auto
                            ? h('span', { className: 'sd-note', title: (entry.data.targets || []).map(t => t.short + ' ' + t.wave).join('，') },
                                (entry.data.targets || []).length + ' 组：' + (entry.data.targets || []).slice(0, 2).map(t => t.short).join('、') + ((entry.data.targets || []).length > 2 ? '…' : ''))
                            : entry.data.scale + ' · ' + waveName(entry.data.wave))
                        : '—'),
                      h('td', { className: 'is-score' }, ok ? String(entry.data.rows) : ''),
                      h('td', { className: 'is-score' }, ok ? entry.data.mapping.matched + '/' + entry.data.mapping.total : ''),
                      h('td', null, entry.imported
                        ? h('span', { className: 'sd-badge sd-badge-ok' }, '已导入')
                        : ok
                          ? h('span', { className: 'sd-badge sd-badge-info' }, entry.auto ? '自动匹配' : '手动指定')
                          : h('span', { className: 'sd-badge sd-badge-bad', title: entry.error }, '认不出')),
                      h('td', null, ok && !entry.imported
                        ? h(Btn, {
                            children: busy === 'apply-' + index ? '导入中…' : entry.auto ? '导入全部匹配' : '导入这一组',
                            kind: 'outline',
                            small: true,
                            disabled: Boolean(busy),
                            onClick: event => { event.stopPropagation(); importAt(index) }
                          })
                        : ok
                          ? h('span', { className: 'sd-note' }, '')
                          : h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }, onClick: event => event.stopPropagation() },
                              h('select', {
                                className: 'sd-select',
                                style: { height: 24, maxWidth: 110, fontSize: 11 },
                                value: (manual[index] || {}).scale || '',
                                onChange: event => setManual(prev => ({ ...prev, [index]: { ...(prev[index] || {}), scale: event.target.value, wave: '' } }))
                              },
                                h('option', { value: '' }, '选量表'),
                                data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short))
                              ),
                              h('select', {
                                className: 'sd-select',
                                style: { height: 24, maxWidth: 90, fontSize: 11 },
                                value: (manual[index] || {}).wave || '',
                                onChange: event => setManual(prev => ({ ...prev, [index]: { ...(prev[index] || {}), wave: event.target.value } }))
                              },
                                h('option', { value: '' }, '波次'),
                                (((data.instruments.find(item => item.id === (manual[index] || {}).scale) || {}).waves) || []).map(item => h('option', { key: item, value: item }, waveName(item)))
                              ),
                              h(Btn, {
                                children: busy === 'preview-' + index ? '识别中…' : '预览',
                                kind: 'ghost',
                                small: true,
                                disabled: Boolean(busy),
                                onClick: () => previewWithTarget(index)
                              })
                            ))
                    )
                  }))
                )
              ),
              h('div', { className: 'sd-field' },
                h('div', { className: 'sd-field' },
                  h('label', null, h('input', { type: 'radio', name: 'sd-mode', checked: mode === 'merge', onChange: () => setMode('merge') }), ' 合并（同编号同答案原位替换，不同答案会留两行待核对）'),
                  h('label', null, h('input', { type: 'radio', name: 'sd-mode', checked: mode === 'replace', onChange: () => setMode('replace') }), ' 覆盖整份')
                )
              )
            )
          : null,
        focused && focused.status === 'ok'
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '映射：' + focused.name),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                  h('span', { className: 'sd-note' }, '编号列：', h('b', null, focused.data.mapping.idColumn)),
                  h('span', { className: 'sd-chip' }, focused.data.scaleName + ' · ' + waveName(focused.data.wave)),
                  h('span', { className: 'sd-chip' }, '匹配 ' + focused.data.mapping.matched + '/' + focused.data.mapping.total),
                  h('span', { className: 'sd-chip' }, focused.data.rows + ' 行'),
                  focused.data.emptyCells ? h('span', { className: 'sd-chip' }, '空格 ' + focused.data.emptyCells) : null
                )
              ),
              focused.data.mapping.unmatched.length
                ? h('div', { className: 'sd-alert sd-alert-warn', style: { margin: 0 } }, '有 ' + focused.data.mapping.unmatched.length + ' 题没认到列：第 ' + focused.data.mapping.unmatched.join('、') + ' 题。可在下面手动指定，否则按缺失处理。')
                : null,
              h('div', { className: 'sd-table-wrap', style: { maxHeight: 'none' } },
                h('table', { className: 'sd-table' },
                  h('thead', null, h('tr', null,
                    h('th', { className: 'sd-sticky' }, '编号'),
                    h('th', { className: 'is-score' }, '已答'),
                    h('th', { className: 'is-score' }, '缺'),
                    h('th', null, '分量表预览')
                  )),
                  h('tbody', null, focused.data.preview.map(row => h('tr', { key: row.id },
                    h('td', { className: 'sd-sticky sd-id' }, row.id),
                    h('td', { className: 'is-score' }, String(row.answered)),
                    h('td', { className: 'is-score' }, row.missing ? String(row.missing) : ''),
                    h('td', { className: 'sd-mono' }, Object.entries(row.subs).map(([key, value]) => key + ' ' + (value === null ? '—' : value)).join('  '))
                  )))
                )
              ),
              h('details', { className: 'sd-details' },
                h('summary', null, '手动改列对应（' + focused.data.mapping.total + ' 题）'),
                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 6, marginTop: 8 } },
                  focused.data.mapping.items.map(item => h('div', { key: item.no, style: { display: 'flex', gap: 6, alignItems: 'center' } },
                    h('span', { className: 'sd-note', style: { width: 34 } }, '第' + item.no),
                    h('select', {
                      className: 'sd-select',
                      style: { flex: 1, maxWidth: 'none', height: 26, fontSize: 11 },
                      value: item.column || '',
                      onChange: event => {
                        const column = event.target.value || null
                        setPreviews(prev => prev.map((entry, index) => {
                          if (index !== focus || entry.status !== 'ok') return entry
                          const mapping = {
                            ...entry.data.mapping,
                            items: entry.data.mapping.items.map(candidate => candidate.no === item.no ? { ...candidate, column, how: 'manual' } : candidate),
                            matched: entry.data.mapping.items.filter(candidate => (candidate.no === item.no ? column : candidate.column)).length
                          }
                          return { ...entry, data: { ...entry.data, mapping } }
                        }))
                      }
                    },
                      h('option', { value: '' }, '（缺失）'),
                      headers.map(name => h('option', { key: name, value: name }, name))
                    )
                  ))
                )
              ),
              focused.data.issues && focused.data.issues.length
                ? h('div', { className: 'sd-issues' },
                    focused.data.issues.slice(0, 12).map((item, index) => h('div', { className: 'sd-issue', key: index },
                      h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : item.level === 'warn' ? 'warn' : 'info') }, LEVEL_TEXT[item.level] || '提示'),
                      h('span', { className: 'sd-issue-body' }, item.text)
                    ))
                  )
                : null,
              h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
                Btn({
                  children: busy === 'apply-' + focus ? '导入中…' : focused.imported ? '已导入' : focused.auto ? '导入这份文件（全部匹配）' : '导入这一组',
                  kind: 'primary',
                  disabled: Boolean(busy) || focused.imported,
                  onClick: () => importAt(focus)
                })
              )
            )
          : null,
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' }, h('h3', null, '导入记录'), h('span', { className: 'sd-note' }, '写进 _lab/scales/imports.json，含当时的定义版本')),
          data.imports && data.imports.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                data.imports.map((entry, index) => h('div', { key: index, style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5 } },
                  h('span', { className: 'sd-note mono' }, String(entry.at || '').replace('T', ' ').slice(0, 16)),
                  h('span', { className: 'sd-chip' }, entry.action === 'import' ? '导入' : entry.action === 'manual' ? '手填' : entry.action === 'keep-one' ? '留一份' : entry.action === 'rename' ? '改号' : entry.action === 'delete-row' ? '删行' : '删除'),
                  h('span', { className: 'sd-mono' }, entry.scale + ' ' + entry.wave),
                  h('span', { className: 'sd-note' }, entry.file || entry.note || ''),
                  h('span', { className: 'sd-note', style: { marginLeft: 'auto' } }, entry.rows ? entry.rows + ' 行' : '')
                ))
              )
            : h('div', { className: 'sd-note' }, '还没有导入记录。')
        )
      )
    }

    /* ================================================================ *
     * 流程
     * ================================================================ */

    function FlowTab({ data, onOpenScale }) {
      const flow = data.flow || { stages: [], problems: [] }
      const recorded = (scale, wave) => {
        const instrument = data.instruments.find(item => item.id === scale)
        return instrument && instrument.data && instrument.data[wave] ? instrument.data[wave].rows : 0
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '施测流程'),
            h('span', { className: 'sd-note' }, [flow.source, flow.version].filter(Boolean).join(' · ')),
            h('span', { className: 'sd-chip', style: { marginLeft: 'auto' } }, flow.stages.length + ' 个阶段')
          ),
          flow.note ? h('div', { className: 'sd-note' }, flow.note) : null,
          flow.problems && flow.problems.length
            ? h('div', { className: 'sd-issues' },
                flow.problems.map((item, index) => h('div', { className: 'sd-issue', key: index },
                  h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : 'warn') }, item.level === 'bad' ? '高' : '中'),
                  h('span', { className: 'sd-issue-body' }, item.text)
                ))
              )
            : null
        ),
        flow.stages.map(stage => h('div', { className: 'sd-card', key: stage.id },
          h('div', { className: 'sd-card-head' },
            h('h3', null, stage.label),
            h('span', { className: 'sd-note' }, stage.steps.length + ' 步')
          ),
          stage.note ? h('div', { className: 'sd-note' }, stage.note) : null,
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            stage.steps.map((step, index) => {
              const isScale = step.kind === 'scale'
              const instrument = isScale ? data.instruments.find(item => item.id === step.scale) : null
              return h('div', {
                key: index,
                style: {
                  display: 'grid',
                  gridTemplateColumns: '22px 56px minmax(0,1fr) auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '5px 8px',
                  border: '1px solid var(--sd-line)',
                  borderRadius: 8,
                  background: 'var(--sd-bg)'
                }
              },
                h('span', { className: 'sd-note', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, String(index + 1)),
                h('span', { className: 'sd-chip', style: { justifyContent: 'center' } }, FLOW_KIND[step.kind] || step.kind),
                h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } },
                  h('span', {
                    style: {
                      fontSize: 12,
                      fontWeight: isScale ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }
                  }, isScale && instrument ? instrument.short + ' · ' + instrument.name : step.title),
                  step.note ? h('span', { className: 'sd-note', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, step.note) : null
                ),
                isScale
                  ? h('span', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                      h('span', { className: 'sd-chip' }, waveName(step.wave)),
                      h('span', { className: 'sd-chip' }, recorded(step.scale, step.wave) + ' 份'),
                      h('button', {
                        type: 'button',
                        className: 'sd-chip is-brand',
                        style: { cursor: 'pointer', height: 24 },
                        onClick: () => onOpenScale(step.scale, step.wave)
                      }, '录入')
                    )
                  : h('span', { className: 'sd-note' }, '')
              )
            })
          )
        ))
      )
    }

    function ReviewPanel({ data, toast, refresh }) {
      const [scaleId, setScaleId] = useState(data.instruments[0] ? data.instruments[0].id : '')
      const instrument = data.instruments.find(item => item.id === scaleId) || data.instruments[0]
      const [wave, setWave] = useState(instrument ? instrument.waves[0] : 'T0')
      const [rows, setRows] = useState([])
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [drafts, setDrafts] = useState({})

      useEffect(() => {
        if (!instrument) return
        if (!instrument.waves.includes(wave)) setWave(instrument.waves[0])
      }, [scaleId])

      const load = useCallback(async () => {
        if (!instrument) return
        setBusy('load')
        setError('')
        try {
          const result = await call('answers', { scale: instrument.id, wave })
          setRows(result.rows || [])
          setDrafts({})
        } catch (err) {
          setError(err.message)
          setRows([])
        } finally {
          setBusy('')
        }
      }, [instrument && instrument.id, wave])

      useEffect(() => { load() }, [load])

      const act = async (action, payload, done) => {
        setBusy(action)
        setError('')
        try {
          const result = await call(action, payload)
          toast(done(result))
          await load()
          if (refresh) refresh()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      const rename = index => {
        const row = rows.find(item => item.index === index)
        const to = (drafts[index] !== undefined ? drafts[index] : row ? row.id : '').trim()
        if (!to) return
        act('renameAnswer', { scale: instrument.id, wave, index, to },
          result => '已把第 ' + (index + 1) + ' 行的编号 ' + result.from + ' 改成 ' + result.to)
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '核对与修正'),
            h('span', { className: 'sd-note' }, '改错编号、删掉多录的、重复编号里留一份；改完自动重算'),
            h('div', { style: { marginLeft: 'auto' } },
              h(Btn, { children: busy === 'load' ? '读取中…' : '刷新', kind: 'ghost', small: true, disabled: Boolean(busy), onClick: load })
            )
          ),
          h('div', { className: 'sd-field' },
            h('label', null, '量表'),
            h('select', {
              className: 'sd-select',
              value: instrument ? instrument.id : '',
              onChange: event => { setScaleId(event.target.value); setRows([]) }
            }, data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short + '（' + item.itemCount + ' 题）'))),
            h('label', null, '波次'),
            h('select', {
              className: 'sd-select',
              style: { maxWidth: 140 },
              value: wave,
              onChange: event => setWave(event.target.value)
            }, (instrument ? instrument.waves : []).map(item => h('option', { key: item, value: item }, waveName(item)))),
            h('span', { className: 'sd-note' }, rows.length + ' 份')
          ),
          error ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, error) : null,
          rows.length
            ? h('div', { className: 'sd-table-wrap' },
                h('table', { className: 'sd-table', style: { minWidth: 640 } },
                  h('thead', null, h('tr', null,
                    h('th', null, '#'),
                    h('th', null, '编号'),
                    h('th', { className: 'is-score' }, '已答'),
                    h('th', { className: 'is-score' }, '缺'),
                    h('th', null, '重复'),
                    h('th', null, '操作')
                  )),
                  h('tbody', null, rows.map(row => h('tr', { key: row.index },
                    h('td', { className: 'sd-note' }, String(row.index + 1)),
                    h('td', null, h('input', {
                      className: 'sd-input sd-id-input',
                      value: drafts[row.index] !== undefined ? drafts[row.index] : row.id,
                      onChange: event => setDrafts(prev => ({ ...prev, [row.index]: event.target.value.replace(/[^\d]/g, '').slice(0, 5) })),
                      onKeyDown: event => { if (event.key === 'Enter') rename(row.index) }
                    })),
                    h('td', { className: 'is-score' }, String(row.answered)),
                    h('td', { className: 'is-score' }, row.missing ? String(row.missing) : ''),
                    h('td', null, row.copies > 1
                      ? h('span', { className: 'sd-badge sd-badge-bad' }, row.copies + ' 份')
                      : h('span', { className: 'sd-note' }, '')),
                    h('td', null, h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                      h(Btn, { children: '改编号', kind: 'outline', small: true, disabled: Boolean(busy), onClick: () => rename(row.index) }),
                      row.copies > 1
                        ? h(Btn, {
                            children: '保留这份',
                            kind: 'primary',
                            small: true,
                            disabled: Boolean(busy),
                            onClick: () => act('keepAnswer', { scale: instrument.id, wave, index: row.index },
                              result => '保留 ' + result.id + ' 的这份，删掉其余 ' + result.removed + ' 份')
                          })
                        : null,
                      h(Btn, {
                        children: '删除',
                        kind: 'ghost',
                        small: true,
                        disabled: Boolean(busy),
                        onClick: () => {
                          if (!window.confirm('删除第 ' + (row.index + 1) + ' 行（编号 ' + row.id + '）？')) return
                          act('deleteAnswerRow', { scale: instrument.id, wave, index: row.index },
                            result => '已删除 ' + result.id + ' 的这份，剩 ' + result.remaining + ' 份')
                        }
                      })
                    ))
                  )))
                )
              )
            : h(Empty, { title: busy === 'load' ? '读取中…' : '这一波次还没有作答' }, '先导入或手填，再回来核对。')
        )
      )
    }

    function EntryTab({ data, toast, refresh, initial }) {
      const [mode, setMode] = useState('sheet')
      const [busy, setBusy] = useState('')
      const save = useCallback(async payload => {
        setBusy('save')
        try {
          const result = await call('save', payload)
          refresh()
          return result
        } finally {
          setBusy('')
        }
      }, [refresh])
      const clear = useCallback(async payload => {
        setBusy('clear')
        try {
          const result = await call('clear', payload)
          refresh()
          return result
        } finally {
          setBusy('')
        }
      }, [refresh])

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-tabs', style: { margin: 0 } },
          h('button', { type: 'button', className: 'sd-tab' + (mode === 'sheet' ? ' is-active' : ''), onClick: () => setMode('sheet') }, '手填答题纸'),
          h('button', { type: 'button', className: 'sd-tab' + (mode === 'import' ? ' is-active' : ''), onClick: () => setMode('import') }, '导入导出文件'),
          h('button', { type: 'button', className: 'sd-tab' + (mode === 'review' ? ' is-active' : ''), onClick: () => setMode('review') }, '核对与修正')
        ),
        mode === 'sheet'
          ? h(SheetEntry, { data, busy: Boolean(busy), onSave: save, onClear: clear, toast, initial })
          : mode === 'import'
            ? h(ImportPanel, { data, toast, onImported: refresh })
            : h(ReviewPanel, { data, toast, refresh })
      )
    }

    /* ================================================================ *
     * 计分
     * ================================================================ */

    function ScoreTab({ data, busy, onScore, onExport, onOpenFolder }) {
      const [open, setOpen] = useState('')
      const [detailRow, setDetailRow] = useState(null)
      const [filter, setFilter] = useState(ALL)
      const columns = data.scores.columns
      const scoreCols = columns.filter(col => col.kind === 'score')
      const shown = data.scores.rows.filter(row => {
        if (filter === ALL) return true
        return scoreCols.some(col => {
          const cell = row.cells[col.key]
          return filter === 'incomplete' ? cell && cell.status === 'incomplete'
            : filter === 'prorated' ? cell && cell.status === 'prorated'
              : filter === 'duplicate' ? cell && cell.status === 'duplicate'
                : cell && cell.status === 'absent'
        })
      })

      const groups = useMemo(() => {
        const byScale = new Map()
        for (const col of columns) {
          if (!byScale.has(col.scale)) byScale.set(col.scale, [])
          byScale.get(col.scale).push(col)
        }
        return [...byScale.entries()]
      }, [columns])

      // One drill-down button per scale × wave, not per column.
      const units = useMemo(() => {
        const seen = new Set()
        const list = []
        for (const col of scoreCols) {
          const key = col.scale + '__' + col.wave
          if (seen.has(key)) continue
          seen.add(key)
          list.push({ scale: col.scale, wave: col.wave })
        }
        return list
      }, [scoreCols])

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' }, h('h3', null, '这张表怎么看')),
          h('div', { className: 'sd-legend' },
            h('span', null, '一行 = 一个被试的编号；一列 = 他在某个量表某个阶段算出来的分。'),
            h('span', null, '数字 = 已算出的分'),
            h('span', null, '折算 = 缺了几题，按已答的题平均补上'),
            h('span', null, '! = 缺太多，没算分'),
            h('span', null, '重复 = 同一编号有多份，先去「录入 → 核对」留一份'),
            h('span', null, '— = 这个阶段还没有他的作答')
          ),
          h('details', { className: 'sd-details' },
            h('summary', null, '每一列是什么（点开对照）'),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '4px 12px', marginTop: 8 } },
              data.scores.columns.map(col => h('div', { key: col.key, style: { display: 'flex', gap: 6, fontSize: 11.5 } },
                h('span', { className: 'sd-mono', style: { color: 'var(--sd-text2)' } }, col.key),
                h('span', null, '= ' + (col.label || '') + (col.kind === 'missing' ? '' : col.range ? '（' + col.range[0] + '–' + col.range[1] + '）' : ''))
              ))
            )
          )
        ),
        data.scores.stale
          ? h('div', { className: 'sd-alert sd-alert-warn', style: { margin: 0 } }, 'scores.csv 比作答或定义旧：点「重算」重建。面板显示的是内存里实时算出的值。')
          : null,
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '计分表'),
            h('span', { className: 'sd-note' }, data.scores.counts.filled + ' / ' + data.scores.counts.subjects + ' 人有分数；' + data.scores.counts.complete + ' 人各量表各波次全齐'),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' } },
              Btn({ children: busy === 'score' ? '重算中…' : '重算并写 scores.csv', kind: 'primary', small: true, onClick: onScore, disabled: Boolean(busy) }),
              Btn({ children: '导出分数与报告', kind: 'outline', small: true, onClick: onExport, disabled: Boolean(busy) }),
              Btn({ children: '打开 _lab', kind: 'ghost', small: true, onClick: () => onOpenFolder('lab') })
            )
          ),
          h('div', { className: 'sd-field' },
            h('label', null, '筛选'),
            h('select', { className: 'sd-select', style: { maxWidth: 200 }, value: filter, onChange: event => setFilter(event.target.value) },
              h('option', { value: ALL }, '全部 ' + data.scores.rows.length),
              h('option', { value: 'incomplete' }, '有未计分'),
              h('option', { value: 'prorated' }, '有折算'),
              h('option', { value: 'absent' }, '有整份未录'),
              h('option', { value: 'duplicate' }, '有重复编号')
            )
          ),
          shown.length
            ? h('div', { className: 'sd-table-wrap' },
                h('table', { className: 'sd-table' },
                  h('thead', null,
                    h('tr', null,
                      h('th', { className: 'sd-sticky', rowSpan: 2 }, '编号'),
                      groups.map(([scale, cols]) => h('th', { key: scale, colSpan: cols.length, style: { textAlign: 'center', borderLeft: '1px solid var(--sd-line2)' } }, scale))
                    ),
                    h('tr', null,
                      groups.flatMap(([scale, cols]) => cols.map((col, index) => h('th', {
                        key: col.key,
                        className: 'is-score',
                        style: index === 0 ? { borderLeft: '1px solid var(--sd-line2)' } : undefined,
                        title: col.key
                      }, col.label.split(' · ')[1] || col.label)))
                    )
                  ),
                  h('tbody', null, shown.map(row => h(React.Fragment, { key: row.id },
                    h('tr', {
                      className: open === row.id ? 'is-open' : '',
                      onClick: () => {
                        if (open === row.id) {
                          setOpen('')
                          setDetailRow(null)
                        } else {
                          setOpen(row.id)
                          setDetailRow(null)
                        }
                      }
                    },
                      h('td', { className: 'sd-sticky sd-id' }, row.id),
                      groups.flatMap(([scale, cols]) => cols.map((col, index) => {
                        const cell = row.cells[col.key]
                        const isMissing = col.kind === 'missing'
                        const empty = !cell || cell.value === null || cell.value === undefined
                        const bad = cell && cell.status === 'incomplete'
                        const duplicate = cell && cell.status === 'duplicate'
                        return h('td', {
                          key: col.key,
                          className: 'is-score',
                          style: index === 0 ? { borderLeft: '1px solid var(--sd-line2)' } : undefined,
                          title: col.key + '：' + (STATUS_TEXT[cell ? cell.status : 'absent'] || '')
                        },
                          h('span', { className: 'sd-cell' + (bad || duplicate ? ' is-bad' : '') + (empty && !duplicate ? ' is-empty' : '') },
                            duplicate ? '重复' : isMissing ? (empty ? '—' : String(cell.value)) : scoreText(cell ? cell.value : null),
                            bad ? h('i', null, '!') : null
                          )
                        )
                      }))
                    ),
                    open === row.id
                      ? h('tr', null,
                          h('td', { colSpan: groups.reduce((sum, [, cols]) => sum + cols.length, 0) + 1, style: { padding: 10 } },
                            row.flags && row.flags.length
                              ? h('div', { className: 'sd-alert sd-alert-warn', style: { marginBottom: 8 } }, row.flags.join('；'))
                              : null,
                            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
                              units.map(unit => h('button', {
                                type: 'button',
                                key: unit.scale + unit.wave,
                                className: 'sd-chip',
                                style: { cursor: 'pointer', height: 24 },
                                onClick: event => {
                                  event.stopPropagation()
                                  call('detail', { id: row.id, scale: unit.scale, wave: unit.wave }).then(value => {
                                    setDetailRow({ id: row.id, value })
                                  }).catch(err => {
                                    setDetailRow({ id: row.id, value: null, error: err.message })
                                  })
                                }
                              }, unit.scale + ' ' + unit.wave + ' 每题'))
                            ),
                            detailRow && detailRow.id === row.id && detailRow.error
                              ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, detailRow.error)
                              : detailRow && detailRow.id === row.id && detailRow.value
                                ? h(ItemDetail, { detail: detailRow.value })
                                : h('span', { className: 'sd-note' }, '点上面的按钮看某一波次的每题明细。')
                          )
                        )
                      : null
                  ))
                )
              )
            )
            : h(Empty, { title: '还没有分数' }, '先在「录入」里手填，或导入问卷平台导出。'),
          h('div', { className: 'sd-note' }, '列名规则：单分量表用 量表_波次，多分量表用 量表_波次_分量表；每个波次另有一列「缺题」。分数在 _lab/scores.csv，每题明细在 scores_detail.csv，分数与题目合并的宽表在 data_wide.csv。')
        )
      )
    }

    function ItemDetail({ detail }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
          h('b', null, detail.short + ' · ' + waveName(detail.wave)),
          h('span', { className: 'sd-note' }, '答 ' + detail.answered + ' / ' + detail.items.length),
          Object.values(detail.subs).map(sub => h('span', { className: 'sd-chip', key: sub.key }, sub.label + ' ' + (sub.score === null ? '未计分' : sub.score)))
        ),
        h('div', { className: 'sd-table-wrap', style: { maxHeight: 300 } },
          h('table', { className: 'sd-table', style: { minWidth: 480 } },
            h('thead', null, h('tr', null, h('th', null, '题号'), h('th', null, '导出码'), h('th', null, '原始值'), h('th', null, '计分值'), h('th', null, '备注'))),
            h('tbody', null, detail.items.map(item => h('tr', { key: item.no },
              h('td', null, String(item.no), item.reverse ? h('span', { className: 'sd-badge sd-badge-warn', style: { marginLeft: 5 } }, '反') : null),
              h('td', { className: 'sd-mono' }, item.code || ''),
              h('td', null, item.raw || '—'),
              h('td', null, item.scored === null || item.scored === undefined ? '—' : String(item.scored)),
              h('td', { className: 'sd-note' }, item.reason === 'range' ? '越界' : item.reason === 'unparsed' ? '认不出' : item.reason === 'empty' ? '缺失' : '')
            )))
          )
        )
      )
    }

    /* ================================================================ *
     * 校验
     * ================================================================ */

    function ValidateTab({ data, busy, onValidate }) {
      const [level, setLevel] = useState('warn')
      const [scale, setScale] = useState(ALL)
      const issues = (data.issues || []).filter(item => {
        if (level === 'bad' && item.level !== 'bad') return false
        if (level === 'warn' && item.level === 'info') return false
        if (scale !== ALL && item.scale !== scale) return false
        return true
      })
      const counts = data.issueCounts || {}

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' }, h('h3', null, '这些提示是什么意思')),
          h('div', { className: 'sd-legend' },
            h('span', null, '「必须处理」的会让分数算错或算不出来；「建议看看」多半是缺题或编号可疑；「提示」只是说明，可以不管。'),
            h('span', null, '每条都写了两行：上面说哪里有问题，下面说怎么办。'),
            h('span', null, '先看「必须处理」，没有就说明现有数据能算分。')
          )
        ),
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '校验'),
            h('span', { className: 'sd-note' }, '定义与作答两边都查：题量、反向、取值域、缺失比例、导出码、版本漂移'),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
              busy === 'validate' ? h('span', { className: 'sd-spin' }) : null,
              Btn({ children: '重新校验', kind: 'outline', small: true, onClick: () => onValidate(), disabled: Boolean(busy) })
            )
          ),
          h('div', { className: 'sd-field' },
            h('label', null, '级别'),
            h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
              [['all', '全部 ' + (data.issues || []).length], ['bad', '高 ' + (counts.issueBad || 0)], ['warn', '中 ' + (counts.issueWarn || 0)]].map(([value, label]) =>
                h('button', {
                  type: 'button',
                  key: value,
                  className: 'sd-chip' + (level === value ? ' is-brand' : ''),
                  style: { cursor: 'pointer', height: 24 },
                  onClick: () => setLevel(value)
                }, label)
              )
            ),
            h('label', null, '量表'),
            h('select', { className: 'sd-select', style: { maxWidth: 180 }, value: scale, onChange: event => setScale(event.target.value) },
              h('option', { value: ALL }, '全部'),
              data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short))
            )
          ),
          issues.length
            ? h('div', { className: 'sd-issues' },
                issues.map((item, index) => h('div', { className: 'sd-issue', key: index },
                  h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : item.level === 'warn' ? 'warn' : 'info') }, LEVEL_TEXT[item.level] || '提示'),
                  h('span', { className: 'sd-issue-body' },
                    h('span', null, item.text),
                    item.hint ? h('div', { className: 'sd-issue-hint' }, item.hint) : null
                  ),
                  item.scale ? h('span', { className: 'sd-chip' }, item.scale + (item.wave ? ' ' + item.wave : '')) : null
                ))
              )
            : h(Empty, { title: '没有要报的问题' }, level === 'all' ? '定义与数据都过了当前检查。' : '这一档里没有条目。')
        )
      )
    }

    /* ================================================================ *
     * panel shell
     * ================================================================ */

    function Panel() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [tab, setTab] = useState('library')
      const [entryTarget, setEntryTarget] = useState(null)
      const [toastState, setToastState] = useState(null)
      const timer = useRef(null)

      const openScale = useCallback((scale, wave) => {
        setEntryTarget({ scale, wave, n: Date.now() })
        setTab('entry')
      }, [])

      const toast = useCallback((message, tone) => {
        setToastState({ message, tone: tone || 'ok' })
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setToastState(null), 5200)
      }, [])

      useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

      const load = useCallback(async (hard) => {
        try {
          const next = hard ? await call('refresh') : await call('status')
          setData(next)
          setError('')
          return next
        } catch (err) {
          setError(err.message)
          return null
        }
      }, [])

      useEffect(() => { load(false) }, [load])

      const refresh = useCallback(() => load(true), [load])

      const runScore = useCallback(async () => {
        setBusy('score')
        try {
          const result = await call('score')
          toast('已重算并写入：' + result.rows + ' 行 × ' + result.columns + ' 列；明细 ' + result.detailRows + ' 行。')
          await refresh()
        } catch (err) {
          toast(err.message, 'bad')
        } finally {
          setBusy('')
        }
      }, [refresh, toast])

      const runExport = useCallback(async () => {
        setBusy('export')
        try {
          const result = await call('export')
          toast('已导出：' + result.csv)
          await refresh()
        } catch (err) {
          toast(err.message, 'bad')
        } finally {
          setBusy('')
        }
      }, [refresh, toast])

      const runValidate = useCallback(async () => {
        setBusy('validate')
        try {
          const result = await call('validate')
          toast('校验完成：高 ' + result.counts.issueBad + ' 条，中 ' + result.counts.issueWarn + ' 条，提示 ' + result.counts.issueInfo + ' 条。')
          await refresh()
        } catch (err) {
          toast(err.message, 'bad')
        } finally {
          setBusy('')
        }
      }, [refresh, toast])

      const openFolder = useCallback(async target => {
        try {
          const result = await call('reveal', { target })
          toast('已打开：' + result.opened)
        } catch (err) {
          toast(err.message, 'bad')
        }
      }, [toast])

      const counts = data ? data.issueCounts : { issueBad: 0, issueWarn: 0 }
      const completed = data ? data.scores.counts.filled : 0
      const subjects = data ? data.scores.counts.subjects : 0

      return h('div', { className: 'sd-root' },
        h('div', { className: 'sd-top' },
          h('div', { className: 'sd-brand' },
            h('strong', null, '量表计分'),
            h('span', null, '定义、作答、分数、校验都在 _lab；题目文本不入库')
          ),
          data
            ? h('div', { className: 'sd-stats' },
                h(Stat, { label: '有分数', value: completed + '/' + subjects }),
                h(Stat, { label: '作答份数', value: data.totals.answerRows }),
                h(Stat, { label: '高分问题', value: counts.issueBad || 0, tone: counts.issueBad ? 'bad' : undefined }),
                h(Stat, { label: '提示', value: counts.issueWarn || 0, tone: counts.issueWarn ? 'warn' : undefined })
              )
            : null,
          h('div', { className: 'sd-actions' },
            Btn({ children: busy === 'refresh' ? '刷新中…' : '刷新', kind: 'ghost', small: true, onClick: async () => { setBusy('refresh'); await refresh(); setBusy('') } }),
            Btn({ children: '导出', kind: 'outline', small: true, onClick: runExport, disabled: Boolean(busy) || !data })
          )
        ),
        data
          ? h('div', { className: 'sd-tabs' },
              [['library', '量表库'], ['flow', '流程'], ['entry', '录入'], ['scores', '计分'], ['validate', '校验']].map(([value, label]) =>
                h('button', {
                  type: 'button',
                  key: value,
                  className: 'sd-tab' + (tab === value ? ' is-active' : ''),
                  onClick: () => setTab(value)
                }, label,
                  value === 'validate' && counts.issueBad ? h('b', { style: { color: 'var(--sd-bad)' } }, counts.issueBad) : null,
                  value === 'scores' && data.scores.stale ? h('b', { style: { color: 'var(--sd-warn)' } }, '·') : null
                )
              )
            )
          : null,
        h('div', { className: 'sd-scroll' },
          error
            ? h('div', { className: 'sd-alert sd-alert-bad' }, '面板加载失败：' + error + '（检查插件是否启用，或点「刷新」）')
            : null,
          !data
            ? h(Empty, { title: '正在读 _lab…' }, '第一次打开会把量表定义与施测流程播种到 _lab/scales。')
            : tab === 'library'
              ? h(LibraryTab, { data, toast, refresh, onOpenFolder: openFolder })
              : tab === 'flow'
                ? h(FlowTab, { data, onOpenScale: openScale })
                : tab === 'entry'
                  ? h(EntryTab, { data, toast, refresh, initial: entryTarget })
                  : tab === 'scores'
                    ? h(ScoreTab, { data, busy, onScore: runScore, onExport: runExport, onOpenFolder: openFolder })
                    : h(ValidateTab, { data, busy, onValidate: runValidate })
        ),
        toastState
          ? h('div', { className: 'sd-toast' + (toastState.tone === 'bad' ? ' is-bad' : '') }, toastState.message)
          : null
      )
    }

    /* ================================================================ *
     * icon + mounting
     * ================================================================ */

    function Icon({ size, active }) {
      return h('svg', {
        width: size || 18,
        height: size || 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true
      },
        h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 3 }),
        h('path', { d: 'M8 8h4M8 12h4M8 16h4' }),
        h('path', { d: 'M15.2 7.6l1.5 1.5 2.4-2.6' }),
        h('path', { d: 'M15.2 11.6l1.5 1.5 2.4-2.6' }),
        h('path', { d: 'M15.2 15.6l1.5 1.5 2.4-2.6' })
      )
    }

    /**
     * 最外层护栏：面板在真实页面里抛错时把错误画在面板上，而不是让槽位把
     * 整个面板撤掉（那会变成一片空白，且看不到原因）。
     */
    class Guard extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        console.error('[scale-desk] panel crashed:', error)
      }
      render() {
        if (this.state.error) {
          const text = String((this.state.error && (this.state.error.stack || this.state.error.message)) || this.state.error)
          return h('div', {
            style: {
              padding: '18px',
              fontFamily: 'ui-monospace,Consolas,monospace',
              fontSize: '12px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              color: '#b00020',
              overflow: 'auto',
              height: '100%',
              boxSizing: 'border-box'
            }
          }, '量表计分面板渲染失败：\n\n' + text + '\n\n（把这段发给我即可定位）')
        }
        return this.props.children
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => insertStyles(), 'scale-desk: styles')
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'scale-desk', order: 32, label: '量表计分' },
            props => h(Icon, { size: (props && props.size) || 18, active: Boolean(props && props.active) })
          )
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'scale-desk' }, () => h(Guard, null, h(Panel))))
      }
    }
  }
})
