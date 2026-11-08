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
const WAVE_ORDER = []
export const WAVE_LABEL = {}
export const WAVE_SHORT = {}

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
  let text = String(value === null || value === undefined ? '' : value).trim()
  // Excel/QuestionPro 常把编号存成数字再导出成 "11002.0"：去掉无意义的小数零，
  // 否则同一个 11002 会被当成两个不同编号（一个合格、一个被跳过）。
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '')
  return text
}

/** Participant identifiers are opaque, non-empty strings. */
export function isValidId(value) {
  return normalizeId(value).length > 0
}

export function waveSort(a, b) {
  const ia = WAVE_ORDER.indexOf(a)
  const ib = WAVE_ORDER.indexOf(b)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b))
}

const ITEM_KINDS = new Set(['likert', 'number', 'choice', 'multi', 'text'])

function normalizeOptions(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map(option => {
      if (option === null || option === undefined) return null
      if (typeof option === 'object') {
        const value = String(option.value === undefined ? option.label : option.value)
        return value === '' ? null : { value, label: String(option.label === undefined ? value : option.label) }
      }
      const value = String(option)
      return value === '' ? null : { value, label: value }
    })
    .filter(Boolean)
}

function itemField(item, key) {
  return item && typeof item === 'object' ? item[key] : undefined
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
    instructions: String(src.instructions || '').trim(),
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
    const declaredKind = String(itemField(item, 'kind') || 'likert')
    byNo.set(no, {
      no,
      text: String((item && item.text) || ''),
      reverse: Boolean(item && item.reverse),
      subscale: String((item && item.subscale) || ''),
      kind: ITEM_KINDS.has(declaredKind) ? declaredKind : 'likert',
      options: normalizeOptions(itemField(item, 'options')),
      min: Number.isFinite(Number(itemField(item, 'min'))) ? Number(itemField(item, 'min')) : null,
      max: Number.isFinite(Number(itemField(item, 'max'))) ? Number(itemField(item, 'max')) : null,
      maxLength: Number(itemField(item, 'maxLength')) > 0 ? Math.round(Number(itemField(item, 'maxLength'))) : 2000
    })
  }
  def.items = []
  for (let no = 1; no <= count; no += 1) {
    def.items.push(byNo.get(no) || {
      no,
      text: '',
      reverse: false,
      subscale: '',
      kind: 'likert',
      options: [],
      min: null,
      max: null,
      maxLength: 2000
    })
  }

  const scoring = src.scoring && typeof src.scoring === 'object' ? src.scoring : {}
  const scoringType = scoring.type === 'none' ? 'none' : scoring.type === 'mean' ? 'mean' : 'sum'
  def.scoring = { type: scoringType, subscales: {} }
  const declaredSubs = scoring.subscales && typeof scoring.subscales === 'object' ? scoring.subscales : {}
  const subEntries = scoringType === 'none'
    ? []
    : Object.keys(declaredSubs).length
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
    minAnswered: Math.max(1, Math.round(num(missing.minAnswered, Math.ceil(count * (missing.minProportion ?? 0.8))))),
    minProportion: Number.isFinite(missing.minProportion) ? missing.minProportion : null,
    codes: Array.isArray(missing.codes) ? missing.codes.map(String) : null
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
  const bounds = items.map(no => def.items.find(item => item.no === no)).map(item => [item?.kind === 'number' && Number.isFinite(item.min) ? item.min : def.response.min, item?.kind === 'number' && Number.isFinite(item.max) ? item.max : def.response.max])
  const divisor = def.scoring.type === 'mean' ? items.length : 1
  const low = bounds.reduce((sum, range) => sum + range[0], 0) / divisor * sub.multiplier
  const high = bounds.reduce((sum, range) => sum + range[1], 0) / divisor * sub.multiplier
  return [roundTo(low, def.decimals), roundTo(high, def.decimals)]
}

function issue(level, scope, text, extra = {}) {
  return { level, scope, text, ...extra }
}

