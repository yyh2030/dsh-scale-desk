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
    waves: ['T0', 'T1'],
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

/* ------------------------------------------------------------------ *
 * 其余问卷：只收集作答，不计分（scoring.type = none）
 * ------------------------------------------------------------------ */

const UNSCORED_NOTE = '自编/修订问卷，按文档原题录入；本插件只存作答，不计算分数。'
const AGREE = { 1: '完全不同意', 2: '比较不同意', 3: '不确定', 4: '比较同意', 5: '完全同意' }
const AGREE_STRONG = { 1: '非常不认同', 2: '比较不认同', 3: '不确定', 4: '比较认同', 5: '非常认同' }
const LIKE_ME = { 1: '一点也不像我', 2: '比较不像我', 3: '不确定', 4: '比较像我', 5: '非常像我' }
const FREQ_4 = { 0: '完全没有', 1: '偶尔/几天', 2: '超过一半时间', 3: '经常/几乎每天' }
const RARELY = { 1: '从不', 2: '偶尔', 3: '有时', 4: '总是' }
const FIT = { 1: '非常不符合', 2: '比较不符合', 3: '不确定', 4: '比较符合', 5: '非常符合' }

function unscored(spec) {
  return {
    schema: 1,
    unit: '分',
    decimals: 2,
    items: items(spec.itemCount),
    scoring: { type: 'none' },
    missing: { rule: 'prorate', minAnswered: spec.itemCount },
    codes: {},
    source: '实验问卷题目整理.docx',
    license: NO_TEXT_NOTE,
    notes: UNSCORED_NOTE,
    ...spec
  }
}

specs.push(
  unscored({
    id: 'BACKGROUND',
    name: 'Distracting · 总体状态',
    short: '总体状态',
    version: '自编（实验问卷题目整理）',
    waves: ['T0'],
    itemCount: 5,
    response: { min: 1, max: 5, labels: AGREE_STRONG },
    notes: '家庭经济、储蓄、时间规划、决策时的时间/金钱优先。不计分。'
  }),
  unscored({
    id: 'TIME_PERCEPTION',
    name: 'Distracting · 时间感受',
    short: '时间感受',
    version: '自编（实验问卷题目整理）',
    waves: ['T0'],
    itemCount: 6,
    response: { min: 1, max: 5, labels: LIKE_ME },
    notes: '时间紧张与碎片化的主观感受。不计分。'
  }),
  unscored({
    id: 'MOOD_CHECK',
    name: 'Distracting · 情绪状态补充',
    short: '情绪补充',
    version: '自编（实验问卷题目整理）',
    waves: ['T0'],
    itemCount: 4,
    response: { min: 0, max: 3, labels: FREQ_4 },
    notes: '过去两周：情绪低落、兴趣减退、紧张、无法停止担心。不计分。'
  }),
  unscored({
    id: 'IMAGERY_APPRAISAL',
    name: '想象／回忆过程评价表',
    short: '想象评价',
    version: '自编（实验问卷题目整理）',
    waves: ['imagery'],
    itemCount: 10,
    response: { min: 1, max: 7, labels: {} },
    notes: '完成想象/回忆后立刻评定，7 点（1–7）；各题锚点不同，题面里自带。不计分。'
  }),
  unscored({
    id: 'AI_META_RATE',
    name: 'AI 建议使用与采纳比例',
    short: 'AI·比例',
    version: '自编（实验问卷题目整理）',
    waves: ['meta'],
    itemCount: 2,
    response: { min: 0, max: 100, labels: {} },
    notes: '两题滑动框 0–100%：估计询问 AI 的比例、采纳的比例。不计分。'
  }),
  unscored({
    id: 'AI_META_INFLUENCE',
    name: 'AI 建议的影响',
    short: 'AI·影响',
    version: '自编（实验问卷题目整理）',
    waves: ['meta'],
    itemCount: 4,
    response: { min: 1, max: 5, labels: AGREE },
    notes: 'AI 建议对选择的影响、偏好表达与主导感。不计分。'
  }),
  unscored({
    id: 'AI_META_EVALUATION',
    name: 'AI 建议评价',
    short: 'AI·评价',
    version: '自编（实验问卷题目整理）',
    waves: ['meta'],
    itemCount: 7,
    response: { min: 1, max: 5, labels: AGREE },
    notes: '第 6、7 题是方向性锚点（1 = 明显偏向今天，5 = 明显偏向未来），题面里注明；前 5 题与后 2 题不要直接相加。不计分。'
  }),
  unscored({
    id: 'AI_META_RESISTANCE',
    name: 'AI 建议的回避与反抗',
    short: 'AI·反抗',
    version: '自编（实验问卷题目整理）',
    waves: ['meta'],
    itemCount: 3,
    response: { min: 1, max: 5, labels: AGREE },
    notes: '故意不看、有意不采纳、认为没必要。不计分。'
  }),
  unscored({
    id: 'AI_META_AFFECT',
    name: '决策后即时情绪',
    short: 'AI·情绪',
    version: '自编（实验问卷题目整理）',
    waves: ['meta'],
    itemCount: 3,
    response: { min: 1, max: 5, labels: {} },
    notes: '效价、唤醒、疲惫各一道，锚点不同（见题面），不能相加。不计分。'
  }),
  unscored({
    id: 'AI_USE_MONEY',
    name: '金钱选择中的 AI 态度',
    short: 'AI·金钱',
    version: '自编（实验问卷题目整理）',
    waves: ['post'],
    itemCount: 4,
    response: { min: 1, max: 5, labels: AGREE },
    notes: '必须放在决策任务之后。不计分。'
  }),
  unscored({
    id: 'AI_USE_HABIT',
    name: 'AI 工具使用习惯与看法',
    short: 'AI·习惯',
    version: '自编（实验问卷题目整理）',
    waves: ['post'],
    itemCount: 11,
    response: { min: 1, max: 5, labels: AGREE },
    notes: '日常使用习惯与总体评价。不计分。'
  }),
  unscored({
    id: 'AI_USE_HELP',
    name: '遇事询问 AI 的习惯',
    short: 'AI·求助',
    version: '自编（实验问卷题目整理）',
    waves: ['post'],
    itemCount: 4,
    response: { min: 1, max: 5, labels: AGREE },
    notes: '面对困难/选择时的求助倾向。不计分。'
  }),
  unscored({
    id: 'IMPULSIVITY',
    name: '冲动性量表（极简）',
    short: '冲动性',
    version: '极简版（实验问卷题目整理）',
    waves: ['post'],
    itemCount: 8,
    response: { min: 1, max: 4, labels: RARELY },
    notes: '第 1、4、5、6 题为正性表述，2、3、7、8 为冲动性表述；原文档未给反向计分规则，故不计分。'
  }),
  unscored({
    id: 'NFC',
    name: '认知需求量表',
    short: '认知需求',
    version: '实验问卷题目整理',
    waves: ['post'],
    itemCount: 18,
    response: { min: 1, max: 5, labels: FIT },
    notes: '原文档未给反向计分规则，故不计分；若后续要算总分，先确认反向题号。'
  }),
  unscored({
    id: 'DISCOMFORT',
    name: '当前不适评分',
    short: '不适评分',
    version: '自编（实验问卷题目整理）',
    waves: ['end', 'week'],
    itemCount: 1,
    response: { min: 0, max: 100, labels: {} },
    notes: '0–100 单题，结束与一周随访各一次。不计分。'
  })
)

