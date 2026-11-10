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

import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { loadStudyContext, validateStudyDefinition } from './study-context.mjs'
import { atomic, hash, definitionSnapshot, publishGeneration } from './persistence.mjs'
import { hostBinding, bindingStatus, BindingError } from '../research-core/host.mjs'
import { openResearchData } from '../research-core/data.mjs'
import { openFlow } from '../research-core/flow.mjs'
import { readFileSync } from 'node:fs'
import { beginMutation, mutationState, rollbackMutation, finishMutation, failMutation, recoverMutation } from './mutation-journal.mjs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyImport,
  buildDetail,
  buildScores,
  confirmImportMapping,
  detailCsv,
  guessTarget,
  headerCode,
  isValidId,
  mapImportColumns,
  normalizeDef,
  normalizeId,
  parseItemTextTable,
  parseTable,
  scoreAnswers,
  scoreColumns,
  scoresCsv,
  scanTargets,
  scoresSummaryText,
  subjectScoreText,
  validateData,
  validateDefinition,
  validateRawDefinition,
  wideCsv
} from './scoring.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_DEF = path.join(HERE, 'sample-def.json')
const ROUTE = '/api/scale-desk'
/** 编号列兜底：自动识别的编号列拿不到合格编号时，找一列值符合研究编号规则的重试。 */
function resolveImport(cfg, def, wave, table, mapping) {
  const attempt = applyImport(def, wave, table, mapping)
  const ok = attempt.rows.filter(row => cfg.study.acceptsId(row.id))
  if (ok.length) return { mapping, applied: attempt, valid: ok, skipped: attempt.rows.length - ok.length }
  const header = (table[0] || []).map(value => String(value ?? '').trim())
  for (let index = 0; index < header.length; index += 1) {
    if (index === mapping.idIndex) continue
    const values = table.slice(1).map(row => String(row[index] ?? '').trim()).filter(Boolean)
    if (!values.length) continue
    const hits = values.filter(value => cfg.study.acceptsId(value)).length
    if (hits < Math.max(1, Math.ceil(values.length * 0.5))) continue
    const retry = applyImport(def, wave, table, { ...mapping, idIndex: index, idColumn: header[index], idHow: 'values' })
    const retryOk = retry.rows.filter(row => cfg.study.acceptsId(row.id))
    if (retryOk.length) return { mapping: { ...mapping, idIndex: index, idColumn: header[index], idHow: 'values' }, applied: retry, valid: retryOk, skipped: retry.rows.length - retryOk.length }
  }
  return { mapping, applied: attempt, valid: ok, skipped: attempt.rows.length - ok.length }
}
const HEADER = 'x-scale-desk'
const MAX_BODY = 8 * 1024 * 1024
const MAX_ISSUES = 300



const KIND_LABEL = { scale: '量表', task: '任务', paper: '纸质', demo: '人口学', audio: '音频', text: '书写', survey: '问卷', rest: '练习' }

