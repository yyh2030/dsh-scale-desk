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
.sd-input,.sd-select{height:30px;padding:0 9px;border:1px solid var(--sd-line);border-radius:7px;background:var(--sd-bg);color:var(--sd-text);font-size:12.5px;outline:none;font-family:inherit;min-width:0}
.sd-input:focus,.sd-select:focus{border-color:var(--sd-brand)}
.sd-input.sd-id-input{width:88px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
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

    const WAVE_LABEL = { T0: 'T0 基线', T1: 'T1 诱导后', T2: 'T2 干预后', post: '决策后', week: '一周追踪' }
    const LEVEL_TEXT = { bad: '高', warn: '中', info: '提示' }
    const STATUS_TEXT = { ok: '完成', prorated: '折算', incomplete: '未计分', absent: '未录', empty: '未录', partial: '部分' }
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

    function LibraryTab({ data, toast, onOpenFolder }) {
      const [selected, setSelected] = useState(data.instruments[0] ? data.instruments[0].id : '')
      const [detail, setDetail] = useState(null)
      const [error, setError] = useState('')

      useEffect(() => {
        let alive = true
        setDetail(null)
        setError('')
        if (!selected) return () => { alive = false }
        call('definition', { id: selected })
          .then(value => { if (alive) setDetail(value) })
          .catch(err => { if (alive) setError(err.message) })
        return () => { alive = false }
      }, [selected])

      const instrument = data.instruments.find(item => item.id === selected)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '量表库'),
            h('span', { className: 'sd-note' }, '定义在 _lab/scales/defs，改完回面板点「重算」；题目文本默认不收录'),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
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
        error ? h('div', { className: 'sd-alert sd-alert-bad' }, error) : null,
        instrument && detail
          ? h('div', { className: 'sd-split' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } },
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' },
                    h('h3', null, instrument.short + ' · ' + instrument.name),
                    h('span', { className: 'sd-note' }, instrument.itemCount + ' 题，' + (instrument.scoringType === 'mean' ? '均分' : '累加')),
                    h('div', { style: { marginLeft: 'auto' } },
                      h('span', { className: 'sd-chip' }, instrument.response.min + '–' + instrument.response.max + ' 计分')
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
                  )
                ),
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' }, h('h3', null, '题目与反向标记')),
                  h('div', { className: 'sd-matrix' },
                    detail.items.map(item => h('div', { className: 'sd-item-row' + (item.reverse ? ' is-reverse' : ''), key: item.no },
                      h('span', { className: 'sd-item-no' }, String(item.no), item.reverse ? h('span', { className: 'sd-badge sd-badge-warn' }, '反') : null),
                      h('span', { className: 'sd-item-text' + (item.text ? '' : ' is-empty') }, item.text || ('第 ' + item.no + ' 题（文本未录入）')),
                      h('span', { className: 'sd-note' }, detail.codes[instrument.waves[0]] ? detail.codes[instrument.waves[0]][item.no - 1] : '')
                    ))
                  ),
                  h('div', { className: 'sd-note' }, '题目文本可选：在 _lab/scales/defs/' + instrument.id + '.json 的 items[].text 里补，面板会显示。题目本身不进插件仓库。')
                )
              ),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } },
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

    function SheetEntry({ data, busy, onSave, onClear, toast }) {
      const [scaleId, setScaleId] = useState(data.instruments[0] ? data.instruments[0].id : '')
      const instrument = data.instruments.find(item => item.id === scaleId) || data.instruments[0]
      const [wave, setWave] = useState(instrument ? instrument.waves[0] : 'T0')
      const [id, setId] = useState('')
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
          toast('已保存 ' + clean + '：' + bits.join('，'))
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
                  h('span', { className: 'sd-note' }, '点数字作答，再点一次取消')
                )
              ),
              h('div', { className: 'sd-matrix' },
                Array.from({ length: def.itemCount }, (_, index) => {
                  const no = index + 1
                  const reverse = def.reverse.includes(no)
                  return h('div', { className: 'sd-item-row' + (reverse ? ' is-reverse' : ''), key: no },
                    h('span', { className: 'sd-item-no' }, String(no)),
                    h('span', { className: 'sd-item-text is-empty' }, '第 ' + no + ' 题'),
                    h('div', { className: 'sd-opts' },
                      Array.from({ length: Math.round(def.response.max - def.response.min + 1) }, (_, offset) => {
                        const value = def.response.min + offset
                        const on = String(values[no]) === String(value)
                        return h('button', {
                          key: value,
                          type: 'button',
                          className: 'sd-opt' + (on ? ' is-on' : ''),
                          title: def.response.labels[value] || '',
                          onClick: () => {
                            setValues(prev => {
                              const next = { ...prev }
                              if (on) delete next[no]
                              else next[no] = String(value)
                              return next
                            })
                          }
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
      const [text, setText] = useState('')
      const [base64, setBase64] = useState('')
      const [filename, setFilename] = useState('')
      const [scaleId, setScaleId] = useState('')
      const [wave, setWave] = useState('')
      const [preview, setPreview] = useState(null)
      const [issues, setIssues] = useState([])
      const [mode, setMode] = useState('merge')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [over, setOver] = useState(false)
      const fileRef = useRef(null)
      const inputRef = useRef(null)

      const readFile = useCallback(async file => {
        if (!file) return
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
        setBase64(btoa(binary))
        setText('')
        setFilename(file.name || '')
        setPreview(null)
        setIssues([])
        setError('')
      }, [])

      const previewNow = async () => {
        if (!base64 && !text) {
          setError('先选一个 CSV / TSV 导出文件')
          return
        }
        setBusy('preview')
        setError('')
        try {
          const payload = base64
            ? { data: base64, filename, scale: scaleId || undefined, wave: wave || undefined }
            : { text, filename, scale: scaleId || undefined, wave: wave || undefined }
          const next = await call('importPreview', payload)
          setPreview(next)
          setIssues(next.issues || [])
          if (!scaleId) setScaleId(next.scale)
          if (!wave) setWave(next.wave)
        } catch (err) {
          setError(err.message)
          setPreview(null)
        } finally {
          setBusy('')
        }
      }

      const apply = async () => {
        if (!preview) return
        setBusy('apply')
        setError('')
        try {
          const payload = {
            data: base64 || undefined,
            text: base64 ? undefined : text,
            filename,
            scale: preview.scale,
            wave: preview.wave,
            mode,
            mapping: preview.mapping
          }
          const result = await call('importApply', payload)
          toast('已导入 ' + result.imported + ' 行到 ' + result.scale + ' ' + waveName(result.wave) + '（现共 ' + result.total + ' 人）')
          setPreview(null)
          setIssues([])
          setText('')
          setBase64('')
          setFilename('')
          if (inputRef.current) inputRef.current.value = ''
          onImported()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      const headers = preview ? preview.header : []

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '导入问卷平台导出'),
            h('span', { className: 'sd-note' }, 'QuestionPro / 问卷星 / Excel 另存的 CSV 与 TSV；UTF-8 与 GBK 都认')
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
              const file = event.dataTransfer.files && event.dataTransfer.files[0]
              readFile(file)
            },
            onClick: () => fileRef.current && fileRef.current.click()
          },
            h('strong', null, '把导出文件拖到这里，或点一下选文件'),
            h('span', null, '列名会被映射到量表题号：先认导出码（如 t0_stais_01），认不出再按 Q1 / 第1题')
          ),
          h('input', { ref: fileRef, type: 'file', accept: '.csv,.tsv,.txt', style: { display: 'none' }, onChange: event => readFile(event.target.files && event.target.files[0]) }),
          h('div', { className: 'sd-field' },
            h('label', null, '目标量表'),
            h('select', {
              className: 'sd-select',
              value: scaleId,
              onChange: event => { setScaleId(event.target.value); setWave(''); setPreview(null); setIssues([]) }
            },
              h('option', { value: '' }, '按列名自动识别'),
              data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short))
            ),
            h('label', null, '波次'),
            h('select', {
              className: 'sd-select',
              style: { maxWidth: 150 },
              value: wave,
              onChange: event => { setWave(event.target.value); setPreview(null); setIssues([]) }
            },
              h('option', { value: '' }, '按列名自动识别'),
              (scaleId
                ? ((data.instruments.find(item => item.id === scaleId) || {}).waves || [])
                : ['T0', 'T1', 'T2', 'week']
              ).map(item => h('option', { key: item, value: item }, waveName(item)))
            ),
            h('span', { className: 'sd-note' }, '认不出列名时才需要手动指定；正常情况留「自动识别」')
          ),
          filename
            ? h('div', { className: 'sd-file' },
                h('span', null, '已选：', h('b', null, filename)),
                h('span', { className: 'sd-note' }, base64 ? Math.round((base64.length * 0.75) / 1024) + ' KB' : ''),
                Btn({ children: '清除', kind: 'ghost', small: true, onClick: () => { setFilename(''); setBase64(''); setText(''); setPreview(null); if (fileRef.current) fileRef.current.value = '' } })
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
                onChange: event => { setText(event.target.value); setBase64(''); if (event.target.value) setFilename('') }
              })
            ),
            h('div', { style: { display: 'flex', gap: 6 } },
              Btn({ children: busy === 'preview' ? '识别中…' : '预览映射', kind: 'outline', onClick: previewNow, disabled: busy === 'preview' || (!base64 && !text) })
            )
          )
        ),
        error ? h('div', { className: 'sd-alert sd-alert-bad' }, error) : null,
        preview
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '预览：' + preview.scaleName + ' · ' + waveName(preview.wave)),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                  h('span', { className: 'sd-note' }, '编号列：', h('b', null, preview.mapping.idColumn)),
                  h('span', { className: 'sd-chip' }, '匹配 ' + preview.mapping.matched + '/' + preview.mapping.total),
                  h('span', { className: 'sd-chip' }, preview.rows + ' 行'),
                  preview.emptyCells ? h('span', { className: 'sd-chip' }, '空格 ' + preview.emptyCells) : null
                )
              ),
              preview.mapping.unmatched.length
                ? h('div', { className: 'sd-alert sd-alert-warn', style: { margin: 0 } }, '有 ' + preview.mapping.unmatched.length + ' 题没认到列：第 ' + preview.mapping.unmatched.join('、') + ' 题。可在下面手动指定，否则按缺失处理。')
                : null,
              h('div', { className: 'sd-table-wrap', style: { maxHeight: 'none' } },
                h('table', { className: 'sd-table' },
                  h('thead', null, h('tr', null,
                    h('th', { className: 'sd-sticky' }, '编号'),
                    h('th', { className: 'is-score' }, '已答'),
                    h('th', { className: 'is-score' }, '缺'),
                    h('th', null, '分量表预览')
                  )),
                  h('tbody', null, preview.preview.map(row => h('tr', { key: row.id },
                    h('td', { className: 'sd-sticky sd-id' }, row.id),
                    h('td', { className: 'is-score' }, String(row.answered)),
                    h('td', { className: 'is-score' }, row.missing ? String(row.missing) : ''),
                    h('td', { className: 'sd-mono' }, Object.entries(row.subs).map(([key, value]) => key + ' ' + (value === null ? '—' : value)).join('  '))
                  )))
                )
              ),
              h('details', { className: 'sd-details' },
                h('summary', null, '手动改列对应（' + preview.mapping.total + ' 题）'),
                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 6, marginTop: 8 } },
                  preview.mapping.items.map(item => h('div', { key: item.no, style: { display: 'flex', gap: 6, alignItems: 'center' } },
                    h('span', { className: 'sd-note', style: { width: 34 } }, '第' + item.no),
                    h('select', {
                      className: 'sd-select',
                      style: { flex: 1, maxWidth: 'none', height: 26, fontSize: 11 },
                      value: item.column || '',
                      onChange: event => {
                        const column = event.target.value || null
                        setPreview(prev => ({
                          ...prev,
                          mapping: {
                            ...prev.mapping,
                            items: prev.mapping.items.map(entry => entry.no === item.no ? { ...entry, column, how: 'manual' } : entry),
                            matched: prev.mapping.items.filter(entry => (entry.no === item.no ? column : entry.column)).length
                          }
                        }))
                      }
                    },
                      h('option', { value: '' }, '（缺失）'),
                      headers.map(name => h('option', { key: name, value: name }, name))
                    )
                  ))
                )
              ),
              issues.length
                ? h('div', { className: 'sd-issues' },
                    issues.slice(0, 12).map((item, index) => h('div', { className: 'sd-issue', key: index },
                      h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : item.level === 'warn' ? 'warn' : 'info') }, LEVEL_TEXT[item.level] || '提示'),
                      h('span', { className: 'sd-issue-body' }, item.text)
                    ))
                  )
                : null,
              h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
                h('div', { className: 'sd-field' },
                  h('label', null, h('input', { type: 'radio', name: 'sd-mode', checked: mode === 'merge', onChange: () => setMode('merge') }), ' 合并（同编号以新数据为准）'),
                  h('label', null, h('input', { type: 'radio', name: 'sd-mode', checked: mode === 'replace', onChange: () => setMode('replace') }), ' 覆盖整份')
                ),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                  Btn({ children: '取消', kind: 'ghost', onClick: () => setPreview(null) }),
                  Btn({ children: busy === 'apply' ? '导入中…' : '确认导入', kind: 'primary', onClick: apply, disabled: busy === 'apply' })
                )
              )
            )
          : null,
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' }, h('h3', null, '导入记录'), h('span', { className: 'sd-note' }, '写进 _lab/scales/imports.json，含当时的定义版本')),
          data.imports && data.imports.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                data.imports.map((entry, index) => h('div', { key: index, style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5 } },
                  h('span', { className: 'sd-note mono' }, String(entry.at || '').replace('T', ' ').slice(0, 16)),
                  h('span', { className: 'sd-chip' }, entry.action === 'import' ? '导入' : entry.action === 'manual' ? '手填' : '删除'),
                  h('span', { className: 'sd-mono' }, entry.scale + ' ' + entry.wave),
                  h('span', { className: 'sd-note' }, entry.file || entry.note || ''),
                  h('span', { className: 'sd-note', style: { marginLeft: 'auto' } }, entry.rows ? entry.rows + ' 行' : '')
                ))
              )
            : h('div', { className: 'sd-note' }, '还没有导入记录。')
        )
      )
    }

    function EntryTab({ data, toast, refresh }) {
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
          h('button', { type: 'button', className: 'sd-tab' + (mode === 'import' ? ' is-active' : ''), onClick: () => setMode('import') }, '导入导出文件')
        ),
        mode === 'sheet'
          ? h(SheetEntry, { data, busy: Boolean(busy), onSave: save, onClear: clear, toast })
          : h(ImportPanel, { data, toast, onImported: refresh })
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
              h('option', { value: 'absent' }, '有整份未录')
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
                        return h('td', {
                          key: col.key,
                          className: 'is-score',
                          style: index === 0 ? { borderLeft: '1px solid var(--sd-line2)' } : undefined,
                          title: col.key + '：' + (STATUS_TEXT[cell ? cell.status : 'absent'] || '')
                        },
                          h('span', { className: 'sd-cell' + (bad ? ' is-bad' : '') + (empty ? ' is-empty' : '') },
                            isMissing ? (empty ? '—' : String(cell.value)) : scoreText(cell ? cell.value : null),
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
          h('div', { className: 'sd-note' }, '列名规则：单分量表用 量表_波次，多分量表用 量表_波次_分量表；每个波次另有一列「缺题」。导出文件在 _lab/scores.csv 与 _lab/scores_detail.csv。')
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
      const [level, setLevel] = useState('all')
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
      const [toastState, setToastState] = useState(null)
      const timer = useRef(null)

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
              [['library', '量表库'], ['entry', '录入'], ['scores', '计分'], ['validate', '校验']].map(([value, label]) =>
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
            ? h(Empty, { title: '正在读 _lab…' }, '第一次打开会把 6 个量表定义播种到 _lab/scales/defs。')
            : tab === 'library'
              ? h(LibraryTab, { data, onOpenFolder: openFolder })
              : tab === 'entry'
                ? h(EntryTab, { data, toast, refresh })
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
