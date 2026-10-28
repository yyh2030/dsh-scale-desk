/**
 * Pure-logic tests: definitions, scoring, missing data, import mapping,
 * validation. No study folders are touched.
 *
 *   node --test tests/scoring.test.mjs
 */

import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  applyImport,
  buildDetail,
  buildScores,
  detailCsv,
  wideCsv,
  guessTarget,
  headerCode,
  mapImportColumns,
  normalizeDef,
  normalizeId,
  parseItemTextTable,
  parseTable,
  parseValue,
  scoreAnswers,
  scoreColumns,
  scoresCsv,
  toCsv,
  parseCsv,
  validateData,
  validateDefinition
} from '../scoring.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

async function loadDefs() {
  const dir = path.join(HERE, '..', 'defs')
  const files = (await readdir(dir)).filter(name => name.endsWith('.json'))
  const defs = []
  for (const name of files) {
    const raw = JSON.parse(await readFile(path.join(dir, name), 'utf8'))
    defs.push(normalizeDef(raw, name.replace(/\.json$/, '')))
  }
  return defs.sort((a, b) => a.id.localeCompare(b.id))
}

const defs = await loadDefs()
const byId = id => defs.find(def => def.id === id)

function answers(count, value) {
  const out = {}
  for (let no = 1; no <= count; no += 1) out[no] = String(value)
  return out
}

test('every shipped definition is internally consistent', () => {
  assert.equal(defs.length, 26)
  const scored = defs.filter(def => def.scoring.type !== 'none')
  assert.equal(scored.length, 6, '六个计分量表')
  assert.equal(defs.filter(def => def.scoring.type === 'none').length, 20, '二十份只收集不计分的问卷')
  for (const def of defs) {
    const issues = validateDefinition(def).filter(item => item.level === 'bad')
    assert.deepEqual(issues, [], `${def.id} 定义有问题：${issues.map(item => item.text).join('；')}`)
    assert.ok(def.version.length > 0, `${def.id} 必须写版本`)
    assert.ok(Array.isArray(def.waves) && def.waves.length > 0, `${def.id} 要有波次`)
    if (def.scoring.type === 'none') {
      assert.deepEqual(Object.keys(def.scoring.subscales), [], `${def.id} 不计分，不该有计分键`)
      continue
    }
    assert.ok(Object.keys(def.codes).length > 0, `${def.id} 要有导出码`)
    for (const wave of def.waves) {
      if (def.codes[wave]) assert.equal(def.codes[wave].length, def.itemCount, `${def.id} ${wave} 导出码数量`)
    }
  }
})

test('an unscored questionnaire records answers but produces no score column', () => {
  const def = byId('BACKGROUND')
  assert.equal(def.scoring.type, 'none')
  assert.deepEqual(scoreColumns(def).map(col => col.key), ['BACKGROUND_T0_缺失', 'BACKGROUND_ts_缺失'])
  const result = scoreAnswers(def, answers(5, 4))
  assert.equal(result.answered, 5)
  assert.deepEqual(result.subs, {})
  assert.equal(result.status, 'ok')
})

test('declared ranges agree with the item count, including mean scales', () => {
  for (const def of defs) {
    const complaints = validateDefinition(def).filter(item => /声明范围/.test(item.text))
    assert.deepEqual(complaints, [], `${def.id} 取值范围自称与实际算出的不一致`)
    for (const sub of Object.values(def.scoring.subscales)) {
      assert.ok(sub.range, `${def.id}/${sub.key} 要声明范围`)
    }
  }
})

test('reverse scoring: STAI-S all 2s scores 50', () => {
  const def = byId('STAI_S')
  const result = scoreAnswers(def, answers(20, 2))
  // 10 reverse items become 3, 10 forward stay 2 => 10*3 + 10*2
  assert.equal(result.subs.anxiety.score, 50)
  assert.equal(result.subs.anxiety.status, 'ok')
  assert.equal(result.missing, 0)
})

