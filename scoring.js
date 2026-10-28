/**
 * scale-desk — scoring layer.
 *
 * Pure functions only: a definition in, numbers out. No file access here, so the
 * whole contract (definitions, import mapping, scoring, missing data, export
 * shape) can be unit-tested without touching the study folders.
 *
 * The four things a scorer may do, and nothing else:
 *   sum / mean, reverse scoring, prorated missing data, subscale aggregation.
 * Statistical tests belong to the analysis pipeline, not here.
 */

const DEFAULT_DECIMALS = 2
const WAVE_ORDER = ['T0', 'T1', 'T2', 'post', 'week']

export const WAVE_LABEL = {
  T0: 'T0 基线',
  T1: 'T1 诱导后',
  T2: 'T2 干预后',
  post: '决策后',
  week: '一周追踪'
}

export const WAVE_SHORT = { T0: 'T0', T1: 'T1', T2: 'T2', post: 'post', week: 'week' }

/* ------------------------------------------------------------------ *
 * csv
 * ------------------------------------------------------------------ */

export function parseCsv(text, delimiter = ',') {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = String(text || '').replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(r => r.some(v => String(v).trim() !== ''))
}

/** Tab- or semicolon-delimited exports: pick the delimiter of the header line. */
export function detectDelimiter(text) {
  const line = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim()) || ''
  const counts = { ',': 0, '\t': 0, ';': 0 }
  let inQuotes = false
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes
    else if (!inQuotes && c in counts) counts[c] += 1
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best && best[1] > 0 ? best[0] : ','
}

