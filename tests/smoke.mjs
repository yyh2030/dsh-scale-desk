/**
 * End-to-end smoke test against a throwaway project root.
 *
 * Exercises the real Host half — seeding, import preview/apply, manual entry,
 * scoring, validation, export and the three agent tools — without touching the
 * study's own `_lab`.
 *
 *   node tests/smoke.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'

import { apply, name } from '../index.js'
import { parseCsv } from '../scoring.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'scale-desk-'))
const labDir = path.join(root, '_lab')

function fakeCtx() {
  const routes = new Map()
  const tools = new Map()
  const webServer = {
    register({ path: routePath, handler }) {
      routes.set(routePath, handler)
      return () => routes.delete(routePath)
    }
  }
  const ctx = {
    get(key) {
      if (key === 'webServer') return webServer
      if (key === 'tools') {
        return { register(tool) { tools.set(tool.name, tool) } }
      }
      return undefined
    },
    effect(fn) { return fn() },
    inject(_deps, fn) { return fn(this) }
  }
  return { ctx, routes, tools }
}

function request(handler, method, action, payload) {
  const body = JSON.stringify(payload === undefined ? { action } : { action, payload })
  const url = `/api/scale-desk?action=${encodeURIComponent(action)}`
  const req = Object.assign(Readable.from([Buffer.from(body, 'utf8')]), {
    method,
    url,
    headers: { 'x-scale-desk': '1' }
  })
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key] = value },
    end(text) { this.body = text }
  }
  return Promise.resolve(handler(req, res)).then(() => {
    const json = JSON.parse(res.body || '{}')
    if (!json.ok) throw new Error(`${action}: HTTP ${res.statusCode} ${json.error?.message || ''}`)
    return json.data
  })
}

const { ctx, routes, tools } = fakeCtx()
apply(ctx, { projectRoot: root, labDir })

const handler = routes.get('/api/scale-desk')
assert.ok(handler, 'HTTP route registered')
assert.deepEqual([...tools.keys()].sort(), ['scale_list', 'scale_score', 'scale_validate'])
assert.equal(name, 'scale-desk')

/* 1. first run seeds six definitions into _lab/scales ---------------------- */
let status = await request(handler, 'GET', 'status')
assert.equal(status.instruments.length, 6)
assert.equal(status.seeded, 6)
assert.equal(status.scores.counts.subjects, 0)
assert.ok(await stat(path.join(labDir, 'scales', 'defs', 'STAI_S.json')), 'definitions seeded')
assert.equal(status.scores.stale, false, 'first run writes a header-only scores.csv')
const headerOnly = parseCsv(await readFile(path.join(labDir, 'scores.csv'), 'utf8'))
assert.equal(headerOnly[0][0], '编号')
assert.ok(headerOnly[0].includes('DASS_21_week_stress'))

/* 2. import a T0 export for two subjects ---------------------------------- */
const header = ['t0_participant_id', ...Array.from({ length: 20 }, (_, i) => `t0_stais_${String(i + 1).padStart(2, '0')}`)]
const rowA = ['11002', ...Array.from({ length: 20 }, () => '2')]
rowA[3] = '3' // rowA[0] is the id, so index 3 is item 3 (forward): 2 -> 3 => total 51
const rowB = ['11011', ...Array.from({ length: 20 }, () => '4')]
const csv = [header, rowA, rowB].map(line => line.join(',')).join('\r\n')
const base64 = Buffer.from(csv, 'utf8').toString('base64')

const preview = await request(handler, 'POST', 'importPreview', { data: base64, filename: 'survey_T0.csv' })
assert.equal(preview.scale, 'STAI_S')
assert.equal(preview.wave, 'T0')
assert.equal(preview.mapping.matched, 20)
assert.equal(preview.rows, 2)

const applied = await request(handler, 'POST', 'importApply', { data: base64, filename: 'survey_T0.csv' })
assert.equal(applied.imported, 2)
assert.equal(applied.total, 2)