test('missing data: prorate below the threshold refuses to score, at it prorates', () => {
  const def = byId('STAI_S')
  const values = answers(20, 2)
  delete values[3]
  delete values[4]
  delete values[5] // 17 answered, threshold 18
  const short = scoreAnswers(def, values)
  assert.equal(short.subs.anxiety.score, null)
  assert.equal(short.subs.anxiety.status, 'incomplete')
  assert.equal(short.missing, 3)

  const values2 = answers(20, 2)
  delete values2[4] // 19 answered: one missing, prorated
  const prorated = scoreAnswers(def, values2)
  // 19 answered: item 4 is forward, so sum = 10*3 + 9*2 = 48; 48/19*20
  assert.equal(prorated.subs.anxiety.score, Number(((48 / 19) * 20).toFixed(2)))
  assert.equal(prorated.subs.anxiety.status, 'prorated')
  assert.equal(prorated.subs.anxiety.missing, 1)
})

test('mean scoring: FTPS averages ten 7-point items', () => {
  const def = byId('FTPS')
  const values = { 1: '4', 2: '4', 3: '4', 4: '4', 5: '4', 6: '4', 7: '4', 8: '7', 9: '7', 10: '7' }
  const result = scoreAnswers(def, values)
  // reversed 8..10 become 1 => (7*4 + 3*1) / 10
  assert.equal(result.subs.total.score, 3.1)
  assert.equal(result.subs.total.status, 'ok')
})

test('DASS-21 multiplies subscale sums by two and keeps the total descriptive', () => {
  const def = byId('DASS_21')
  const values = answers(21, 1)
  // every item 1 => each subscale raw 7, x2 = 14; the descriptive total is the
  // raw 21-item sum (0-63), no multiplier
  const result = scoreAnswers(def, values)
  assert.equal(result.subs.stress.score, 14)
  assert.equal(result.subs.anxiety.score, 14)
  assert.equal(result.subs.depression.score, 14)
  assert.equal(result.subs.total.score, 21)
  assert.equal(result.subs.total.missing, 0)
})

test('out-of-range and unparsable values are reported, never coerced', () => {
  const def = byId('CT_DAS')
  const values = answers(15, 3)
  values[1] = '9'
  values[2] = '说不清'
  values[3] = 'N/A'
  const result = scoreAnswers(def, values)
  assert.deepEqual(result.invalid.map(item => item.no), [1, 2])
  assert.equal(result.answered, 12)
  assert.equal(parseValue(def, 'N/A').reason, 'empty')
  assert.equal(parseValue(def, '非常同意').value, 5)
})

test('text labels from an export score like numbers', () => {
  const def = byId('PANAS_NA_NOW')
  const values = {}
  for (let no = 1; no <= 9; no += 1) values[no] = '比较轻微'
  assert.equal(scoreAnswers(def, values).subs.na.score, 2)
})

test('wide score table: columns, absent rows, missing counts', () => {
  const defs2 = defs
  const rows = [
    { scale: 'FTPS', wave: 'T0', id: '11002', values: answers(10, 4) },
    { scale: 'FTPS', wave: 'T2', id: '11002', values: answers(10, 5) }
  ]
  const scores = buildScores(defs2, rows, ['11002', '11003'])
  assert.equal(scores.counts.subjects, 2)
  assert.equal(scores.counts.filled, 1)
  const col = key => scores.columns.find(item => item.key === key)
  assert.ok(col('FTPS_T0'), '单分量表列名不带分量表后缀')
  assert.ok(col('DASS_21_week_stress'))
  assert.ok(col('DASS_21_week_缺失'))
  const first = scores.rows.find(row => row.id === '11002')
  assert.equal(first.cells.FTPS_T0.value, 4)
  assert.equal(first.cells.STAI_S_T0.status, 'absent')
  const empty = scores.rows.find(row => row.id === '11003')
  assert.equal(empty.cells.FTPS_T0.status, 'absent')
  assert.equal(empty.cells.FTPS_T0.value, null)
})

test('scores.csv header follows the design contract', () => {
  const scores = buildScores(defs, [{ scale: 'FTPS', wave: 'T0', id: '11002', values: answers(10, 4) }], [])
  const csv = scoresCsv(defs, scores)
  const header = parseCsv(csv)[0]
  assert.equal(header[0], '编号')
  assert.ok(header.includes('FTPS_T0'))
  assert.ok(header.includes('CT_DAS_T0'))
  assert.ok(header.includes('DASS_21_week_depression'))
  assert.equal(header.length, scores.columns.length + 1)
})

