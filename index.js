/**
 * scale-desk — Host half.
 *
 * One HTTP route serves the panel (量表库 / 录入 / 计分 / 校验); three agent tools
 * expose the same numbers as text. The study folders stay read-only: this plugin
 * writes only under `_lab` — definitions, raw answers, the two derived score
 * files, the import log and the export folder.
 *
 * Data contract (see README): answers are primary, scores are a cache.
 */

import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyImport,
  buildDetail,
  buildScores,
  detailCsv,
  guessTarget,
  isValidId,
  mapImportColumns,
  normalizeDef,
  normalizeId,
  parseItemTextTable,
  parseTable,
  scoreAnswers,
  scoreColumns,
  scoresCsv,
  scoresSummaryText,
  subjectScoreText,
  validateData,
  validateDefinition
} from './scoring.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_DEFS = path.join(HERE, 'defs')
const PKG_FLOW = path.join(HERE, 'flow.json')
const ROUTE = '/api/scale-desk'
const HEADER = 'x-scale-desk'
const MAX_BODY = 8 * 1024 * 1024
const MAX_ISSUES = 300

const DEFAULTS = {
  projectRoot: 'C:/Users/16787/OneDrive/Desktop/yyh硕士论文'
}

const KIND_LABEL = { scale: '量表', task: '任务', paper: '纸质', demo: '人口学', audio: '音频', text: '书写', survey: '问卷', rest: '练习' }

const LAB_README = `# _lab/scales

量表定义、施测流程与原始作答。派生结果不在这里：\`_lab/scores.csv\`（宽表）与
\`_lab/scores_detail.csv\`（每题明细）由插件重算生成，删掉可以重建。

- \`flow.json\`：施测流程（阶段与步骤）。量表步骤用 \`scale\` + \`wave\` 指向定义，
  其余步骤用 \`title\` 与 \`note\` 说明任务。
- \`defs/<量表>.json\`：题号、反向标记、计分键、缺失规则、导出码、出处、版本、
  指导语。\`items[].text\` 与 \`instructions\` 默认留空（题目不随插件仓库分发）；
  在面板「量表库 → 编辑题面」里填，或直接改这里。
- \`answers/<量表>__<波次>.csv\`：原始作答，\`编号,q01,q02,...\`，空 = 缺失。
  这是原始数据，不要手工改成计算结果。
- \`imports.json\`：每次导入/录入的时间、来源文件、当时使用的定义版本。

改了定义或作答，面板点「重算」即重建 scores.csv；改波次在「量表库 → 波次与导出码」。
`

class RouteError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/* ------------------------------------------------------------------ *
 * io helpers
 * ------------------------------------------------------------------ */

function send(res, status, payload) {
  const text = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new RouteError('too_large', '请求体过大（导入文件上限 8 MB）'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new RouteError('invalid', '请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sameOrigin(req) {
  const site = String(req.headers['sec-fetch-site'] || '')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = String(req.headers.origin || '')
  if (!origin) return true
  try {
    return new URL(origin).host === String(req.headers.host || '')
  } catch {
    return false
  }
}

/** Chinese questionnaire exports are often GBK; decode strictly, then fall back. */
function decodeBuffer(buf) {
  for (const encoding of ['utf-8', 'gbk', 'gb18030']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buf)
    } catch {
      /* try the next one */
    }
  }
  return buf.toString('utf8')
}