export function parseTable(text) {
  return parseCsv(text, detectDelimiter(text))
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

export function toCsv(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/* ------------------------------------------------------------------ *
 * small helpers
 * ------------------------------------------------------------------ */

export function roundTo(value, decimals = DEFAULT_DECIMALS) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function normalizeCode(value) {
  return String(value === null || value === undefined ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

export function normalizeId(value) {
  return String(value === null || value === undefined ? '' : value).trim().replace(/^["']|["']$/g, '')
}

/** A subject id in this study is five digits, two of which encode the cell. */
export function isValidId(value) {
  return /^[12][12]\d{3}$/.test(String(value || '').trim())
}

export function waveSort(a, b) {
  const ia = WAVE_ORDER.indexOf(a)
  const ib = WAVE_ORDER.indexOf(b)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b))
}

/* ------------------------------------------------------------------ *
 * definitions
 * ------------------------------------------------------------------ */

/**
 * Fill in every optional field so the rest of the module can assume a shape.
 * Reverse marks live on the item; a subscale may also list them, and the item
 * list wins — validateDefinition reports the mismatch instead of guessing.
 */
export function normalizeDef(raw, fallbackId) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const def = {
    schema: num(src.schema, 1),
    id: String(src.id || fallbackId || '').trim(),
    name: String(src.name || src.id || fallbackId || '').trim(),
    short: String(src.short || src.id || fallbackId || '').trim(),
    version: String(src.version || '').trim(),
    source: String(src.source || '').trim(),
    license: String(src.license || '').trim(),
    notes: String(src.notes || '').trim(),
    unit: String(src.unit || '分').trim(),
    decimals: Number.isInteger(src.decimals) ? src.decimals : DEFAULT_DECIMALS
  }

  const response = src.response && typeof src.response === 'object' ? src.response : {}
  def.response = {
    min: num(response.min, 1),
    max: num(response.max, 5),
    labels: response.labels && typeof response.labels === 'object' ? { ...response.labels } : {}
  }

  const declaredItems = Array.isArray(src.items) ? src.items : []
  const declaredCount = num(src.itemCount, declaredItems.length || 0)
  const maxNo = declaredItems.reduce((m, item) => Math.max(m, num(item && item.no, 0)), 0)
  const count = Math.max(0, Math.round(declaredCount), maxNo)
  def.itemCount = count

  const byNo = new Map()
  for (const item of declaredItems) {
    const no = num(item && item.no, NaN)
    if (!Number.isInteger(no) || no < 1) continue
    byNo.set(no, {
      no,
      text: String((item && item.text) || ''),
      reverse: Boolean(item && item.reverse),
      subscale: String((item && item.subscale) || '')
    })
  }
  def.items = []
  for (let no = 1; no <= count; no += 1) {
    def.items.push(byNo.get(no) || { no, text: '', reverse: false, subscale: '' })
  }

  const scoring = src.scoring && typeof src.scoring === 'object' ? src.scoring : {}
  def.scoring = { type: scoring.type === 'mean' ? 'mean' : 'sum', subscales: {} }
  const declaredSubs = scoring.subscales && typeof scoring.subscales === 'object' ? scoring.subscales : {}
  const subEntries = Object.keys(declaredSubs).length
    ? Object.entries(declaredSubs)
    : [['total', { items: def.items.map(item => item.no) }]]

  for (const [key, rawSub] of subEntries) {
    const sub = rawSub && typeof rawSub === 'object' ? rawSub : {}
    const items = Array.isArray(sub.items) && sub.items.length
      ? sub.items.map(Number).filter(n => Number.isInteger(n) && n >= 1)
      : def.items.map(item => item.no)
    const reverse = new Set((Array.isArray(sub.reverse) ? sub.reverse : []).map(Number).filter(n => Number.isInteger(n)))
    def.scoring.subscales[key] = {
      key,
      label: String(sub.label || key),
      items,
      reverse,
      multiplier: num(sub.multiplier, 1),
      range: Array.isArray(sub.range) && sub.range.length === 2 ? sub.range.map(Number) : null,
      descriptive: Boolean(sub.descriptive),
      aggregate: Boolean(sub.aggregate),
      reverseListed: reverse.size > 0,
      minAnswered: Number.isFinite(Number(sub.minAnswered)) ? Math.round(Number(sub.minAnswered)) : null
    }
    // Item-level reverse is authoritative; a subscale list only fills the gap.
    for (const no of reverse) {
      const item = def.items.find(it => it.no === no)
      if (item) item.reverse = true
    }
  }

  const missing = src.missing && typeof src.missing === 'object' ? src.missing : {}
  def.missing = {
    rule: missing.rule === 'strict' ? 'strict' : 'prorate',
    minAnswered: Math.max(1, Math.round(num(missing.minAnswered, Math.ceil(count * 0.8))))
  }

  def.waves = Array.isArray(src.waves) && src.waves.length
    ? [...new Set(src.waves.map(String).filter(Boolean))].sort(waveSort)
    : ['T0']

  def.codes = {}
  if (src.codes && typeof src.codes === 'object') {
    for (const [wave, list] of Object.entries(src.codes)) {
      if (Array.isArray(list)) def.codes[wave] = list.map(code => String(code).trim())
    }
  }

  def.file = src.file || ''
  return def
}

export function theoreticalRange(def, sub) {
  const items = sub.items.filter(no => no >= 1 && no <= def.itemCount)
  if (!items.length) return null
  // Reversal flips a value but not the bounds. A mean stays on the response
  // scale; a sum grows with the number of items and the multiplier.
  const count = items.length
  const span = def.scoring.type === 'mean' ? 1 : count
  const low = span * def.response.min * sub.multiplier
  const high = span * def.response.max * sub.multiplier
  return [roundTo(low, def.decimals), roundTo(high, def.decimals)]
}

function issue(level, scope, text, extra = {}) {
  return { level, scope, text, ...extra }
}

/** Definition problems: they must be fixed before any score is trusted. */
export function validateDefinition(def) {
  const list = []
  if (!def.id) list.push(issue('bad', 'definition', '定义缺少 id'))
  if (!def.name) list.push(issue('bad', 'definition', '定义缺少名称'))
  if (!def.version) list.push(issue('warn', 'definition', '没有写 version：不同版中文量表不可比，后续无法追溯', { hint: '在定义里补上中文版出处与年份' }))
  if (!def.itemCount) list.push(issue('bad', 'definition', '题量为 0：itemCount 与 items 都没写'))
  if (def.response.max <= def.response.min) list.push(issue('bad', 'definition', '取值域上限不大于下限'))
  const labelKeys = Object.keys(def.response.labels)
  if (labelKeys.length && labelKeys.length !== Math.round(def.response.max - def.response.min + 1)) {
    list.push(issue('warn', 'definition', `取值域有 ${Math.round(def.response.max - def.response.min + 1)} 档，标签写了 ${labelKeys.length} 个`))
  }

  const seen = new Set()
  for (const item of def.items) {
    if (seen.has(item.no)) list.push(issue('bad', 'definition', `题号 ${item.no} 重复`))
    seen.add(item.no)
  }

  const subs = Object.values(def.scoring.subscales)
  if (!subs.length) list.push(issue('bad', 'definition', '没有任何计分键'))
  const single = subs.length === 1

  for (const sub of subs) {
    const label = single ? '' : `分量表 ${sub.label} `
    const unknown = sub.items.filter(no => no < 1 || no > def.itemCount)
    if (unknown.length) list.push(issue('bad', 'definition', `${label}引用了不存在的题号 ${unknown.join('、')}`))
    const dup = sub.items.filter((no, i) => sub.items.indexOf(no) !== i)
    if (dup.length) list.push(issue('bad', 'definition', `${label}题号重复 ${[...new Set(dup)].join('、')}`))

    if (sub.reverseListed) {
      const mismatched = [...sub.reverse].filter(no => {
        const item = def.items.find(it => it.no === no)
        return item && !item.reverse
      })
      if (mismatched.length) list.push(issue('warn', 'definition', `${label}反向题列表与逐题标记不一致：${mismatched.join('、')}`))
    }

    const theoretical = theoreticalRange(def, sub)
    if (sub.range && theoretical) {
      const [lo, hi] = theoretical
      const [declaredLo, declaredHi] = sub.range
      if (Math.abs(declaredLo - lo) > 1e-9 || Math.abs(declaredHi - hi) > 1e-9) {
        list.push(issue('warn', 'definition', `${label}声明范围 ${declaredLo}–${declaredHi} 与按题量与取值域算出的 ${lo}–${hi} 不一致`, { hint: '确认是否漏了反向题、乘数或多题' }))
      }
    } else if (!sub.range && def.scoring.type === 'sum') {
      list.push(issue('info', 'definition', `${label}没有声明取值范围`))
    }
  }

  // Subscales may overlap only when the overlapping one is a descriptive total.
  for (let i = 0; i < subs.length; i += 1) {
    for (let j = i + 1; j < subs.length; j += 1) {
      const a = subs[i]
      const b = subs[j]
      if (a.aggregate || b.aggregate) continue
      const shared = a.items.filter(no => b.items.includes(no))
      if (shared.length) list.push(issue('warn', 'definition', `分量表 ${a.label} 与 ${b.label} 共用题号 ${shared.join('、')}`))
    }
  }

  for (const wave of def.waves) {
    const codes = def.codes[wave]
    if (!codes) {
      list.push(issue('info', 'definition', `${wave} 没有导出码，导入时只能按列名/题号匹配`, { wave }))
      continue
    }
    if (codes.length !== def.itemCount) {
      list.push(issue('warn', 'definition', `${wave} 导出码 ${codes.length} 个，题量 ${def.itemCount}`, { wave }))
    }
    if (new Set(codes).size !== codes.length) list.push(issue('bad', 'definition', `${wave} 导出码有重复`, { wave }))
  }

  return list
}

export function definitionSummary(def) {
  const subs = Object.values(def.scoring.subscales)
  const single = subs.length === 1
  return {
    id: def.id,
    name: def.name,
    short: def.short,
    version: def.version,
    source: def.source,
    license: def.license,
    notes: def.notes,
    unit: def.unit,
    itemCount: def.itemCount,
    waves: def.waves,
    response: def.response,
    scoringType: def.scoring.type,
    scoringLabel: def.scoring.type === 'mean' ? '均分' : '累加',
    missing: def.missing,
    reverse: def.items.filter(item => item.reverse).map(item => item.no),
    subscales: subs.map(sub => ({
      key: sub.key,
      label: sub.label,
      items: sub.items,
      multiplier: sub.multiplier,
      range: sub.range,
      theoretical: theoreticalRange(def, sub),
      descriptive: sub.descriptive
    })),
    columns: scoreColumns(def).filter(col => col.kind === 'score').map(col => col.key),
    single
  }
}

/** Every score column this definition contributes, plus one missing count per wave. */
export function scoreColumns(def) {
  const subs = Object.values(def.scoring.subscales)
  const single = subs.length === 1
  const columns = []
  for (const wave of def.waves) {
    for (const sub of subs) {
      columns.push({
        kind: 'score',
        key: single ? `${def.id}_${wave}` : `${def.id}_${wave}_${sub.key}`,
        scale: def.id,
        wave,
        sub: sub.key,
        label: single ? `${def.short} · ${WAVE_SHORT[wave] || wave}` : `${def.short}${sub.label} · ${WAVE_SHORT[wave] || wave}`,
        descriptive: sub.descriptive,
        range: sub.range
      })
    }
    columns.push({
      kind: 'missing',
      key: `${def.id}_${wave}_缺失`,
      scale: def.id,
      wave,
      label: `${def.short} · ${WAVE_SHORT[wave] || wave} 缺题`,
      range: [0, def.itemCount]
    })
  }
  return columns
}

/* ------------------------------------------------------------------ *
 * response values
 * ------------------------------------------------------------------ */

function labelLookup(def) {
  const map = new Map()
  for (const [value, text] of Object.entries(def.response.labels)) {
    const key = normalizeCode(text)
    if (key) map.set(key, Number(value))
  }
  return map
}

/**
 * One raw answer to one number. Text labels are accepted so an export that
 * carries "非常同意" instead of 5 still scores; anything unparsable is kept as
 * `invalid` and treated as missing, never silently coerced.
 */
const MISSING_TOKENS = new Set(['na', 'n/a', 'na.', 'null', 'nil', 'none', '-', '--', '—', '无', '空', '未答', '.'])

export function parseValue(def, raw) {
  const text = raw === null || raw === undefined ? '' : String(raw).trim()
  if (!text) return { value: null, reason: 'empty' }
  if (MISSING_TOKENS.has(text.toLowerCase())) return { value: null, reason: 'empty' }
  const numeric = Number(text.replace(/[，,]/g, ''))
  if (Number.isFinite(numeric)) {
    if (numeric < def.response.min || numeric > def.response.max) return { value: null, reason: 'range', raw: text }
    return { value: numeric }
  }
  const byLabel = labelLookup(def).get(normalizeCode(text))
  if (byLabel !== undefined) return { value: byLabel }
  return { value: null, reason: 'unparsed', raw: text }
}

export function scoredValue(def, value, reverse) {
  if (!Number.isFinite(value)) return null
  return reverse ? def.response.min + def.response.max - value : value
}

function computeSubscale(def, sub, scoredByNo) {
  const items = sub.items.filter(no => no >= 1 && no <= def.itemCount)
  const n = items.length
  const answered = items.filter(no => Number.isFinite(scoredByNo.get(no)))
  const a = answered.length
  const sum = answered.reduce((total, no) => total + scoredByNo.get(no), 0)
  const minAnswered = Math.min(sub.minAnswered === null || sub.minAnswered === undefined ? def.missing.minAnswered : sub.minAnswered, n)
  let score = null
  let status = 'empty'
  if (a > 0) {
    if (def.missing.rule === 'strict' && a < n) status = 'incomplete'
    else if (a < minAnswered) status = 'incomplete'
    else {
      const base = def.scoring.type === 'mean' ? sum / a : (sum / a) * n
      score = roundTo(base * sub.multiplier, def.decimals)
      status = a === n ? 'ok' : 'prorated'
    }
  }
  return { key: sub.key, score, answered: a, missing: n - a, status, minAnswered }
}

/**
 * Score one subject's answers to one scale at one wave.
 * `values` is keyed by item number; every item is visited so the detail table
 * can show the blank ones too.
 */
export function scoreAnswers(def, values = {}) {
  const scoredByNo = new Map()
  const items = def.items.map(item => {
    const raw = values[item.no]
    const parsed = parseValue(def, raw)
    const scored = scoredValue(def, parsed.value, item.reverse)
    if (Number.isFinite(scored)) scoredByNo.set(item.no, scored)
    return {
      no: item.no,
      text: item.text,
      reverse: item.reverse,
      raw: raw === undefined || raw === null ? '' : String(raw),
      value: parsed.value,
      scored,
      reason: parsed.reason || null
    }
  })
  const subs = {}
  for (const sub of Object.values(def.scoring.subscales)) {
    subs[sub.key] = computeSubscale(def, sub, scoredByNo)
  }
  const answered = items.filter(item => Number.isFinite(item.value)).length
  const invalid = items.filter(item => item.reason === 'range' || item.reason === 'unparsed')
  return {
    items,
    subs,
    answered,
    missing: def.itemCount - answered,
    invalid,
    status: answered === def.itemCount ? 'ok' : answered ? 'partial' : 'empty'
  }
}

/* ------------------------------------------------------------------ *
 * tables
 * ------------------------------------------------------------------ */

function answerKey(scale, wave) {
  return `${scale}__${wave}`
}

/** Index [{scale, wave, id, values}] as scale__wave → id → values. */
export function indexAnswers(answerRows) {
  const index = new Map()
  for (const row of answerRows || []) {
    const key = answerKey(row.scale, row.wave)
    if (!index.has(key)) index.set(key, new Map())
    index.get(key).set(row.id, row)
  }
  return index
}

/**
 * The wide score table: one row per subject, one column per scale/wave/subscale.
 * Subjects with no answers still get a row, so "who has not been entered yet"
 * is visible instead of invisible.
 */
export function buildScores(defs, answerRows, subjectIds = []) {
  const index = indexAnswers(answerRows)
  const ids = [...new Set([...subjectIds, ...(answerRows || []).map(row => row.id)].filter(Boolean))].sort()
  const columns = defs.flatMap(def => scoreColumns(def))
  const rows = ids.map(id => {
    const cells = {}
    const flags = []
    for (const def of defs) {
      for (const wave of def.waves) {
        const entry = index.get(answerKey(def.id, wave))?.get(id)
        const values = entry ? entry.values : {}
        const result = scoreAnswers(def, values)
        const missingCol = scoreColumns(def).find(col => col.kind === 'missing' && col.wave === wave)
        if (missingCol) {
          cells[missingCol.key] = { value: entry ? result.missing : null, status: entry ? result.status : 'absent' }
        }
        for (const col of scoreColumns(def).filter(item => item.kind === 'score' && item.wave === wave)) {
          const sub = result.subs[col.sub]
          if (!sub) continue
          cells[col.key] = {
            value: sub.score,
            status: entry ? sub.status : 'absent',
            missing: sub.missing,
            answered: sub.answered
          }
        }
        if (entry && result.invalid.length) {
          flags.push(`${def.short} ${wave}：${result.invalid.map(item => `第 ${item.no} 题「${item.raw}」`).join('、')}`)
        }
      }
    }
    return { id, cells, flags }
  })

  // One pass for counts, so the panel does not recompute them per render.
  const filled = rows.filter(row => Object.values(row.cells).some(cell => cell.status !== 'absent'))
  const complete = rows.filter(row => defs.every(def => def.waves.every(wave => {
    const entry = index.get(answerKey(def.id, wave))?.get(row.id)
    if (!entry) return false
    const result = scoreAnswers(def, entry.values)
    return result.answered === def.itemCount
  })))
  return { columns, rows, counts: { subjects: rows.length, filled: filled.length, complete: complete.length } }
}

/** Item-level rows for scores_detail.csv and the panel's per-subject drill-down. */
export function buildDetail(defs, answerRows) {
  const out = []
  const sorted = [...(answerRows || [])].sort((a, b) => a.id.localeCompare(b.id) || a.scale.localeCompare(b.scale) || waveSort(a.wave, b.wave))
  for (const row of sorted) {
    const def = defs.find(item => item.id === row.scale)
    if (!def) continue
    const result = scoreAnswers(def, row.values)
    for (const item of result.items) {
      out.push({
        id: row.id,
        scale: def.id,
        wave: row.wave,
        no: item.no,
        code: def.codes[row.wave]?.[item.no - 1] || '',
        reverse: item.reverse ? 'reverse' : '',
        raw: item.raw,
        value: item.value,
        scored: item.scored,
        note: item.reason || ''
      })
    }
  }
  return out
}

export function scoresCsv(defs, scores) {
  const header = ['编号', ...scores.columns.map(col => col.key)]
  const rows = scores.rows.map(row => [
    row.id,
    ...scores.columns.map(col => {
      const cell = row.cells[col.key]
      return cell && cell.value !== null && cell.value !== undefined ? cell.value : ''
    })
  ])
  return toCsv([header, ...rows])
}

export function detailCsv(detailRows) {
  const header = ['编号', '量表', '波次', '题号', '导出码', '反向', '原始值', '计分值', '备注']
  const rows = detailRows.map(row => [row.id, row.scale, row.wave, row.no, row.code, row.reverse, row.raw, row.scored, row.note])
  return toCsv([header, ...rows])
}

/* ------------------------------------------------------------------ *
 * import mapping
 * ------------------------------------------------------------------ */

const ID_ALIASES = [
  '编号', '被试编号', '参与者编号', '用户编号', '问卷编号', 'participant', 'participantid', 'respondent', 'respondentid',
  'pid', 'subject', 'subjectid', 'subjectid', 'id', 'responseid', 'responseidentifier', 'externalreference'
]

function findIdColumn(header, rows) {
  const normalized = header.map(normalizeCode)
  for (const alias of ID_ALIASES) {
    const at = normalized.indexOf(normalizeCode(alias))
    if (at >= 0) return { column: header[at], how: 'alias' }
  }
  const fuzzy = header.findIndex(name => /编号|participant|respondent|subject/i.test(String(name)))
  if (fuzzy >= 0) return { column: header[fuzzy], how: 'fuzzy' }
  // Last resort: a column whose every non-empty cell is a valid subject id.
  if (Array.isArray(rows) && rows.length) {
    for (let i = 0; i < header.length; i += 1) {
      const values = rows.map(row => String(row[i] ?? '').trim()).filter(Boolean)
      if (values.length && values.length >= Math.ceil(rows.length * 0.8) && values.every(value => isValidId(value))) {
        return { column: header[i], how: 'values' }
      }
    }
  }
  return { column: null, how: null }
}

function itemColumnCandidates(def, wave, header) {
  const codes = def.codes[wave] || []
  const normalized = header.map(normalizeCode)
  const claimed = new Set()
  const items = []
  for (const item of def.items) {
    const code = codes[item.no - 1] || ''
    let column = null
    let how = null
    if (code) {
      let at = header.findIndex(name => String(name).trim() === code)
      if (at < 0) at = normalized.indexOf(normalizeCode(code))
      if (at < 0) at = header.findIndex(name => normalizeCode(name).includes(normalizeCode(code)))
      if (at >= 0 && !claimed.has(at)) {
        column = header[at]
        how = 'code'
        claimed.add(at)
      }
    }
    if (!column) {
      const patterns = [
        new RegExp(`^(?:q|item|no)?0?${item.no}$`),
        new RegExp(`^第0?${item.no}题$`),
        new RegExp(`^${item.no}[、.．]`)
      ]
      for (let i = 0; i < header.length; i += 1) {
        if (claimed.has(i)) continue
        const norm = normalized[i]
        if (patterns.some(pattern => pattern.test(norm))) {
          column = header[i]
          how = 'number'
          claimed.add(i)
          break
        }
      }
    }
    items.push({ no: item.no, code, column, how })
  }
  return { items, claimed }
}

/**
 * Map an export's header onto one definition at one wave. Codes are exact
 * contract; numbering patterns are a fallback. Anything still unmatched is
 * returned so the panel can offer a manual pick.
 */
export function mapImportColumns(def, wave, header, rows) {
  const names = (header || []).map(name => String(name ?? '').trim())
  const id = findIdColumn(names, rows)
  const { items, claimed } = itemColumnCandidates(def, wave, names)
  if (id.column) {
    const at = names.indexOf(id.column)
    if (at >= 0) claimed.add(at)
  }
  const extras = names.filter((name, at) => !claimed.has(at))
  const unmatched = items.filter(item => !item.column).map(item => item.no)
  return {
    idColumn: id.column,
    idHow: id.how,
    items,
    unmatched,
    extraColumns: extras,
    matched: items.filter(item => item.column).length,
    total: def.itemCount
  }
}

/** Best (scale, wave) guess for a file, from its header codes first, name second. */
export function guessTarget(defs, header, filename = '') {
  const names = (header || []).map(name => normalizeCode(name))
  const fileNorm = normalizeCode(filename)
  let best = null
  for (const def of defs) {
    for (const wave of def.waves) {
      const codes = (def.codes[wave] || []).map(normalizeCode)
      const fromHeader = names.filter(name => codes.includes(name)).length
      const fromFile = codes.filter(code => code && fileNorm.includes(code)).length
      const mapping = mapImportColumns(def, wave, header || [])
      const score = Math.max(fromHeader, fromFile) * 10 + mapping.matched
      const enough = fromHeader >= Math.max(2, Math.ceil(def.itemCount * 0.5)) || mapping.matched >= Math.ceil(def.itemCount * 0.8)
      if (!enough) continue
      if (!best || score > best.score) best = { scale: def.id, wave, score, exact: fromHeader }
    }
  }
  return best
}

/**
 * Parse pasted item texts (one item per line) into `{no, text}` rows.
 *
 * Accepts a two-column paste from Word/Excel (`题号<TAB>题目`) or a plain list
 * in item order. Mixed numbering is refused rather than guessed, because a
 * wrong shift moves every reverse mark and every score by one item.
 */
export function parseItemTextTable(text, itemCount) {
  const lines = String(text || '')
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (!lines.length) return { items: [], issues: [issue('bad', 'texts', '没有可读的行')] }

  const prefixed = /^第\s*(\d{1,3})\s*题\s*[：:、.．\s]*(.+)$/
  const numbered = /^[（(]?\s*(\d{1,3})\s*[)）]?\s*(?:[、.．:：,，\t]|\s)\s*(.+)$/

  const parsed = []
  let numberedCount = 0
  for (const line of lines) {
    const match = prefixed.exec(line) || numbered.exec(line)
    if (match) {
      numberedCount += 1
      parsed.push({ no: Number(match[1]), text: match[2].trim() })
    } else {
      parsed.push({ no: null, text: line })
    }
  }

  const issues = []
  const byNo = new Map()
  if (numberedCount === 0) {
    parsed.forEach((entry, index) => {
      if (index >= itemCount) {
        issues.push(issue('warn', 'texts', `第 ${index + 1} 行超出题量 ${itemCount}，已忽略`))
        return
      }
      byNo.set(index + 1, entry.text)
    })
  } else if (numberedCount !== parsed.length) {
    return {
      items: [],
      issues: [issue('bad', 'texts', '有的行带题号、有的不带，混在一起没法判断顺序；要么全部带题号，要么全部按顺序排')]
    }
  } else {
    for (const entry of parsed) {
      if (entry.no < 1 || entry.no > itemCount) {
        issues.push(issue('warn', 'texts', `题号 ${entry.no} 超出 1–${itemCount}，已忽略`))
        continue
      }
      if (byNo.has(entry.no)) {
        issues.push(issue('bad', 'texts', `题号 ${entry.no} 重复`))
        continue
      }
      byNo.set(entry.no, entry.text)
    }
  }

  const items = [...byNo.entries()]
    .map(([no, text2]) => ({ no, text: text2.slice(0, 1000) }))
    .sort((a, b) => a.no - b.no)
  if (!items.length) issues.push(issue('bad', 'texts', '没有解析出任何题目'))
  return { items, issues, numbered: numberedCount > 0 }
}

/**
 * Turn a parsed export into answer rows for one definition/wave. Raw text is
 * preserved; out-of-range or unparsable cells are reported, not repaired.
 */
export function applyImport(def, wave, table, mapping) {
  if (!table || !table.length) return { rows: [], issues: [], header: [] }
  const header = table[0].map(name => String(name ?? '').trim())
  const body = table.slice(1)
  const columns = new Map()
  for (const item of mapping.items) {
    if (!item.column) continue
    const at = header.indexOf(item.column)
    if (at >= 0) columns.set(item.no, at)
  }
  const rows = []
  const issues = []
  const seen = new Map()
  body.forEach((cells, offset) => {
    const line = offset + 2
    const idAt = mapping.idColumn ? header.indexOf(mapping.idColumn) : -1
    const id = idAt >= 0 ? normalizeId(cells[idAt]) : ''
    if (!id) {
      issues.push(issue('bad', 'import', `第 ${line} 行没有编号，已跳过`, { line }))
      return
    }
    if (!isValidId(id)) {
      issues.push(issue('warn', 'import', `第 ${line} 行编号「${id}」不是 5 位分组编号，仍然导入`, { line, id }))
    }
    const values = {}
    for (const [no, at] of columns.entries()) {
      values[no] = String(cells[at] ?? '').trim()
    }
    if (!Object.values(values).some(value => value !== '')) {
      issues.push(issue('info', 'import', `第 ${line} 行只有编号、整行空白，已跳过`, { line, id }))
      return
    }
    if (seen.has(id)) {
      issues.push(issue('warn', 'import', `编号 ${id} 重复出现（第 ${seen.get(id).line}、${line} 行），保留后一行`, { line, id }))
      seen.get(id).values = values
      seen.get(id).line = line
      return
    }
    const row = { id, values, line }
    seen.set(id, row)
    rows.push(row)
  })
  return { rows, issues, header }
}

/* ------------------------------------------------------------------ *
 * data validation
 * ------------------------------------------------------------------ */

/**
 * Data problems, per scale and wave. `provenance` is the import/save log: it
 * carries the definition version each batch was recorded against, which is the
 * only way to notice that a scale was re-versioned mid-study.
 */
export function validateData(defs, answerFiles, scores, provenance = []) {
  const list = []

  for (const file of answerFiles || []) {
    const def = defs.find(item => item.id === file.scale)
    if (!def) {
      list.push(issue('bad', 'data', `answers/${file.name} 对应不到量表定义 ${file.scale}`, { scale: file.scale, wave: file.wave }))
      continue
    }
    if (!def.waves.includes(file.wave)) {
      list.push(issue('warn', 'data', `${def.name} 没有 ${file.wave} 这个波次，但文件存在`, { scale: def.id, wave: file.wave }))
    }
    const entry = [...provenance].reverse().find(item => item.scale === file.scale && item.wave === file.wave)
    if (entry && entry.defVersion && entry.defVersion !== def.version) {
      list.push(issue('warn', 'data', `${def.short} ${file.wave} 是按下述版本录入的：${entry.defVersion}；当前定义是：${def.version}。跨版本不可比前先确认来源`, { scale: def.id, wave: file.wave, hint: '确认后在定义里保留旧版本说明，或按新版本重新计分' }))
    }

    let rowsWithIssues = 0
    for (const row of file.rows || []) {
      if (!isValidId(row.id)) {
        list.push(issue('warn', 'data', `${def.short} ${file.wave} 编号「${row.id}」格式可疑`, { scale: def.id, wave: file.wave, id: row.id }))
      }
      const result = scoreAnswers(def, row.values)
      const bad = result.invalid
      if (bad.length) {
        rowsWithIssues += 1
        list.push(issue('bad', 'data', `${def.short} ${file.wave} ${row.id}：${bad.map(item => `第 ${item.no} 题「${item.raw}」不在 ${def.response.min}–${def.response.max}`).join('；')}`, {
          scale: def.id, wave: file.wave, id: row.id, hint: '修正原始作答后重算；当前按缺失处理'
        }))
      }
      const short = Object.values(result.subs).filter(sub => sub.status === 'incomplete')
      if (short.length) {
        const detail = short.map(sub => `${def.scoring.subscales[sub.key] ? def.scoring.subscales[sub.key].label : sub.key} 答 ${sub.answered}/${sub.answered + sub.missing}，门槛 ${sub.minAnswered}`).join('；')
        list.push(issue('warn', 'data', `${def.short} ${file.wave} ${row.id} 缺失过多，未计分（${detail}）`, { scale: def.id, wave: file.wave, id: row.id }))
      } else if (result.missing > 0) {
        list.push(issue('info', 'data', `${def.short} ${file.wave} ${row.id} 缺 ${result.missing} 题，已按比例折算（${def.missing.rule}）`, { scale: def.id, wave: file.wave, id: row.id }))
      }
    }
    if (rowsWithIssues > 1 && list.length > 400) break
  }

  // Subjects that answered one scale but not another, per wave.
  const byWave = new Map()
  for (const row of answerFiles || []) {
    const key = row.wave
    if (!byWave.has(key)) byWave.set(key, new Map())
    byWave.get(key).set(row.id, true)
  }
  for (const def of defs) {
    for (const wave of def.waves) {
      const present = byWave.get(wave)
      if (!present || !present.size) {
        list.push(issue('info', 'data', `${def.short} ${wave} 还没有任何作答记录`, { scale: def.id, wave }))
        continue
      }
      const ids = [...present.keys()]
      const missingHere = ids.filter(id => {
        const file = (answerFiles || []).find(item => item.scale === def.id && item.wave === wave && (item.rows || []).some(row => row.id === id))
        return !file
      })
      if (!missingHere.length) continue
      if (missingHere.length === ids.length) {
        list.push(issue('info', 'data', `${def.short} ${wave} 整批未录（${ids.length} 人已录别的量表）`, { scale: def.id, wave, ids: missingHere }))
      } else {
        list.push(issue('warn', 'data', `${def.short} ${wave} 缺 ${missingHere.length} 人的作答：${missingHere.slice(0, 8).join('、')}${missingHere.length > 8 ? ' 等' : ''}`, { scale: def.id, wave, ids: missingHere }))
      }
    }
  }

  if (scores && scores.counts && scores.counts.filled === 0) {
    list.push(issue('info', 'data', '还没有任何作答：先在「录入」里手填，或在「录入 → 导入 Excel/CSV」导入问卷平台导出'))
  }

  const levelOrder = { bad: 0, warn: 1, info: 2 }
  return list.sort((a, b) => (levelOrder[a.level] ?? 3) - (levelOrder[b.level] ?? 3) || String(a.scale || '').localeCompare(String(b.scale || '')))
}

/* ------------------------------------------------------------------ *
 * summaries (panel + agent tools)
 * ------------------------------------------------------------------ */

export function scoresSummaryText(defs, scores, issues = []) {
  const lines = []
  lines.push(`量表计分：${defs.length} 个量表定义，${scores.counts.filled}/${scores.counts.subjects} 人有分数，${scores.counts.complete} 人各量表各波次全齐。`)
  for (const def of defs) {
    const cols = scoreColumns(def).filter(col => col.kind === 'score')
    const perWave = def.waves.map(wave => {
      const missingCol = scoreColumns(def).find(col => col.kind === 'missing' && col.wave === wave)
      const done = scores.rows.filter(row => row.cells[missingCol?.key]?.status && row.cells[missingCol.key].status !== 'absent').length
      return `${wave} ${done} 人`
    }).join('，')
    lines.push(`- ${def.short}（${def.name}，${def.itemCount} 题，${def.scoring.type === 'mean' ? '均分' : '累加'}）：${perWave}；列 ${cols.map(col => col.key).join(' / ')}`)
  }
  if (issues.length) {
    const bad = issues.filter(item => item.level === 'bad').length
    const warn = issues.filter(item => item.level === 'warn').length
    lines.push(`校验：高 ${bad} 条，中 ${warn} 条。`)
    for (const item of issues.filter(item => item.level !== 'info').slice(0, 8)) lines.push(`- [${item.level === 'bad' ? '高' : '中'}] ${item.text}`)
  }
  return lines.join('\n')
}

export function subjectScoreText(def, wave, row, result) {
  const lines = [`${def.short}（${def.name}）${wave}：${row.id}`]
  for (const sub of Object.values(def.scoring.subscales)) {
    const cell = result.subs[sub.key]
    const range = sub.range ? `，范围 ${sub.range[0]}–${sub.range[1]}` : ''
    lines.push(`- ${sub.label}：${cell.score === null ? '未计分' : cell.score}${cell.score === null ? `（答 ${cell.answered}/${cell.answered + cell.missing}）` : range}；缺 ${cell.missing} 题`)
  }
  const reversed = result.items.filter(item => item.reverse && Number.isFinite(item.scored))
  if (reversed.length) lines.push(`- 反向题：${reversed.map(item => `${item.no}(${item.raw}→${item.scored})`).join('、')}`)
  return lines.join('\n')
}