const LAB_README = `# _lab/scales

量表定义、施测流程与原始作答。派生结果不在这里：\`_lab/scores.csv\`（宽表分数）、
\`_lab/scores_detail.csv\`（每题明细）与 \`_lab/data_wide.csv\`（分数与题目合并）
由插件重算生成，删掉可以重建。

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

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeFileAtomic(file, text) {
  return atomic(file, text)
}

/** 新建文件用 wx：并发创建同一个研究定义时宁可报冲突，也不静默覆盖。 */
async function writeFileExclusive(file, text) {
  try {
    await writeFile(file, text, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error.code === 'EEXIST') throw new BindingError('binding_conflict', '研究文件在保存时已被其他操作创建，请重新预览')
    throw error
  }
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
 * xlsx → csv (through the bundled Python, which has openpyxl)
 * ------------------------------------------------------------------ */

function isZipBuffer(buffer) {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
}

function isOleBuffer(buffer) {
  return buffer.length > 8
    && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0
}

function runPython(pythonPath, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('读取 Excel 超时'))
    }, timeoutMs)
    child.stdout.on('data', chunk => {
      stdout += chunk
      if (stdout.length > 32 * 1024 * 1024) child.kill()
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('无法启动 Python 读取 Excel：' + error.message))
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error('读取 Excel 失败：' + (stderr.trim() || 'exit ' + code).slice(0, 400)))
        return
      }
      resolve(stdout)
    })
  })
}

async function convertXlsx(buffer, cfg) {
  const file = path.join(tmpdir(), `scale-desk-${process.pid}-${randomUUID()}.xlsx`)
  await writeFile(file, buffer)
  try {
    const output = await runPython(cfg.pythonPath, [cfg.xlsxScript, file])
    let parsed
    try {
      parsed = JSON.parse(output)
    } catch {
      throw new Error('Excel 解析结果无法读取')
    }
    if (!parsed || typeof parsed.csv !== 'string') throw new Error('Excel 里没有可读的表格')
    return { text: parsed.csv, sheet: String(parsed.sheet || '') }
  } finally {
    await unlink(file).catch(() => {})
  }
}

/** Turn an import payload (base64 file or pasted text) into CSV text. */
async function tableFromPayload(payload, cfg) {
  const encoded = payload && payload.data
  if (typeof encoded === 'string' && encoded) {
    const buffer = Buffer.from(encoded, 'base64')
    if (isZipBuffer(buffer)) {
      const converted = await convertXlsx(buffer, cfg)
      return converted
    }
    if (isOleBuffer(buffer)) {
      throw new RouteError('invalid', '这是旧版 .xls 文件，请在 Excel 里另存为 .xlsx 或 CSV 再导入')
    }
    return { text: decodeBuffer(buffer), sheet: '' }
  }
  if (payload && typeof payload.text === 'string') return { text: payload.text, sheet: '' }
  throw new RouteError('invalid', '没有收到文件内容')
}

/**
 * QuestionPro puts matrix row labels in the second row (first cell empty).
 * Returning them lets the mapper match columns by item text when codes differ.
 */
function detectLabelRow(table) {
  if (!Array.isArray(table) || table.length < 2) return []
  const row = table[1].map(value => String(value === null || value === undefined ? '' : value).trim())
  if (row.length < 3 || row[0]) return []
  const filled = row.filter(Boolean)
  if (filled.length < 3) return []
  const numeric = filled.filter(value => /^-?\d+(\.\d+)?$/.test(value)).length
  if (numeric > filled.length * 0.3) return []
  return row
}

/* ------------------------------------------------------------------ *
 * config
 * ------------------------------------------------------------------ */

function resolveConfig(config = {}) {
  const study = loadStudyContext(config, { pluginKey: 'scales' })
  const plugin = { ...study.plugin, ...config }
  const root = path.resolve(plugin.projectRoot || process.cwd())
  const labDir = path.resolve(plugin.labDir || study.dataRoot)
  const scalesDir = path.resolve(plugin.scalesDir || path.join(labDir, 'scales'))
  return {
    study, projectRoot: root, labDir, scalesDir,
    defsDir: path.join(scalesDir, 'defs'), answersDir: path.join(scalesDir, 'answers'),
    importsPath: path.join(scalesDir, 'imports.json'), flowPath: path.join(scalesDir, 'flow.json'),
    scoresPath: path.join(labDir, 'scores.csv'), detailPath: path.join(labDir, 'scores_detail.csv'),
    widePath: path.join(labDir, 'data_wide.csv'), exportDir: path.join(labDir, 'export'),
    subjectsPath: plugin.subjectsPath || study.participants.path || path.join(labDir, 'subjects.csv'),
    pythonPath: plugin.pythonPath || process.env.DSH_PYTHON_PATH || 'python', xlsxScript: path.join(HERE, 'xlsx_dump.py')
  }
}

/* ------------------------------------------------------------------ *
 * definitions + answers
 * ------------------------------------------------------------------ */

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
      const rawIssues = validateRawDefinition(raw)
      if (rawIssues.length) { problems.push(...rawIssues.map(item => ({ ...item, scale: raw.id || name, file }))); continue }
      const def = normalizeDef(raw, name.replace(/\.json$/, ''))
      const semantic = validateDefinition(def).filter(item => item.level === 'bad')
      if (semantic.length) { problems.push(...semantic.map(item => ({ ...item, scale: raw.id, file }))); continue }
      def.definitionHash = hash(JSON.stringify(raw))
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
    rows.push({ id, values, definitionHash: header.includes('definitionHash') ? cells[header.indexOf('definitionHash')] || '' : '', submissionId: header.includes('submissionId') ? cells[header.indexOf('submissionId')] || '' : '' })
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
  const header = ['编号', 'definitionHash', 'submissionId', ...Array.from({ length: items }, (_, i) => `q${String(i + 1).padStart(width, '0')}`)]
  const body = rows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(row => [row.id, row.definitionHash || '', row.submissionId || randomUUID(), ...Array.from({ length: items }, (_, i) => row.values?.[i + 1] ?? '')])
  const csv = [header, ...body].map(line => line.map(cellText).join(',')).join('\r\n') + '\r\n'
  await writeFileAtomic(path.join(cfg.answersDir, answerFileName(scale, wave)), csv)
}

function cellText(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

/**
 * Merge imported rows into the existing answer file. Same id + same answers is
 * a re-import and replaces in place; same id + different answers is kept as a
 * second row and flagged so the reviewer decides which submission is real.
 */
function mergeAnswerRows(existing, incoming, mode) {
  const canonical = values => JSON.stringify(Object.keys(values || {}).sort().map(no => [no, values[no]]))
  const rows = mode === 'replace' ? [] : existing.map(row => ({ ...row }))
  for (const row of incoming) {
    const same = rows.findIndex(existingRow => existingRow.id === row.id && canonical(existingRow.values) === canonical(row.values))
    if (same >= 0) rows[same] = { ...row }
    else rows.push({ ...row })
  }
  return rows
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
      const idAt = cfg.study.participants.idColumn ? header.indexOf(cfg.study.participants.idColumn) : Math.max(0, header.findIndex(value => /编号|participant/i.test(value)))
      for (const cells of table.slice(1)) {
        const id = normalizeId(cells[idAt])
        if (cfg.study.acceptsId(id)) fromFile.push(id)
      }
    }
  }
  return { ids: fromFile, source: fromFile.length ? 'subjects.csv' : 'answers' }
}

/* ------------------------------------------------------------------ *
 * model
 * ------------------------------------------------------------------ */

async function buildModel(cfg) {
  const seeded = 0
  const { defs, problems: defProblems } = await loadDefs(cfg)
  const flow = await loadFlow(cfg, defs)
  const { files: answerFiles, problems: answerProblems } = await loadAnswerFiles(cfg)
  const provenance = await loadProvenance(cfg)
  const answerRows = answerFiles.flatMap(file => file.rows.map(row => ({
    scale: file.scale,
    wave: file.wave,
    id: row.id,
    values: row.values, definitionHash: row.definitionHash, submissionId: row.submissionId
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
  const revision = hash(JSON.stringify({ definitions: defs.map(def => [def.id, def.definitionHash]), answerRows, subjects: subjectIds }))
  const manifest = await readJson(path.join(cfg.labDir, 'scores-manifest.json'), null)
  const stale = !scoresStat || (manifest ? manifest.inputRevision !== revision : scoresStat + 1000 < Math.max(newestAnswer, newestDef))

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
    revision,
    subjectSource: subjects.source,
    stale: Boolean(answerRows.length || defs.length) && stale,
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
    definitionHash: def.definitionHash,
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
    study: cfg.study.identity,
    visits: cfg.study.visits,
    revision: model.revision,
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
      detailPath: cfg.detailPath,
      widePath: cfg.widePath
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
  const wide = wideCsv(model.defs, model.scores, model.answerRows)
  const inputs = { 'inputs/answer-rows.json': JSON.stringify(model.answerRows, null, 2), 'inputs/subjects.json': JSON.stringify(model.scores.rows.map(row => row.id)), 'inputs/study.json': JSON.stringify(cfg.study.identity), 'inputs/scoring.js': await readFile(path.join(HERE, 'scoring.js'), 'utf8') }
  for (const def of model.defs) inputs['inputs/defs/' + def.id + '.json'] = await readFile(def.file, 'utf8')
  const manifest = await publishGeneration(cfg, { 'scores.csv': csv, 'scores_detail.csv': detail, 'data_wide.csv': wide, ...inputs }, { inputRevision: model.revision, definitions: model.defs.map(def => ({ id: def.id, hash: def.definitionHash })) })
  return {
    generation: manifest.generation,
    rows: model.scores.rows.length,
    columns: model.scores.columns.length,
    detailRows: model.detail.length,
    wideColumns: wide.split('\r\n')[0].split(',').length,
    scoresPath: cfg.scoresPath,
    detailPath: cfg.detailPath,
    widePath: cfg.widePath
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
  lines.push('', '说明：分数在 scores.csv；每题明细（含原始值与反向后值）在 scores_detail.csv；分数与每题原始值合并的宽表在 data_wide.csv。')
  return lines.join('\n')
}

async function exportReport(model, cfg) {
  const file = path.join(cfg.exportDir, `量表分数_${stampForName()}.csv`)
  const wideFile = path.join(cfg.exportDir, `分数与题目宽表_${stampForName()}.csv`)
  const mdFile = path.join(cfg.exportDir, `量表分数_${stampForName()}.md`)
  await writeFileAtomic(file, '\uFEFF' + scoresCsv(model.defs, model.scores))
  await writeFileAtomic(wideFile, '\uFEFF' + wideCsv(model.defs, model.scores, model.answerRows))
  await writeFileAtomic(mdFile, exportMarkdown(model))
  return {
    csv: file.replace(/\\/g, '/'),
    wide: wideFile.replace(/\\/g, '/'),
    md: mdFile.replace(/\\/g, '/')
  }
}

/* ------------------------------------------------------------------ *
 * plugin
 * ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  let cfg = resolveConfig(config || {})
  let activeConfig = { ...config }
  let writeQueue = Promise.resolve()
  let lastWriteError = null
  let pendingWrites = 0
  let activeReads = 0
  let cacheEpoch = 0
  let modelCache = null
  let modelAt = 0
  let building = null
  const CACHE_TTL_MS = 5000

  async function model(force = false) {
    if (!force && modelCache && Date.now() - modelAt < CACHE_TTL_MS) return modelCache
    const epoch = cacheEpoch
    const context = cfg
    if (building && building.epoch === epoch) return building.promise
    const entry = { epoch, promise: null }
    entry.promise = (async () => {
      try {
        const result = await buildModel(context)
        if (epoch === cacheEpoch && cfg === context) { modelCache = result; modelAt = Date.now() }
        return result
      } finally { if (building === entry) building = null }
    })()
    building = entry
    return entry.promise
  }

  function invalidate() {
    cacheEpoch += 1
    modelCache = null
    modelAt = 0
  }

  /**
   * Answers are primary, scores are a cache — but the cache is the contract the
   * run console and the analysis pipeline read, so refresh it after every write
   * instead of making the user remember to press 重算.
   */
  async function syncScores() {
    const current = await model(true)
    await writeScores(current, cfg)
    modelAt = Date.now()
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
    if (!cfg.study.acceptsId(clean)) throw new RouteError('invalid', '被试编号不符合研究规则（需非空且匹配pattern）')
    return clean
  }

  const binding = hostBinding(ctx, {
    plugin: 'scale-desk',
    version: '0.2.0',
    config,
    hooks: {
      // 未配置研究时的默认根，与核心的 emptyDescriptor 用同一个基准，避免无谓切换。
      emptyBase: () => path.resolve(config.projectRoot || process.cwd()),
      loadStudy(studyPath) {
        return resolveConfig({ studyPath, pythonPath: activeConfig.pythonPath }).study
      },
      currentIdentity() {
        // 空研究（尚未显式连接）时数据根与核心的默认根对齐，避免无谓切换；
        // 业务读写仍用 cfg.labDir，所以配置了 labDir 也不会被覆盖。
        const dataRoot = cfg.study.path ? cfg.labDir : path.resolve(config.projectRoot || process.cwd(), '_lab')
        return { studyId: cfg.study.id, studyPath: cfg.study.path, dataRoot, revision: cfg.study.revision }
      },
      prepareSwitch(studyPath) {
        if (activeReads || building || pendingWrites > 0) throw new RouteError('busy', '量表正在写入，请稍后切换')
        const nextConfig = { studyPath, pythonPath: activeConfig.pythonPath }
        const next = resolveConfig(nextConfig)
        const marker = path.join(next.labDir, '.scale-study.json')
        try { const owner = JSON.parse(readFileSync(marker, 'utf8')); if (owner.studyId !== next.study.id) throw new RouteError('study_mismatch', '目标数据目录属于其他研究') } catch (error) { if (error.code !== 'ENOENT') throw error }
        const previous = { cfg, activeConfig }
        return {
          commit() { cfg = next; activeConfig = nextConfig; invalidate() },
          rollback() { cfg = previous.cfg; activeConfig = previous.activeConfig; invalidate() }
        }
      },
      busy() {
        return activeReads > 0 || Boolean(building) || pendingWrites > 0
      }
    }
  })
  binding.dispatch(ctx)

  const actions = {
    async studyConfig() {
      return { study: cfg.study.identity, definition: cfg.study.path ? JSON.parse(await readFile(cfg.study.path, 'utf8')) : { schemaVersion: 1, studyId: cfg.study.id, name: cfg.study.name, dataRoot: cfg.labDir, participantId: {}, visits: [], tasks: [], followups: [], plugins: {} } }
    },
    async studyPreview(payload) {
      let definition
      try { definition = typeof payload.definition === 'string' ? JSON.parse(payload.definition) : payload.definition } catch { throw new RouteError('invalid', '研究JSON无法解析') }
      const problems = validateStudyDefinition(definition)
      return { valid: problems.length === 0, problems, definition, path: payload.path ? path.resolve(payload.path) : null }
    },
    async studyConnect(payload, actor) {
      const requested = String((payload && payload.path) || '').trim()
      if (!requested) throw new RouteError('invalid', '请填写研究定义路径')
      // 连接前先按旧行为核对目标数据目录归属，避免写入一条指向别的研究的绑定。
      const next = resolveConfig({ studyPath: path.resolve(requested), pythonPath: activeConfig.pythonPath })
      const marker = path.join(next.labDir, '.scale-study.json')
      try { const owner = JSON.parse(readFileSync(marker, 'utf8')); if (owner.studyId !== next.study.id) throw new RouteError('study_mismatch', '目标数据目录属于其他研究') } catch (error) { if (error.code !== 'ENOENT') throw error }
      // 显式连接：只改当前页面/会话的绑定，并把绑定修订号 +1（旧令牌随即失效）。
      binding.connect(actor, { studyPath: path.resolve(requested) })
      const active = await binding.activate(actor)
      return { study: cfg.study.identity, binding: active }
    },
    async studySave(payload, actor) {
      const preview = await actions.studyPreview(payload)
      if (!preview.valid || !preview.path) throw new RouteError('invalid', preview.problems.join('；') || '请填写研究文件路径')
      const existing = await readFile(preview.path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (existing !== null && (!payload.expectedRevision || hash(existing) !== payload.expectedRevision)) throw new RouteError('conflict', '研究文件已存在或已更改，请重新连接并预览')
      const dataRoot = path.resolve(path.dirname(preview.path), preview.definition.dataRoot || './data')
      if (dataRoot === cfg.labDir && preview.definition.studyId !== cfg.study.id) throw new RouteError('study_mismatch', '新研究ID需使用独立数据目录')
      const owner = await readJson(path.join(dataRoot, '.scale-study.json'), null)
      if (owner && owner.studyId !== preview.definition.studyId) throw new RouteError('study_mismatch', '目标数据目录属于其他研究')
      const savedText = JSON.stringify(preview.definition, null, 2) + '\n'
      // 新文件用 wx 语义（并发创建时报冲突而不是覆盖）；已有文件写入前再核对一次内容。
      if (existing === null) await writeFileExclusive(preview.path, savedText)
      else {
        const now = await readFile(preview.path, 'utf8').catch(() => null)
        if (now !== existing) throw new RouteError('conflict', '研究文件在保存前被外部修改，请重新预览')
        await writeFileAtomic(preview.path, savedText)
      }
      try { binding.connect(actor, { studyPath: preview.path }) }
      catch (error) {
        const now = await readFile(preview.path, 'utf8').catch(() => null)
        if (now === savedText) {
          if (existing === null) await rm(preview.path, { force: true })
          else await writeFileAtomic(preview.path, existing)
        } else throw new RouteError('partial', '研究连接失败且文件被外部修改，未回滚；请重新连接核对：' + error.message)
        throw error
      }
      // 绑定记录已落盘：激活失败不回滚研究定义，下次读取会重新切换过去。
      const active = await binding.activate(actor)
      return { study: cfg.study.identity, binding: active }
    },
    async recover() { const result = await recoverMutation(cfg); invalidate(); return result },
    async initialize(payload) {
      await mkdir(cfg.defsDir, { recursive: true }); await mkdir(cfg.answersDir, { recursive: true })
      if (payload.sample === true) {
        const raw = JSON.parse(await readFile(SAMPLE_DEF, 'utf8'))
        const target = path.join(cfg.defsDir, raw.id + '.json')
        if (await stat(target).then(() => true).catch(() => false)) throw new RouteError('conflict', '示例定义已存在')
        await writeFileAtomic(target, JSON.stringify(raw, null, 2) + '\n')
      }
      invalidate(); return { study: cfg.study.identity, sample: payload.sample === true }
    },
    async status() {
      const current = await model(false)
      return { ...statusPayload(current, cfg), transaction: await mutationState(cfg), lastWriteError, publishOutbox: await readOutbox() }
    },

    async refresh() {
      invalidate()
      const current = await model(true)
      return { ...statusPayload(current, cfg), lastWriteError }
    },

    async definition(payload) {
      const current = await model(false)
      const def = findDef(current, String((payload && payload.id) || ''))
      return {
        id: def.id,
        name: def.name,
        short: def.short,
        version: def.version,
        definitionHash: def.definitionHash,
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
      const rawIssues = validateRawDefinition(raw)
      if (rawIssues.length) throw new RouteError('invalid', rawIssues.map(item => item.text).join('；'))
      await definitionSnapshot(cfg, JSON.parse(await readFile(def.file, 'utf8')))
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
      const codes = { ...def.codes }
      for (const entry of incoming) {
        const name = String((entry && entry.name) || '').trim()
        if (!name) throw new RouteError('invalid', '波次名不能为空')
        if (!/^[A-Za-z0-9._-]{1,24}$/.test(name)) {
          throw new RouteError('invalid', `波次名「${name}」只能用字母、数字和 . _ -（它同时是文件名和列名的一部分）`)
        }
        if (names.includes(name)) throw new RouteError('invalid', `波次名 ${name} 重复`)
        names.push(name)
        const prefix = String((entry && entry.prefix) || '').trim()
        if ((def.codes[name] || []).length) continue
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
      raw.codes = Object.fromEntries(Object.entries(codes).filter(([wave]) => names.includes(wave)))
      const rawIssues = validateRawDefinition(raw)
      if (rawIssues.length) throw new RouteError('invalid', rawIssues.map(item => item.text).join('；'))
      await definitionSnapshot(cfg, JSON.parse(await readFile(def.file, 'utf8')))
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
      const entries = file ? file.rows.filter(item => item.id === id) : []
      if (entries.length > 1) throw new RouteError('duplicate', '同编号有多份作答，请先在核对里保留一份')
      const row = entries[0]
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
      const entries = file ? file.rows.filter(item => item.id === id) : []
      if (entries.length > 1) return { id, scale: def.id, scaleName: def.name, short: def.short, wave, status: 'duplicate', copies: entries.length, items: [], subs: [], answered: null, file: file.file }
      const row = entries[0]
      if (!row) throw new RouteError('not_found', `${id} 没有 ${def.short} ${wave} 的作答`)
      const result = scoreAnswers(def, row.values)
      return {
        id,
        status: result.status,
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
      const definitionHash = await definitionSnapshot(cfg, JSON.parse(await readFile(def.file, 'utf8')))
      rows.push({ id, values, definitionHash, submissionId: randomUUID() })
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

    /* ---------------- 作答核对：改编号、删、多份里留一份 ---------------- */

    async answers(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const wave = String((payload && payload.wave) || def.waves[0])
      requireWave(def, wave)
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      const rows = file ? file.rows : []
      const counts = new Map()
      for (const row of rows) counts.set(row.id, (counts.get(row.id) || 0) + 1)
      return {
        scale: def.id,
        wave,
        file: file ? file.file : '',
        rows: rows.map((row, index) => {
          const result = scoreAnswers(def, row.values)
          return {
            index,
            id: row.id,
            values: row.values,
            answered: result.answered,
            missing: result.missing,
            invalid: result.invalid.length,
            copies: counts.get(row.id) || 1
          }
        })
      }
    },

    async renameAnswer(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const wave = String((payload && payload.wave) || def.waves[0])
      requireWave(def, wave)
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      if (!file) throw new RouteError('invalid', '这一波次还没有作答')
      const index = Number(payload && payload.index)
      if (!Number.isInteger(index) || index < 0 || index >= file.rows.length) throw new RouteError('invalid', '找不到这一行')
      const to = normalizeId(payload && payload.to)
      if (!cfg.study.acceptsId(to)) throw new RouteError('invalid', '新编号不能为空')
      if (file.rows.some((row, at) => at !== index && row.id === to)) {
        throw new RouteError('invalid', `${to} 已经有作答，先把那份删掉或改成别的编号`)
      }
      const from = file.rows[index].id
      const rows = file.rows.map((row, at) => (at === index ? { ...row, id: to } : row))
      await writeAnswerFile(cfg, def.id, wave, rows, def.itemCount)
      await appendProvenance(cfg, { action: 'rename', scale: def.id, wave, defVersion: def.version, note: `${from}→${to}` })
      await syncScores()
      return { from, to, index }
    },

    async deleteAnswerRow(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const wave = String((payload && payload.wave) || def.waves[0])
      requireWave(def, wave)
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      if (!file) throw new RouteError('invalid', '这一波次还没有作答')
      const index = Number(payload && payload.index)
      if (!Number.isInteger(index) || index < 0 || index >= file.rows.length) throw new RouteError('invalid', '找不到这一行')
      const dropped = file.rows[index]
      const rows = file.rows.filter((row, at) => at !== index)
      await writeAnswerFile(cfg, def.id, wave, rows, def.itemCount)
      await appendProvenance(cfg, { action: 'delete-row', scale: def.id, wave, defVersion: def.version, note: dropped.id })
      await syncScores()
      return { id: dropped.id, index, remaining: rows.length }
    },

    async keepAnswer(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const wave = String((payload && payload.wave) || def.waves[0])
      requireWave(def, wave)
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      if (!file) throw new RouteError('invalid', '这一波次还没有作答')
      const index = Number(payload && payload.index)
      if (!Number.isInteger(index) || index < 0 || index >= file.rows.length) throw new RouteError('invalid', '找不到这一行')
      const kept = file.rows[index]
      const rows = file.rows.filter((row, at) => at === index || row.id !== kept.id)
      await writeAnswerFile(cfg, def.id, wave, rows, def.itemCount)
      await appendProvenance(cfg, {
        action: 'keep-one',
        scale: def.id,
        wave,
        defVersion: def.version,
        note: `${kept.id} 保留第 ${index + 1} 行，删掉 ${file.rows.length - rows.length} 份`
      })
      await syncScores()
      return { id: kept.id, removed: file.rows.length - rows.length }
    },

    /** Rows that look unusable: bad id format, or several submissions per id. */
    async suspicious() {
      const current = await model(false)
      const entries = []
      for (const file of current.answerFiles) {
        const counts = new Map()
        for (const row of file.rows) counts.set(row.id, (counts.get(row.id) || 0) + 1)
        for (const row of file.rows) {
          const reasons = []
          if (!cfg.study.acceptsId(row.id)) reasons.push('编号为空')
          if ((counts.get(row.id) || 0) > 1) reasons.push('同编号 ' + counts.get(row.id) + ' 份')
          if (!reasons.length) continue
          entries.push({
            scale: file.scale,
            short: (current.defs.find(def => def.id === file.scale) || {}).short || file.scale,
            wave: file.wave,
            id: row.id,
            answered: Object.values(row.values || {}).filter(value => String(value ?? '').trim()).length,
            reasons
          })
        }
      }
      const byScale = new Map(current.defs.map(def => [def.id, def.short]))
      for (const entry of entries) entry.short = byScale.get(entry.scale) || entry.scale
      return { entries, total: entries.length }
    },

    /** Delete many (scale, wave, id) rows in one go. */
    async bulkDelete(payload) {
      const current = await model(false)
      const targets = Array.isArray(payload && payload.targets) ? payload.targets : []
      if (!targets.length) throw new RouteError('invalid', '没有选中要删的行')
      const wanted = new Set(targets.map(item => `${item.scale}__${item.wave}__${item.id}`))
      let removed = 0
      const touched = []
      for (const file of current.answerFiles) {
        const kept = file.rows.filter(row => !wanted.has(`${file.scale}__${file.wave}__${row.id}`))
        const dropped = file.rows.length - kept.length
        if (!dropped) continue
        const def = current.defs.find(item => item.id === file.scale)
        await writeAnswerFile(cfg, file.scale, file.wave, kept, def ? def.itemCount : 0)
        await appendProvenance(cfg, {
          action: 'bulk-delete',
          scale: file.scale,
          wave: file.wave,
          note: String((payload && payload.reason) || '批量删除') + `：${dropped} 行`,
          rows: dropped
        })
        removed += dropped
        touched.push({ scale: file.scale, wave: file.wave, removed: dropped })
      }
      await syncScores()
      return { removed, touched }
    },

    /** Remove several subject ids from every answer file at once. */
    async bulkDeleteSubjects(payload) {
      const current = await model(false)
      const ids = [...new Set((Array.isArray(payload && payload.ids) ? payload.ids : [])
        .map(normalizeId).filter(Boolean))]
      if (!ids.length) throw new RouteError('invalid', '没有选中要删的编号')
      const wanted = new Set(ids)
      let removed = 0
      const touched = []
      const perId = Object.fromEntries(ids.map(id => [id, 0]))
      for (const file of current.answerFiles) {
        const kept = file.rows.filter(row => !wanted.has(row.id))
        const dropped = file.rows.length - kept.length
        if (!dropped) continue
        const def = current.defs.find(item => item.id === file.scale)
        await writeAnswerFile(cfg, file.scale, file.wave, kept, def ? def.itemCount : 0)
        await appendProvenance(cfg, {
          action: 'bulk-delete',
          scale: file.scale,
          wave: file.wave,
          note: `删除编号 ${ids.join('、')}：${dropped} 行`
        })
        removed += dropped
        touched.push({ scale: file.scale, wave: file.wave, removed: dropped })
        for (const row of file.rows) if (wanted.has(row.id)) perId[row.id] = (perId[row.id] || 0) + 1
      }
      await syncScores()
      return { ids, removed, touched, perId }
    },

    /** Rename one subject id everywhere (typos such as `0.22007` → `22007`). */
    async bulkRenameSubjects(payload) {
      const current = await model(false)
      const from = normalizeId(payload && payload.from)
      const to = requireId(payload && payload.to)
      if (!from) throw new RouteError('invalid', '先填旧编号')
      if (!to) throw new RouteError('invalid', '先填新编号')
      if (from === to) throw new RouteError('invalid', '新旧编号一样，不用改')
      const collision = current.answerFiles.some(file => file.rows.some(row => row.id === to))
      let renamed = 0
      let merged = 0
      const touched = []
      for (const file of current.answerFiles) {
        if (!file.rows.some(row => row.id === from)) continue
        const rows = []
        const seen = new Set()
        let fileRenamed = 0
        let fileMerged = 0
        for (const row of file.rows) {
          const next = row.id === from ? { ...row, id: to } : row
          if (row.id === from) fileRenamed += 1
          const key = next.id + '|' + JSON.stringify(next.values)
          if (seen.has(key)) {
            fileMerged += 1
            continue
          }
          seen.add(key)
          rows.push(next)
        }
        const def = current.defs.find(item => item.id === file.scale)
        await writeAnswerFile(cfg, file.scale, file.wave, rows, def ? def.itemCount : 0)
        await appendProvenance(cfg, {
          action: 'bulk-rename',
          scale: file.scale,
          wave: file.wave,
          note: `${from} → ${to}：${fileRenamed} 行` + (fileMerged ? `，合并重复 ${fileMerged} 行` : '')
        })
        renamed += fileRenamed
        merged += fileMerged
        touched.push({ scale: file.scale, wave: file.wave, renamed: fileRenamed })
      }
      if (!renamed) throw new RouteError('invalid', `没有找到编号 ${from} 的作答`)
      await syncScores()
      return {
        from,
        to,
        renamed,
        merged,
        touched,
        collision,
        warning: null
      }
    },

    /**
     * Keep one submission per id (the last row, i.e. the latest response, by
     * default) across every answer file, dropping the other copies.
     */
    async keepOnePerId(payload) {
      const current = await model(false)
      const order = payload && payload.order === 'first' ? 'first' : 'last'
      const scale = String((payload && payload.scale) || '')
      const wave = String((payload && payload.wave) || '')
      let removed = 0
      const touched = []
      for (const file of current.answerFiles) {
        if (scale && file.scale !== scale) continue
        if (wave && file.wave !== wave) continue
        const positions = new Map()
        file.rows.forEach((row, index) => {
          if (!positions.has(row.id)) positions.set(row.id, [])
          positions.get(row.id).push(index)
        })
        const duplicates = [...positions.entries()].filter(([, list]) => list.length > 1)
        if (!duplicates.length) continue
        const keep = new Set()
        for (const [, list] of duplicates) {
          keep.add(order === 'first' ? list[0] : list[list.length - 1])
        }
        const rows = file.rows.filter((row, index) => {
          const list = positions.get(row.id)
          return list.length === 1 || keep.has(index)
        })
        const dropped = file.rows.length - rows.length
        if (!dropped) continue
        const def = current.defs.find(item => item.id === file.scale)
        await writeAnswerFile(cfg, file.scale, file.wave, rows, def ? def.itemCount : 0)
        await appendProvenance(cfg, {
          action: 'keep-one-bulk',
          scale: file.scale,
          wave: file.wave,
          note: `${duplicates.length} 个编号只留${order === 'first' ? '第一' : '最后'}一份，删 ${dropped} 行`
        })
        removed += dropped
        touched.push({ scale: file.scale, wave: file.wave, ids: duplicates.length, removed: dropped })
      }
      if (!removed) throw new RouteError('invalid', '没有重复编号，不用处理')
      await syncScores()
      return { order, removed, touched }
    },

    /** Remove one subject id from every answer file (test submissions, typos). */
    async deleteSubject(payload) {
      const current = await model(false)
      const id = normalizeId(payload && payload.id)
      if (!id) throw new RouteError('invalid', '先填编号')
      let removed = 0
      const touched = []
      for (const file of current.answerFiles) {
        const kept = file.rows.filter(row => row.id !== id)
        const dropped = file.rows.length - kept.length
        if (!dropped) continue
        const def = current.defs.find(item => item.id === file.scale)
        await writeAnswerFile(cfg, file.scale, file.wave, kept, def ? def.itemCount : 0)
        await appendProvenance(cfg, {
          action: 'bulk-delete',
          scale: file.scale,
          wave: file.wave,
          note: `删除编号 ${id}：${dropped} 行`
        })
        removed += dropped
        touched.push({ scale: file.scale, wave: file.wave, removed: dropped })
      }
      await syncScores()
      return { id, removed, touched }
    },

    /* ---------------- 量表库管理：新建、删除、改基本信息与计分 ---------------- */

    async createScale(payload) {
      const current = await model(false)
      const id = String(payload && payload.id || '').trim()
      if (!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(id)) {
        throw new RouteError('invalid', '量表 id 以字母开头，只能用字母、数字、_ 与 -（它会进文件名和列名）')
      }
      if (current.defs.some(def => def.id.toLowerCase() === id.toLowerCase())) {
        throw new RouteError('invalid', `已经有 id 为 ${id} 的量表`)
      }
      const itemCount = Number(payload && payload.itemCount)
      if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 300) throw new RouteError('invalid', '题量要在 1–300 之间')
      const min = Number(payload && payload.min)
      const max = Number(payload && payload.max)
      if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) throw new RouteError('invalid', '取值下限要小于上限')
      const names = Array.isArray(payload && payload.waves) && payload.waves.length ? payload.waves.map(String) : ['T0']
      for (const name of names) {
        if (!/^[A-Za-z0-9._-]{1,24}$/.test(name)) throw new RouteError('invalid', `波次名「${name}」只能用字母、数字和 . _ -`)
      }
      if (new Set(names).size !== names.length) throw new RouteError('invalid', '波次名重复')
      const scoringType = ['none', 'sum', 'mean'].includes(payload && payload.scoringType) ? payload.scoringType : 'sum'
      const reverse = Array.isArray(payload && payload.reverse)
        ? [...new Set(payload.reverse.map(Number).filter(no => Number.isInteger(no) && no >= 1 && no <= itemCount))].sort((a, b) => a - b)
        : []
      const minAnswered = Number(payload && payload.minAnswered) > 0
        ? Math.min(itemCount, Math.round(Number(payload.minAnswered)))
        : Math.max(1, Math.ceil(itemCount * 0.8))
      const items = Array.from({ length: itemCount }, (_, index) => ({
        no: index + 1,
        text: '',
        reverse: reverse.includes(index + 1)
      }))
      const raw = {
        schema: 1,
        id,
        name: String((payload && payload.name) || id).trim() || id,
        short: String((payload && payload.short) || (payload && payload.name) || id).trim() || id,
        version: String((payload && payload.version) || '新建').trim(),
        waves: names,
        itemCount,
        response: { min, max, labels: {} },
        items,
        scoring: scoringType === 'none'
          ? { type: 'none' }
          : {
              type: scoringType,
              subscales: {
                total: {
                  label: '总分',
                  items: items.map(item => item.no),
                  reverse,
                  range: scoringType === 'sum' ? [min * itemCount, max * itemCount] : [min, max],
                  multiplier: 1
                }
              }
            },
        missing: { rule: 'prorate', minAnswered },
        codes: {},
        unit: '分',
        decimals: 2,
        source: '',
        license: '题目文本只存在本地 _lab，不进插件仓库',
        notes: String((payload && payload.notes) || ''),
        instructions: String((payload && payload.instructions) || '')
      }
      await writeFileAtomic(path.join(cfg.defsDir, `${id}.json`), JSON.stringify(raw, null, 2) + '\n')
      invalidate()
      return { id, itemCount, waves: names }
    },

    async deleteScale(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const used = current.answerFiles.filter(file => file.scale === def.id && (file.rows || []).length)
      if (used.length) {
        throw new RouteError('invalid', `${def.short} 已有作答（${used.map(file => file.wave + ' ' + file.rows.length + ' 份').join('，')}），先把这些作答删掉再删量表`)
      }
      let flowRemoved = 0
      const flowRaw = await readFile(cfg.flowPath, 'utf8').then(JSON.parse).catch(() => null)
      if (flowRaw && Array.isArray(flowRaw.stages)) {
        let changed = false
        for (const stage of flowRaw.stages) {
          if (!Array.isArray(stage.steps)) continue
          const before = stage.steps.length
          stage.steps = stage.steps.filter(step => !(step && step.kind === 'scale' && step.scale === def.id))
          if (stage.steps.length !== before) changed = true
          flowRemoved += before - stage.steps.length
        }
        if (changed) await writeFileAtomic(cfg.flowPath, JSON.stringify(flowRaw, null, 2) + '\n')
      }
      await rm(def.file, { force: true })
      invalidate()
      await syncScores()
      return { removed: def.id, flowRemoved }
    },

    async saveMeta(payload) {
      const current = await model(false)
      const def = findDef(current, String(payload && payload.scale))
      const raw = JSON.parse(await readFile(def.file, 'utf8'))
      const multiSub = Object.keys(def.scoring.subscales).length > 1

      const name = String((payload && payload.name) === undefined ? raw.name : payload.name).trim()
      if (!name) throw new RouteError('invalid', '名称不能为空')
      raw.name = name
      raw.short = String((payload && payload.short) === undefined ? raw.short || name : payload.short).trim() || name
      raw.version = String((payload && payload.version) === undefined ? raw.version || '' : payload.version).trim()
      raw.notes = String((payload && payload.notes) === undefined ? raw.notes || '' : payload.notes)
      raw.instructions = String((payload && payload.instructions) === undefined ? raw.instructions || '' : payload.instructions)

      const wantsScoring = payload && (payload.scoringType !== undefined || payload.reverse !== undefined || payload.minAnswered !== undefined)
      if (wantsScoring && multiSub) {
        throw new RouteError('invalid', `${def.short} 是多分量表（${Object.values(def.scoring.subscales).map(sub => sub.label).join('/')}），计分键请在定义 JSON 里改`)
      }
      if (wantsScoring) {
        if (payload.scoringType !== undefined && !['none', 'sum', 'mean'].includes(payload.scoringType)) throw new RouteError('invalid', '计分方式无效')
        const scoringType = payload.scoringType ?? def.scoring.type
        const reverse = payload.reverse === undefined ? null : payload.reverse
        if (reverse !== null && (!Array.isArray(reverse) || reverse.some(no => !Number.isInteger(no) || no < 1 || no > def.itemCount))) throw new RouteError('invalid', '反向题应为有效题号数组')
        if (payload.minAnswered !== undefined) {
          if (!Number.isInteger(payload.minAnswered) || payload.minAnswered < 1 || payload.minAnswered > def.itemCount) throw new RouteError('invalid', '缺失门槛超出题量')
          if (payload.minAnswered !== def.missing.minAnswered) raw.missing = { ...(raw.missing || {}), minAnswered: payload.minAnswered }
        }
        if (reverse !== null && JSON.stringify([...new Set(reverse)].sort((a,b) => a-b)) !== JSON.stringify(def.items.filter(item => item.reverse).map(item => item.no))) {
          raw.items = (raw.items || def.items).map(item => ({ ...item, reverse: reverse.includes(Number(item.no)) }))
          for (const sub of Object.values(raw.scoring?.subscales || {})) if (Object.hasOwn(sub, 'reverse')) sub.reverse = reverse.filter(no => (sub.items || def.items.map(item => item.no)).includes(no))
        }
        if (scoringType !== def.scoring.type) {
          raw.scoring = { ...(raw.scoring || {}), type: scoringType }
          // Preserve custom keys, item subsets, weights and extension fields.
          for (const sub of Object.values(raw.scoring.subscales || {})) {
            const count = (sub.items || def.items).length
            const span = scoringType === 'mean' ? 1 : count
            if (scoringType !== 'none') sub.range = [def.response.min * span * (sub.multiplier ?? 1), def.response.max * span * (sub.multiplier ?? 1)]
          }
        }
      }
      const rawIssues = validateRawDefinition(raw)
      if (rawIssues.length) throw new RouteError('invalid', rawIssues.map(item => item.text).join('；'))
      await definitionSnapshot(cfg, JSON.parse(await readFile(def.file, 'utf8')))
      await writeFileAtomic(def.file, JSON.stringify(raw, null, 2) + '\n')
      invalidate()
      await syncScores()
      return { scale: def.id, name: raw.name, scoringType: raw.scoring.type }
    },

    async importPreview(payload) {
      const current = await model(false)
      const source = await tableFromPayload(payload, cfg)
      const table = parseTable(source.text)
      if (!table.length) throw new RouteError('invalid', '文件里没有可读的表格行')
      const header = table[0].map(value => String(value ?? '').trim())
      const body = table.slice(1)
      const filename = String((payload && payload.filename) || '')
      if (!body.length) {
        throw new RouteError('invalid', `「${source.sheet || filename}」只有表头、没有作答行。请确认导出时选的是回复数据（Raw Data / Responses），而不是空报告。`)
      }
      const labels = detectLabelRow(table)
      let scale = String((payload && payload.scale) || '')
      let wave = String((payload && payload.wave) || '')
      let guessed = null
      const targets = scanTargets(current.defs, header, body, labels)
      if (!scale || !wave) {
        const pool = scale ? current.defs.filter(def => def.id === scale) : current.defs
        guessed = targets.find(target => target.automatic && pool.some(def => def.id === target.scale)) || guessTarget(pool, header, filename, labels)
        if (!guessed) {
          if (!targets.length) {
            throw new RouteError('invalid', `这份文件的列名对不上任何一份量表（前几列：${header.slice(0, 4).join(' / ')}）。可以手动选择目标量表与波次再预览。`)
          }
          guessed = targets[0]
        }
        if (!scale) scale = guessed.scale
        if (!wave) wave = guessed.wave
      }
      const def = findDef(current, scale)
      requireWave(def, wave)
      const mapping = confirmImportMapping(def, header, mapImportColumns(def, wave, header, body, labels), payload?.mapping)
      if (mapping.idIndex < 0) throw new RouteError('invalid', '请选择编号列')
      const resolved = resolveImport(cfg, def, wave, table, mapping)
      const applied = resolved.applied
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
        sheet: source.sheet,
        guessed,
        scale: def.id,
        scaleName: def.name,
        wave,
        requiresTarget: !(payload?.scale && payload?.wave) && !targets.some(target => target.automatic),
        targets: targets.map(target => ({
          scale: target.scale,
          short: target.short,
          name: target.name,
          wave: target.wave,
          matched: target.matched,
          total: target.total,
          automatic: target.automatic,
          mapping: target.mapping
        })),
        header,
        mapping: {
          idColumn: resolved.mapping.idColumn,
          idIndex: resolved.mapping.idIndex,
          idHow: resolved.mapping.idHow,
          items: mapping.items,
          matched: mapping.matched,
          total: mapping.total,
          unmatched: mapping.unmatched,
          extraColumns: mapping.extraColumns.slice(0, 30)
        },
        rows: applied.rows.length,
        skipped: resolved.skipped,
        ids: applied.rows.map(row => row.id),
        issues: [...applied.issues].slice(0, 50),
        preview,
        emptyCells: applied.rows.reduce((sum, row) => sum + Object.values(row.values).filter(value => !String(value).trim()).length, 0)
      }
    },

    async importApply(payload) {
      const current = await model(false)
      const source = await tableFromPayload(payload, cfg)
      const table = parseTable(source.text)
      if (!table.length) throw new RouteError('invalid', '文件里没有可读的表格行')
      if (table.length < 2) throw new RouteError('invalid', `「${source.sheet || ''}」只有表头、没有作答行`)
      const labels = detectLabelRow(table)
      const filename = String((payload && payload.filename) || '')
      let scale = String((payload && payload.scale) || '')
      let wave = String((payload && payload.wave) || '')
      if (!scale || !wave) {
        const pool = scale ? current.defs.filter(def => def.id === scale) : current.defs
        const guessed = guessTarget(pool, table[0], filename, labels)
        const certain = scanTargets(pool, table[0], table.slice(1), labels).filter(target => target.automatic)
        if (!guessed || certain.length !== 1 || certain[0].scale !== guessed.scale || certain[0].wave !== guessed.wave) throw new RouteError('invalid', '请明确选择目标量表与波次后导入')
        scale = scale || guessed.scale
        wave = wave || guessed.wave
      }
      const def = findDef(current, scale)
      requireWave(def, wave)
      const header = table[0].map(value => String(value ?? '').trim())
      const mapping = confirmImportMapping(def, header, mapImportColumns(def, wave, header, table.slice(1), labels), payload?.mapping)
      if (mapping.idIndex < 0) throw new RouteError('invalid', '请选择编号列')
      const resolved = resolveImport(cfg, def, wave, table, mapping)
      const applied = resolved.applied
      const skipped = resolved.skipped
      if (!applied.rows.length) throw new RouteError('invalid', '这份文件没有一行编号符合研究规则（可能都是测试行或未填编号）')
      const definitionHash = await definitionSnapshot(cfg, JSON.parse(await readFile(def.file, 'utf8')))
      for (const row of applied.rows) { row.definitionHash = definitionHash; row.submissionId = randomUUID() }
      if (!applied.rows.length) throw new RouteError('invalid', '没有解析出任何一行带编号的作答')
      const mode = payload && payload.mode === 'replace' ? 'replace' : 'merge'
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      const existing = file ? file.rows : []
      const rows = mergeAnswerRows(existing, applied.rows, mode)
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
      const learned = null
      return {
        scale: def.id,
        wave,
        mode,
        imported: applied.rows.length,
        skipped,
        total: rows.length,
        replaced: mode === 'replace' ? existing.length : Math.max(0, applied.rows.length - existing.length),
        learned,
        issues: applied.issues.slice(0, 30),
        file: file ? file.file : path.join(cfg.answersDir, answerFileName(def.id, wave)).replace(/\\/g, '/')
      }
    },

    /** 编号列兜底：如果自动识别的列拿不到合格编号，就找一列值符合研究编号规则的重试。 */

    /** Import only the confirmed targets and their positional mappings. */
    async importFile(payload) {
      const current = await model(false)
      const source = await tableFromPayload(payload, cfg)
      const table = parseTable(source.text)
      if (table.length < 2) throw new RouteError('invalid', `「${source.sheet || ''}」只有表头、没有作答行`)
      const header = table[0].map(value => String(value ?? '').trim())
      const body = table.slice(1)
      const filename = String((payload && payload.filename) || '')
      const labels = detectLabelRow(table)
      const selected = payload?.targets
      if (!Array.isArray(selected) || !selected.length) throw new RouteError('invalid', '请先确认导入目标和列映射')
      const keys = new Set()
      const targets = selected.map(target => {
        const def = findDef(current, String(target.scale || ''))
        requireWave(def, String(target.wave || ''))
        const key = JSON.stringify([def.id, target.wave])
        if (keys.has(key)) throw new RouteError('invalid', '导入目标重复')
        keys.add(key)
        if (!target.mapping) throw new RouteError('invalid', '每个目标都需要确认列映射')
        const mapping = confirmImportMapping(def, header, mapImportColumns(def, target.wave, header, body, labels), target.mapping)
        const resolved = resolveImport(cfg, def, target.wave, table, mapping)
        const applied = resolved.applied
        if (!applied.rows.length) throw new RouteError('invalid', '这份文件没有一行编号符合研究规则（可能都是测试行或未填编号）')
        return { scale: def.id, wave: target.wave, mapping: resolved.mapping, applied, matched: mapping.matched, total: def.itemCount, skipped: resolved.skipped }
      })
      const mode = payload && payload.mode === 'replace' ? 'replace' : 'merge'
      const results = []
      for (const target of targets) {
        const def = findDef(current, target.scale)
        const applied = target.applied
        const definitionHash = await definitionSnapshot(cfg, JSON.parse(await readFile(def.file, 'utf8')))
        for (const row of applied.rows) { row.definitionHash = definitionHash; row.submissionId = randomUUID() }
        if (!applied.rows.length) continue
        const file = current.answerFiles.find(item => item.scale === def.id && item.wave === target.wave)
        const rows = mergeAnswerRows(file ? file.rows : [], applied.rows, mode)
        await writeAnswerFile(cfg, def.id, target.wave, rows, def.itemCount)
        await appendProvenance(cfg, {
          action: 'import',
          scale: def.id,
          wave: target.wave,
          defVersion: def.version,
          file: filename || null,
          rows: applied.rows.length,
          mode
        })
        const learned = null
        results.push({
          scale: def.id,
          short: def.short,
          wave: target.wave,
          imported: applied.rows.length,
          skipped: target.skipped || 0,
          total: rows.length,
          matched: target.matched,
          totalItems: target.total,
          learned
        })
      }
      if (!results.length) throw new RouteError('invalid', '没有解析出任何一行带编号的作答')
      await syncScores()
      return { filename, sheet: source.sheet, results }
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

  /** 可选：把量表提交发布为标准 observation（默认关闭，避免擅自改动既有研究）。 */
  async function publishObservations(view) {
    if (!view || !view.instanceId) return { published: 0, reason: '没有绑定实例身份' }
    const tasks = (cfg.study.tasks || []).filter(task => task && task.source && (task.source.type === 'scale' || task.source.scaleId) && task.source.scaleId && task.source.waveId)
    if (!tasks.length) return { published: 0, reason: '研究里没有带 scaleId/waveId 的量表任务' }
    const current = await model(false)
    const data = openResearchData({ study: cfg.study, instanceId: view.instanceId })
    const flow = openFlow({ data, study: cfg.study, owner: 'scale-desk' })
    let published = 0
    let changed = 0
    let unregistered = 0
    let missingDefs = 0
    for (const task of tasks) {
      const def = current.defs.find(item => item.id === task.source.scaleId)
      const wave = String(task.source.waveId)
      if (!def || !def.waves.includes(wave)) { missingDefs += 1; continue }
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      if (!file) continue
      const visitId = (task.visits && task.visits[0]) || task.visitId || wave
      for (const row of file.rows || []) {
        // 未登记编号留在"待关联区"：不静默增加入组人数，也不发布 observation。
        if (!flow.participants.resolve(row.id)) { unregistered += 1; continue }
        const result = scoreAnswers(def, row.values)
        const quality = def.scoring.type === 'none'
          ? 'unchecked'
          : result.invalid.length ? 'invalid'
            : Object.values(result.subs).some(sub => sub.status === 'incomplete' || sub.status === 'empty') ? 'unscorable'
              : 'valid'
        const collection = result.answered === def.itemCount ? 'complete' : (result.answered ? 'entered' : 'missing')
        const sourceRevision = `def:${String(def.definitionHash || '').slice(0, 8)}|sub:${row.submissionId || hash(JSON.stringify(row.values)).slice(0, 12)}`
        try {
          flow.observations.publish({
            participantId: row.id, visitId, taskId: task.id,
            recordId: `scale_${task.id}_${wave}_${row.id}_${String(row.submissionId || hash(JSON.stringify(row.values)).slice(0, 8))}`,
            collectionState: collection, qualityState: quality,
            eventDate: null, datePrecision: 'unknown',
            sourceType: 'scale', sourceId: `${def.id}@${wave}`, sourceRevision,
            evidence: { scaleId: def.id, waveId: wave, definitionHash: def.definitionHash || null, submissionId: row.submissionId || null },
          })
          published += 1
        } catch (error) {
          // 同一条记录已经发布过、但答案版本变了（例如清理重复行后 submissionId 更新）：
          // 不覆盖旧记录，也不让整次计分失败，计入 changed 由页面提示。
          if (error && error.code === 'duplicate_record') { changed += 1; continue }
          throw error
        }
      }
    }
    return { published, changed, unregistered, missingDefs, tasks: tasks.length }
  }

  /* ---------- 数值分数发布（F01）与待发布 outbox（F03） ---------- */

  function outboxPath() { return path.join(cfg.labDir, 'scale-publish-outbox.json') }

  async function readOutbox() {
    try {
      const doc = JSON.parse(await readFile(outboxPath(), 'utf8'))
      if (!doc || !Array.isArray(doc.pending)) return { schemaVersion: 1, pending: [], lastError: null }
      return doc
    } catch {
      return { schemaVersion: 1, pending: [], lastError: null }
    }
  }

  async function writeOutbox(doc) {
    await writeFileAtomic(outboxPath(), JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }, null, 2))
  }

  /**
   * 把量表数值分数作为核心独立数据集提交：每个 (参与者, 量表, 波次, 分量表) 一行。
   * 多份提交保留全部原值；只有被核心裁决选中的 submission 才出数值，其余标 duplicate。
   */
  async function publishScores(view) {
    if (!view || !view.instanceId) return { published: 0, reason: '没有绑定实例身份' }
    const current = await model(false)
    const data = openResearchData({ study: cfg.study, instanceId: view.instanceId })
    const flow = openFlow({ data, study: cfg.study, owner: 'scale-desk' })
    const tasks = (cfg.study.tasks || []).filter(task => task && task.source && task.source.scaleId && task.source.waveId)
    const rows = []
    let unscorable = 0
    for (const task of tasks) {
      const def = current.defs.find(item => item.id === task.source.scaleId)
      const wave = String(task.source.waveId)
      if (!def || !def.waves.includes(wave)) continue
      const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
      if (!file) continue
      const visitId = (task.visits && task.visits[0]) || task.visitId || wave
      const groups = new Map()
      for (const row of file.rows || []) {
        const participant = flow.participants.resolve(row.id)
        if (!participant) continue
        const key = `${participant.participantKey}|${wave}`
        if (!groups.has(key)) groups.set(key, { participant, submissions: [] })
        groups.get(key).submissions.push(row)
      }
      for (const group of groups.values()) {
        const slot = flow.observations.effective({ participantKey: group.participant.participantKey, visitId, taskId: task.id })
        let selected = slot && slot.state === 'complete' && slot.effective && slot.effective.evidence ? (slot.effective.evidence.submissionId || null) : null
        if (!selected && group.submissions.length === 1) selected = group.submissions[0].submissionId || null
        for (const row of group.submissions) {
          const result = scoreAnswers(def, row.values)
          const chosen = Boolean(selected) && row.submissionId === selected
          for (const [subKey, sub] of Object.entries(result.subs)) {
            const scorable = ['ok', 'prorated'].includes(sub.status)
            const value = chosen && scorable ? sub.score : null
            if (value === null) unscorable += 1
            rows.push({
              participantId: row.id, participantKey: group.participant.participantKey,
              scaleId: def.id, waveId: wave, subscaleKey: subKey || 'total',
              numericValue: value,
              status: chosen ? sub.status : (group.submissions.length > 1 ? 'duplicate' : sub.status),
              reason: value === null
                ? (group.submissions.length > 1 ? '多份提交未裁决或未被选中' : (sub.status === 'incomplete' ? '未答完' : '不可计分'))
                : null,
              definitionHash: def.definitionHash || null, definitionVersion: def.version || null,
              selectedSubmissionId: selected, submissionId: row.submissionId || null,
              answered: sub.answered, missing: sub.missing, itemCount: def.itemCount,
              sourceRevision: `def:${String(def.definitionHash || '').slice(0, 8)}|sub:${row.submissionId || ''}`,
              recordedAt: new Date().toISOString(),
            })
          }
        }
      }
    }
    const result = data.commit('scores', { schemaVersion: 1, plugin: 'scale-desk', studyId: cfg.study.id, rows }, { owner: 'scale-desk', note: '量表数值分数' })
    return { published: rows.length, unscorable, revision: result.revision, contentHash: result.contentHash, unchanged: Boolean(result.unchanged) }
  }

  async function publishAll(view) {
    const observations = await publishObservations(view)
    let scores = null
    try { scores = await publishScores(view) } catch (error) { scores = { error: String(error && error.message ? error.message : error) } }
    return { observations, scores }
  }

  /** 发布失败写入 outbox；下一次成功发布时清空。补发不依赖用户记得点计分。 */
  async function attemptPublish(view, action) {
    try {
      const result = await publishAll(view)
      const outbox = await readOutbox()
      await writeOutbox({ ...outbox, pending: [], lastError: null, lastSuccessAt: new Date().toISOString(), lastAction: action })
      return { ok: true, ...result }
    } catch (error) {
      const message = String(error && error.message ? error.message : error)
      const outbox = await readOutbox()
      outbox.pending.push({ at: new Date().toISOString(), action, error: message })
      await writeOutbox({ ...outbox, lastError: message, lastAction: action })
      return { ok: false, error: message }
    }
  }

  const readActions = new Set(['status','refresh','definition','textsPreview','answer','detail','answers','suspicious','importPreview','validate','studyConfig','studyPreview','capabilities'])
  const actionNames = new Set([...Object.keys(actions), 'capabilities', 'publishRetry'])

  /** 读：按调用身份解析研究并切换插件，读期间计数，切换会被拒绝。 */
  async function runRead(actor, run) {
    return await binding.read(actor, async () => {
      activeReads += 1
      try { return await run() } finally { activeReads -= 1 }
    })
  }

  /**
   * 写：令牌与配置版本已由研究核心核对；这里只保留数据版本比较、事务日志与串行队列。
   * 保留 pendingWrites 与 writeQueue，避免两次写入交错写同一个作答文件。
   */
  async function runWrite(actor, action, payload) {
    pendingWrites += 1
    const work = writeQueue.then(async () => {
      let journal = null
      const context = cfg
      try {
        if (cfg !== context) throw new RouteError('study_mismatch', '研究已切换，请重新提交')
        invalidate()
        const marker = path.join(cfg.labDir, '.scale-study.json')
        const owner = await readJson(marker, null)
        if (owner && owner.studyId !== cfg.study.id) throw new RouteError('study_mismatch', '该数据目录已属于其他研究')
        if (!owner) await writeFileAtomic(marker, JSON.stringify({ studyId: cfg.study.id }) + '\n')
        if (payload?.expectedRevision) {
          const current = await model(true)
          if (payload.expectedRevision !== current.revision) throw new RouteError('conflict', '数据已被其他操作更改，请刷新后重试')
        }
        const journaled = !['studySave', 'studyConnect', 'reveal', 'recover'].includes(action)
        const pending = await mutationState(context)
        if (pending && action !== 'recover') throw new RouteError('recovery_required', '存在未完成写入，请先恢复事务：' + pending.id)
        if (journaled) journal = await beginMutation(context, action)
        const result = await actions[action](payload)
        if (journal) await finishMutation(context)
        lastWriteError = null
        return { ...result, revision: (await model(true)).revision }
      } catch (error) {
        let recovery = 'no-change'
        if (journal) {
          try { await rollbackMutation(context, journal); recovery = 'rolled-back' }
          catch (rollbackError) { await failMutation(context, journal, rollbackError); recovery = 'recovery-required' }
        }
        invalidate(); lastWriteError = { action, message: error.message, recovery, at: new Date().toISOString() }; throw error
      } finally { pendingWrites -= 1 }
    })
    writeQueue = work.catch(() => {})
    return work
  }

  async function dispatch(actor, action, payload = {}) {
    if (!actionNames.has(action)) throw new RouteError('unknown_action', '未知操作：' + action)
    // 能力查询：先让插件切到该身份的研究，再报告各插件是否一致。
    if (action === 'capabilities') {
      await runRead(actor, () => null)
      return { ...binding.capabilities(actor), study: cfg.study.identity }
    }
    // 显式连接研究：写页面/会话绑定并激活，不走写入令牌校验。
    if (action === 'studyConnect' || action === 'studySave') {
      if (pendingWrites > 0) throw new RouteError('busy', '正在保存作答，请完成后再切换研究')
      const result = await actions[action](payload, actor)
      return result
    }
    if (readActions.has(action)) {
      const { binding: view, data } = await runRead(actor, () => actions[action](payload))
      return { ...data, binding: view }
    }
    const expected = { token: payload.binding || payload.bindingToken, studyId: payload.studyId, studyRevision: payload.studyRevision }
    const { binding: view, data } = await binding.write(actor, expected, async resolvedView => {
      const release = config.crossProcessLock === true ? acquireWriteLock(resolvedView) : null
      try {
        if (action === 'publishRetry') return await attemptPublish(resolvedView, 'retry')
        const value = await runWrite(actor, action, payload)
        if (config.publishFlow === true && ['save','clear','answer','importApply','importFile','score','export'].includes(action)) {
          value.publish = await attemptPublish(resolvedView, action)
        }
        return value
      } finally { if (release) release() }
    })
    return { ...data, binding: view }
  }

  /**
   * 可选：写入前取数据核心的跨进程锁（默认关闭）。
   * 量表自己的 scores.csv / 作答文件不在核心事务里，这个锁补的是"两个宿主进程同时写同一研究"。
   */
  function acquireWriteLock(view) {
    const data = openResearchData({ study: cfg.study, instanceId: view.instanceId })
    try {
      const lock = data.lock('scale-desk', { owner: 'scale-desk', timeoutMs: 2000 })
      return () => { try { lock.release() } catch { /* 已释放 */ } }
    } catch (error) {
      throw new RouteError('busy', '另一个进程正在写入这个研究的量表数据，请稍后重试')
    }
  }

  const handler = async (req, res) => {
    if (!sameOrigin(req) || req.headers[HEADER] !== '1') {
      send(res, 403, { ok: false, error: { code: 'forbidden', message: '拒绝跨站访问量表计分接口' } })
      return
    }
    try {
      const url = new URL(req.url || ROUTE, 'http://localhost')
      let action
      let payload
      if (req.method === 'GET') {
        action = url.searchParams.get('action') || 'status'
        if (!actionNames.has(action)) throw new RouteError('unknown_action', '未知操作：' + action)
        if (!readActions.has(action)) throw new RouteError('method', '写操作必须使用POST')
        payload = Object.fromEntries(url.searchParams.entries())
      } else if (req.method === 'POST') {
        const body = await readBody(req)
        action = String(body.action || url.searchParams.get('action') || '')
        if (!actionNames.has(action)) throw new RouteError('unknown_action', '未知操作：' + action)
        payload = body.payload || body || {}
      } else throw new RouteError('method', '只接受 GET 与 POST')
      // 每个标签页一个 pageId（GET 用查询参数、POST 用 body）；pageActor 也会读 x-dsh-page 头。
      const actor = binding.pageActor({ req, pageId: payload?.pageId })
      const data = await dispatch(actor, action, payload)
      send(res, 200, { ok: true, data })
    } catch (error) {
      const mapped = bindingStatus(error)
      const status = mapped || (error instanceof RouteError || ['invalid_mapping', 'study_config'].includes(error.code) ? (error.code === 'not_found' ? 404 : 400) : 500)
      if (status >= 500) console.error('[scale-desk]', error)
      send(res, status, {
        ok: false,
        error: { code: error && error.code ? error.code : 'error', message: String(error && error.message ? error.message : error), details: error && error.details }
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
        async execute(args, exec) {
          // 会话身份按该会话的研究绑定解析，不读全局"当前研究"。
          const { data } = await runRead(binding.agentActor(exec), async () => {
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
          })
          return data
        }
      })

      scope.tools.register({
        name: 'scale_flow',
        description: '按施测顺序列出实验流程：每个阶段有哪些问卷、量表与任务，量表对应哪个波次、已录几份。数据来自 _lab/scales/flow.json。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: textOutput,
        async execute(args, exec) {
          const { data } = await runRead(binding.agentActor(exec), async () => {
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
          })
          return data
        }
      })

      scope.tools.register({
        name: 'scale_score',
        description: '查看量表分数。给 id 时返回该被试各量表各波次的分数、缺失题数与未计分原因；不给 id 时返回全表摘要与缺失情况。分数来自 _lab/scores，只含编号不含姓名。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '被试编号（非空字符串）；不填则看全表摘要' },
            scale: { type: 'string', description: '只看某个量表的 id，如 GARDEN' }
          },
          additionalProperties: false
        },
        output: textOutput,
        async execute(args, exec) {
          const { data } = await runRead(binding.agentActor(exec), async () => {
            const current = await model(false)
            const id = normalizeId(args && args.id)
            const only = String((args && args.scale) || '').trim()
            if (!id) return { text: scoresSummaryText(current.defs, current.scores, current.issues) }
            const subject = current.scores.rows.find(row => row.id === id)
            if (!subject) throw new Error(`没有 ${id} 的作答；先在「量表计分 → 录入」里录入，或导入问卷平台导出。`)
            const lines = [`被试 ${id} 的量表分数：`]
            for (const def of current.defs) {
              if (only && def.id !== only) continue
              for (const wave of def.waves) {
                const file = current.answerFiles.find(item => item.scale === def.id && item.wave === wave)
                const entries = file ? file.rows.filter(item => item.id === id) : []
                if (entries.length > 1) { lines.push(`${def.short}（${def.name}）${wave}：duplicate，重复作答 ${entries.length} 份，未计分；请先在核对里保留一份`); continue }
                const row = entries[0]
                if (!row) continue
                const result = scoreAnswers(def, row.values)
                lines.push(subjectScoreText(def, wave, row, result))
              }
            }
            if (lines.length === 1) lines.push('（该编号还没有任何作答记录）')
            return { text: lines.join('\n') }
          })
          return data
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
        async execute(args, exec) {
          const { data } = await runRead(binding.agentActor(exec), async () => {
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
          })
          return data
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
