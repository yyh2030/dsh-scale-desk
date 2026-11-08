# 量表计分

定义驱动的量表库、问卷录入、列映射导入、计分与质控。默认是内存中的空研究；状态、校验与工具查询不创建目录、不播种定义、不写分数。研究材料和作答均由使用者显式配置。

## 研究连接

插件配置可给 `studyPath` 指向本机研究JSON。研究的 `schemaVersion` 为1，包含 `studyId`、`name`、`dataRoot`、`participantId`、`participants`、`visits`、`tasks`、`followups` 和 `plugins.scales`。相对路径以研究文件所在目录解析。未给研究文件时使用工作目录下 `_lab` 作为默认数据目录；`projectRoot`、`labDir`、`scalesDir`、`subjectsPath` 显式配置仍可使用。

「研究」页支持连接已有路径、编辑JSON、验证预览及保存。连接使用同Host内共享的prepare/commit/rollback协调器切换已注册研究插件；状态列出参与切换的插件与一致性。未注册插件仍需单独配置。已有文件保存需要版本一致。不同研究ID不能写入同一个已认领的数据目录。

`sample-study.json` 与 `sample-def.json` 是完全虚构的花园体验演示，不具有研究或临床效度。「初始化空目录」或「加入虚构花园示例」才会写入目录。定义全部删除后保持空白。

## 数据与编号

参与者编号按字符串处理，保留前导零、字母及Unicode。默认需非空且不含控制字符；研究可设置 `participantId.pattern`，所有录入、导入和改号使用同一规则。组别独立保存在参与者表。数值型Excel已经丢失的显示格式无法自动恢复。

量表定义在 `scales/defs`，作答在 `scales/answers`。新作答CSV包含 `definitionHash`、`submissionId` 与题目原值；不可变定义快照在 `definition-history`。旧CSV可读取并标记未知定义版本，查询不回写旧作答。版本漂移按每行hash检查。

定义先验证原始schema、题号和反向冲突再归一化；错误定义不会产生正式分数。Likert按整数档位，数值题允许小数并按逐题范围反向。合法选项与文本先于缺失码识别。分量表可指定 `minAnswered`；未指定时按声明的 `minProportion` 或整表门槛比例计算。strict规则缺一题不计分。

## 导入与编辑

导入预览接受位置映射；`idIndex`、`items[].index` 从0开始，题目缺失列为-1，名称仅显示。改列与编号列重新计算预览；重复同名列按位置区分。通用Q题号、题面及顺序只产生候选，需明确量表与波次。专用码的多个目标只有列集合不重叠时才可批量确认。`importFile` 必须传 `targets: [{ scale, wave, mapping }]`。

元信息编辑只提交变化的计分字段；单纯更名、说明或指导语不会重建原计分对象、子集、乘数和输出键。添加波次不改旧导出码。导入不自动学习或覆盖定义映射。

重复作答保留原值，宽表、明细接口、工具和导出一致标为duplicate并不出正式分。先在核对页选择一份。各写操作在插件实例内排队。所有写请求必须带当前 `studyId`、`contextRevision` 和 `selectionRevision`，防止旧连接在A→B→A后写入；带 `expectedRevision` 可拒绝旧数据覆盖。浏览器自动附带这些字段，成功响应返回最新revision。

## 派生与错误

重算生成分数、题目明细与宽表。每代输出在 `score-generations`，并保存输入作答、编号集合、定义和计分代码快照。`scores-manifest.json` 是同代文件与输入/定义hash的权威清单，读取者应优先使用其不可变代路径。平面CSV仅为兼容镜像，进程被终止时不能保证镜像永远同代。

每次数据写入先保存持久事务快照，普通异常回滚原始作答、日志和兼容派生。若进程中断或回滚失败，状态的 `transaction` 显示待恢复状态，并阻止继续写入；界面「恢复未完成事务」调用 `recover` 回到写入前快照。definition-history已有内容须hash一致，不覆盖损坏快照。实例内队列不构成多个Host进程间的锁。

`.xlsx`通过Python/openpyxl读取。可显式配置 `pythonPath`，否则使用环境 `DSH_PYTHON_PATH` 或PATH中的 `python`。纯CSV/TSV导入无需Python。

## 验证

```powershell
npm test
npm run test:host
```

全部测试仅使用临时虚构研究。测试真实客户端事件构造、Host路由、研究切换、纯查询不写盘、映射、编号、定义追溯、派生manifest和并发冲突。