/* ------------------------------------------------------------------ *
 * 非量表题：选择题、数值题、文本题，答案按原文存
 * ------------------------------------------------------------------ */

const FREQ_YEAR = [
  { value: '1', label: '从不' },
  { value: '2', label: '偶尔（每月不到1次）' },
  { value: '3', label: '有时（每月1-3次）' },
  { value: '4', label: '经常（每周1-3次）' },
  { value: '5', label: '频繁（每周4次及以上）' }
]
const CAFFEINE = [
  { value: '1', label: '从不' },
  { value: '2', label: '偶尔（每周1~2杯）' },
  { value: '3', label: '有时（每周3~6杯）' },
  { value: '4', label: '经常（每天1杯）' },
  { value: '5', label: '频繁（每天2杯及以上）' }
]
const EXERCISE = [
  { value: '1', label: '完全没有（0天）' },
  { value: '2', label: '很少（1-2天）' },
  { value: '3', label: '有时（3-5天）' },
  { value: '4', label: '经常（6-9天）' },
  { value: '5', label: '几乎每天（10天或以上）' }
]
const DIET = [
  { value: '1', label: '非常不规律' },
  { value: '2', label: '比较不规律' },
  { value: '3', label: '不确定' },
  { value: '4', label: '比较规律' },
  { value: '5', label: '非常规律' }
]
const SLEEP = [
  { value: '1', label: '非常差' },
  { value: '2', label: '比较差' },
  { value: '3', label: '一般' },
  { value: '4', label: '比较好' },
  { value: '5', label: '非常好' }
]
const QUIT_DURATION = [
  { value: '1', label: '最近（不到1个月）' },
  { value: '2', label: '1 ~ 3个月' },
  { value: '3', label: '3~6个月' },
  { value: '4', label: '半年-1年' },
  { value: '5', label: '一年以上' }
]
const SMOKE_NOW = [
  { value: '1', label: '偶尔（几周1包）' },
  { value: '2', label: '有时（几天1包）' },
  { value: '3', label: '比较频繁（每天半包左右）' },
  { value: '4', label: '经常（每天约1包）' },
  { value: '5', label: '非常频繁（每天1包以上）' }
]

