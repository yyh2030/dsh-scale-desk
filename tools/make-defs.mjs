/**
 * Generate defs/*.json from the compact specs below.
 *
 * The specs mirror 02_实验材料与问卷/量表计分与来源.docx and the QuestionPro
 * export maps in 02_实验材料与问卷/questionpro/_build_specs/*.json. Item texts
 * are deliberately absent: the definitions carry item numbers, reverse marks,
 * scoring keys and codes only, so题目文本 never enters the plugin repo.
 *
 *   node tools/make-defs.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'defs')

const LIKERT_7 = {
  1: '完全不正确',
  2: '比较不正确',
  3: '有一点不正确',
  4: '不确定',
  5: '有一点正确',
  6: '比较正确',
  7: '完全正确'
}

const LIKERT_5_PANAS = {
  1: '非常轻微或根本没有',
  2: '比较轻微',
  3: '中等程度',
  4: '比较强烈',
  5: '非常强烈'
}

const LIKERT_4_STAI = { 1: '完全没有', 2: '有些', 3: '中等程度', 4: '非常明显' }

const LIKERT_5_DAS = { 1: '非常不同意', 2: '比较不同意', 3: '不确定', 4: '比较同意', 5: '非常同意' }

const DASS_4 = { 0: '不符合', 1: '有时符合', 2: '常常符合', 3: '总是符合' }

function codes(prefix, count) {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`)
}

function items(count, reverse = []) {
  const set = new Set(reverse)
  return Array.from({ length: count }, (_, i) => ({ no: i + 1, text: '', reverse: set.has(i + 1) }))
}

const NO_TEXT_NOTE = '题目文本不入库：定义只存题号、反向标记、计分键与导出码。'

const specs = [
  {
    schema: 1,
    id: 'FTPS',
    name: '未来时间洞察力量表',
    short: 'FTPS',
    version: '10 题版；中文版来源待核',
    waves: ['T0', 'T1', 'T2'],
    itemCount: 10,
    response: { min: 1, max: 7, labels: LIKERT_7 },
    items: items(10, [8, 9, 10]),
    scoring: {
      type: 'mean',
      subscales: {
        total: { label: '总分', items: Array.from({ length: 10 }, (_, i) => i + 1), reverse: [8, 9, 10], range: [1, 7], multiplier: 1 }
      }
    },
    missing: { rule: 'prorate', minAnswered: 8 },
    codes: { T0: codes('t0_ftps_', 10), T1: codes('t1_ftps_', 10), T2: codes('t2_ftps_', 10) },
    unit: '分',
    decimals: 2,
    source: '量表计分与来源.docx M04；原版出处待核',
    license: NO_TEXT_NOTE,
    notes: '第 8、9、10 题反向计分；以 10 题平均分为主指标，得分越高表示主观未来越开放、可规划时间越充足。三个波次同一量表，列名按波次分开。'
  },
  {
    schema: 1,
    id: 'PANAS_NA_NOW',
    name: 'PANAS 负性情绪分量表（此刻版）',
    short: 'PANAS-NA·此刻',
    version: '邱林、郑雪、王雁飞（2008）修订，9 题 NA 分量表；此刻指导语',
    waves: ['T0', 'T2'],
    itemCount: 9,
    response: { min: 1, max: 5, labels: LIKERT_5_PANAS },
    items: items(9),
    scoring: {
      type: 'mean',
      subscales: {
        na: { label: '负性情绪', items: Array.from({ length: 9 }, (_, i) => i + 1), reverse: [], range: [1, 5], multiplier: 1 }
      }
    },
    missing: { rule: 'prorate', minAnswered: 7 },
    codes: { T0: codes('t0_na_', 9), T2: codes('t2_na_', 9) },
    unit: '分',
    decimals: 2,
    source: '量表计分与来源.docx M05；邱林、郑雪、王雁飞（2008），N=290，α: PA .87/.87、NA .84/.86',
    license: NO_TEXT_NOTE,
    notes: '9 项均正向计分，取平均分，范围 1–5。此刻版与过去一周版是两个量表（PANAS_NA_WEEK），分数不可混用。'
  },
  {
    schema: 1,
    id: 'PANAS_NA_WEEK',
    name: 'PANAS 负性情绪分量表（过去一周版）',
    short: 'PANAS-NA·周',
    version: '邱林、郑雪、王雁飞（2008）修订，9 题 NA 分量表；过去一周指导语',
    waves: ['week'],
    itemCount: 9,
    response: { min: 1, max: 5, labels: LIKERT_5_PANAS },
    items: items(9),
    scoring: {
      type: 'mean',
      subscales: {
        na: { label: '负性情绪', items: Array.from({ length: 9 }, (_, i) => i + 1), reverse: [], range: [1, 5], multiplier: 1 }
      }
    },
    missing: { rule: 'prorate', minAnswered: 7 },
    codes: { week: codes('week_na_', 9) },
    unit: '分',
    decimals: 2,
    source: '量表计分与来源.docx M19；邱林等（2008）',
    license: NO_TEXT_NOTE,
    notes: '过去一周指导语。与 PANAS_NA_NOW 的分值不可比，故独立成量表。'
  },
  {
    schema: 1,
    id: 'STAI_S',
    name: '状态焦虑量表（STAI-Y S-AI）',
    short: 'STAI-S',
    version: 'Spielberger 1983，S-AI 20 题；中文版来源待核',
    waves: ['T0', 'T2'],
    itemCount: 20,
    response: { min: 1, max: 4, labels: LIKERT_4_STAI },
    items: items(20, [1, 2, 5, 8, 10, 11, 15, 16, 19, 20]),
    scoring: {
      type: 'sum',
      subscales: {
        anxiety: { label: '状态焦虑', items: Array.from({ length: 20 }, (_, i) => i + 1), reverse: [1, 2, 5, 8, 10, 11, 15, 16, 19, 20], range: [20, 80], multiplier: 1 }
      }
    },
    missing: { rule: 'prorate', minAnswered: 18 },
    codes: { T0: codes('t0_stais_', 20), T2: codes('t2_stais_', 20) },
    unit: '分',
    decimals: 2,
    source: '量表计分与来源.docx M06；Spielberger（1983）',
    license: NO_TEXT_NOTE,
    notes: '反向题：第 1、2、5、8、10、11、15、16、19、20 题。S-AI 总分为 20 题累加，范围 20–80。'
  },
  {
    schema: 1,
    id: 'CT_DAS',
    name: '中文版 Templer 死亡焦虑量表',
    short: 'CT-DAS',
    version: 'Templer（1970）；Yang et al.（2012）中文版，15 题',
    waves: ['T0'],
    itemCount: 15,
    response: { min: 1, max: 5, labels: LIKERT_5_DAS },
    items: items(15, [2, 3, 5, 6, 7, 15]),
    scoring: {
      type: 'sum',
      subscales: {
        total: { label: '死亡焦虑', items: Array.from({ length: 15 }, (_, i) => i + 1), reverse: [2, 3, 5, 6, 7, 15], range: [15, 75], multiplier: 1 }
      }
    },
    missing: { rule: 'prorate', minAnswered: 12 },
    codes: { T0: codes('t0_ctdas_', 15) },
    unit: '分',
    decimals: 2,
    source: '量表计分与来源.docx M13；Templer（1970）；Yang et al.（2012）中文版 α=.71、重测 .831',
    license: NO_TEXT_NOTE,
    notes: '反向题：第 2、3、5、6、7、15 题。15 项相加，范围 15–75，分数越高死亡焦虑越高。'
  },
  {
    schema: 1,
    id: 'DASS_21',
    name: '抑郁—焦虑—压力量表简版',
    short: 'DASS-21',
    version: 'Lovibond & Lovibond（1995）；龚栩等（2010）中文版，21 题',
    waves: ['week'],
    itemCount: 21,
    response: { min: 0, max: 3, labels: DASS_4 },
    items: items(21),
    scoring: {
      type: 'sum',
      subscales: {
        stress: { label: '压力', items: [1, 6, 8, 11, 12, 14, 18], reverse: [], range: [0, 42], multiplier: 2, minAnswered: 6 },
        anxiety: { label: '焦虑', items: [2, 4, 7, 9, 15, 19, 20], reverse: [], range: [0, 42], multiplier: 2, minAnswered: 6 },
        depression: { label: '抑郁', items: [3, 5, 10, 13, 16, 17, 21], reverse: [], range: [0, 42], multiplier: 2, minAnswered: 6 },
        total: { label: '总分（描述性）', items: Array.from({ length: 21 }, (_, i) => i + 1), reverse: [], range: [0, 63], multiplier: 1, aggregate: true, descriptive: true, minAnswered: 18 }
      }
    },
    missing: { rule: 'prorate', minAnswered: 6 },
    codes: { week: codes('week_dass_', 21) },
    unit: '分',
    decimals: 2,
    source: '量表计分与来源.docx M20；Lovibond & Lovibond（1995）；龚栩等（2010）N=1779，α=.77/.79/.76，总量表 .89',
    license: NO_TEXT_NOTE,
    notes: '压力/焦虑/抑郁各 7 项原始和（0–21）×2，得 0–42 分；总分是 21 项原始和（0–63），只作描述性指标，重点报告三个分量表。'
  }
]

await mkdir(OUT, { recursive: true })
for (const spec of specs) {
  const file = path.join(OUT, `${spec.id}.json`)
  await writeFile(file, JSON.stringify(spec, null, 2) + '\n', 'utf8')
  console.log('wrote', path.relative(process.cwd(), file))
}
