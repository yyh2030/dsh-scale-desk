# 量表计分（@local/scale-desk）

DSH Web 界面左侧的「量表计分」。把量表**定义、原始作答、分数**摊开成可核查的三层，谁算的、按哪版算的，都能回看。

只读研究材料；写入只发生在 `_lab/`：`scales/defs`（定义）、`scales/answers`（原始作答）、`scales/imports.json`（导入与录入记录）、`scores.csv` / `scores_detail.csv`（派生分数）、`export/`（导出）。

## 三层分开

| 层 | 位置 | 是什么 | 能不能删 |
|---|---|---|---|
| 定义 | `_lab/scales/defs/<量表>.json` | 题号、反向标记、计分键、缺失规则、导出码、出处、版本 | 不能，删了要重写 |
| 原始作答 | `_lab/scales/answers/<量表>__<波次>.csv` | `编号,q01,q02,...`，空格 = 缺失，保留原始文本 | 不能，这是原始数据 |
| 派生分数 | `_lab/scores.csv`、`_lab/scores_detail.csv` | 宽表分数、每题明细 | 能，每次录入或导入后自动重算，也可点「重算」 |

这条分工对应设计稿的三条约定：原始数据只读、派生可重算、版本单独记（`imports.json` 记每批数据录入时的定义版本）。

## 六个量表（MVP 五个 + 一周追踪）

| 量表 | 题量 | 取值 | 反向题 | 计分 | 波次 | 导出码 |
|---|---|---|---|---|---|---|
| FTPS 未来时间洞察力 | 10 | 1–7 | 8、9、10 | 均分 1–7 | T0 / T1 / T2 | `t{n}_ftps_01..10` |
| PANAS-NA 此刻版 | 9 | 1–5 | 无 | 均分 1–5 | T0 / T2 | `t{n}_na_01..09` |
| PANAS-NA 过去一周版 | 9 | 1–5 | 无 | 均分 1–5 | week | `week_na_01..09` |
| STAI-S 状态焦虑 | 20 | 1–4 | 1、2、5、8、10、11、15、16、19、20 | 累加 20–80 | T0 / T2 | `t{n}_stais_01..20` |
| CT-DAS 死亡焦虑 | 15 | 1–5 | 2、3、5、6、7、15 | 累加 15–75 | T0 | `t0_ctdas_01..15` |
| DASS-21 | 21 | 0–3 | 无 | 三份量表和 ×2，各 0–42；总分（描述性）= 原始和 0–63 | week | `week_dass_01..21` |

出处与信度抄自 `02_实验材料与问卷/量表计分与来源.docx`：
FTPS 抄 M04；PANAS-NA 抄 M05/M19（邱林等 2008）；STAI-S 抄 M06；CT-DAS 抄 M13（Templer 1970；Yang et al. 2012）；DASS-21 抄 M20（Lovibond & Lovibond 1995；龚栩等 2010）。

**此刻版与过去一周版是两个量表**，分数不可比，所以定义里分成 `PANAS_NA_NOW` 与 `PANAS_NA_WEEK`，列名也分开。同理 FTPS 三个波次同在一列族里但按波次分列。

## 计分器只做四件事

1. 求和 / 均分（`scoring.type`: `sum` | `mean`）；
2. 反向计分（逐题 `reverse`，`min + max - 值`）；
3. 缺失按比例折算（`prorate`：`(已答之和 / 已答数) × 题量 × 乘数`；`strict`：缺一题即不计分）；
4. 分量表汇总（`scoring.subscales`，可设 `items`、`multiplier`、`range`、`minAnswered`）。

不做统计检验，那是分析直通的事。取值范围只在定义里声明，用于校验「声明范围」与「题量 × 取值」是否自相矛盾，不参与计算。