/** Validate source JSON before any normalization can hide errors. */
export function validateRawDefinition(raw) {
  const problems = []
  const bad = text => problems.push(issue('bad', 'definition', text))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [issue('bad', 'definition', '定义必须是JSON对象')]
  if (raw.schema !== 1) bad('定义schema必须为1')
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(raw.id || '')) bad('量表id不是安全的文件名标识')
  if (!Number.isInteger(raw.itemCount) || raw.itemCount < 1 || raw.itemCount > 1000) bad('itemCount需为1–1000整数')
  if (!raw.response || typeof raw.response !== 'object' || !Number.isFinite(raw.response.min) || !Number.isFinite(raw.response.max) || raw.response.min >= raw.response.max) bad('response需有有限数值min/max且下限小于上限')
  if (raw.decimals !== undefined && (!Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 10)) bad('decimals需为0–10整数')
  if (raw.missing?.rule !== undefined && !['strict','prorate'].includes(raw.missing.rule)) bad('missing.rule只能为strict/prorate')
  if (raw.missing?.minAnswered !== undefined && (!Number.isInteger(raw.missing.minAnswered) || raw.missing.minAnswered < 1 || raw.missing.minAnswered > raw.itemCount)) bad('missing.minAnswered超出题量')
  if (!Array.isArray(raw.items)) bad('items需为数组')
  const seen = new Set()
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    if (!item || !Number.isInteger(item.no) || item.no < 1 || item.no > raw.itemCount) { bad('题号超出声明itemCount'); continue }
    if (seen.has(item.no)) bad('题号重复：' + item.no)
    seen.add(item.no)
    if (item.kind !== undefined && !ITEM_KINDS.has(item.kind)) bad('未知题型：' + item.kind)
    if (item.reverse !== undefined && typeof item.reverse !== 'boolean') bad('reverse需为boolean：' + item.no)
    for (const bound of ['min','max']) if (item[bound] !== undefined && item[bound] !== null && !Number.isFinite(item[bound])) bad('题目范围需为有限数字：' + item.no)
    if (item.kind === 'number' && Number.isFinite(item.min) && Number.isFinite(item.max) && item.min > item.max) bad('题目范围下限大于上限：' + item.no)
  }
  if (Number.isInteger(raw.itemCount)) for (let no = 1; no <= raw.itemCount; no++) if (!seen.has(no)) bad('缺少题号：' + no)
  if (!Array.isArray(raw.waves) || !raw.waves.length || raw.waves.some(wave => !/^[A-Za-z0-9._-]{1,24}$/.test(wave))) bad('waves需含安全的波次标识')
  if (Array.isArray(raw.waves) && new Set(raw.waves).size !== raw.waves.length) bad('波次重复')
  if (!['sum','mean','none'].includes(raw.scoring?.type)) bad('未知计分方式')
  if (raw.scoring?.type !== 'none' && (!raw.scoring?.subscales || typeof raw.scoring.subscales !== 'object' || !Object.keys(raw.scoring.subscales).length)) bad('计分量表需有非空subscales')
  for (const sub of Object.values(raw.scoring?.subscales || {})) {
    if (!sub || typeof sub !== 'object') { bad('分量表需为对象'); continue }
    if (!Array.isArray(sub.items) || !sub.items.length || sub.items.some(no => !seen.has(no)) || new Set(sub.items).size !== sub.items.length) bad('分量表题号无效或重复')
    if (sub.multiplier !== undefined && !Number.isFinite(sub.multiplier)) bad('multiplier需为有限数字')
    if (sub.minAnswered !== undefined && sub.minAnswered !== null && (!Number.isInteger(sub.minAnswered) || sub.minAnswered < 1 || sub.minAnswered > (sub.items || []).length)) bad('分量表minAnswered超出题量')
    if (sub.reverse !== undefined && !Array.isArray(sub.reverse)) { bad('分量表reverse需为数组'); continue }
    if (sub.range !== undefined && sub.range !== null && (!Array.isArray(sub.range) || sub.range.length !== 2 || sub.range.some(value => !Number.isFinite(value)) || sub.range[0] > sub.range[1])) bad('分量表range需为两个有限数字')
    for (const no of sub.reverse || []) {
      const item = raw.items?.find(item => item.no === no)
      if (!item || item.reverse === false || !(sub.items || []).includes(no)) bad('反向题与逐题标记冲突：' + no)
    }
  }
  if (raw.missing?.minProportion !== undefined && (!Number.isFinite(raw.missing.minProportion) || !(raw.missing.minProportion > 0) || raw.missing.minProportion > 1)) bad('minProportion需大于0且不超过1')
  return problems
}