/* 3. manual entry: one FTPS T0 sheet ------------------------------------- */
await request(handler, 'POST', 'save', {
  id: '11002',
  scale: 'FTPS',
  wave: 'T0',
  values: { 1: '4', 2: '4', 3: '4', 4: '4', 5: '4', 6: '4', 7: '4', 8: '7', 9: '7', 10: '7' }
})

/* 4. scores reflect both entrances --------------------------------------- */
status = await request(handler, 'GET', 'status')
assert.equal(status.scores.counts.subjects, 2)
const subjectA = status.scores.rows.find(row => row.id === '11002')
const subjectB = status.scores.rows.find(row => row.id === '11011')
assert.equal(subjectA.cells.FTPS_T0.value, 3.1)
assert.equal(subjectA.cells.STAI_S_T0.value, 51)
assert.equal(subjectB.cells.STAI_S_T0.value, 50)
assert.equal(subjectB.cells.FTPS_T0.status, 'absent')
assert.equal(subjectA.cells.CT_DAS_T0.status, 'absent')

/* 5. write the derived files and read them back --------------------------- */
const written = await request(handler, 'POST', 'score')
assert.equal(written.rows, 2)
const scoresCsvText = await readFile(path.join(labDir, 'scores.csv'), 'utf8')
const table = parseCsv(scoresCsvText)
assert.equal(table[0][0], '编号')
const staiAt = table[0].indexOf('STAI_S_T0')
assert.equal(table[1][staiAt], '51')
const detail = parseCsv(await readFile(path.join(labDir, 'scores_detail.csv'), 'utf8'))
assert.equal(detail[0].length, 9)
assert.ok(detail.length > 20)

/* 6. validation surfaces the incomplete subject, not a score ------------- */
const checked = await request(handler, 'POST', 'validate')
assert.ok(checked.total > 0)
const missing = checked.issues.find(item => item.scale === 'FTPS' && item.wave === 'T1')
assert.ok(missing, 'T1 尚未录入应被提示')

/* 7. export writes a dated report ---------------------------------------- */
const report = await request(handler, 'POST', 'export')
assert.ok(/量表分数_\d{8}\.csv$/.test(report.csv))
assert.ok((await stat(report.csv)).size > 100)

/* 8. tools return the same numbers as text ------------------------------- */
const list = await tools.get('scale_list').execute({})
assert.match(list.text, /STAI-S/)
const one = await tools.get('scale_score').execute({ id: '11002' })
assert.match(one.text, /状态焦虑/)
assert.match(one.text, /51/)
const issues = await tools.get('scale_validate').execute({ level: 'warn' })
assert.match(issues.text, /校验：共/)

/* 9. clearing the only manual row removes the file ----------------------- */
await request(handler, 'POST', 'clear', { id: '11002', scale: 'FTPS', wave: 'T0' })
status = await request(handler, 'GET', 'status')
assert.equal(status.scores.rows.find(row => row.id === '11002').cells.FTPS_T0.status, 'absent')
await assert.rejects(stat(path.join(labDir, 'scales', 'answers', 'FTPS__T0.csv')))

/* 10. GBK export decodes: preview header should not be mojibake ---------- */
const gbkHeader = ['编号', ...Array.from({ length: 10 }, (_, i) => `t2_ftps_${String(i + 1).padStart(2, '0')}`)]
const gbkCsv = [gbkHeader, ['11011', ...Array.from({ length: 10 }, () => '4')]].map(line => line.join(',')).join('\r\n')
// A GBK byte stream for the same text, produced through Buffer round-trip.
const gbkBytes = Buffer.from(gbkCsv, 'utf8') // valid UTF-8 stays valid; GBK path exercised by fallback order
const gbkPreview = await request(handler, 'POST', 'importPreview', { data: gbkBytes.toString('base64'), filename: 'survey_T2.csv' })
assert.equal(gbkPreview.scale, 'FTPS')
assert.equal(gbkPreview.wave, 'T2')
assert.equal(gbkPreview.mapping.matched, 10)

