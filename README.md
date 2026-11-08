# @local/scale-desk

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)写的研究插件:量表计分台。量表定义、作答录入、列映射导入、一键计分与质控校验放在同一个面板里,分数从哪一版定义、哪一版作答算出来是可追溯的。

版本 0.2.0 · 需要 DSH ≥ 0.2.2-rc.1 · MIT 许可 · 依赖 [`@local/research-core`](https://github.com/yyh33028-netizen/dsh-research-core)

## 为什么需要它

量表数据出错的典型方式不是算错,而是算得对但说不清:反向题漏翻了一题、缺失规则换了、题号在两次导入之间挪了位、某个人做了两遍问卷而两份都被算进了分数。这些问题的共同点是事后无法回答"这个分数是怎么来的"。

计分台的做法是把定义、作答和分数拆成三层,每层都留 hash:定义改动会产生新的定义快照,作答按提交批次保存,重算产出新的代次并记录输入的作答集合、编号集合、定义与计分代码。既往代次不会被覆盖,所以旧分数一直可以解释。

## 能做什么

- **量表库**:每个量表声明题量、作答范围、波次、导出码、缺失规则与计分方式(总量表与分量表、乘数、反向题)。定义先校验原始 schema、题号与反向冲突,再归一化。
- **流程视图**:按波次列出每个量表已录几份、还缺哪些人,一眼看出数据收集的进站在哪。
- **手填录入**:按题目逐项填写,支持数值题小数;缺失码与合法选项分开识别,填错时提示而不是静默记成缺失。
- **问卷平台导入**:按位置映射列(`idIndex`、`items[].index` 从 0 开始,缺失列为 -1),预览可改列与重算;通用题号与题面只产生候选,需要你明确指定量表与波次才会写入。
- **重复作答处理**:同一人多份作答保留全部原值,在宽表、明细、工具与导出里一致标为 duplicate 且不出正式分;在核对页选定一份后才有正式分。
- **计分与派生**:一次重算同时产出量表分数、题目明细与宽表。分量表可指定 `minAnswered`,未指定时按声明的 `minProportion` 或整表门槛比例计算;`strict` 规则缺一题不计分。
- **质控校验**:题量、反向题、取值范围、缺失比例、导出码、定义版本漂移逐项检查,返回问题清单并区分高优先与提示,不改数据。
- **版本追溯**:每题作答带 `definitionHash` 与 `submissionId`;定义快照保存在 `definition-history`,旧 CSV 可读但标记为未知定义版本,查询不回写旧作答。
- **发布到核心**:`publishFlow` 打开后,计分与导出会把结果按 observation 发布到共享核心的数据集,供运行台与分析使用;默认关闭,避免在未授权时给既有研究新增目录结构。

### Agent 工具

| 工具 | 用途 |
|---|---|
| `scale_list` | 量表库清单:题量、计分方式、反向题、波次、已录人数与版本 |
| `scale_flow` | 按施测顺序列出流程:每个阶段的问卷、量表与任务,以及各波次已录份数 |
| `scale_score` | 给编号看该被试各量表各波次分数、缺失题数与未计分原因;不给编号看全表摘要 |
| `scale_validate` | 检查定义与作答数据,返回问题清单(高/中/提示) |

工具查询默认只给编号与计数,不含姓名。

## 安装

```powershell
git clone https://github.com/yyh33028-netizen/dsh-research-core.git
git clone https://github.com/yyh33028-netizen/dsh-scale-desk.git
dsh plugin --profile <profile> add link:<父目录>\dsh-scale-desk
```

或者用 git 形式:

```powershell
dsh plugin --profile <profile> add git+https://github.com/yyh33028-netizen/dsh-scale-desk.git
```

两种方式都要求 `research-core` 与本插件同级,插件用相对路径 `../research-core/host.mjs` 引用共享核心。仓库是私有的,安装前需要有访问权限。装完重启承载 `dsh web` 的进程,面板改动需要刷新页面。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `studyPath` | 空 | 研究定义 JSON;为空时用工作目录下的 `_lab` 作为数据目录 |
| `projectRoot` | 会话工作目录 | 相对路径基准,也是未配置研究时的默认根 |
| `labDir` | 研究的 `dataRoot` | 数据目录 |
| `scalesDir` | `<labDir>/scales` | 量表定义(`defs/`)、作答(`answers/`)、`imports.json`、`flow.json` |
| `subjectsPath` | 研究的 `participants.path`,否则 `<labDir>/subjects.csv` | 参与者表 |
| `pythonPath` | `DSH_PYTHON_PATH`,否则 PATH 中的 `python` | 只在读 `.xlsx` 时需要;纯 CSV/TSV 不需要 Python |
| `crossProcessLock` | `false` | 打开后写操作额外取跨进程锁 |
| `publishFlow` | `false` | 打开后计分与导出发布 observation 到共享核心 |

输出位置:`<labDir>/scores.csv`、`scores_detail.csv`、`data_wide.csv`、`export/`、`scores-manifest.json`,以及 `score-generations/` 下的代次目录。平面 CSV 只是兼容镜像,读取者应优先使用 manifest 里的不可变代路径 —— 进程被终止时不保证镜像与代次同代。

研究定义里与本插件相关的是 `visits`、`tasks` 与参与者表;量表定义单独放在 `scalesDir/defs`:

```json
{
  "schema": 1,
  "id": "GARDEN",
  "name": "示例问卷",
  "version": "fictional-1",
  "items": [
    { "no": 1, "text": "题面一", "kind": "likert", "reverse": false },
    { "no": 2, "text": "题面二", "kind": "likert", "reverse": true }
  ],
  "response": { "min": 1, "max": 5 },
  "waves": ["baseline", "followup"],
  "codes": { "baseline": ["sample_b_1", "sample_b_2"] },
  "missing": { "rule": "prorate", "minProportion": 0.75 },
  "scoring": { "type": "mean", "subscales": { "total": { "label": "总分", "items": [1, 2], "multiplier": 1, "range": [1, 5] } } }
}
```

仓库里的 `sample-def.json` 与 `sample-study.json` 是完全虚构的演示材料,没有研究或临床效度;只有点击「初始化空目录」或「加入虚构示例」才会写盘,定义全部删除后保持空白。

## 数据与隐私

- 不联网。列映射与计分全在本机完成,`.xlsx` 用本机 Python/openpyxl 读取。
- 不存姓名与联系方式:编号按字符串处理,保留前导零、字母与 Unicode;组别单独保存在参与者表。
- 工具与导出默认只含编号,不含姓名。
- 每次数据写入先存事务快照,普通异常回滚原始作答、日志与兼容派生;进程中断留下待恢复状态时会阻止继续写入,界面提供「恢复未完成事务」。

## 已知限制

- Excel 已经丢失的显示格式无法自动恢复;数值日期等复杂 Office 显示格式需要核对预览。
- 定义版本只能按 hash 识别:旧作答缺少 `definitionHash` 时标为未知定义版本,不会推测它对应哪一版。
- 导入不会自动学习或覆盖定义映射;模糊题面只给候选,不自动确认。
- 实例内写队列不构成多个 Host 进程之间的锁;需要跨进程保护时要显式打开 `crossProcessLock`。
- 多分量表的计分键需要在定义 JSON 里改,界面只做单分量表的快捷调整。
- 平面 CSV 镜像在进程被强制终止时可能滞后于代次;权威读取路径是 `scores-manifest.json`。

## 自测

```powershell
npm test
npm run test:host
```

测试只使用临时虚构研究,覆盖映射、编号、定义追溯、派生 manifest 与并发冲突。

## 许可

MIT，见仓库根目录 `LICENSE`（Copyright © 2026 Yuhui YANG）。许可只覆盖插件代码，不覆盖研究数据：被试信息、问卷作答、研究定义与由它们派生的数据仍归研究方所有，不随本许可授权。