/** Definition problems: they must be fixed before any score is trusted. */
export function validateDefinition(def) {
  const list = []
  if (!def.id) list.push(issue('bad', 'definition', '定义缺少 id'))
  if (!def.name) list.push(issue('bad', 'definition', '定义缺少名称'))
  if (!def.version) list.push(issue('warn', 'definition', '没有写 version：不同版中文量表不可比，后续无法追溯', { hint: '在定义里补上中文版出处与年份' }))
  if (!def.itemCount) list.push(issue('bad', 'definition', '题量为 0：itemCount 与 items 都没写'))
  const labelKeys = Object.keys(def.response.labels)
  if (labelKeys.length && labelKeys.length !== Math.round(def.response.max - def.response.min + 1)) {
    list.push(issue('warn', 'definition', `取值域有 ${Math.round(def.response.max - def.response.min + 1)} 档，标签写了 ${labelKeys.length} 个`))
  }

  const seen = new Set()
  for (const item of def.items) {
    if (seen.has(item.no)) list.push(issue('bad', 'definition', `题号 ${item.no} 重复`))
    seen.add(item.no)
    if (item.kind === 'choice' || item.kind === 'multi') {
      if (!item.options.length) list.push(issue('bad', 'definition', `第 ${item.no} 题是选择题，但没有写可选项`))
      const values = item.options.map(option => option.value)
      if (new Set(values).size !== values.length) list.push(issue('bad', 'definition', `第 ${item.no} 题可选项有重复值`))
    }
    if (item.kind === 'number') {
      if (item.min !== null && item.max !== null && item.min > item.max) {
        list.push(issue('bad', 'definition', `第 ${item.no} 题数值范围下限大于上限`))
      }
    }
  }

  // A pure-likert definition must keep the response range consistent.
  const hasLikert = def.items.some(item => item.kind === 'likert')
  if (hasLikert && def.response.max <= def.response.min) list.push(issue('bad', 'definition', '取值域上限不大于下限'))

  const subs = Object.values(def.scoring.subscales)
  if (!subs.length && def.scoring.type !== 'none') list.push(issue('bad', 'definition', '没有任何计分键'))
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

  // A questionnaire that never exports codes is fine; only an inconsistent mix
  // (some waves coded, some not) is worth a note.
  const codedWaves = def.waves.filter(wave => (def.codes[wave] || []).length)
  for (const wave of def.waves) {
    const codes = def.codes[wave]
    if (!codes) {
      if (codedWaves.length) list.push(issue('info', 'definition', `${wave} 没有导出码，导入时只能按列名/题号匹配`, { wave }))
      continue
    }
    if (codes.length !== def.itemCount) {
      list.push(issue('warn', 'definition', `${wave} 导出码 ${codes.length} 个，题量 ${def.itemCount}`, { wave }))
    }
    // Repeated codes are normal for matrix exports (QuestionPro repeats the
    // parent question code on every row), so duplicates are not an error.
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
    scoringLabel: def.scoring.type === 'mean' ? '均分' : def.scoring.type === 'none' ? '不计分' : '累加',
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
 * One raw answer to one value. Number-like items return a number; choice and
 * text items keep the raw string. Anything unparsable is kept as `invalid` and
 * treated as missing, never silently coerced.
 */
const MISSING_TOKENS = new Set(['na', 'n/a', 'na.', 'null', 'nil', 'none', '-', '--', '—', '无', '空', '未答', '.'])

export function parseValue(def, raw, item) {
  const text = raw === null || raw === undefined ? '' : String(raw).trim()
  if (!text) return { value: null, reason: 'empty' }

  const kind = item && item.kind ? item.kind : 'likert'
  if (kind === 'text') {
    const maxLength = (item && item.maxLength) || 2000
    return { value: text.slice(0, maxLength) }
  }
  if (kind === 'choice' || kind === 'multi') {
    const options = (item && item.options) || []
    // QuestionPro hands numeric choice codes back as `4.0`; compare the
    // numeric form so `4.0` matches option `4`.
    const simplify = value => {
      const token = String(value).trim()
      const numeric = /^(\d+)\.0+$/.exec(token)
      return numeric ? numeric[1] : token
    }
    const allowed = new Set(options.map(option => simplify(option.value)))
    const parts = kind === 'multi'
      ? text.split(/[;,，；]/).map(part => part.trim()).filter(Boolean)
      : [text]
    if (parts.length && parts.every(part => allowed.has(simplify(part)))) {
      return { value: kind === 'multi' ? parts.map(simplify).join(',') : simplify(parts[0]) }
    }
    if ((def.missing.codes || [...MISSING_TOKENS]).map(value => value.toLowerCase()).includes(text.toLowerCase())) return { value: null, reason: 'empty' }
    return { value: null, reason: 'unparsed', raw: text }
  }

  if ((def.missing.codes || [...MISSING_TOKENS]).map(value => value.toLowerCase()).includes(text.toLowerCase())) return { value: null, reason: 'empty' }
  // number / likert: a bounded numeric answer
  const min = kind === 'number' && item && Number.isFinite(item.min) ? item.min : def.response.min
  const max = kind === 'number' && item && Number.isFinite(item.max) ? item.max : def.response.max
  const numeric = Number(text.replace(/[，,]/g, ''))
  if (Number.isFinite(numeric)) {
    if (numeric < min || numeric > max) return { value: null, reason: 'range', raw: text, min, max }
    if (kind === 'likert' && !Number.isInteger(numeric)) return { value: null, reason: 'unparsed', raw: text }
    return { value: numeric }
  }
  const byLabel = labelLookup(def).get(normalizeCode(text))
  if (byLabel !== undefined) return { value: byLabel }
  return { value: null, reason: 'unparsed', raw: text }
}

export function scoredValue(def, value, reverse, item) {
  if (!Number.isFinite(value)) return null
  const min = item?.kind === 'number' && Number.isFinite(item.min) ? item.min : def.response.min
  const max = item?.kind === 'number' && Number.isFinite(item.max) ? item.max : def.response.max
  return reverse ? min + max - value : value
}

function computeSubscale(def, sub, scoredByNo) {
  const items = sub.items.filter(no => no >= 1 && no <= def.itemCount)
  const n = items.length
  const answered = items.filter(no => Number.isFinite(scoredByNo.get(no)))
  const a = answered.length
  const sum = answered.reduce((total, no) => total + scoredByNo.get(no), 0)
  const minAnswered = Math.min(sub.minAnswered === null || sub.minAnswered === undefined ? (def.missing.minProportion !== null ? Math.ceil(n * def.missing.minProportion) : Math.ceil(n * def.missing.minAnswered / Math.max(1, def.itemCount))) : sub.minAnswered, n)
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
    const parsed = parseValue(def, raw, item)
    const scored = Number.isFinite(parsed.value) ? scoredValue(def, parsed.value, item.reverse, item) : null
    if (Number.isFinite(scored)) scoredByNo.set(item.no, scored)
    return {
      no: item.no,
      text: item.text,
      kind: item.kind,
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
  const answered = items.filter(item => item.value !== null && item.value !== undefined && item.value !== '').length
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

/** Index [{scale, wave, id, values}] as scale__wave → id → row[] (duplicates kept). */
export function indexAnswers(answerRows) {
  const index = new Map()
  for (const row of answerRows || []) {
    const key = answerKey(row.scale, row.wave)
    if (!index.has(key)) index.set(key, new Map())
    const byId = index.get(key)
    if (!byId.has(row.id)) byId.set(row.id, [])
    byId.get(row.id).push(row)
  }
  return index
}

/** The single answered row for a subject, or null when there are zero or many. */
export function pickedAnswer(index, scale, wave, id) {
  const rows = index.get(answerKey(scale, wave))?.get(id) || []
  return rows.length === 1 ? rows[0] : null
}

/**
 * The wide score table: one row per subject, one column per scale/wave/subscale.
 * Subjects with no answers still get a row, so "who has not been entered yet"
 * is visible instead of invisible. A duplicated id is never silently resolved:
 * its cells are marked `duplicate` until someone keeps one copy.
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
        const entries = index.get(answerKey(def.id, wave))?.get(id) || []
        const duplicate = entries.length > 1
        const entry = duplicate ? null : entries[0] || null
        const values = entry ? entry.values : {}
        const result = scoreAnswers(def, values)
        const missingCol = scoreColumns(def).find(col => col.kind === 'missing' && col.wave === wave)
        if (missingCol) {
          cells[missingCol.key] = {
            value: entry ? result.missing : null,
            status: duplicate ? 'duplicate' : entry ? result.status : 'absent',
            count: duplicate ? entries.length : entry ? 1 : 0
          }
        }
        for (const col of scoreColumns(def).filter(item => item.kind === 'score' && item.wave === wave)) {
          const sub = result.subs[col.sub]
          if (!sub) continue
          cells[col.key] = {
            value: duplicate ? null : sub.score,
            status: duplicate ? 'duplicate' : entry ? sub.status : 'absent',
            missing: sub.missing,
            answered: sub.answered
          }
        }
        if (duplicate) flags.push(`${def.short} ${wave}：编号 ${id} 有 ${entries.length} 份作答，先在「录入 → 核对」里保留一份`)
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
    const entry = pickedAnswer(index, def.id, wave, row.id)
    if (!entry) return false
    const result = scoreAnswers(def, entry.values)
    return result.answered === def.itemCount
  })))
  return { columns, rows, counts: { subjects: rows.length, filled: filled.length, complete: complete.length } }
}

/** Item-level rows for scores_detail.csv and the panel's per-subject drill-down. */
export function buildDetail(defs, answerRows) {
  const out = []
  const index = indexAnswers(answerRows)
  const sorted = [...(answerRows || [])].sort((a, b) => a.id.localeCompare(b.id) || a.scale.localeCompare(b.scale) || waveSort(a.wave, b.wave))
  for (const row of sorted) {
    const def = defs.find(item => item.id === row.scale)
    if (!def) continue
    const result = scoreAnswers(def, row.values)
    const duplicate = (index.get(answerKey(row.scale, row.wave))?.get(row.id) || []).length > 1
    for (const item of result.items) {
      out.push({
        id: row.id,
        definitionHash: row.definitionHash || '',
        submissionId: row.submissionId || '',
        scale: def.id,
        wave: row.wave,
        no: item.no,
        code: def.codes[row.wave]?.[item.no - 1] || '',
        reverse: item.reverse ? 'reverse' : '',
        raw: item.raw,
        value: item.value,
        scored: duplicate ? null : item.scored,
        note: duplicate ? 'duplicate' : item.reason || ''
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
  const header = ['编号', '量表', '波次', '题号', '导出码', '反向', '原始值', '计分值', '备注', 'definitionHash', 'submissionId']
  const rows = detailRows.map(row => [row.id, row.scale, row.wave, row.no, row.code, row.reverse, row.raw, row.scored, row.note, row.definitionHash, row.submissionId])
  return toCsv([header, ...rows])
}

/**
 * The integrated dataset: one row per subject, the scale scores first, then
 * every item's raw answer (`<scales>_<wave>_qNN`). This is the file analysis
 * starts from — no join required.
 */
export function wideCsv(defs, scores, answerRows) {
  const index = indexAnswers(answerRows)
  const itemColumns = []
  for (const def of defs) {
    for (const wave of def.waves) {
      for (const item of def.items) {
        itemColumns.push({ scale: def.id, wave, no: item.no, key: `${def.id}_${wave}_q${String(item.no).padStart(2, '0')}` })
      }
    }
  }
  const header = ['编号', ...scores.columns.map(col => col.key), ...itemColumns.map(col => col.key)]
  const scoreById = new Map(scores.rows.map(row => [row.id, row]))
  const ids = [...scoreById.keys()].sort()
  const rows = ids.map(id => {
    const scoreRow = scoreById.get(id)
    const cells = scores.columns.map(col => {
      const cell = scoreRow && scoreRow.cells[col.key]
      return cell && cell.value !== null && cell.value !== undefined ? cell.value : ''
    })
    const items = itemColumns.map(col => {
      const entry = pickedAnswer(index, col.scale, col.wave, id)
      const value = entry ? entry.values[col.no] : undefined
      return value === undefined || value === null ? '' : value
    })
    return [id, ...cells, ...items]
  })
  return toCsv([header, ...rows])
}

/* ------------------------------------------------------------------ *
 * import mapping
 * ------------------------------------------------------------------ */

// Strong aliases name the participant; weak ones (Response ID etc.) only count
// when nothing better exists — QuestionPro puts both in the same header row.
const STRONG_ID_ALIASES = [
  '编号', '被试编号', '参与者编号', '用户编号', '问卷编号',
  'participant', 'participantid', 'respondent', 'respondentid', 'pid', 'subject', 'subjectid'
]
const WEAK_ID_ALIASES = ['id', 'responseid', 'responseidentifier', 'externalreference']

function findIdColumn(header, rows) {
  const normalized = header.map(name => normalizeCode(headerCode(name)))
  for (const alias of STRONG_ID_ALIASES) {
    const at = normalized.indexOf(normalizeCode(alias))
    if (at >= 0) return { column: header[at], index: at, how: 'alias' }
  }
  // QuestionPro names the participant question `t1_participant_id` and also
  // exports `Respondent Email` / `Response ID`; prefer the participant one.
  const isEmail = name => /email/i.test(String(name))
  const participant = normalized.findIndex((name, at) => !isEmail(header[at]) && /participant|编号|subjectid/.test(name))
  if (participant >= 0) return { column: header[participant], index: participant, how: 'fuzzy' }
  const fuzzy = header.findIndex(name => !isEmail(name) && /编号|participant|respondent|subject/i.test(String(name)))
  if (fuzzy >= 0) return { column: header[fuzzy], index: fuzzy, how: 'fuzzy' }
  for (const alias of WEAK_ID_ALIASES) {
    const at = normalized.indexOf(normalizeCode(alias))
    if (at >= 0) return { column: header[at], index: at, how: 'weak-alias' }
  }
  // Last resort: a column whose every non-empty cell is a valid subject id.
  if (Array.isArray(rows) && rows.length) {
    for (let i = 0; i < header.length; i += 1) {
      const values = rows.map(row => String(row[i] ?? '').trim()).filter(Boolean)
      if (values.length && values.length >= Math.ceil(rows.length * 0.8) && values.every(value => /^[12][12]\d{3}$/.test(value))) {
        return { column: header[i], index: i, how: 'values' }
      }
    }
  }
  return { column: null, index: -1, how: null }
}

/**
 * QuestionPro puts the question code in brackets and repeats it for every row
 * of a matrix: `[t1_garden] 1. …`, `[t1_garden] 2. …`. Extract that code; fall back
 * to the header text itself.
 */
export function headerCode(name) {
  const text = String(name === null || name === undefined ? '' : name).trim()
  const match = /^\[([^\]]+)\]/.exec(text)
  return match ? match[1].trim() : text
}

/** Text used for fuzzy matching: lowercase, digits, latin and CJK only. */
function normalizeText(value) {
  return String(value === null || value === undefined ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

function bigrams(text) {
  const grams = new Set()
  for (let i = 0; i < text.length - 1; i += 1) grams.add(text.slice(i, i + 2))
  return grams
}

/**
 * Similarity between a definition's item text and an export column label.
 * Character bigrams work for Chinese without any tokenizer; an exact or
 * contained text is trusted outright.
 */
export function textSimilarity(a, b) {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.length >= 6 && right.includes(left)) return 0.95
  if (right.length >= 6 && left.includes(right)) return 0.95
  const gramsA = bigrams(left)
  const gramsB = bigrams(right)
  if (!gramsA.size || !gramsB.size) return 0
  let shared = 0
  for (const gram of gramsA) if (gramsB.has(gram)) shared += 1
  return (2 * shared) / (gramsA.size + gramsB.size)
}

/** Label of a column for fuzzy matching: the export's sub-header row first. */
function columnLabel(header, labels, at) {
  const label = labels && labels[at] ? String(labels[at]).trim() : ''
  if (label && !/^range$/i.test(label)) return label
  return String(header[at] || '').replace(/^\[[^\]]*\]\s*/, '')
}

function itemColumnCandidates(def, wave, header, taken = new Set(), labels = [], allowOrder = true, allowText = true) {
  const codes = def.codes[wave] || []
  const normalized = header.map(normalizeCode)
  const headerCodes = header.map(headerCode)
  const claimed = new Set(taken)

  // Group columns by their bracket code so repeated matrix codes keep order.
  const groups = new Map()
  headerCodes.forEach((code, at) => {
    const key = normalizeCode(code)
    if (!key) return
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(at)
  })

  const items = []
  for (const item of def.items) {
    const code = codes[item.no - 1] || ''
    let column = null
    let columnIndex = -1
    let how = null
    if (code) {
      const key = normalizeCode(code)
      // 1. exact bracket code (may repeat for every row of a matrix);
      // 2. a per-item code such as `t1_garden_03` against a `[t1_garden]` group;
      // 3. a header that merely contains the code.
      let candidates = groups.get(key) || []
      if (!candidates.length) {
        const ordinal = /^(.*?)(\d{1,3})$/.exec(String(code).trim())
        if (ordinal) {
          const base = groups.get(normalizeCode(ordinal[1]))
          const index = Number(ordinal[2]) - 1
          if (base && index >= 0 && index < base.length) candidates = [base[index]]
        }
      }
      if (!candidates.length) {
        candidates = header.map((name, at) => at).filter(at => normalized[at].includes(key))
      }
      const at = candidates.find(index => !claimed.has(index))
      if (at !== undefined) {
        column = header[at]
        columnIndex = at
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
          columnIndex = i
          how = 'number'
          claimed.add(i)
          break
        }
      }
    }
    items.push({ no: item.no, code, column, index: columnIndex, how })
  }

  // 3. 题面相似：题码缺失或对不上时，按题目文字认列。QuestionPro 的
  //    第二行表头（矩阵行文本）就是最好的依据。
  for (const item of items) {
    if (!allowText || item.column) continue
    const source = def.items.find(entry => entry.no === item.no)
    const itemText = source && source.text ? String(source.text) : ''
    if (!itemText) continue
    let best = -1
    let bestScore = 0
    let secondScore = 0
    for (let at = 0; at < header.length; at += 1) {
      if (claimed.has(at)) continue
      const score = textSimilarity(itemText, columnLabel(header, labels, at))
      if (score > bestScore) {
        secondScore = bestScore
        bestScore = score
        best = at
      } else if (score > secondScore) {
        secondScore = score
      }
    }
    if (best >= 0 && bestScore >= 0.6 && bestScore - secondScore >= 0.1) {
      item.column = header[best]
      item.index = best
      item.how = 'text'
      claimed.add(best)
    }
  }

  // 4. 顺序兜底：这个波次完全没有题码，而导出里正好有一组列数与题量相同，
  //    就按列顺序对题号（矩阵导出天然是有序的）。
  if (allowOrder && !codes.length && items.every(item => !item.column)) {
    const open = [...groups.values()].filter(group => group.length === def.itemCount && group.every(at => !claimed.has(at)))
    if (open.length === 1) {
      open[0].forEach((at, index) => {
        const item = items[index]
        item.column = header[at]
        item.index = at
        item.how = 'order'
        claimed.add(at)
      })
    }
  }

  return { items, claimed }
}

/**
 * Map an export's header onto one definition at one wave. Codes are the exact
 * contract; numbering, the second header row (item texts) and the order of a
 * single matrix block are fallbacks. Anything still unmatched is returned so
 * the panel can offer a manual pick.
 */
export function mapImportColumns(def, wave, header, rows, labels = [], allowOrder = true, allowText = true) {
  const names = (header || []).map(name => String(name ?? '').trim())
  const id = findIdColumn(names, rows)
  // Claim the id column first: the screening export reuses `Q4` for both the
  // participant number and the drinking-frequency item, so item mapping must
  // not steal the id column.
  const taken = new Set()
  if (id.index >= 0) taken.add(id.index)
  const { items, claimed } = itemColumnCandidates(def, wave, names, taken, labels, allowOrder, allowText)
  const extras = names.filter((name, at) => !claimed.has(at))
  const unmatched = items.filter(item => !item.column).map(item => item.no)
  return {
    idColumn: id.column,
    idIndex: id.index,
    idHow: id.how,
    items,
    unmatched,
    extraColumns: extras,
    matched: items.filter(item => item.column).length,
    total: def.itemCount
  }
}

/** Every (definition, wave) whose header now maps well enough. */
export function scanTargets(defs, header, rows, labels = []) {
  const headerKeys = (header || []).map(name => normalizeCode(headerCode(name)))
  const targets = []
  for (const def of defs) {
    for (const wave of def.waves) {
      const known = (def.codes[wave] || []).filter(Boolean)
      // A wave whose codes were configured but did not hit is probably a
      // different wave of the same instrument (identical item texts), so do
      // not let text similarity pull it in automatically.
      const mapping = mapImportColumns(def, wave, header, rows, labels, false, known.length === 0)
      if (!mapping.idColumn) continue
      const threshold = Math.max(1, Math.ceil(def.itemCount * 0.6))
      if (mapping.matched < threshold) continue
      const codes = known.map(normalizeCode)
      const codeHits = codes.length ? headerKeys.filter(key => codes.includes(key)).length : 0
      targets.push({
        scale: def.id,
        short: def.short,
        name: def.name,
        wave,
        matched: mapping.matched,
        total: mapping.total,
        codeHits,
        automatic: mapping.items.filter(item => item.how === 'code' && !/^(?:q|item|no)?\d+$/i.test(item.code)).length >= threshold,
        mapping
      })
    }
  }
  // When a survey's own code names one wave (`t1_garden`), a text-only match on
  // another wave (`t0_garden` shares the item texts) is noise: keep the coded one.
  const bestHits = new Map()
  for (const target of targets) {
    bestHits.set(target.scale, Math.max(bestHits.get(target.scale) || 0, target.codeHits))
  }
  const filtered = targets.filter(target => (bestHits.get(target.scale) || 0) === 0 || target.codeHits > 0)
  // The same physical item columns cannot be assigned automatically twice.
  const owners = new Map()
  for (const target of filtered.filter(target => target.automatic)) {
    for (const item of target.mapping.items.filter(item => item.index >= 0)) {
      if (!owners.has(item.index)) owners.set(item.index, [])
      owners.get(item.index).push(target)
    }
  }
  for (const targets of owners.values()) if (targets.length > 1) for (const target of targets) target.automatic = false
  return filtered.sort((a, b) => (b.codeHits - a.codeHits) || (b.matched / b.total - a.matched / a.total))
}

/** Best (scale, wave) guess for a file, from its header codes first, name second. */
export function guessTarget(defs, header, filename = '', labels = []) {
  const names = (header || []).map(name => normalizeCode(headerCode(name)))
  const fileNorm = normalizeCode(filename)
  let best = null
  for (const def of defs) {
    for (const wave of def.waves) {
      const codes = (def.codes[wave] || []).map(normalizeCode)
      const fromHeader = names.filter(name => codes.includes(name)).length
      const fromFile = codes.filter(code => code && fileNorm.includes(code)).length
      const known = (def.codes[wave] || []).filter(Boolean)
      const mapping = mapImportColumns(def, wave, header || [], [], labels, false, known.length === 0)
      const score = fromHeader * 100 + fromFile * 50 + mapping.matched
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
  mapping = confirmImportMapping(def, header, mapping)
  const columns = new Map(mapping.items.filter(item => item.index >= 0).map(item => [item.no, item.index]))
  const rows = []
  const issues = []
  const seen = new Map()
  body.forEach((cells, offset) => {
    const line = offset + 2
    const idAt = Number.isInteger(mapping.idIndex) && mapping.idIndex >= 0
      ? mapping.idIndex
      : (mapping.idColumn ? header.indexOf(mapping.idColumn) : -1)
    const id = idAt >= 0 ? normalizeId(cells[idAt]) : ''
    if (!id) {
      issues.push(issue('bad', 'import', `第 ${line} 行没有编号，已跳过`, { line }))
      return
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
      const prior = seen.get(id)
      const same = JSON.stringify(prior.values) === JSON.stringify(values)
      if (same) {
        issues.push(issue('info', 'import', `编号 ${id} 重复出现且答案相同（第 ${prior.line}、${line} 行），只留一份`, { line, id }))
        return
      }
      issues.push(issue('warn', 'import', `编号 ${id} 重复出现且答案不同（第 ${prior.line}、${line} 行），两行都保留，请在核对里留一份`, { line, id }))
      rows.push({ id, values, line })
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
      if (!row.definitionHash) list.push(issue('warn', 'data', `${def.short} ${file.wave} ${row.id} 没有definitionHash，无法追溯旧定义`, { scale: def.id, wave: file.wave, id: row.id }))
      else if (def.definitionHash && row.definitionHash !== def.definitionHash) list.push(issue('warn', 'data', `${def.short} ${file.wave} ${row.id} 按旧定义 ${row.definitionHash} 录入；当前 ${def.definitionHash}`, { scale: def.id, wave: file.wave, id: row.id }))
      const result = scoreAnswers(def, row.values)
      const bad = result.invalid
      if (bad.length) {
        rowsWithIssues += 1
        const describe = bad.map(item => {
          const entry = def.items.find(candidate => candidate.no === item.no)
          if (entry && (entry.kind === 'choice' || entry.kind === 'multi')) return `第 ${item.no} 题「${item.raw}」不在可选项里`
          if (entry && entry.kind === 'number') return `第 ${item.no} 题「${item.raw}」不是 ${entry.min === null ? '' : entry.min}–${entry.max === null ? '' : entry.max} 的数字`
          return `第 ${item.no} 题「${item.raw}」不在 ${def.response.min}–${def.response.max}`
        })
        list.push(issue('bad', 'data', `${def.short} ${file.wave} ${row.id}：${describe.join('；')}`, {
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
    const idCounts = new Map()
    for (const row of file.rows || []) idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1)
    for (const [id, count] of idCounts) {
      if (count > 1) {
        list.push(issue('bad', 'data', `${def.short} ${file.wave} 编号 ${id} 有 ${count} 份作答，先在「录入 → 核对」里保留一份`, {
          scale: def.id, wave: file.wave, id, hint: '重复的编号这一段不会被计分，直到只留一份'
        }))
      }
    }
    if (rowsWithIssues > 1 && list.length > 400) break
  }

  // Subjects that answered one scale but not another, per wave.
  const byWave = new Map()
  for (const file of answerFiles || []) {
    if (!byWave.has(file.wave)) byWave.set(file.wave, new Map())
    for (const row of file.rows || []) if (isValidId(row.id)) byWave.get(file.wave).set(row.id, true)
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
    lines.push(`- ${def.short}（${def.name}，${def.itemCount} 题，${def.scoring.type === 'mean' ? '均分' : def.scoring.type === 'none' ? '不计分' : '累加'}）：${perWave}；列 ${cols.map(col => col.key).join(' / ')}`)
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

/** Canonicalize and validate positions; labels are display-only. */
export function confirmImportMapping(def, header, base, overrides) {
  const invalid = message => Object.assign(new Error(message), { code: 'invalid_mapping' })
  const mapping = { ...base, items: base.items.map(item => ({ ...item })) }
  const position = (entry, key, labelKey, fallback) => {
    if (entry && Object.hasOwn(entry, key)) {
      const value = entry[key]
      if (!Number.isInteger(value) || value < -1 || value >= header.length) throw invalid('列索引超出范围')
      return value
    }
    if (entry && Object.hasOwn(entry, labelKey)) {
      const name = entry[labelKey]
      if (!name) return -1
      const matches = header.map((label, at) => label === name ? at : -1).filter(at => at >= 0)
      if (matches.length !== 1) throw invalid('列名不存在或重复，请使用列索引')
      return matches[0]
    }
    return fallback
  }
  mapping.idIndex = position(overrides, 'idIndex', 'idColumn', position(base, 'idIndex', 'idColumn', -1))
  if (mapping.idIndex < 0) throw invalid('请选择编号列')
  mapping.idColumn = header[mapping.idIndex]
  const changes = new Map()
  for (const item of overrides?.items || []) {
    if (!def.items.some(candidate => candidate.no === item.no) || changes.has(item.no)) throw invalid('题号不存在或重复')
    changes.set(item.no, item)
  }
  const taken = new Set([mapping.idIndex])
  mapping.items = mapping.items.map(item => {
    const change = changes.get(item.no)
    const index = position(change, 'index', 'column', position(item, 'index', 'column', -1))
    if (index >= 0 && taken.has(index)) throw invalid('同一列不能同时作为编号或多道题')
    if (index >= 0) taken.add(index)
    return { ...item, index, column: index >= 0 ? header[index] : null, how: change ? 'manual' : item.how }
  })
  mapping.matched = mapping.items.filter(item => item.index >= 0).length
  mapping.unmatched = mapping.items.filter(item => item.index < 0).map(item => item.no)
  mapping.extraColumns = header.filter((_, at) => !taken.has(at))
  return mapping
}