缺失门槛是**没有文献依据的默认值**，按 80% 取整：FTPS 8、PANAS 7、STAI 18（设计稿给的值）、CT-DAS 12、DASS 每个分量表 6、总分 18。要改就改定义里的 `missing.minAnswered`，面板与导出都会跟着变。低于门槛的记「未计分」，不写 0 分，也不猜。

## 列名规则

`scores.csv` 第一列是 `编号`，之后：

- 单分量表：`量表_波次`，如 `FTPS_T0`、`STAI_S_T2`、`CT_DAS_T0`；
- 多分量表：`量表_波次_分量表`，如 `DASS_21_week_stress` / `_anxiety` / `_depression` / `_total`；
- 每个波次另有一列 `量表_波次_缺失`（缺题数）。

`scores_detail.csv` 是长表：`编号,量表,波次,题号,导出码,反向,原始值,计分值,备注`，用来核查反向题是否翻对了。

## 三条入口

1. **外部导入**：QuestionPro / 问卷星 / Excel 另存的 CSV 或 TSV。列名先认导出码（`t0_stais_01`），认不出再认 `Q1` / `第1题` / 纯数字列；预览时可手动改每题对应哪一列。UTF-8、GBK、GB18030 都试一遍再解码。导入只存原始文本，越界值不修，留给校验报出来。
2. **手工录入**：选量表、波次、编号，在答题纸上点数字。已录过的会载入原值，改完再存。反向题在答题纸上标橙底（主试视角；被试问卷里不该出现反向标记）。
3. **以后** PsychoPy 问卷模块直接写 `answers/*.csv`，格式一样即可。

## 面板四页

- **量表库**：六张卡（题量、计分、波次、已录份数、版本）；点开看逐题反向标记、计分键、取值范围与乘数、出处与授权、定义文件路径。
- **录入**：手填答题纸 + 导入预览（映射表、样本行、越界/重复编号提示、合并或覆盖）。已录名单可点回填。
- **计分**：宽表（按量表分组的两层表头，缺题与未计分带 `!`），筛选「有未计分 / 有折算 / 有整份未录」；点行看该被试每个波次的**每题明细**（原始值 → 反向后计分值）。「重算并写 scores.csv」「导出分数与报告」。
- **校验**：定义与数据两边都查，分高 / 中 / 提示三级，可按量表筛。

## 校验查什么

定义：题量为 0、题号重复、计分键引用不存在的题、反向列表与逐题标记不一致、声明范围与题量算出的不符、导出码数量不符或重复、没写版本、分量表共用题号（描述性总分除外）。

数据：编号不是 5 位、编号重复、作答越界或认不出、缺失过多未计分、折算缺题、某波次整批未录、某量表缺几个人、**定义版本漂移**（`imports.json` 里那批数据是按旧版本录的）。

## Agent 工具

- `scale_list()` —— 量表库：题量、计分、反向题、波次、已录人数、版本。
- `scale_score(id?, scale?)` —— 给编号看该被试各量表各波次分数与缺失；不给编号看全表摘要。
- `scale_validate(id?, level?)` —— 定义与数据问题清单，只读。

## 接口

`/api/scale-desk`，同源 + 请求头 `x-scale-desk: 1`：

- `GET ?action=status` —— 面板全量快照（定义摘要、分数宽表、问题清单、导入记录）
- `GET ?action=refresh` —— 绕过 5 秒内存缓存重读
- `POST {action:'definition', payload:{id}}` —— 单个定义的完整内容
- `POST {action:'answer', payload:{id, scale, wave}}` —— 某人某份的作答
- `POST {action:'detail', payload:{id, scale, wave}}` —— 每题原始值 / 反向后值
- `POST {action:'save', payload:{id, scale, wave, values}}` —— 手填保存
- `POST {action:'clear', payload:{id, scale, wave}}` —— 删除某人某份
- `POST {action:'importPreview', payload:{data|text, filename, scale?, wave?}}` —— 识别映射，不写盘
- `POST {action:'importApply', payload:{data|text, filename, scale, wave, mode, mapping}}` —— 落盘（`merge` / `replace`）
- `POST {action:'score'}` —— 重算并写 `scores.csv` + `scores_detail.csv`
- `POST {action:'validate'}` —— 重新校验
- `POST {action:'export'}` —— 写 `_lab/export/量表分数_YYYYMMDD.csv` 与 `.md`
- `POST {action:'reveal', payload:{target}}` —— 打开 `scales` / `lab` / `export` 目录