test('detail rows keep the raw value next to the scored one', () => {
  const def = byId('STAI_S')
  const values = answers(20, 2)
  const detail = buildDetail([def], [{ scale: 'STAI_S', wave: 'T0', id: '11002', values }])
  assert.equal(detail.length, 20)
  const item1 = detail.find(row => row.no === 1)
  assert.equal(item1.raw, '2')
  assert.equal(item1.scored, 3)
  assert.equal(item1.reverse, 'reverse')
  assert.equal(item1.code, 't0_stais')
  const csv = parseCsv(detailCsv(detail))
  assert.equal(csv[0].length, 9)
})

test('import maps codes exactly, and generic Q-numbers as a fallback', () => {
  const def = byId('STAI_S')
  const header = ['t0_participant_id', ...def.codes.T0]
  const mapping = mapImportColumns(def, 'T0', header)
  assert.equal(mapping.idColumn, 't0_participant_id')
  assert.equal(mapping.matched, 20)
  assert.equal(mapping.unmatched.length, 0)

  const numeric = mapImportColumns(def, 'T0', ['编号', ...Array.from({ length: 20 }, (_, i) => `Q${i + 1}`)])
  assert.equal(numeric.matched, 20)
  assert.equal(numeric.idColumn, '编号')

  const chinese = mapImportColumns(def, 'T0', ['被试编号', ...Array.from({ length: 20 }, (_, i) => `第${i + 1}题`)])
  assert.equal(chinese.matched, 20)
})

test('import applies raw text, keeps the last duplicate, and flags bad ids', () => {
  const def = byId('FTPS')
  const header = ['编号', ...def.codes.T0]
  const row = id => [id, ...Array.from({ length: 10 }, () => '4')]
  const table = [header, row('11002'), row('11011'), row('11011')]
  const mapping = mapImportColumns(def, 'T0', header)
  const result = applyImport(def, 'T0', table, mapping)
  assert.equal(result.rows.length, 2)
  assert.ok(result.issues.some(item => /重复/.test(item.text)))
  assert.equal(result.rows[1].values[1], '4')
})

test('guessTarget picks wave and scale from the export header', () => {
  const def = byId('DASS_21')
  const guess = guessTarget(defs, ['week_participant_id', ...def.codes.week], 'export_week.csv')
  assert.equal(guess.scale, 'DASS_21')
  assert.equal(guess.wave, 'week')

  const stai = byId('STAI_S')
  const staiGuess = guessTarget(defs, ['编号', ...stai.codes.T2], '')
  assert.equal(staiGuess.scale, 'STAI_S')
  assert.equal(staiGuess.wave, 'T2')
})

test('definition validation catches a wrong declared range and a missing version', () => {
  const def = normalizeDef({
    id: 'X',
    name: '测试量表',
    itemCount: 5,
    response: { min: 1, max: 5 },
    items: [],
    scoring: { type: 'sum', subscales: { total: { items: [1, 2, 3, 4, 5], range: [5, 20] } } },
    waves: ['T0']
  })
  const texts = validateDefinition(def).map(item => item.text).join('；')
  assert.match(texts, /声明范围 5–20/)
  assert.match(texts, /没有写 version/)
})

test('data validation flags out-of-range answers and version drift', () => {
  const def = byId('CT_DAS')
  const values = answers(15, 3)
  values[2] = '8'
  const files = [{ name: 'CT_DAS__T0.csv', scale: 'CT_DAS', wave: 'T0', rows: [{ id: '11002', values }] }]
  const scores = buildScores(defs, [{ scale: 'CT_DAS', wave: 'T0', id: '11002', values }], ['11002'])
  const issues = validateData(defs, files, scores, [{ scale: 'CT_DAS', wave: 'T0', defVersion: '旧版本', at: 'x' }])
  assert.ok(issues.some(item => item.level === 'bad' && /第 2 题/.test(item.text)))
  assert.ok(issues.some(item => item.level === 'warn' && /旧版本/.test(item.text)))
})

test('csv round trip survives quotes, commas and newlines', () => {
  const rows = [['编号', '备注'], ['11002', 'a,b'], ['11003', 'he said "ok"\nnext line']]
  const parsed = parseCsv(toCsv(rows))
  assert.deepEqual(parsed[0], ['编号', '备注'])
  assert.equal(parsed[1][1], 'a,b')
  assert.equal(parsed[2][1], 'he said "ok"\nnext line')
})