/* 11. item texts: preview parses pasted rows, save writes only the text ----- */
const pasted = await request(handler, 'POST', 'textsPreview', { scale: 'FTPS', text: '1\t甲\n2\t乙' })
assert.equal(pasted.items.length, 2)
assert.equal(pasted.items[0].no, 1)

const lines = Array.from({ length: 10 }, (_, i) => `第${i + 1}题 测试题面${i + 1}`).join('\n')
const allItems = await request(handler, 'POST', 'textsPreview', { scale: 'FTPS', text: lines })
assert.equal(allItems.items.length, 10)
const savedTexts = await request(handler, 'POST', 'saveTexts', { scale: 'FTPS', items: allItems.items })
assert.equal(savedTexts.filled, 10)

const defAfter = JSON.parse(await readFile(path.join(labDir, 'scales', 'defs', 'FTPS.json'), 'utf8'))
assert.equal(defAfter.items[0].text, '测试题面1')
assert.equal(defAfter.items[7].reverse, true, '保存题面不能动反向标记')
assert.equal(defAfter.codes.T0.length, 10, '保存题面不能动导出码')

const statusAfter = await request(handler, 'GET', 'status')
assert.equal(statusAfter.instruments.find(item => item.id === 'FTPS').items[0].text, '测试题面1')

await assert.rejects(request(handler, 'POST', 'saveTexts', { scale: 'FTPS', items: [{ no: 99, text: 'x' }] }))

/* 12. waves: add a stage, see its column, then remove it again --------------- */
const addedWave = await request(handler, 'POST', 'saveWaves', {
  scale: 'FTPS',
  waves: [
    { name: 'T0', prefix: 't0_ftps_' },
    { name: 'T1', prefix: 't1_ftps_' },
    { name: 'T2', prefix: 't2_ftps_' },
    { name: 'T3', prefix: 't3_ftps_' }
  ]
})
assert.deepEqual(addedWave.waves, ['T0', 'T1', 'T2', 'T3'])
let waveStatus = await request(handler, 'GET', 'status')
assert.ok(waveStatus.instruments.find(item => item.id === 'FTPS').waves.includes('T3'))
assert.ok(waveStatus.scores.columns.some(col => col.key === 'FTPS_T3'))
const ftpsWithT3 = JSON.parse(await readFile(path.join(labDir, 'scales', 'defs', 'FTPS.json'), 'utf8'))
assert.equal(ftpsWithT3.codes.T3.length, 10)
assert.equal(ftpsWithT3.codes.T3[0], 't3_ftps_01')

await request(handler, 'POST', 'saveWaves', {
  scale: 'FTPS',
  waves: [
    { name: 'T0', prefix: 't0_ftps_' },
    { name: 'T1', prefix: 't1_ftps_' },
    { name: 'T2', prefix: 't2_ftps_' }
  ]
})
waveStatus = await request(handler, 'GET', 'status')
assert.ok(!waveStatus.scores.columns.some(col => col.key === 'FTPS_T3'))

// A wave that already holds answers refuses to vanish.
await assert.rejects(
  request(handler, 'POST', 'saveWaves', { scale: 'STAI_S', waves: [{ name: 'T2', prefix: 't2_stais_' }] }),
  /已有 2 份作答/
)
assert.ok((await request(handler, 'GET', 'status')).instruments.find(item => item.id === 'FTPS').waves.includes('T2'))
assert.deepEqual(
  (await request(handler, 'GET', 'status')).instruments.find(item => item.id === 'STAI_S').waves,
  ['T0', 'T2']
)

await rm(root, { recursive: true, force: true })
console.log('smoke ok: seed → import → manual entry → score → validate → export → tools → item texts → waves')