## 与运行台、分析直通的关系

- **运行台**只需要 `_lab/scores.csv`：`编号` + 各列 + `_缺失` 列就能算「量表完成度」，不需要知道怎么算的。这一步还没接（运行台当前没有量表列）。
- **分析直通**的第 3 阶段 merge 直接读 `scores.csv` 与 `scores_detail.csv`，把 `编号` 并到 AUC 宽表上。`runs/<runId>/meta.json` 的 `scriptHash` 之外，建议把 `scores.csv` 的列清单也记一份，防止定义改版后历史结果对不上。

## 版权与版本

- 定义里**不存题目文本**，只存题号、反向标记、计分键与导出码；题面在面板「量表库 → 编辑题面」里补（写进本地 `_lab/scales/defs/<量表>.json`），不进这个仓库。这样中文版授权状况不明时也能先计分。
- 同一个量表的中文版可能有多版，`version` 必须写清。改版后旧批次会被校验标成「版本漂移」，而不是静默混算。

## 题目文本

定义里 `items[].text` 默认是空的（题目不随插件仓库分发）。补题面在面板里就能做，不用改 JSON：

1. **量表库 → 选中量表 →「编辑题面」**：逐题在输入框里改；或者把「题号 + 题目」两列从 Word / Excel 粘进「从 Word / Excel 粘贴题目」，点「解析并填入」，检查后点「保存题面」。
2. 保存只改 `items[].text`，题号、反向标记、计分键、导出码都不动；落盘到 `_lab/scales/defs/<量表>.json`。
3. 保存后「录入 → 答题纸」和「量表库」立刻用新题面，不用重启。批量脚本仍可直接改那个 JSON。

粘贴规则：`1<TAB>题目`、`1. 题目`、`1、题目`、`第1题 题目` 都认；不带题号就按行序填。**带号和不带号混在一段里会被拒绝**，因为错位会让每道反向题和总分整体挪一位，不如让人看一眼。

本机这六份定义已经照 `02_实验材料与问卷/实验问卷题目整理.docx` 的题表填好（FTPS 10 题、PANAS-NA 各 9 题、STAI-S 20 题、CT-DAS 15 题、DASS-21 21 题），换了中文版就整份替换。`text` 为空的题显示「第 n 题（文本未录入）」，不影响计分。

## 安装

源码在 `D:\dsh-plugins\scale-desk`，按 bundle 装进 desktop profile（`plugin_manager` 的 `install_bundle`，target 为绝对目录）。配置写在插件自己的 `cordis.patch.yml`：

```yaml
- id: scale-desk
  name: '@local/scale-desk'
  config:
    projectRoot: 'C:/Users/16787/OneDrive/Desktop/yyh硕士论文'
```

`labDir` 默认 `<projectRoot>/_lab`，`scalesDir` 默认 `<labDir>/scales`；`subjectsPath` 默认 `<labDir>/subjects.csv`（有就用来列出「已入组但还没量表」的人，没有就只列已录过量表的人）。

改 Host 代码要重启 app；改 client 在「设置 → 插件」里把本插件关掉再打开，然后刷新页面。

## 测试

```powershell
node --test tests/scoring.test.mjs   # 18 项：定义、反向、折算、乘数、列名、导入映射、校验、CSV
node tests/smoke.mjs                 # 临时目录跑完整链路：播种 → 导入 → 手填 → 计分 → 导出 → 工具
```