test('tab and semicolon exports are detected', () => {
  assert.deepEqual(parseTable('编号\tt0_ftps_01\n11002\t4')[0], ['编号', 't0_ftps_01'])
  assert.deepEqual(parseTable('编号;t0_ftps_01\n11002;4')[1], ['11002', '4'])
})

test('scoreColumns is stable for a panel binding', () => {
  const def = byId('DASS_21')
  const columns = scoreColumns(def)
  assert.deepEqual(columns.filter(col => col.kind === 'score').map(col => col.key), [
    'DASS_21_week_stress',
    'DASS_21_week_anxiety',
    'DASS_21_week_depression',
    'DASS_21_week_total'
  ])
  assert.equal(columns.at(-1).kind, 'missing')
})

test('item text paste: numbered two-column rows', () => {
  const result = parseItemTextTable('1\t示例一\n2\t示例二\n3\t示例三', 20)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.items.map(item => item.no), [1, 2, 3])
  assert.equal(result.items[0].text, '示例一')
  assert.equal(result.numbered, true)
})

test('item text paste: plain lines fill in order, and 第N题 prefix works', () => {
  const plain = parseItemTextTable('示例一\n示例二\n示例三', 9)
  assert.deepEqual(plain.items.map(item => [item.no, item.text]), [[1, '示例一'], [2, '示例二'], [3, '示例三']])

  const prefixed = parseItemTextTable('第3题 示例三', 20)
  assert.deepEqual(prefixed.items, [{ no: 3, text: '示例三' }])
})

test('item text paste: full-width numbers, duplicates and out-of-range', () => {
  const fullWidth = parseItemTextTable('１、示例一\n２、示例二', 9)
  assert.deepEqual(fullWidth.items.map(item => item.no), [1, 2])

  const dup = parseItemTextTable('1\t甲\n1\t乙', 9)
  assert.ok(dup.issues.some(item => /重复/.test(item.text)))
  assert.deepEqual(dup.items, [{ no: 1, text: '甲' }])

  const overflow = parseItemTextTable('1\t甲\n12\t乙', 9)
  assert.ok(overflow.issues.some(item => /超出/.test(item.text)))
  assert.deepEqual(overflow.items.map(item => item.no), [1])
})

test('item text paste refuses mixed numbering instead of guessing', () => {
  const mixed = parseItemTextTable('1\t甲\n乙\n3\t丙', 9)
  assert.deepEqual(mixed.items, [])
  assert.ok(mixed.issues.some(item => item.level === 'bad' && /混在一起/.test(item.text)))
})

test('QuestionPro header: the participant column wins over Response ID', () => {
  const def = byId('FTPS')
  const header = ['Response ID', 't2_participant_id', ...def.codes.T2]
  const mapping = mapImportColumns(def, 'T2', header)
  assert.equal(mapping.idColumn, 't2_participant_id')
  assert.equal(mapping.matched, 10)
  assert.equal(mapping.unmatched.length, 0)
})

test('QuestionPro bracket codes: a repeated [t1_ftps] group maps item by item', () => {
  const def = byId('FTPS')
  const header = [
    'Response ID',
    'Respondent Email',
    '[t1_participant_id] 您的编号：（仅数字）',
    ...Array.from({ length: 10 }, (_, i) => `[t1_ftps] ${i + 1}. 题目文字`)
  ]
  assert.equal(headerCode(header[3]), 't1_ftps')
  const mapping = mapImportColumns(def, 'T1', header)
  assert.equal(mapping.idColumn, '[t1_participant_id] 您的编号：（仅数字）')
  assert.equal(mapping.matched, 10)
  assert.deepEqual(mapping.items.map(item => item.column), header.slice(3))

  const guess = guessTarget(defs, header, 'QuestionPro-SR-RawData-4114068.xlsx')
  assert.equal(guess.scale, 'FTPS')
  assert.equal(guess.wave, 'T1')
})

