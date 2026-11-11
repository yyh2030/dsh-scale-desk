# DSH 研究插件套件 · 变更日志

> 规则：每次改动/调整都在本文件追加一条，注明日期、插件、版本、问题 ID、改了什么、验证方式。
> 修复阶段的详细验收记录在 `reports/research-plugin-remediation-20261108/` 各阶段完成记录里。

## 2026-11-10 · 07 隐私执行与分享边界（P01/P02 接入，P03/P04 边界）

- **research-core 1.4.0（本轮未升版本号）**（新增 `privacy-projection.mjs`；`results.mjs`；`package.json` 导出）
  - P01：新增 `agentProjection(kind,payload,mode,options)`。strict-local 对 analysis_status/analysis_results/analysis_run/analysis_export/scale_score/材料摘要只返回状态、计数、opaque artifactId（`art-<sha16>`）和 blocked 原因；summary-cloud 按顶层字段白名单过滤，未知字段或超过 32 KiB 的载荷整体返回 `policy_blocked`；`local` 只授权本机界面，Agent 仍走最小化。模式只从 `ctx.get('privacy')` 服务、研究 `plugins.<plugin>.privacyMode` 或插件配置 `privacyMode` 读取，缺省 strict-local，工具参数不能放宽。
  - P02：新增 `shareProjection(results,{meta,artifacts,allowedColumns})`：study 仅保留 id/name/version（path/dataRoot/config 去掉）；显示名含路径/邮箱/URL/控制字符时整段隐藏；表按列 schema、声明类型与角色过滤，participantId/姓名/电话/邮箱/地址/备注/自由文本与未知列默认不保留，`group` 等分类列和数值列保留（不按“值像数字”误判）；图注/正文/警告/节点错误同策略，含路径或联系信息的自由文本整段隐藏；manifest 只保留相对路径；`notes` 明示“自由文本/图片元数据不能仅靠规则保证匿名”。
  - 路径与错误：`scrubText` 覆盖 `C:\`、`\\server\share`、`\\?\`、`/home`、`/Users`、`/tmp`、`~/`、URL/邮箱/证件/手机号/文件名；`sanitizeError` 去路径与逐人编号，丢弃 details 与异常栈。
  - 结果对象：`buildResults` 保留列 `role`；analysis-run `results()` 透传 meta 表的 `types/analysisSet/nodeId`，使分享过滤按 schema 而不是按值推断。
- **analysis-run 0.5.0（本轮未升版本号）**（`index.js`）：analysis_results/analysis_status/analysis_run/analysis_export 工具返回全部经过 `agentProjection`；exportRun 用 `shareProjection` 生成 report.html、results.json、tables.docx/tables.xlsx 与 manifest（标题和表值同策略，manifest 相对路径）；图表 label/subtitle 先 `scrubText`；路由错误改用 `sanitizeError`。
- **scale-desk 0.3.0（本轮未升版本号）**（`index.js`）：`scale_score` 只把计数/汇总（summary-cloud 含量表名与波次人数）交给 `agentProjection`，逐人分数、题目原始值与编号不出工具；工具参数不能改 privacyMode；路由错误脱敏。
- **study-ops 0.3.1（本轮未升版本号）**（`index.js`）：`materials_scan`、`prep_readiness`、`materials_decisions`(list) 文本摘要经 `agentProjection` 投影（材料目录/文件路径、逐人编号、联系信息去除）；路由错误脱敏。`materials_decisions` set 的“刚写入什么”确认仍回显 label，未改 06 材料解析/草案逻辑。
- 测试：新增 `tests/remediation-07.test.mjs` 10 例：P01-A（analysis_results/analysis_status、scale_score、materials 摘要的真实工具路径）、P01-B（summary-cloud 白名单/未知字段/超大载荷 + 真实工具）、P02-A（研究名/列名/表值/图注/错误 + 真实导出 HTML/JSON/manifest）、P02-B（ID001 与组 A/B 保留、敏感列过滤）、P03-A（unenforceable 且不伪造已阻止）、P03-B/P04 边界、策略读取与错误投影。`cd D:\dsh-plugins\research-core; node --test "tests/*.test.mjs"` → **193 tests / 193 pass / 0 fail**（基线 183 + 新增 10，未删改旧断言）。
- P03/P04 边界：strict-local 只保证插件工具返回最小化；当前通用会话存在 read/pwsh/附件/浏览器/MCP 旁路时返回 `enforceability.unenforceable=true`，没有工具清单时返回 `'unknown'`，不宣称“已阻止”。P04-A 需要宿主侧捕获真实模型请求/通知载荷，P03-B 需要断网本地模型/模板全链路，本轮没有伪造这两项；测试注释已写明。自由文本名称、图片元数据、自定义脚本表格仍可能需要人工审阅。
- 范围说明：未改 06 材料解析/绑定逻辑；未抓真实数据/凭证；未 git commit/push。

## 2026-11-10 · 06 页面工作区/标签绑定（U01/U02，页面身份侧）

- **research-core 1.4.0**（`client-identity.mjs`、`host.mjs`、`index.mjs`）
  - U01-A：新增共享 `client-identity.mjs`（浏览器可用、无 Node 依赖），四个 client bundle 由 `research-core/scripts/sync-client-identity.mjs` 嵌入同一实现；pageId 首次生成立即写入 sessionStorage 共享键 `dsh:research:page:v3` 与插件前缀键 `dsh:research:page:v3:plugin:<plugin>`，同标签四插件共用一个 pageId，不同标签不串；刷新读取已有 pageId 保持不变。
  - U01-B：没有 sessionStorage（隐私模式/禁用/为空）时使用本标签 window 上的进程内唯一 ID，不再共用 localStorage 的 `default` 常量；用 BroadcastChannel + 标签指纹握手检测克隆标签复制 sessionStorage，克隆标签改生成新身份并写回自己的存储，原标签不变。
  - U02-A：页面请求同时带 pageId、workspaceId（来自 `uiWorkspace` 当前会话所属工作区）与本地绑定代次；`host.mjs` 的 `pageActor` 只信宿主注入的 workspace/session，客户端 workspace 必须命中宿主工作区清单，页面自报 sessionId 直接拒绝，声明与注入不一致返回 `workspace_mismatch`；核心令牌增加工作区指纹，同一页面换工作区即使研究没变也推进 `bindingRevision`，旧令牌写入被 409 拒绝。
  - U02-A 客户端：每次请求 capture 页面/工作区/绑定代次，响应回来核对 pageId、workspace、bindingRevision、studyId、instanceId，晚到旧响应抛 `stale_response` 且不更新 activeBinding；同标签切换工作区清空旧令牌。
  - 草稿键：study-ops 焦点提示改为 `dsh:research:focus:v2:<instanceId>:<dataset>`；analysis-run 方案草稿改为 `analysis-plan:v2:<instanceId>:<studyId>:<dataPath>`；demographic-coder 数据集草稿改为 `dc:dataset:v3:<instanceId>:<studyId>:<dataset>`，同 studyId 的不同实例/数据集不再交叉恢复。
  - 保留“页面缺令牌则拒绝”（`binding_required` 409）与旧页面/会话绑定行为。
- **study-ops 0.3.1 / scale-desk 0.3.0 / demographic-coder 1.2.0 / analysis-run 0.5.0**（`client.js` 浏览器半）：统一改用共享身份模块；请求头带 `x-dsh-workspace`，请求体带 workspaceId/bindingRevision；连接/保存/重连走 `identity.newPage()`；scale-desk 只读取当前实例+数据集对应的焦点提示键。
- 测试：新增 `tests/remediation-06-binding.test.mjs` 6 例——两标签两工作区四插件 pageId 一致且不串、克隆/无 storage/空 storage 唯一身份、四插件切工作区后旧响应按 workspace/study/instance 拒绝、宿主旧 A 令牌写 B 被拒且同研究换工作区推进版本、草稿键含 instanceId+数据集、四份 client 预置段与共享模块同源；测试真实加载四个 `client.js` 并用真实 study-ops 路由 + 研究核心。`cd D:\dsh-plugins\research-core; node --test "tests/*.test.mjs"` → **183 tests / 183 pass / 0 fail**（基线 177 + 新增 6，未删改旧断言）。
- 范围说明：本轮只做页面身份与绑定（U01/U02）；未改 07 隐私边界，未改材料侧扫描/草案逻辑，未写真实研究数据。

## 2026-11-10 · 06 材料扫描与可审阅草案（材料侧）

- **research-core 1.4.0**（`materials.mjs`）
  - M01：中文/特殊字符标签不再被 slug 成 `-`；访视/任务 ID 改为 `visit-<sha12>` / `task-<sha12>`（类型前缀 + 来源/candidate 稳定 hash），label 保留原文；同名不同来源 ID 不同，显式改 label 不改既有 ID；任务默认 `visits: []`、`required: false`、`visitMapping: 'pending'`，只给 `suggestedVisits` 建议，不自动进入必需矩阵。
  - M02：扫描记录 attempted/notScanned 与 complete/incompleteReasons；file/byte/time/depth 上限或 permission 失败时 `complete=false`、`truncated` 同步；上一轮已知但本轮未遍历的文件标 `not_scanned`，不判 `removed`；覆盖率分母含已知未尝试文件（`coverage.files`，另给 `attemptedCoverageRatio`），报告显式声明扫描是否完整。
  - M03：解析缓存键加入 parser 版本、解析脚本/能力指纹（Python 路径、PDF 库）、规则与 parse limits；环境补齐后缓存键变化，自动重试同一文件的旧失败/未解析状态；新增 `retryUnparsed`/`retryPaths`/`retry` 显式重试。
  - M04：候选新增确认/拒绝/待映射状态（默认 `pending`，observed 不自动算接受）；`decisions.json` 持久化，重新扫描按来源 sha 保留有效决定，来源变化标 `needs_review`；preview 生成 `draftId` + `revision` 并保存快照，save 接受同一 `draftId`/`expectedRevision`、不重新随机；缺 studyId 时用材料目录指纹保证 preview→save 身份一致；更新以现有定义为基础合并，保留 `plugins`/`dataRoot`/`participantId`/已有访视与任务，列出草案未提到的行。
  - M05：`assessReadiness` 按 import/scoring/run/analysis 四阶段分别给出 state/blockers/pending；dryRun 非 `passed` 时 run 与 analysis 阻断，统计后端缺失时 analysis 阻断；`canStart` 只有在所有阶段 ok/not_applicable 时为真；支持 `analysisNotRequired`/`statisticsNotRequired` 让不需要统计的项目仅对相应任务就绪；统计环境优先读取真实配置后端，缺配置时才退回 Python 依赖探测。
- **study-ops 0.3.1**（`index.js` 路由）
  - `materials_scan` 应用持久候选决定并汇总扫描完整性与决定计数；新增 `retry` 参数。
  - 新增 `materials_decisions` 工具（list/set），提供可发现的候选确认入口。
  - `study_draft_preview` 返回/持久化 draftId+revision，更新预览先与现有定义合并并展示删除项；`study_draft_save` 支持 `draftId`，校验预览内容与现有文件版本后再写，更新同样走合并。
  - `prep_readiness` 输出四阶段状态与阶段阻断原因；路由读取 `config.statisticsBackend` / `config.dryRun`。
- 测试：新增 `tests/remediation-06.test.mjs` 5 例（M01-A/M02-A/M03-A/M04-A/M05-A，全合成材料，含 study-ops 路由级 M04/M05）；`cd D:\dsh-plugins\research-core; node --test "tests/*.test.mjs"` → **177 tests / 177 pass / 0 fail**（基线 172 + 新增 5，未改旧断言）。
- 范围说明：本轮只做材料侧 M01–M05；U01/U02 页面工作区/标签绑定与 07 隐私边界留给下一轮，本轮未改 `study-ops/client.js` 的页面绑定逻辑。

## 2026-11-10 · 05 自动分析与缓存

- **analysis-run 0.5.0 / engine 2.4.0**
  - A01：外部脚本字节在准备阶段冻结进 `plan.script.code` 与 fingerprint，快照写 `code/<name>`，执行只用快照。
  - A02：表文件记录 sha256；`cache_artifacts_ok` 校验 input 与所有表存在且 hash 一致，坏缓存跳过；新增 `forceRecompute`。
  - A03：自动请求指纹改为 study + 完整 plan + dataset hash；失败暂停键改为完整指纹。
  - A04：interval/初始 timeout/debounce 登记 disposers，`ctx.effect` 卸载时清理。
  - 测试：`tests/remediation-05.test.mjs` 4 例；全套 168/168。
- 记录：`05-完成记录.md`（A05 未做，A03/A04 调度测试未做）。

## 2026-11-10 · 04 量表分数与发布

- **scale-desk 0.3.0**：recordId 带 submissionId；`scores` 数据集；save/import/answer/score/export 后自动发布；outbox + `publishRetry`。
- **research-core 1.3.0**：analysis 支持 `type:'score'` 变量，缺失带 `missingReason`；manifest 记录 scores 代次。
- 测试：`tests/remediation-04.test.mjs` 4 例；全套 164/164。

## 2026-11-08 · 03 图表与 Office

- **analysis-run 0.4.0 / engine 2.3.0**：Office 小数不再归零；XLSX 数值类型 + number_format；图读 `meta.charts`；每表 analysisSet/types；`"001"` 保真。
- **research-core**：`tableFromGrid` 支持声明类型；箱线须取围栏内真实极值。
- 测试：`tests/remediation-03.test.mjs` 7 例；全套 160/160。

## 2026-11-08 · 02 统计输入与推断

- **analysis-run 0.3.0 / engine 2.2.0**：`module_columns` + `prepare_frame` 统一输入；每 scope 门槛；偏相关 df；Table1 按人去重；信度声明量尺与 corrected 题总；零方差 t 明确失败；节点 `analysisSet`。
- 测试：`tests/remediation-02.test.mjs` 10 例；全套 153/153。

## 2026-11-08 · 01 数据身份锁与健康

- **research-core 1.2.0**：实例断言、锁状态机、提交指针、`commitMany`、`reconcile`、复合人口学提交、健康错误区分。
- 测试：`tests/remediation-01.test.mjs` 11 例；core 143/143。

## 2026-11-10 · 05 补充（A05 句柄捕获）

- **analysis-run 0.5.0**：scheduleDebounced 在排队时捕获 studyState（cfg/context），回调与失败/成功状态都写到捕获的研究目录，不再用执行时的 current()；eadAutoState/writeAutoState 显式接收 cfg。A05 仍缺双研究交错集成测试。
- 验证：
ode --check + 全套 168/168。

## 2026-11-10 · 05 补充（自动调度 seam 与 A03/A04/A05 测试）

- **analysis-run 0.5.0**
  - 新增 `analysis-run/scheduler.mjs`：`createScheduler({ config, current, run, analysis, readAutoState, writeAutoState, setTimeoutFn, clearTimeoutFn, setIntervalFn, clearIntervalFn })` 与纯函数 `requestedKey()`；requestedKey = sha256(JSON.stringify({ studyId, plan, datasetHash }))。
  - tick 只读一次 `current()` 并把快照用到结束；auto-state 键未变直接返回；否则比较最新 run 的 dataset hash 与 plan，去抖排一次 run；失败暂停键为完整 requestedKey，成功后写 auto-state。
  - 排队回调只用排队时捕获的 studyState（含 cfg.outputDir 与 context），不在回调里读 current()（A05）；dispose 清 interval、初始 timeout、debounce 并清空 disposer，之后 tick/schedule 不再启动任务（A04）。
  - `index.js` 改为注入 `createScheduler`，run 前 LOCKS/WRITES guard 与旧 `startAuto()` 接口保留，`autoTick` 动作与 status 的 autoError/autoTicks 不变；`runs(cfg, study)` 显式接收捕获的 context。
  - 新增测试 `research-core/tests/remediation-05-scheduler.test.mjs` 4 例，只测 scheduler 模块并用假时钟：A03-A（同 dataset 改 plan 触发一次、plan 不变不触发）、A03-B（失败暂停、plan 变后恢复）、A04-A（dispose 后推进假时钟不运行且无新 timer、新实例才工作）、A05-A（A 排队后 current 切 B，回调仍用 A 的 cfg.outputDir/context）。
  - 验证：`node --test "tests/*.test.mjs"` → 172 通过 / 0 失败（原 168 + 新增 4）；`node --check analysis-run/index.js`、`node --check analysis-run/scheduler.mjs` 通过。

## 2026-11-11 · 09 独立安装（B01）

- 四个业务插件改为 @local/research-core 包名导入（exports 子路径），package.json 声明 file:../research-core；开发/测试用 D:\dsh-plugins\node_modules\@local\research-core junction。
- 新增 tests/remediation-09.test.mjs：干净临时目录 + 包名依赖真实 import 两个入口。
- analysis-run 导出常量同步 0.5.0；npm pack dry-run 27 files/48.6MB，含 vendor/wheels。
- 验证：remediation-09 通过；全量 194/194。
- 未完成：scale-desk 旧测试 19/28 失败、GUI 验收、迁移演练、跨平台 wheel。

## 2026-11-11 · 09/T01 scale-desk 旧测试夹具升级

- **scale-desk 0.3.0（仅测试/夹具）**：新增 `tests/support/host.mjs`（临时研究 store、workspaceRegistry/sessions/workingDirectory 宿主入口、每页随机 pageId + `studyConnect` 令牌）；`tests/batch1.test.mjs`、`tests/study.test.mjs`、`tests/smoke.mjs` 改为临时 `study.json`（含 tasks/visits/plugins，dataRoot 指回原临时 lab）+ 真实 Host 路由 + `x-dsh-page`/`x-dsh-workspace` 头与绑定令牌。未删测试、未弱化断言；只在旧契约处更新期望并写明原因：Excel 式 `12345.0` 按 `normalizeId` 归一为 `12345`；07 严格本地投影不再返回逐人 duplicate 原因，改断言 `status missing`/`records 0`；`resolveImport` 会自动换编号列重试，旧“后段 pattern 拒绝”不可达，改用同样写前抛出的未知波次验证导入原子性；A-B-A 旧页面拒绝改用旧 binding token，并以 store 不可写模拟连接失败验证研究定义回滚。
- 根因分类：19 个失败全部是夹具身份过时（同一类，两个来源）——旧夹具 apply 只给 `{projectRoot,labDir}`，没有 study.json、没有 pageId/令牌，写请求被识别为 probe 并报 `study_missing`；同时进程级默认 store 残留“probe → 已删除临时研究”的记录，使失败在多次运行间复现。`tests/study.test.mjs` 里旧 `researchSelection` peer-busy 机制已被 06 绑定层取代，按当前契约用核心持久化失败验证回滚。
- 验证：`cd D:\dsh-plugins\scale-desk; node --test tests/*.test.mjs` → **28 tests / 28 pass / 0 fail**；`node tests/smoke.mjs` → 通过；`cd D:\dsh-plugins\research-core; node --test "tests/*.test.mjs"` → **194 tests / 194 pass / 0 fail**（未改 research-core 共享代码；此前两次全量分别因 PDF 渲染与 autoRun 去抖在并发负载下超时，单文件复跑与第三次全量均通过）。
- 范围：未写真实研究数据，未 git commit/push。