specs.push(
  unscored({
    id: 'BODY_STATE',
    name: 'Distracting · 身体状态',
    short: '身体状态',
    version: '自编（实验问卷题目整理）',
    waves: ['T0'],
    itemCount: 10,
    response: { min: 1, max: 5, labels: {} },
    items: [
      { no: 1, kind: 'choice', text: '', options: FREQ_YEAR },
      { no: 2, kind: 'choice', text: '', options: [{ value: 'A', label: '从未吸烟' }, { value: 'B', label: '已戒烟' }, { value: 'C', label: '正在吸烟' }] },
      { no: 3, kind: 'choice', text: '', options: QUIT_DURATION },
      { no: 4, kind: 'choice', text: '', options: SMOKE_NOW },
      { no: 5, kind: 'choice', text: '', options: CAFFEINE },
      { no: 6, kind: 'choice', text: '', options: EXERCISE },
      { no: 7, kind: 'choice', text: '', options: DIET },
      { no: 8, kind: 'choice', text: '', options: SLEEP },
      { no: 9, kind: 'choice', text: '', options: [{ value: 'A', label: '否，目前未服用任何药物或补剂' }, { value: 'B', label: '是，目前正在服用' }] },
      { no: 10, kind: 'text', text: '', maxLength: 300 }
    ],
    notes: '第 1–4 题问过去一年，第 5–8 题问最近两周；第 3、4 题按吸烟状态二选一填写；第 10 题填药物或补剂名称。答案按选项编号或原文保存。'
  }),
  unscored({
    id: 'CRT',
    name: '认知反思测试（三道数学题）',
    short: '数学题',
    version: '实验问卷题目整理',
    waves: ['post'],
    itemCount: 4,
    response: { min: 0, max: 1000, labels: {} },
    items: [
      { no: 1, kind: 'number', text: '', min: 0, max: 10 },
      { no: 2, kind: 'number', text: '', min: 0, max: 1000 },
      { no: 3, kind: 'number', text: '', min: 0, max: 1000 },
      { no: 4, kind: 'choice', text: '', options: [{ value: 'A', label: '完全没看过' }, { value: 'B', label: '见过1道' }, { value: 'C', label: '见过2道' }, { value: 'D', label: '见过3道题' }] }
    ],
    notes: '前三题填具体数字（允许小数，如 0.05）；第 4 题是既往接触。答案按原文保存。'
  }),
  unscored({
    id: 'SUPPORT',
    name: '结束时的支持需求选择',
    short: '支持需求',
    version: '自编（实验问卷题目整理）',
    waves: ['end'],
    itemCount: 1,
    response: { min: 1, max: 3, labels: {} },
    items: [
      { no: 1, kind: 'multi', text: '', options: [{ value: '私下交谈', label: '私下交谈' }, { value: '休息更久', label: '休息更久' }, { value: '获取校内心理支持信息', label: '获取校内心理支持信息' }] }
    ],
    notes: '可多选；答案以逗号分隔保存。'
  }),
  unscored({
    id: 'ADVERSE',
    name: '不良体验与支持需求',
    short: '不良体验',
    version: '自编（实验问卷题目整理）',
    waves: ['week'],
    itemCount: 5,
    response: { min: 1, max: 3, labels: {} },
    items: [
      { no: 1, kind: 'choice', text: '', options: [{ value: '否', label: '否' }, { value: '是', label: '是' }, { value: '不愿回答', label: '不愿回答' }] },
      { no: 2, kind: 'text', text: '', maxLength: 1000 },
      { no: 3, kind: 'choice', text: '', options: [{ value: '否', label: '否' }, { value: '是', label: '是' }] },
      { no: 4, kind: 'choice', text: '', options: [{ value: '否', label: '否' }, { value: '是', label: '是' }] },
      { no: 5, kind: 'text', text: '', maxLength: 200 }
    ],
    notes: '第 2 题在选「是」时填写说明；第 5 题在希望团队联系时填联系方式。答案按原文保存。'
  })
)

await mkdir(OUT, { recursive: true })
for (const spec of specs) {
  const file = path.join(OUT, `${spec.id}.json`)
  await writeFile(file, JSON.stringify(spec, null, 2) + '\n', 'utf8')
  console.log('wrote', path.relative(process.cwd(), file))
}