function decodePayload(payload) {
  const encoded = payload && payload.data
  if (typeof encoded === 'string' && encoded) {
    return decodeBuffer(Buffer.from(encoded, 'base64'))
  }
  if (payload && typeof payload.text === 'string') return payload.text
  throw new RouteError('invalid', '没有收到文件内容')
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeFileAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

async function listFiles(dir, suffix) {
  try {
    const names = await readdir(dir)
    return names.filter(name => name.endsWith(suffix))
  } catch {
    return []
  }
}

function todayString(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function stampForName(now = new Date()) {
  return `${todayString(now).replace(/-/g, '')}`
}

/* ------------------------------------------------------------------ *
 * config
 * ------------------------------------------------------------------ */

function resolveConfig(config = {}) {
  const root = path.resolve(String(config.projectRoot || DEFAULTS.projectRoot).replace(/\\/g, '/'))
  const join = (...parts) => path.join(root, ...parts).replace(/\\/g, '/')
  const labDir = path.resolve(String(config.labDir || join('_lab')).replace(/\\/g, '/'))
  const scalesDir = config.scalesDir || path.join(labDir, 'scales').replace(/\\/g, '/')
  return {
    projectRoot: root,
    labDir,
    scalesDir,
    defsDir: path.join(scalesDir, 'defs').replace(/\\/g, '/'),
    answersDir: path.join(scalesDir, 'answers').replace(/\\/g, '/'),
    importsPath: path.join(scalesDir, 'imports.json').replace(/\\/g, '/'),
    scoresPath: path.join(labDir, 'scores.csv').replace(/\\/g, '/'),
    detailPath: path.join(labDir, 'scores_detail.csv').replace(/\\/g, '/'),
    exportDir: path.join(labDir, 'export').replace(/\\/g, '/'),
    flowPath: path.join(scalesDir, 'flow.json').replace(/\\/g, '/'),
    subjectsPath: String(config.subjectsPath || join('_lab', 'subjects.csv')).replace(/\\/g, '/')
  }
}

/* ------------------------------------------------------------------ *
 * definitions + answers
 * ------------------------------------------------------------------ */

/** First run: copy the shipped definitions and the protocol flow into _lab. */
async function ensureSeeded(cfg) {
  await mkdir(cfg.defsDir, { recursive: true })
  await mkdir(cfg.answersDir, { recursive: true })
  const existing = await listFiles(cfg.defsDir, '.json')
  const shipped = existing.length ? [] : await listFiles(PKG_DEFS, '.json')
  for (const name of shipped) {
    await copyFile(path.join(PKG_DEFS, name), path.join(cfg.defsDir, name))
  }
  const hasFlow = await stat(cfg.flowPath).then(() => true).catch(() => false)
  if (!hasFlow) {
    await copyFile(PKG_FLOW, cfg.flowPath)
    shipped.push('flow.json')
  }
  if (shipped.length) {
    const readme = path.join(cfg.scalesDir, 'README.md')
    const hasReadme = await stat(readme).then(() => true).catch(() => false)
    if (!hasReadme) await writeFile(readme, LAB_README, 'utf8')
  }
  return shipped.length
}

/** The protocol: ordered stages, each with ordered steps. */
async function loadFlow(cfg, defs) {
  let raw
  try {
    raw = JSON.parse(await readFile(cfg.flowPath, 'utf8'))
  } catch (error) {
    return { version: '', source: '', note: '', stages: [], problems: [{ level: 'bad', text: `流程文件读不了：${error.message}` }] }
  }
  const problems = []
  const stages = []
  const seen = new Set()
  for (const stage of Array.isArray(raw.stages) ? raw.stages : []) {
    const id = String(stage && stage.id || '').trim()
    if (!id) {
      problems.push({ level: 'bad', text: '有一个阶段没有 id' })
      continue
    }
    if (seen.has(id)) problems.push({ level: 'warn', text: `阶段 ${id} 重复` })
    seen.add(id)
    const steps = []
    for (const step of Array.isArray(stage.steps) ? stage.steps : []) {
      const kind = String(step && step.kind || 'task')
      const entry = {
        kind,
        title: String(step && step.title || ''),
        note: String(step && step.note || ''),
        scale: String(step && step.scale || ''),
        wave: String(step && step.wave || '')
      }
      if (kind === 'scale') {
        const def = defs.find(item => item.id === entry.scale)
        if (!def) {
          problems.push({ level: 'bad', text: `${id} 引用了不存在的量表 ${entry.scale}` })
        } else if (!def.waves.includes(entry.wave)) {
          problems.push({ level: 'bad', text: `${id}：${def.short} 没有 ${entry.wave} 这个波次` })
        } else {
          entry.title = entry.title || `${def.short}（${def.name}）`
        }
      }
      if (!entry.title) entry.title = entry.kind === 'scale' ? entry.scale : '（未命名步骤）'
      steps.push(entry)
    }
    stages.push({ id, label: String(stage.label || id), note: String(stage.note || ''), steps })
  }
  return {
    version: String(raw.version || ''),
    source: String(raw.source || ''),
    note: String(raw.note || ''),
    stages,
    problems
  }
}

async function loadDefs(cfg) {
  const names = (await listFiles(cfg.defsDir, '.json')).sort()
  const defs = []
  const problems = []
  for (const name of names) {
    const file = path.join(cfg.defsDir, name)
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      const def = normalizeDef(raw, name.replace(/\.json$/, ''))
      def.file = file.replace(/\\/g, '/')
      def.mtime = (await stat(file)).mtimeMs
      defs.push(def)
    } catch (error) {
      problems.push({ level: 'bad', scope: 'definition', text: `定义文件 ${name} 读不了：${error.message}`, file: file.replace(/\\/g, '/') })
    }
  }
  return { defs, problems }
}

function answerFileName(scale, wave) {
  return `${scale}__${wave}.csv`
}

/** Parse one answers file: 编号 + q01..qNN, blanks allowed, raw text preserved. */
function parseAnswerFile(name, text) {
  const match = /^(.+)__(.+)\.csv$/.exec(name)
  if (!match) return null
  const table = parseTable(text)
  if (!table.length) return { name, scale: match[1], wave: match[2], header: [], rows: [], notes: ['文件是空的'] }
  const header = table[0].map(value => String(value ?? '').trim())
  const body = table.slice(1)
  const idAt = Math.max(0, header.findIndex(value => /编号|participant|id$/i.test(value)))
  const rows = []
  const notes = []
  for (const cells of body) {
    const id = normalizeId(cells[idAt])
    if (!id) continue
    const values = {}
    header.forEach((column, at) => {
      if (at === idAt) return
      const q = /^q0*(\d+)$/i.exec(column)
      if (!q) return
      const no = Number(q[1])
      const text2 = String(cells[at] ?? '').trim()
      if (text2) values[no] = text2
    })
    rows.push({ id, values })
  }
  return { name, scale: match[1], wave: match[2], header, rows, notes }
}

async function loadAnswerFiles(cfg) {
  const names = (await listFiles(cfg.answersDir, '.csv')).sort()
  const files = []
  const problems = []
  for (const name of names) {
    const file = path.join(cfg.answersDir, name)
    try {
      const parsed = parseAnswerFile(name, await readFile(file, 'utf8'))
      if (!parsed) continue
      parsed.file = file.replace(/\\/g, '/')
      parsed.mtime = (await stat(file)).mtimeMs
      files.push(parsed)
    } catch (error) {
      problems.push({ level: 'bad', scope: 'data', text: `作答文件 ${name} 读不了：${error.message}` })
    }
  }
  return { files, problems }
}

async function writeAnswerFile(cfg, scale, wave, rows, itemCount = 0) {
  const answeredMax = rows.reduce((max, row) => Math.max(max, ...Object.keys(row.values || {}).map(Number)), 0)
  const items = Math.max(itemCount || 0, answeredMax, 1)
  if (!rows.length) {
    await rm(path.join(cfg.answersDir, answerFileName(scale, wave)), { force: true })
    return
  }
  const width = Math.max(2, String(items).length)
  const header = ['编号', ...Array.from({ length: items }, (_, i) => `q${String(i + 1).padStart(width, '0')}`)]
  const body = rows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(row => [row.id, ...Array.from({ length: items }, (_, i) => row.values?.[i + 1] ?? '')])
  const csv = [header, ...body].map(line => line.map(cellText).join(',')).join('\r\n') + '\r\n'
  await writeFileAtomic(path.join(cfg.answersDir, answerFileName(scale, wave)), csv)
}

function cellText(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

async function loadProvenance(cfg) {
  const data = await readJson(cfg.importsPath, { entries: [] })
  return Array.isArray(data.entries) ? data.entries : []
}

async function appendProvenance(cfg, entry) {
  const entries = await loadProvenance(cfg)
  entries.push({ at: new Date().toISOString(), ...entry })
  await writeFileAtomic(cfg.importsPath, JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 2))
}

async function readSubjectIds(cfg) {
  const fromFile = []
  const text = await readFile(cfg.subjectsPath, 'utf8').catch(() => '')
  if (text) {
    const table = parseTable(text)
    if (table.length) {
      const header = table[0].map(value => String(value ?? '').trim())
      const idAt = Math.max(0, header.findIndex(value => /编号|participant/i.test(value)))
      for (const cells of table.slice(1)) {
        const id = normalizeId(cells[idAt])
        if (isValidId(id)) fromFile.push(id)
      }
    }
  }
  return { ids: fromFile, source: fromFile.length ? 'subjects.csv' : 'answers' }
}

/* ------------------------------------------------------------------ *
 * model
 * ------------------------------------------------------------------ */

async function buildModel(cfg, { seed = true } = {}) {
  const seeded = seed ? await ensureSeeded(cfg) : 0
  const { defs, problems: defProblems } = await loadDefs(cfg)
  const flow = await loadFlow(cfg, defs)
  const { files: answerFiles, problems: answerProblems } = await loadAnswerFiles(cfg)
  const provenance = await loadProvenance(cfg)
  const answerRows = answerFiles.flatMap(file => file.rows.map(row => ({
    scale: file.scale,
    wave: file.wave,
    id: row.id,
    values: row.values
  })))
  const subjects = await readSubjectIds(cfg)
  const subjectIds = [...new Set([...subjects.ids, ...answerRows.map(row => row.id)])]
  const scores = buildScores(defs, answerRows, subjectIds)
  const detail = buildDetail(defs, answerRows)

  const definitionIssues = defs.flatMap(def => validateDefinition(def).map(item => ({ ...item, scale: def.id })))
  const dataIssues = validateData(defs, answerFiles, scores, provenance)
  const issues = [...defProblems, ...answerProblems, ...definitionIssues, ...dataIssues]

  const scoresStat = await stat(cfg.scoresPath).then(value => value.mtimeMs).catch(() => 0)
  const newestAnswer = answerFiles.reduce((max, file) => Math.max(max, file.mtime || 0), 0)
  const newestDef = defs.reduce((max, def) => Math.max(max, def.mtime || 0), 0)
  const stale = !scoresStat || scoresStat + 1000 < Math.max(newestAnswer, newestDef)

  // First run: leave a header-only scores.csv behind so the run console and the
  // analysis pipeline have their contract file before anyone answers anything.
  if (!scoresStat) {
    try {
      await writeScores({ defs, scores, detail }, cfg)
    } catch (error) {
      console.error('[scale-desk] 初始化 scores.csv 失败：', error)
    }
  }

  return {
    seeded,
    defs,
    flow,
    answerFiles,
    answerRows,
    provenance,
    scores,
    detail,
    issues,
    subjectSource: subjects.source,
    stale: scoresStat ? stale : false,
    counts: {
      issueBad: issues.filter(item => item.level === 'bad').length,
      issueWarn: issues.filter(item => item.level === 'warn').length,
      issueInfo: issues.filter(item => item.level === 'info').length,
      answers: answerRows.length,
      imports: provenance.length
    }
  }
}

function instrumentPayload(model, def) {
  const summary = {
    id: def.id,
    name: def.name,
    short: def.short,
    version: def.version,
    itemCount: def.itemCount,
    waves: def.waves,
    response: def.response,
    scoringType: def.scoring.type,
    missing: def.missing,
    reverse: def.items.filter(item => item.reverse).map(item => item.no),
    items: def.items.map(item => ({
      no: item.no,
      text: item.text,
      kind: item.kind,
      options: item.options,
      min: item.min,
      max: item.max
    })),
    subscales: Object.values(def.scoring.subscales).map(sub => ({
      key: sub.key,
      label: sub.label,
      items: sub.items,
      multiplier: sub.multiplier,
      range: sub.range,
      descriptive: sub.descriptive,
      aggregate: sub.aggregate
    })),
    source: def.source,
    license: def.license,
    notes: def.notes,
    instructions: def.instructions,
    unit: def.unit,
    file: def.file,
    columns: scoreColumns(def).filter(col => col.kind === 'score').map(col => col.key)
  }
  summary.data = {}
  for (const wave of def.waves) {
    const file = model.answerFiles.find(item => item.scale === def.id && item.wave === wave)
    summary.data[wave] = {
      rows: file ? file.rows.length : 0,
      file: file ? file.file : '',
      mtime: file ? file.mtime : 0
    }
  }
  return summary
}

function statusPayload(model, cfg) {
  const instruments = model.defs.map(def => instrumentPayload(model, def))
  const totalRows = instruments.reduce((sum, item) => sum + Object.values(item.data).reduce((s, d) => s + d.rows, 0), 0)
  return {
    today: todayString(),
    labDir: cfg.labDir,
    scalesDir: cfg.scalesDir,
    subjectsPath: cfg.subjectsPath,
    subjectSource: model.subjectSource,
    seeded: model.seeded,
    instruments,
    scores: {
      columns: model.scores.columns,
      rows: model.scores.rows,
      counts: model.scores.counts,
      stale: model.stale,
      path: cfg.scoresPath,
      detailPath: cfg.detailPath
    },
    issues: model.issues.slice(0, MAX_ISSUES),
    issueCounts: model.counts,
    flow: model.flow,
    imports: [...model.provenance].reverse().slice(0, 30),
    totals: {
      instruments: instruments.length,
      answerSheets: model.answerFiles.length,
      answerRows: totalRows,
      scoreColumns: model.scores.columns.filter(col => col.kind === 'score').length
    }
  }
}

/* ------------------------------------------------------------------ *
 * write paths
 * ------------------------------------------------------------------ */

async function writeScores(model, cfg) {
  const csv = scoresCsv(model.defs, model.scores)
  const detail = detailCsv(model.detail)
  await writeFileAtomic(cfg.scoresPath, csv)
  await writeFileAtomic(cfg.detailPath, detail)
  return {
    rows: model.scores.rows.length,
    columns: model.scores.columns.length,
    detailRows: model.detail.length,
    scoresPath: cfg.scoresPath,
    detailPath: cfg.detailPath
  }
}

function exportMarkdown(model) {
  const lines = [`# 量表分数 · ${todayString()}`, '']
  lines.push(`数据：${model.counts.answers} 份作答；${model.scores.counts.filled}/${model.scores.counts.subjects} 人有分数；${model.scores.counts.complete} 人各量表各波次全齐。`, '')
  lines.push('| 量表 | 题量 | 计分 | 波次 | 已录 | 版本 |')
  lines.push('|---|---|---|---|---|---|')
  for (const def of model.defs) {
    const recorded = def.waves.map(wave => {
      const file = model.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      return `${wave} ${file ? file.rows.length : 0}`
    }).join(' / ')
    const scoring = def.scoring.type === 'mean' ? '均分' : '累加'
    lines.push(`| ${def.short}（${def.name}） | ${def.itemCount} | ${scoring} | ${recorded} | ${def.waves.length} | ${def.version} |`)
  }
  const bad = model.issues.filter(item => item.level !== 'info')
  lines.push('', `校验：高 ${model.issues.filter(item => item.level === 'bad').length} 条，中 ${model.issues.filter(item => item.level === 'warn').length} 条。`)
  for (const item of bad.slice(0, 40)) lines.push(`- ${item.text}`)
  if (bad.length > 40) lines.push(`- ……另 ${bad.length - 40} 条见面板`)
  lines.push('', '说明：分数在 scores.csv；每题明细（含原始值与反向后值）在 scores_detail.csv。')
  return lines.join('\n')
}

async function exportReport(model, cfg) {
  const file = path.join(cfg.exportDir, `量表分数_${stampForName()}.csv`)
  const mdFile = path.join(cfg.exportDir, `量表分数_${stampForName()}.md`)
  await writeFileAtomic(file, '\uFEFF' + scoresCsv(model.defs, model.scores))
  await writeFileAtomic(mdFile, exportMarkdown(model))
  return { csv: file.replace(/\\/g, '/'), md: mdFile.replace(/\\/g, '/') }
}

/* ------------------------------------------------------------------ *
 * plugin
 * ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  const cfg = resolveConfig(config || {})
  let modelCache = null
  let modelAt = 0
  let building = null
  const CACHE_TTL_MS = 5000

  async function model(force = false) {
    if (!force && modelCache && Date.now() - modelAt < CACHE_TTL_MS) return modelCache
    if (building) return building
    building = (async () => {
      try {
        modelCache = await buildModel(cfg)
        modelAt = Date.now()
        return modelCache
      } finally {
        building = null
      }
    })()
    return building
  }

  function invalidate() {
    modelCache = null
    modelAt = 0
  }

  /**
   * Answers are primary, scores are a cache — but the cache is the contract the
   * run console and the analysis pipeline read, so refresh it after every write
   * instead of making the user remember to press 重算.
   */
  async function syncScores() {
    try {
      const current = await model(true)
      await writeScores(current, cfg)
      modelAt = Date.now()
    } catch (error) {
      console.error('[scale-desk] 写 scores.csv 失败：', error)
    }
  }

  function findDef(current, id) {
    const def = current.defs.find(item => item.id === id)
    if (!def) throw new RouteError('not_found', '没有这个量表：' + id)
    return def
  }

  function requireWave(def, wave) {
    if (!def.waves.includes(wave)) throw new RouteError('invalid', `${def.short} 没有 ${wave} 这个波次`)
  }

  function requireId(id) {
    const clean = normalizeId(id)
    if (!isValidId(clean)) throw new RouteError('invalid', '被试编号应为 5 位分组编号（如 11002）')
    return clean
  }

  const actions = {
    async status() {
      const current = await model(false)
      return statusPayload(current, cfg)
    },

    async refresh() {
      invalidate()
      const current = await model(true)
      return statusPayload(current, cfg)
    },

    async definition(payload) {
      const current = await model(false)
      const def = findDef(current, String((payload && payload.id) || ''))
      return {
        id: def.id,
        name: def.name,
        short: def.short,
        version: def.version,
        response: def.response,
        items: def.items,
        codes: def.codes,
        waves: def.waves,
        scoring: {
          type: def.scoring.type,
          subscales: Object.values(def.scoring.subscales).map(sub => ({
            key: sub.key,
            label: sub.label,
            items: sub.items,
            reverse: [...sub.reverse],
            multiplier: sub.multiplier,
            range: sub.range,
            minAnswered: sub.minAnswered,
            descriptive: sub.descriptive,
            aggregate: sub.aggregate
          }))
        },
        missing: def.missing,
        source: def.source,
        license: def.license,
        notes: def.notes,
        instructions: def.instructions,
        unit: def.unit,
        file: def.file,
        columns: scoreColumns(def)
      }
    },

    /** Parse pasted item texts for the editor's preview; writes nothing. */
    async textsPreview(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const parsed = parseItemTextTable(payload && payload.text, def.itemCount)
      return { scale: def.id, itemCount: def.itemCount, ...parsed }
    },

    /**
     * Save item texts back into `_lab/scales/defs/<id>.json`. Only `items[].text`
     * is touched: numbers, reverse marks, scoring keys and codes stay as they are.
     */
    async saveTexts(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const incoming = Array.isArray(payload && payload.items) ? payload.items : []
      const texts = new Map()
      for (const entry of incoming) {
        const no = Number(entry && entry.no)
        if (!Number.isInteger(no) || no < 1 || no > def.itemCount) {
          throw new RouteError('invalid', `题号 ${entry && entry.no} 超出 1–${def.itemCount}`)
        }
        texts.set(no, String((entry && entry.text) === undefined || (entry && entry.text) === null ? '' : entry.text).trim().slice(0, 1000))
      }
      if (!texts.size) throw new RouteError('invalid', '没有收到任何题面')

      const raw = JSON.parse(await readFile(def.file, 'utf8'))
      const base = Array.isArray(raw.items) && raw.items.length === def.itemCount
        ? raw.items
        : def.items.map(item => ({
            no: item.no,
            text: item.text,
            reverse: item.reverse,
            kind: item.kind,
            options: item.options,
            min: item.min,
            max: item.max
          }))
      raw.items = base
        .slice()
        .sort((a, b) => Number(a.no) - Number(b.no))
        .map(item => ({
          ...item,
          no: Number(item.no),
          text: texts.has(Number(item.no)) ? texts.get(Number(item.no)) : String(item.text || '')
        }))
      // Keep the file readable for whoever opens it next.
      await writeFileAtomic(def.file, JSON.stringify(raw, null, 2) + '\n')
      invalidate()
      return {
        scale: def.id,
        itemCount: def.itemCount,
        filled: raw.items.filter(item => String(item.text || '').trim() !== '').length
      }
    },

    /**
     * Edit the wave list of one scale: add a stage, drop one that never got data,
     * or change the export-code prefix. A wave that already has answers cannot be
     * renamed or removed, because the answers file and the score column both hang
     * off that name.
     */
    async saveWaves(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const incoming = Array.isArray(payload && payload.waves) ? payload.waves : []
      const names = []
      const codes = {}
      for (const entry of incoming) {
        const name = String((entry && entry.name) || '').trim()
        if (!name) throw new RouteError('invalid', '波次名不能为空')
        if (!/^[A-Za-z0-9._-]{1,24}$/.test(name)) {
          throw new RouteError('invalid', `波次名「${name}」只能用字母、数字和 . _ -（它同时是文件名和列名的一部分）`)
        }
        if (names.includes(name)) throw new RouteError('invalid', `波次名 ${name} 重复`)
        names.push(name)
        const prefix = String((entry && entry.prefix) || '').trim()
        if (!prefix) continue
        if (!/^[A-Za-z0-9._-]{1,40}$/.test(prefix)) {
          throw new RouteError('invalid', `导出码前缀「${prefix}」只能用字母、数字和 . _ -`)
        }
        const width = Math.max(2, String(def.itemCount).length)
        codes[name] = Array.from({ length: def.itemCount }, (_, index) => `${prefix}${String(index + 1).padStart(width, '0')}`)
      }
      if (!names.length) throw new RouteError('invalid', '至少保留一个波次')

      const withData = current.answerFiles.filter(file => file.scale === def.id && (file.rows || []).length)
      for (const file of withData) {
        if (!names.includes(file.wave)) {
          throw new RouteError('invalid', `${def.short} 的 ${file.wave} 已有 ${file.rows.length} 份作答，不能删除或改名；要改先把那一波次的作答导出或删掉`)
        }
      }

      const raw = JSON.parse(await readFile(def.file, 'utf8'))
      raw.waves = names
      raw.codes = codes
      await writeFileAtomic(def.file, JSON.stringify(raw, null, 2) + '\n')
      invalidate()
      await syncScores()
      return { scale: def.id, waves: names, coded: Object.keys(codes).length }
    },

    async answer(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const wave = String((payload && payload.wave) || def.waves[0])
      requireWave(def, wave)
      const id = requireId(payload && payload.id)
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      const row = file ? file.rows.find(item => item.id === id) : undefined
      return { id, scale: def.id, wave, exists: Boolean(row), values: row ? row.values : {} }
    },

    /** Item-level view of one subject: raw, reverse mark, scored value. */
    async detail(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const wave = String((payload && payload.wave) || def.waves[0])
      requireWave(def, wave)
      const id = requireId(payload && payload.id)
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      const row = file ? file.rows.find(item => item.id === id) : undefined
      if (!row) throw new RouteError('not_found', `${id} 没有 ${def.short} ${wave} 的作答`)
      const result = scoreAnswers(def, row.values)
      return {
        id,
        scale: def.id,
        scaleName: def.name,
        short: def.short,
        wave,
        response: def.response,
        missing: def.missing,
        items: result.items,
        subs: Object.values(def.scoring.subscales).map(sub => ({
          key: sub.key,
          label: sub.label,
          range: sub.range,
          ...result.subs[sub.key]
        })),
        answered: result.answered,
        file: file.file
      }
    },

    async save(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const wave = String((payload && payload.wave) || def.waves[0])
      requireWave(def, wave)
      const id = requireId(payload && payload.id)
      const incoming = (payload && payload.values) || {}
      const values = {}
      for (const item of def.items) {
        const raw = incoming[item.no]
        const text = raw === null || raw === undefined ? '' : String(raw).trim()
        if (text) values[item.no] = text
      }
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      const rows = file ? file.rows.filter(row => row.id !== id) : []
      rows.push({ id, values })
      await writeAnswerFile(cfg, def.id, wave, rows, def.itemCount)
      await appendProvenance(cfg, {
        action: 'manual',
        scale: def.id,
        wave,
        defVersion: def.version,
        rows: 1,
        file: null,
        note: id
      })
      await syncScores()
      return { id, scale: def.id, wave, values, scored: scoreAnswers(def, values) }
    },

    async clear(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const wave = String((payload && payload.wave) || def.waves[0])
      requireWave(def, wave)
      const id = requireId(payload && payload.id)
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      const rows = file ? file.rows.filter(row => row.id !== id) : []
      await writeAnswerFile(cfg, def.id, wave, rows, def.itemCount)
      await appendProvenance(cfg, { action: 'clear', scale: def.id, wave, defVersion: def.version, note: id })
      await syncScores()
      return { id, scale: def.id, wave, removed: Boolean(file && file.rows.some(row => row.id === id)) }
    },

    async importPreview(payload) {
      const current = await model(false)
      const text = decodePayload(payload)
      const table = parseTable(text)
      if (!table.length) throw new RouteError('invalid', '文件里没有可读的表格行')
      const header = table[0].map(value => String(value ?? '').trim())
      const body = table.slice(1)
      const filename = String((payload && payload.filename) || '')
      let scale = String((payload && payload.scale) || '')
      let wave = String((payload && payload.wave) || '')
      let guessed = null
      if (!scale || !wave) {
        const pool = scale ? current.defs.filter(def => def.id === scale) : current.defs
        guessed = guessTarget(pool, header, filename)
        if (!guessed) {
          throw new RouteError('invalid', `从列名里认不出是哪个量表（${header.slice(0, 6).join(' / ')}）。请先选量表与波次，再预览。`)
        }
        if (!scale) scale = guessed.scale
        if (!wave) wave = guessed.wave
      }
      const def = findDef(current, scale)
      requireWave(def, wave)
      const mapping = mapImportColumns(def, wave, header, body)
      if (!mapping.idColumn) throw new RouteError('invalid', '没有找到编号列（列名需含「编号」或 participant）')
      const applied = applyImport(def, wave, table, mapping)
      const preview = applied.rows.slice(0, 5).map(row => {
        const scored = scoreAnswers(def, row.values)
        return {
          id: row.id,
          answered: scored.answered,
          missing: scored.missing,
          subs: Object.fromEntries(Object.entries(scored.subs).map(([key, value]) => [key, value.score]))
        }
      })
      return {
        filename,
        guessed,
        scale: def.id,
        scaleName: def.name,
        wave,
        header,
        mapping: {
          idColumn: mapping.idColumn,
          idHow: mapping.idHow,
          items: mapping.items,
          matched: mapping.matched,
          total: mapping.total,
          unmatched: mapping.unmatched,
          extraColumns: mapping.extraColumns.slice(0, 30)
        },
        rows: applied.rows.length,
        ids: applied.rows.map(row => row.id),
        issues: [...applied.issues].slice(0, 50),
        preview,
        emptyCells: applied.rows.reduce((sum, row) => sum + Object.values(row.values).filter(value => !String(value).trim()).length, 0)
      }
    },

    async importApply(payload) {
      const current = await model(false)
      const text = decodePayload(payload)
      const table = parseTable(text)
      if (!table.length) throw new RouteError('invalid', '文件里没有可读的表格行')
      const filename = String((payload && payload.filename) || '')
      let scale = String((payload && payload.scale) || '')
      let wave = String((payload && payload.wave) || '')
      if (!scale || !wave) {
        const pool = scale ? current.defs.filter(def => def.id === scale) : current.defs
        const guessed = guessTarget(pool, table[0], filename)
        if (!guessed) throw new RouteError('invalid', '认不出量表与波次，请明确指定')
        scale = scale || guessed.scale
        wave = wave || guessed.wave
      }
      const def = findDef(current, scale)
      requireWave(def, wave)
      const header = table[0].map(value => String(value ?? '').trim())
      let mapping = mapImportColumns(def, wave, header, table.slice(1))
      const overrides = payload && payload.mapping
      if (overrides && Array.isArray(overrides.items)) {
        const byNo = new Map(overrides.items.map(item => [Number(item.no), item.column]))
        mapping = {
          ...mapping,
          items: mapping.items.map(item => (byNo.has(item.no) ? { ...item, column: byNo.get(item.no) || null, how: 'manual' } : item)),
          idColumn: overrides.idColumn || mapping.idColumn
        }
        mapping.matched = mapping.items.filter(item => item.column).length
      }
      if (!mapping.idColumn) throw new RouteError('invalid', '没有找到编号列')
      const applied = applyImport(def, wave, table, mapping)
      if (!applied.rows.length) throw new RouteError('invalid', '没有解析出任何一行带编号的作答')
      const mode = payload && payload.mode === 'replace' ? 'replace' : 'merge'
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      const existing = file ? file.rows : []
      const merged = new Map()
      if (mode === 'merge') for (const row of existing) merged.set(row.id, row.values)
      for (const row of applied.rows) merged.set(row.id, row.values)
      const rows = [...merged.entries()].map(([id, values]) => ({ id, values }))
      await writeAnswerFile(cfg, def.id, wave, rows, def.itemCount)
      await appendProvenance(cfg, {
        action: 'import',
        scale: def.id,
        wave,
        defVersion: def.version,
        file: filename || null,
        rows: applied.rows.length,
        mode
      })
      await syncScores()
      return {
        scale: def.id,
        wave,
        mode,
        imported: applied.rows.length,
        total: rows.length,
        replaced: mode === 'replace' ? existing.length : Math.max(0, applied.rows.length - existing.length),
        issues: applied.issues.slice(0, 30),
        file: file ? file.file : path.join(cfg.answersDir, answerFileName(def.id, wave)).replace(/\\/g, '/')
      }
    },

    async score() {
      const current = await model(true)
      const written = await writeScores(current, cfg)
      return { ...written, counts: current.counts }
    },

    async validate() {
      const current = await model(true)
      return {
        issues: current.issues.slice(0, MAX_ISSUES),
        counts: current.counts,
        total: current.issues.length
      }
    },

    async export() {
      const current = await model(false)
      const written = await writeScores(current, cfg)
      const report = await exportReport(current, cfg)
      return { ...written, ...report }
    },

    async reveal(payload) {
      const target = String((payload && payload.target) || 'scales')
      const dir = target === 'export'
        ? cfg.exportDir
        : target === 'lab'
          ? cfg.labDir
          : cfg.scalesDir
      await mkdir(dir, { recursive: true }).catch(() => {})
      const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' })
      child.unref()
      return { opened: dir.replace(/\\/g, '/') }
    }
  }

  const handler = async (req, res) => {
    if (!sameOrigin(req) || req.headers[HEADER] !== '1') {
      send(res, 403, { ok: false, error: { code: 'forbidden', message: '拒绝跨站访问量表计分接口' } })
      return
    }
    try {
      const url = new URL(req.url || ROUTE, 'http://localhost')
      if (req.method === 'GET') {
        const action = url.searchParams.get('action') || 'status'
        const run = actions[action]
        if (!run) throw new RouteError('unknown_action', '未知操作：' + action)
        const data = await run(Object.fromEntries(url.searchParams.entries()))
        send(res, 200, { ok: true, data })
        return
      }
      if (req.method !== 'POST') throw new RouteError('method', '只接受 GET 与 POST')
      const body = await readBody(req)
      const action = String(body.action || url.searchParams.get('action') || '')
      const run = actions[action]
      if (!run) throw new RouteError('unknown_action', '未知操作：' + action)
      const data = await run(body.payload || body || {})
      send(res, 200, { ok: true, data })
    } catch (error) {
      const status = error instanceof RouteError ? (error.code === 'not_found' ? 404 : 400) : 500
      if (status >= 500) console.error('[scale-desk]', error)
      send(res, status, {
        ok: false,
        error: { code: error && error.code ? error.code : 'error', message: String(error && error.message ? error.message : error) }
      })
    }
  }

  const webServer = ctx.get ? ctx.get('webServer') : undefined
  if (webServer) {
    ctx.effect(() => webServer.register({ kind: 'prefix', path: ROUTE, handler }), 'scale-desk: http route')
  } else {
    ctx.inject(['webServer'], scope => {
      scope.effect(
        () => scope.webServer.register({ kind: 'prefix', path: ROUTE, handler }),
        'scale-desk: http route'
      )
    })
  }

  const registerTools = scope => {
    try {
      if (!scope.tools || typeof scope.tools.register !== 'function') return
      const textOutput = {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      }

      scope.tools.register({
        name: 'scale_list',
        description: '列出量表库：每个量表的题量、计分方式、反向题、波次、已录人数与版本。只读 _lab/scales，返回定义与计数。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: textOutput,
        async execute() {
          const current = await model(false)
          const lines = [`量表库：${current.defs.length} 个定义（${current.answerFiles.length} 份作答文件）。`]
          for (const def of current.defs) {
            const recorded = def.waves.map(wave => {
              const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
              return `${wave} ${file ? file.rows.length : 0} 人`
            }).join('，')
            const range = def.scoring.subscales && Object.values(def.scoring.subscales).find(sub => sub.range)
            const subs = Object.values(def.scoring.subscales)
            lines.push(`- ${def.short}（${def.name}）：${def.itemCount} 题，${def.scoring.type === 'mean' ? '均分' : def.scoring.type === 'none' ? '不计分' : '累加'}${subs.length > 1 ? '，' + subs.map(sub => sub.label).join('/') : ''}${range ? `，范围 ${range.range[0]}–${range.range[1]}` : ''}；反向题 ${def.items.filter(item => item.reverse).map(item => item.no).join('、') || '无'}；${recorded}；版本：${def.version}`)
          }
          lines.push(`派生：scores.csv 列 ${current.scores.columns.length}，行 ${current.scores.rows.length}；校验高 ${current.counts.issueBad} 条、中 ${current.counts.issueWarn} 条。`)
          return { text: lines.join('\n') }
        }
      })

      scope.tools.register({
        name: 'scale_flow',
        description: '按施测顺序列出实验流程：每个阶段有哪些问卷、量表与任务，量表对应哪个波次、已录几份。数据来自 _lab/scales/flow.json。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: textOutput,
        async execute() {
          const current = await model(false)
          const flow = current.flow
          const lines = [`实验流程：${flow.stages.length} 个阶段（${flow.version || '未标版本'}）。`]
          for (const stage of flow.stages) {
            lines.push('')
            lines.push(`${stage.label}${stage.note ? ' — ' + stage.note : ''}`)
            stage.steps.forEach((step, index) => {
              if (step.kind === 'scale') {
                const def = current.defs.find(item => item.id === step.scale)
                const file = current.answerFiles.find(item => item.scale === step.scale && item.wave === step.wave)
                lines.push(`  ${index + 1}. [量表] ${def ? def.short : step.scale} ${step.wave}（已录 ${file ? file.rows.length : 0} 份）`)
              } else {
                lines.push(`  ${index + 1}. [${KIND_LABEL[step.kind] || step.kind}] ${step.title}${step.note ? '（' + step.note + '）' : ''}`)
              }
            })
          }
          if (flow.problems.length) lines.push('', `流程问题 ${flow.problems.length} 条：` + flow.problems.map(item => item.text).join('；'))
          return { text: lines.join('\n') }
        }
      })

      scope.tools.register({
        name: 'scale_score',
        description: '查看量表分数。给 id 时返回该被试各量表各波次的分数、缺失题数与未计分原因；不给 id 时返回全表摘要与缺失情况。分数来自 _lab/scores，只含编号不含姓名。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '被试编号（5 位数字）；不填则看全表摘要' },
            scale: { type: 'string', description: '只看某个量表的 id，如 FTPS / STAI_S / DASS_21' }
          },
          additionalProperties: false
        },
        output: textOutput,
        async execute(args) {
          const current = await model(false)
          const id = String((args && args.id) || '').trim()
          const only = String((args && args.scale) || '').trim()
          if (!id) return { text: scoresSummaryText(current.defs, current.scores, current.issues) }
          const subject = current.scores.rows.find(row => row.id === id)
          if (!subject) throw new Error(`没有 ${id} 的作答；先在「量表计分 → 录入」里录入，或导入问卷平台导出。`)
          const lines = [`被试 ${id} 的量表分数：`]
          for (const def of current.defs) {
            if (only && def.id !== only) continue
            for (const wave of def.waves) {
              const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
              const row = file ? file.rows.find(item => item.id === id) : undefined
              if (!row) continue
              const result = scoreAnswers(def, row.values)
              lines.push(subjectScoreText(def, wave, row, result))
            }
          }
          if (lines.length === 1) lines.push('（该编号还没有任何作答记录）')
          return { text: lines.join('\n') }
        }
      })

      scope.tools.register({
        name: 'scale_validate',
        description: '检查量表定义与作答数据：题量、反向题、取值范围、缺失比例、导出码、定义版本漂移。返回问题清单（高/中/提示），不改数据。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '只看某个被试的问题；不填则看全部' },
            level: { type: 'string', enum: ['all', 'bad', 'warn'], description: 'all=全部；bad=只看高优先；warn=只看提示' }
          },
          additionalProperties: false
        },
        output: textOutput,
        async execute(args) {
          const current = await model(true)
          const id = String((args && args.id) || '').trim()
          const level = String((args && args.level) || 'all')
          const issues = current.issues.filter(item => {
            if (id && item.id && item.id !== id) return false
            if (level === 'bad') return item.level === 'bad'
            if (level === 'warn') return item.level !== 'info'
            return true
          })
          const lines = [`校验：共 ${issues.length} 条（高 ${issues.filter(item => item.level === 'bad').length}，中 ${issues.filter(item => item.level === 'warn').length}，提示 ${issues.filter(item => item.level === 'info').length}）。`]
          for (const item of issues.slice(0, 40)) {
            lines.push(`- [${item.level === 'bad' ? '高' : item.level === 'warn' ? '中' : '提示'}] ${item.text}`)
            if (item.hint) lines.push(`  ${item.hint}`)
          }
          if (issues.length > 40) lines.push(`（还有 ${issues.length - 40} 条，见面板「校验」）`)
          return { text: lines.join('\n') }
        }
      })
    } catch (error) {
      console.error('[scale-desk] 工具注册失败：', error)
    }
  }
  const tools = ctx.get ? ctx.get('tools') : undefined
  if (tools) registerTools({ tools })
  else ctx.inject(['tools'], registerTools)
}

export const name = 'scale-desk'