test('a shared code is not stolen from the id column', () => {
  const def = byId('BODY_STATE')
  const header = [
    '[Q4] 您的编号：（仅数字）',
    '[Q4] 在过去一年中，您的饮酒频率为：',
    '[Q5] 在过去一年中，您的吸烟频率为：',
    '[Q6] 您的戒烟时长为：',
    '[Q7] 您目前吸烟的频率为：',
    '[Q8] 咖啡因摄入频率：',
    '[Q9] 运动频率：',
    '[Q10] 饮食规律性：',
    '[Q11] 睡眠质量：',
    '[Q12] 是否在服用药物或补剂：',
    '[Q13] 请填写具体类型或药物名称：'
  ]
  const mapping = mapImportColumns(def, 'ts', header)
  assert.equal(mapping.idColumn, header[0])
  assert.equal(mapping.items[0].column, header[1], 'Q4 appears twice; the item takes the second one')
})

test('numeric ids coming out of Excel lose the .0 suffix', () => {
  assert.equal(normalizeId('11002.0'), '11002')
  assert.equal(normalizeId(11002), '11002')
  assert.equal(normalizeId('21001'), '21001')
})

test('choice and text items keep raw answers without scoring', () => {
  const def = byId('BODY_STATE')
  const result = scoreAnswers(def, {
    1: '3',
    2: '2',
    5: '1',
    6: '2',
    7: '4',
    8: '5',
    9: '2',
    10: '维生素D 1000IU'
  })
  assert.equal(result.answered, 8)
  assert.equal(result.missing, 2)
  const text = result.items.find(item => item.no === 10)
  assert.equal(text.value, '维生素D 1000IU')
  assert.equal(text.scored, null)
  const choice = result.items.find(item => item.no === 2)
  assert.equal(choice.value, '2')
  assert.equal(choice.scored, null)
  assert.deepEqual(result.invalid, [])
})

test('a choice value outside its options is flagged, not stored', () => {
  const def = byId('BODY_STATE')
  const result = scoreAnswers(def, { 2: 'Z' })
  const item = result.items.find(entry => entry.no === 2)
  assert.equal(item.value, null)
  assert.equal(item.reason, 'unparsed')
  assert.equal(result.answered, 0)
})

test('number items use their own bounds, including decimals', () => {
  const def = byId('CRT')
  const ok = scoreAnswers(def, { 1: '0.05', 2: '5', 3: '24', 4: '2' })
  assert.equal(ok.answered, 4)
  assert.equal(ok.items.find(item => item.no === 1).value, 0.05)
  assert.deepEqual(ok.invalid, [])

  const out = scoreAnswers(def, { 1: '99' })
  assert.equal(out.invalid[0].reason, 'range')
  assert.equal(out.answered, 0)
})

test('multi choice joins the selected values', () => {
  const def = byId('SUPPORT')
  const result = scoreAnswers(def, { 1: '私下交谈, 获取校内心理支持信息' })
  assert.equal(result.items[0].value, '私下交谈,获取校内心理支持信息')
  assert.equal(result.answered, 1)
})

test('a duplicated id is flagged and never scored until one copy is kept', () => {
  const rows = [
    { scale: 'FTPS', wave: 'T0', id: '11002', values: answers(10, 4) },
    { scale: 'FTPS', wave: 'T0', id: '11002', values: answers(10, 5) }
  ]
  const scores = buildScores(defs, rows, [])
  const cell = scores.rows[0].cells.FTPS_T0
  assert.equal(cell.status, 'duplicate')
  assert.equal(cell.value, null)
  assert.ok(scores.rows[0].flags.some(text => /有 2 份作答/.test(text)))
  assert.equal(scores.counts.complete, 0)
})

test('wide csv puts scale scores and every raw item answer side by side', () => {
  const rows = [{ scale: 'FTPS', wave: 'T0', id: '11002', values: answers(10, 4) }]
  const scores = buildScores(defs, rows, [])
  const table = parseCsv(wideCsv(defs, scores, rows))
  const header = table[0]
  assert.ok(header.includes('FTPS_T0'))
  assert.ok(header.includes('FTPS_T0_q01'))
  assert.ok(header.includes('CT_DAS_T0_q01'))
  assert.equal(table[1][header.indexOf('FTPS_T0')], '4')
  assert.equal(table[1][header.indexOf('FTPS_T0_q01')], '4')
  assert.equal(table[1][header.indexOf('STAI_S_T0_q01')], '')
})
