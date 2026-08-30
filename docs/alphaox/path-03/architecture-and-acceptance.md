# AlphaOx 路径三：确定性计划、执行与证据内核架构与验收报告

## 0. 文档状态与决策门

| 项目 | 当前值 |
| --- | --- |
| 路径 | 路径三：确定性计划、执行与证据内核 |
| 架构切片分支 | `codex/alphaox/pass-03-architecture` |
| 当前实现切片 | `codex/alphaox/pass-03` |
| Pass 集成分支 | `codex/alphaox/pass-03` |
| 基线分支 | `main` |
| 架构状态 | v1 架构方案已获人类确认 |
| 实现状态 | 阶段一契约与计划 DAG、阶段二前置检查、阶段三编译器与只读接口、阶段四结果与证据边界、阶段五确定性运行时和阶段六 Pass03 集成门已完成；已合入 main |
| 验收状态 | Pass03 集成检查、对抗复核和人类 Decision Gate 已通过；已合入 main |
| 外部系统 | 不连接真实数据库、飞书、模型、向量库或生产身份系统 |
| 生产状态 | 未部署、未切换、未写回 |

本报告冻结路径三 v1 的边界、契约方向、失败语义、迁移/回滚边界和验收门。
它不把架构方案误写成实现完成，也不把确定性 fixture 结果误写成真实来源或
生产权限证据。

本报告区分两层批准状态：用户已经确认核心架构方向、安全边界以及具体的
聚合/操作符集合、关系基数表达、freshness 策略、并发/重试默认值和知识/混合
步骤数据形态。以下内容可以作为阶段一实现约束；如果后续需要改变，必须同步
修改本报告、契约和验收清单。

人类已确认以下架构方向：新增 `BindingExecutionSpec` 解决 Path2 的自由文本
`SourceBinding.grain` 无法机器验证的问题；使用不含任意 SQL 的类型化
`QueryPlan`；执行前完成权限、关系、粒度、新鲜度和成本前置检查；使用可注入
的只读执行器；以结构化 `ResultEnvelope` 和 `EvidenceEnvelope` 作为唯一结果
边界；本路径只使用本地确定性 fixture，不连接真实外部系统。

## 1. 目标、事实与成功标准

### 1.1 真实目标

路径三要把 Path2 的上下文资产变成一个可验证的分析计划、可编译的查询计划、
可取消的只读执行流程和可追溯的结构化证据输出。模型或调用方只能提出受约束
计划，不能直接编写或执行 SQL、JavaScript、TypeScript、Shell 或其他代码。

### 1.2 已核实事实

- `packages/semantic-agent` 已提供严格的 `SourceSnapshot`、`SourceBinding`、
  `ContextPack` 和匹配结果边界，但尚未提供计划、编译、执行或证据内核。
- `SourceSnapshot` 已记录表、列、主键、外键、方言、结构指纹和 freshness。
- `SourceBinding` 已记录业务主体、物理目标、粒度文本、时间语义、权限引用、
  生命周期、来源和版本，但 `grain` 目前是自由文本，不能被路径三当作机器
  可执行规则解析。
- `ContextPack` 的可用性、Binding 的发布状态和匹配结果都已能在内存中进行
  确定性判断；这不代表权限已经在真实数据库执行。
- 当前没有生产数据库、身份系统、Connector、查询执行器、持久化控制面或
  Web 工作台；路径三不提前创建这些系统。

### 1.3 成功标准

路径三只有在以下内容全部通过后才可申请 Pass03 集成门：

1. `AnalysisPlan`、`QueryPlan`、`BindingExecutionSpec`、`ExecutionContext`、
   `ResultEnvelope` 和 `EvidenceEnvelope` 具有严格、版本化、拒绝未知字段的
   契约。
2. 计划引用的 Context Pack、Binding、Snapshot 和执行规格可被完整解析；
   任一引用断裂、版本不匹配或状态不可用都 fail closed。
3. 权限、freshness、关系、粒度、成本、只读和输出最小化检查发生在执行前，
   未通过前不调用执行器。
4. QueryPlan 是类型化 AST；编译器只生成参数化查询，用户输入中的 SQL 片段、
   注释、标识符注入和任意表达式不能穿透到编译结果。
5. 取消、截止时间、步骤/行/字节预算、执行器失败和证据失败都能产生稳定的
   `complete`、`partial`、`blocked` 或 `clarification_required` 状态。
6. 结果只通过受限的 `ResultEnvelope` 暴露；证据包含精确版本、来源、时间、
   查询摘要和转换链，不包含凭据、完整提示词或未经最小化的原始内容。
7. 所有核心行为都有不依赖真实模型或真实数据源的确定性契约测试；根级检查、
   包级测试、差异审查和对抗复核通过。

## 2. 架构决策与理由

### D1：路径三只扩展 `semantic-agent` 的内核

计划、编译器、执行器接口、结果和证据模块放在 `packages/semantic-agent`。
不创建 `semantic-web`，不接 Pi Agent Host，不接数据库或外部身份系统。

这样可以先证明机器边界和失败语义，再由路径四接入 Agent 循环；否则模型、
网络、身份和数据库问题会掩盖计划内核本身是否正确。

### D2：新增 `BindingExecutionSpec`，不重写 Path2 的 `SourceBinding`

`SourceBinding.grain` 是业务说明文本，不足以进行粒度校验。路径三新增独立的
`BindingExecutionSpec`，引用已发布的 Binding 和对应 Snapshot，并声明：

- 机器可验证的 `grainKeys`；
- 允许的 measure、dimension 和时间字段；
- 允许的外键关系路径及其人工确认的基数边界；
- 允许的聚合和结果限制；
- 审批、来源、版本、权限和 freshness。

执行计划只能引用已发布且 freshness 可接受的执行规格。规格与 Binding 或
Snapshot 不一致时阻断，不从自由文本推断规则。

该设计保留 Path2 已验收的公共契约，避免在路径三中静默改变已有 Schema；
如果未来要把 `grain` 改成结构化字段，应另开契约迁移决策门。

### D3：`QueryPlan` 使用受约束的类型化关系 AST

QueryPlan 只表达以下可审查结构：

- 已发布的执行规格和 Binding 引用；
- 物理列和业务维度的受约束选择；
- allowlist 内的聚合函数；
- 参数化过滤条件和时间窗口；
- 来自 Snapshot/执行规格的外键关系路径；
- 受约束的排序、分页和行数上限。

模型、API 调用方和 fixture 不得传入 SQL 字符串、SQL 片段、任意函数名、
脚本、模板或可执行表达式。编译器内部可以生成参数化 SQL 或其他方言查询，
但该编译产物不是外部输入，也不能反向改变计划。

### D4：完整前置检查后才能调用只读执行器

每个 QueryStep 按以下顺序处理：

1. 严格解析 AnalysisPlan、QueryPlan、ContextPack、Binding、Snapshot 和执行规格。
2. 检查状态、生效窗口、版本引用、来源覆盖和 freshness。
3. 调用策略评估器完成权限前置；`allow` 之外的结果都不执行。
4. 检查表/列存在性、关系路径、连接基数、粒度键、时间语义和聚合规则。
5. 根据预算、行数限制和方言能力编译参数化查询。
6. 只有前五步全部通过才调用 `ReadOnlyQueryExecutor`。
7. 对返回值执行结果校验、隐私变换、行/字节限制和证据封装。

### D5：执行器和知识检索器都是注入边界

路径三定义 `ReadOnlyQueryExecutor` 和 `KnowledgeRetriever` 接口。测试使用
确定性 fixture 实现；真实 Connector、数据库驱动、向量库和权限服务属于
后续路径的独立决策门。

执行器只接收编译结果、结构化参数和已通过前置检查的执行上下文，不接收模型
提示词、凭据或任意用户代码。检索器只能返回已声明来源的结构化内容引用、
摘要和证据定位，不能把未授权全文直接写入结果。

### D6：结果与证据分层，证据不生成结论

`ResultEnvelope` 表示一次受限执行的结构化结果；`EvidenceEnvelope` 表示该
结果为何可被追溯，包括来源、版本、时间、计划、查询摘要和转换链。路径三
不生成自然语言结论，不把模型文字作为事实，不把“权限检查通过”写成业务
数据正确性证明。

## 3. 契约与边界

### 3.1 `AnalysisPlan`

`AnalysisPlan` 是不可变的、带版本的步骤 DAG，至少包含：

- `contractVersion: "analysis.v1"`、`planId`、`version`；
- Context Pack 引用和执行规格引用；
- 有序但由 `stepId`/依赖关系决定的步骤集合；
- 每个步骤的 `kind`、`required`、`dependsOn` 和结构化输入；
- 创建者、创建时间、来源和计划摘要。

步骤类型限定为 `query`、`knowledge`、`transform` 和 `hybrid`。步骤 ID 必须
唯一，依赖不能形成环，不能引用未来版本或未发布资产。用户原始问题不作为
执行代码或任意模板保存；如需审计，只保存受限的请求引用或摘要。

### 3.2 `BindingExecutionSpec`

执行规格至少包含：

- `specId`、`version`、`bindingRef`、`snapshotRef`；
- `grainKeys`：目标表/列的稳定引用，不能为空且不能重复；
- `measures`：绑定目标列、允许聚合和空值规则；
- `dimensions`：可分组的绑定目标列；
- `timeColumns`：与 Path2 时间语义一致的字段和边界；
- `relationshipPaths`：外键 ID 序列、允许的方向和基数限制；
- `permission`、`provenance`、`freshness`、生命周期和人工审批。

执行规格不允许覆盖 Snapshot 的列、外键或 Binding 的目标；它只能收紧已有
边界。无法证明关系基数、粒度键或来源版本一致时返回 `blocked`。

### 3.3 `QueryPlan`

QueryPlan 的 v1 结构限定为：

- 一个已发布的主执行规格；
- 已批准的维度和 measure 引用；
- 参数化 predicate：列引用、比较操作、参数值和显式时间窗口；
- 已批准的关系路径；
- allowlist 内的 `count`、`sum`、`avg`、`min`、`max` 等聚合；
- 显式 `groupBy`、`orderBy` 和 `limit`，且受执行上下文预算约束。

不支持的函数、任意列、隐式 join、隐式粒度、自由 SQL、子查询、脚本和跨
Snapshot 引用一律阻断，而不是降级为猜测。

### 3.4 `ExecutionContext`

执行上下文只携带运行所需的非秘密控制信息：

- `runId`、不透明的 actor/org 引用和 `asOf` 时间；
- `PolicyEvaluator`，返回 `allow`、`deny` 或 `unknown`，并提供结构化原因；
- `maxSteps`、`maxRows`、`maxBytes`、截止时间和并发预算；
- `AbortSignal` 或等价取消边界；
- freshness 处理策略和结果最小化策略。

凭据、连接字符串、完整策略正文、原始企业行和模型提示词不得进入
`ExecutionContext`。`unknown` 权限、过期 freshness、超出预算和缺少取消
能力都不能被静默放宽。

### 3.5 `CompiledQuery`

编译结果仅由确定性编译器生成，至少包含：

- 目标来源、方言和 Snapshot/Binding/执行规格版本；
- 参数化查询文本或等价的内部查询表示；
- 有序参数集合及其类型；
- 规范化计划摘要和查询 digest；
- 估算行数/成本和采用的限制。

编译器不能拼接未经验证的标识符或把参数值插入查询文本。方言不支持某个
结构时返回结构化阻断原因。

阶段三 v1 只实现本地 `fixture-sql` 编译；其他方言返回
`unsupported_dialect`。由于当前执行规格没有独立根表字段，编译器要求 Binding
只有一个目标表，并把它作为根表；多目标表、无法从根表连续展开的关系路径、重复
或物理表名冲突都阻断，不自动推断。阶段三的 fixture 成本估算采用每行基础 64 字节
加每个输出列 64 字节的确定性上界，不能解释为生产数据库成本。

### 3.6 `ResultEnvelope`

结果至少包含：

- `status`、`runId`、`stepId` 和结果版本；
- 严格的列描述、受限行值、`rowCount`、`returnedCount` 和 `truncated`；
- 来源、Snapshot、Binding、执行规格、`asOf` 和 freshness；
- 脱敏/最小化规则引用、警告和结构化错误；
- 是否可被下游 transform 或 evidence 使用。

空结果在契约和证据完整时可以是 `complete`；因行数、字节或超时截断则为
`partial`，不能把截断结果标为完整。

### 3.7 `EvidenceEnvelope`

证据至少包含：

- `evidenceId`、`runId`、`planRef`、`stepId`；
- 精确的 Context Pack、Binding、Snapshot、执行规格和来源版本；
- 查询 digest、参数摘要、`asOf`、freshness 和策略决策引用；
- 结构化观察值/统计摘要、转换步骤和上游结果引用；
- 失败、警告、截断和证据完整性状态。

EvidenceEnvelope 不包含凭据、完整提示词、未经授权全文或无法追溯来源的数值。
如果结果无法完成证据封装，则该步骤不能向上层报告为成功。

## 4. 运行流程与状态语义

```text
plan validation
  -> context/version/freshness resolution
  -> policy preflight
  -> relation/grain/cost validation
  -> deterministic compilation
  -> read-only adapter execution
  -> result minimization
  -> evidence construction
  -> aggregate run status
```

顶层状态固定为：

| 状态 | 进入条件 | 是否调用执行器 |
| --- | --- | --- |
| `clarification_required` | 语义上存在多个合法选择，需人类或上层 Agent 澄清 | 否 |
| `blocked` | 契约、引用、权限、freshness、关系、粒度、编译或能力失败，且没有可交付步骤 | 否 |
| `partial` | 至少一个请求步骤完成，同时存在失败、取消、超时、截断或不可用步骤 | 可能 |
| `complete` | 所有必需步骤完成，结果和证据完整 | 是，或纯知识/变换步骤 |

`cancelled`、`deadline_exceeded`、`permission_denied`、`unknown_permission`、
`freshness_expired`、`grain_mismatch`、`relation_not_allowed`、`query_unsupported`
等作为结构化原因，不新增顶层状态。任何错误不得通过空结果伪装为成功。

## 5. 状态与失败矩阵

| 场景 | 结果 | 执行边界 |
| --- | --- | --- |
| Plan/Query/执行规格含未知字段或非法类型 | `blocked / invalid_contract` | 不执行 |
| 步骤 ID 重复、缺依赖或依赖成环 | `blocked / invalid_graph` | 不执行 |
| Context Pack 未发布、未生效、已撤销或引用断裂 | `blocked / invalid_context` | 不执行 |
| Binding、Snapshot、执行规格版本不一致 | `blocked / version_mismatch` | 不执行 |
| 权限返回 `deny` | `blocked / permission_denied` | 不执行 |
| 权限返回 `unknown` | `blocked / unknown_permission` | 不执行 |
| freshness 为 `expired` | `blocked / freshness_expired` | 不执行 |
| freshness 为 `stale`/`unknown` 且策略允许继续 | 继续并附 warning | 可执行，结果不得称为新鲜 |
| freshness 为 `stale`/`unknown` 且策略不允许 | `blocked / freshness_not_allowed` | 不执行 |
| 关系路径不存在、跨 Snapshot 或基数未获批准 | `blocked / relation_not_allowed` | 不执行 |
| group-by 与执行规格粒度不一致 | `blocked / grain_mismatch` | 不执行 |
| 任意 SQL、未允许函数或未知列进入计划 | `blocked / query_unsupported` | 不执行 |
| 参数、标识符或结果超过预算 | `blocked / budget_exceeded` | 不执行 |
| 执行器在首个步骤前失败 | `blocked / executor_failed` | 不产生伪造结果 |
| 已有步骤完成，后续执行器失败 | `partial / executor_failed` | 保留已完成步骤的证据 |
| 取消/截止时间在执行前触发 | `blocked / cancelled` 或 `deadline_exceeded` | 不执行 |
| 取消/截止时间在部分步骤后触发 | `partial / cancelled` 或 `deadline_exceeded` | 仅保留已完成步骤 |
| 结果行数/字节被截断 | `partial / result_truncated` | 结果必须标记截断 |
| 空结果但契约和证据完整 | `complete` | 可正常完成 |
| 结果无法脱敏或证据无法封装 | `blocked` 或 `partial` | 不释放无证据结果 |
| 知识检索器不可用 | 无已完成步骤则 `blocked`，否则 `partial` | 不伪造文本证据 |

## 6. 边界情况与对抗复核重点

- 恶意字符串只能作为参数值，不能改变列名、表名、排序方向或查询结构。
- Unicode、大小写、空白和同名字段不能让两个不同的稳定引用被静默合并。
- 多对多关系、未知基数、循环关系和跨来源 join 不被自动推断；必须有执行规格
  的明确允许路径，否则阻断。
- measure 的聚合、空值和粒度必须由执行规格声明；不能从 label、definition
  或用户自然语言猜测。
- 时间窗口遵循 Binding 的 timezone 和 boundary；默认使用明确的半开区间，
  不用本地时区或运行机器时区隐式转换。
- 相同计划、相同输入和相同 fixture 必须生成相同的规范化计划摘要、参数顺序、
  query digest、候选证据和状态原因。
- 结果为空、结果只有 null、结果达到上限、结果超过字节预算和结果含重复行都
  必须有明确的可审查语义。
- 独立步骤失败时不能把其他步骤的证据复制给失败步骤；依赖失败的步骤必须跳过
  并记录原因。
- 不把策略 ID、模型置信度、向量分数或执行器返回的任意文字当作业务事实。
- fixture 只使用合成数据，不能包含凭据、真实企业行、真实飞书内容或授权信息。

## 7. 依赖、迁移与回滚

### 7.1 依赖

- Node.js / TypeScript。
- Path2 已有 TypeBox 契约、Source Snapshot、Source Binding 和 Context Pack。
- Vitest 用于确定性契约和回归测试。
- Node 标准库可用于 digest、取消和时间处理；不新增外部依赖，除非另行批准。

### 7.2 实现顺序

1. 先冻结并校验 `analysis.v1` 计划、执行规格、结果和证据结构。
2. 再实现纯函数引用解析、DAG 检查、策略前置和关系/粒度校验。
3. 再实现类型化 QueryPlan 编译器、参数绑定、成本/限制计算。
4. 再接入确定性 fixture executor、knowledge retriever、结果最小化和证据构建。
5. 最后补齐取消、部分失败、混合步骤和全量对抗测试，再申请 Pass 集成门。

### 7.3 迁移与回滚

- 路径三只在内存中定义和执行契约，不创建数据库表、索引、队列或外部资源。
- 不修改 Path2 的现有 Schema；`BindingExecutionSpec` 通过明确引用连接两者。
- `analysis.v1` 不兼容输入直接拒绝，不把未知字段降级到旧契约。
- 代码回滚回到路径三前的已验收 commit；不需要删除外部数据。
- 如果后续要持久化执行规格、计划、结果或证据，必须另开迁移、备份、双读和
  回滚决策门，不能由本路径隐式引入。

## 8. 分阶段实施计划

| 阶段 | 交付 | 完成门 |
| --- | --- | --- |
| 0 | 本报告、契约边界、失败矩阵和人类架构确认 | 报告完整，范围和未决风险真实记录 |
| 1 | `analysis.v1`、`BindingExecutionSpec`、计划 DAG 和严格解析 | 未知字段、断裂引用、循环和版本错配测试通过 |
| 2 | 前置策略、freshness、关系、粒度和成本检查 | 未通过检查不调用执行器；allow/deny/unknown 全覆盖 |
| 3 | QueryPlan AST、参数化编译器和只读执行器接口 | 注入、非法结构、方言能力和预算测试通过 |
| 4 | ResultEnvelope、EvidenceEnvelope、隐私最小化和混合步骤 | 来源/版本/时间/转换链完整；无证据结果不释放 |
| 5 | 取消、超时、部分失败、确定性 fixture 和对抗复核 | 状态矩阵、回归测试、根级检查和差异审查通过 |
| 6 | Pass03 集成门 | 子分支合入 Pass03 前完成测试、风险、回滚和人类验收 |

## 9. 验收清单

### 9.1 契约与计划

- [ ] 所有路径三对象带 `analysis.v1` 或明确的子契约版本。
- [ ] 计划、步骤、执行规格、结果和证据均严格拒绝未知字段。
- [ ] 计划引用的 Context Pack、Binding、Snapshot 和执行规格可完整解析。
- [ ] 步骤 ID、依赖、DAG、必需/可选关系和失败传播规则确定且有测试。
- [ ] `BindingExecutionSpec` 不能覆盖 Path2 Snapshot、Binding 或权限边界。
- [ ] free-text `grain` 不会被编译器、匹配器或执行器当作机器规则解析。

### 9.2 前置检查

- [ ] 未发布、过期、断裂引用和版本不匹配均在执行前阻断。
- [ ] `allow`、`deny`、`unknown` 权限决策分别有确定性结果。
- [ ] stale/unknown freshness 只能按显式策略继续，并带 warning；expired 永久阻断。
- [ ] 表、列、外键、关系方向、基数和跨 Snapshot 引用都有验证。
- [ ] measure、dimension、group-by、time window 和 grain keys 不一致时阻断。
- [ ] 步骤/行/字节/截止时间预算在执行前和执行中都有效。

### 9.3 编译与执行

- [x] QueryPlan 不接受 SQL 字符串、任意函数、脚本、模板或可执行表达式。
- [x] 用户输入只能进入参数位；标识符来自已验证的 Snapshot/执行规格引用。
- [x] 参数顺序、规范化摘要和 query digest 在相同输入下稳定。
- [x] 不支持的方言或结构返回明确编译错误，不降级执行。
- [x] 只读执行器接口只接收编译结果和无秘密的执行上下文。
- [x] 执行器在前置检查失败时不会被调用；`createPreflightedFixtureQueryStep` 和 fixture 测试证明这一点。

### 9.4 结果、证据与失败状态

- [x] ResultEnvelope 包含列、行、计数、截断、来源、版本、freshness 和警告。
- [x] 超行数、超字节、截止时间、取消和执行器失败的状态与原因可重放。
- [x] EvidenceEnvelope 包含计划、步骤、Binding、Snapshot、执行规格、来源、
  `as_of`、query digest 和转换链。
- [x] 无法最小化或无法封装证据的结果不会作为成功结果释放。
- [ ] `complete`、`partial`、`blocked`、`clarification_required` 的边界测试完整。
- [ ] 空结果、null 值、重复行和独立步骤部分失败都有明确语义。

### 9.5 确定性与安全

- [x] 同一 fixture、计划和执行上下文重复运行得到相同结果摘要、证据引用和状态。
- [ ] SQL 注入、未知列、非法排序、越权 Binding、未知向量结果和伪造来源均阻断。
- [x] fixture 不含真实企业数据、凭据、真实飞书内容或完整提示词。
- [ ] 不把模型、向量分数、策略 ID 或适配器文字当作事实证明。
- [x] 通过 `npm run test --workspace=@alphaox/semantic-agent`、根级 `npm run check`
  和 `git diff --check`。
- [ ] 只提交本阶段文件；无旧阶段 ` 2` 后缀副本、锁文件意外变化或未审查生成物。

### 9.6 阶段一验收记录

- [x] `analysis.v1` 的 `BindingExecutionSpec`、`QueryPlan`、`AnalysisPlan` 和四类
  步骤契约已实现，并通过严格字段校验。
- [x] 已实现执行规格、查询计划和计划 DAG 的确定性规范化；重复 ID、断裂依赖、
  环、未声明执行规格和错误的 Hybrid 输入均阻断。
- [x] 已实现已确认的聚合/操作符 allowlist、人工确认的关系基数字段、stale/unknown
  由策略层决定的边界，以及串行/无自动重试的计划约束基础。
- [x] `npm run test --workspace=@alphaox/semantic-agent` 通过：6 个测试文件、35 个测试。
- [x] 根级 `npm run check` 通过：Biome 检查 1108 个文件无修复；依赖固定、相对导入、
  shrinkwrap、install lock、TypeScript 检查和 Browser smoke 检查均通过。
- [x] `git diff --check` 通过；本阶段没有锁文件或外部依赖变更。
- [x] 工作区扫描未发现旧阶段带 ` 2` 后缀的未跟踪或已跟踪副本。
- [ ] QueryPlan 编译器、权限前置、执行器、ResultEnvelope、EvidenceEnvelope 和取消/预算
  执行尚未实现，不能把阶段一结果标记为路径三完成。

### 9.7 阶段二验收记录

- [x] `ExecutionContext` 使用严格字段 allowlist，拒绝凭据字段和非法预算；已验证取消信号
  在前置阶段阻断。
- [x] Context Pack 的有效窗口、发布状态、来源/Binding/权限引用、Binding/执行规格/Snapshot
  版本和发布审批状态均在策略调用前校验；断裂引用 fail closed。
- [x] `allow`、`deny`、`unknown` 策略结果分别产生可执行、`permission_denied` 和
  `unknown_permission`；策略异常按 unknown 处理。
- [x] `fresh_only`、`allow_stale`、`allow_unknown` 对 stale/unknown 的继续与 warning 语义已实现，
  `expired` 始终阻断；测试覆盖允许、阻断和过期场景。
- [x] Snapshot 的表/列/主键/外键引用、全局外键 ID、关系方向和路径连续性已验证；执行规格与
  QueryPlan 的关系路径、执行规格引用、时间边界和粒度键不一致时阻断。
- [x] 查询行数上限和单查询步骤预算在执行前检查；`maxBytes` 的结构化预算字段已严格校验，
  具体字节估算和结果截断留给编译/结果阶段。
- [x] `npm run test --workspace=@alphaox/semantic-agent` 通过：7 个测试文件、40 个测试。
- [x] 根级 `npm run check` 通过：Biome 检查 1110 个文件；依赖固定、相对导入、shrinkwrap、
  install lock、TypeScript 检查和 Browser smoke 检查均通过。
- [x] `git diff --check` 通过；本阶段没有锁文件或外部依赖变更。
- [x] 本阶段没有引入旧阶段带 ` 2` 后缀副本、真实连接、凭据或外部写入。
- [ ] QueryPlan 编译器、只读执行器、ResultEnvelope、EvidenceEnvelope、步骤级 maxBytes 估算、
  执行中预算和部分失败状态在阶段二收口时尚未实现；阶段三验收记录见 9.8。

### 9.8 阶段三验收记录

- [x] 编译器只接受 `status=ready` 的前置结果，并重新规范化计划、执行规格、Binding、Snapshot
  和 Context Pack；前置结果缺失或引用不一致时阻断。
- [x] 仅支持 `fixture-sql`；其他方言返回 `unsupported_dialect`，不伪装成生产适配器。
- [x] Binding 多目标表返回 `ambiguous_base_table`；关系路径必须从根表连续展开，生成已批准外键的
  `INNER JOIN`；重复表、物理名称冲突、未知列和未知外键均阻断。
- [x] 表名和列名全部来自 Snapshot 并统一转义；过滤条件、时间边界和 limit 使用有序参数，参数值
  不进入查询文本；null 比较要求显式 `is_null`/`is_not_null` 语义。
- [x] 过滤条件按规范顺序编译，输出包含稳定的 plan/query digest、参数类型、只读标记和来源版本。
- [x] 估算行数、字节和成本在编译前校验上下文预算；字节估算固定为每行 64 字节加每个输出列 64 字节，
  仅作为 fixture 预算门。
- [x] `ReadOnlyQueryExecutor` 只定义结构化编译结果和执行上下文接口，没有真实数据库适配器。
- [x] `npm run test --workspace=@alphaox/semantic-agent` 通过：8 个测试文件、44 个测试。
- [x] 根级 `npm run check` 通过：Biome 检查 1112 个文件无修复；依赖固定、相对导入、shrinkwrap、
  install lock、TypeScript 检查和 Browser smoke 检查均通过。
- [x] `git diff --check` 通过；本阶段没有锁文件或外部依赖变更。
- [x] 本阶段没有引入真实数据库、模型、凭据、外部写入或旧阶段 ` 2` 后缀副本。
- [ ] 真实方言适配器、执行器调用保护、ResultEnvelope、EvidenceEnvelope、执行中预算、取消后的部分
  失败和结果最小化尚未实现，不能把阶段三结果标记为路径三完成。

### 9.9 阶段四验收记录

- [x] `ResultEnvelope` 使用 `analysis.v1` 严格契约，列、标量行、计数、截断、来源/版本、freshness、
  最小化引用、结构化 warning/error 和下游能力均有明确字段；未知字段、重复列、行宽不一致、非法
  计数和状态不一致均阻断。
- [x] 结果最小化只释放策略允许的列，并在策略引用未知列、没有可释放列、超行数或超 UTF-8 字节预算时
  确定性返回 `ready`、`privacy_blocked` 或 `invalid_candidate`；截断和隐私裁剪会进入结构化 warning。
- [x] `complete` 不能带截断或错误；`partial` 必须有截断或错误；`blocked`/`clarification_required` 不
  暴露行和计数，也不能声明可供下游消费；freshness warning、截断 warning 和隐私 warning 与实际状态
  交叉校验。
- [x] `EvidenceEnvelope` 只保存 Context Pack、计划、Result、Source/Snapshot/Binding/ExecutionSpec 的
  精确引用，query digest、参数序号/角色/类型摘要、策略决策、数值观察、转换链和上游结果引用；不复制
  行值、参数值、提示词、凭据或原始适配器文本。
- [x] 证据构建拒绝 blocked/clarification 或 `canEvidence=false` 的结果；截断结果产生 `partial`、
  `incomplete` 和结构化 warning/error；完整性摘要采用规范化 payload 的 SHA-256，篡改 digest、重复
  上游引用、重复观察或重复参数序号均阻断。
- [x] 确定性契约测试通过：`semantic-agent` 共 10 个测试文件、53 个测试；阶段四新增 2 个测试文件、
  9 个测试，覆盖最小化、预算、状态矩阵、证据脱敏和完整性篡改。
- [x] 根级 `npm run check` 通过：Biome 检查 1116 个文件无修复；依赖固定、相对导入、shrinkwrap、
  install lock、TypeScript 检查和 Browser smoke 检查均通过。
- [x] `git diff --check` 通过；本阶段没有锁文件、外部依赖、真实连接、模型调用、凭据、外部写入或旧
  阶段 ` 2` 后缀副本。
- [ ] 阶段四收口时，真实执行器调用保护、执行中预算、取消/超时、独立步骤部分失败、fixture executor、
  knowledge/hybrid 编排和 Pass03 集成门尚未实现；阶段五验收记录见 9.10，阶段六仍是后续工作。

### 9.10 阶段五验收记录

- [x] `runSerialAnalysis` 按依赖拓扑稳定排序并串行执行；步骤 kind 固定为 `query`、`knowledge`、
  `transform` 或 `hybrid`，下游只接受经过规范化的结构化 Result/Evidence，不接收任意原文或执行代码。
- [x] `FixtureQueryExecutor` 只接受 `fixture-sql` 的只读编译查询，按 query digest 读取合成候选数据，
  返回深拷贝；不存在的 digest、错误方言、dispose 后的新请求均结构化失败，不自动重试。
- [x] `createPreflightedFixtureQueryStep` 在 preflight 为 blocked 时不会调用 executor；ready 才允许进入
  编译和 fixture 执行边界。
- [x] 运行前和运行中均检查取消与截止时间；取消/截止时间在首步骤前返回 `blocked`，在步骤执行期间或
  输出完成后超过截止时间时不释放结果；fixture 的 active execution 会在取消或 dispose 后清理。
- [x] `maxSteps`、聚合 `maxRows` 和 `maxBytes` 在步骤启动前及结果接受前检查；超预算结果被丢弃并返回
  `budget_exceeded`，不以空成功结果掩盖。
- [x] 首步骤执行器失败返回 `blocked`；已有独立步骤完成后，后续执行器失败返回 `partial`，已完成步骤的
  Result/Evidence 保留；失败步骤的依赖被跳过，独立步骤仍可按串行顺序执行。
- [x] 缺少证据、Result/Evidence 的 run/step/reference/lineage/freshness 不一致、非法结果和未知异常均
  fail closed；原始异常文本不进入运行记录。
- [x] 阶段五确定性回归测试通过：`semantic-agent` 共 11 个测试文件、64 个测试；阶段五新增 1 个测试
  文件、11 个测试，覆盖 fixture、前置阻断、取消、截止时间、dispose、预算、部分失败、依赖跳过和证据门。
- [x] 根级 `npm run check` 通过：Biome 检查 1118 个文件无修复；依赖固定、相对导入、shrinkwrap、
  install lock、TypeScript 检查和 Browser smoke 检查均通过。
- [x] `git diff --check` 通过；本阶段没有锁文件、外部依赖、真实连接、模型调用、凭据、外部写入或旧
  阶段 ` 2` 后缀副本。
- [x] 真实数据库/知识检索器、持久化、并发调度和长任务恢复仍不属于阶段五；阶段六集成门记录见 9.11，
  本阶段没有把这些后续能力误报为已实现。

### 9.11 阶段六 Pass03 集成门验收记录

- [x] `codex/alphaox/pass-03-runtime` 无冲突合入 `codex/alphaox/pass-03`；Pass03 合并提交为
  `9f41d02c1`，最终 `main` 合并提交为 `989abb510`。
- [x] 人类 Decision Gate 已确认，Pass03 已按授权合入 `main`；没有执行 push、部署或外部写入。
- [x] 合并后 `npm run test --workspace=@alphaox/semantic-agent` 通过：11 个测试文件、64 个测试。
- [x] 合并后根级 `npm run check` 通过：Biome 检查 1118 个文件无修复；依赖固定、相对导入、shrinkwrap、
  install lock、TypeScript 检查和 Browser smoke 检查均通过。
- [x] `git diff --check main...HEAD` 通过；合并后工作区干净，未跟踪的旧阶段 ` 2` 后缀副本复核后不存在。
- [x] 回滚边界保持为代码提交回退；本路径未创建数据库、队列、文件或其他外部资源，不需要数据回滚。

### 9.12 Browser 验收

路径三不创建 Web UI、HTTP 服务或可视化结果，因此本阶段没有 Browser 视觉验收
门。Browser 验收延后到路径五；路径三只向路径五提供可渲染的结构化状态、结果、
来源、证据和错误契约，不能把本阶段的 fixture 或命令行测试标记为 Browser 通过。

## 10. 运行、可观测性、可访问性与维护责任

### 10.1 可观测性

- 每次运行和每个步骤都关联 `runId`、`stepId`、计划版本、Context Pack、Binding、
  Snapshot、执行规格和 query digest。
- 记录状态转换、前置检查结果、耗时、返回行数、截断、取消、重试计数和错误码；
  日志不记录凭据、原始企业行、完整提示词、完整策略正文或未经裁剪的文档。
- 适配器错误必须经过结构化错误映射；原始异常只允许在受控调试边界保留，不能
  进入 `ResultEnvelope` 或 `EvidenceEnvelope`。
- v1 不做自动重试；如果未来增加重试，必须定义幂等键、预算扣减、退避和证据
  去重规则，不能由执行器自行重试。

### 10.2 并发、取消与清理

- v1 单次运行只允许按 DAG 依赖执行；独立步骤是否并发由执行上下文的明确预算
  决定，默认串行以保证确定性。
- 每个执行步骤都必须监听取消信号和截止时间；取消后不得启动新的依赖步骤，
  已完成步骤的证据保留为只读结果。
- 适配器必须提供释放/终止边界；fixture 运行结束时清理临时状态，不创建外部
  数据、连接、文件或后台进程。
- 内存中的结果、计划和证据不跨运行共享；路径三不提供缓存、持久化、恢复或
  后台任务，避免隐式泄漏和所有权不清。

### 10.3 可访问性、所有权与维护

- 本路径没有 UI，因此不声明桌面、移动端、键盘、焦点、滚动或视觉可访问性通过；
  路径五必须将本路径的状态、错误、来源和证据字段转换为可读的结构化结果块。
- `semantic-agent` 维护者负责契约版本、编译器 allowlist、错误码和回归 fixture；
  Connector/执行器实现者负责适配器契约、取消、清理和秘密隔离。
- 新增聚合、关系、隐私规则或状态码必须更新本报告、契约、失败矩阵和确定性测试；
  不允许只改 prompt 或适配器行为而不改机器契约。
- 生产部署、凭据托管、数据库迁移、审计存储和数据保留策略不属于路径三所有权；
  它们在后续路径中由明确的服务所有者和独立决策门负责。

## 11. 未决风险

### 11.1 已确认的实现默认值

以下选择已获人类确认，阶段一及后续阶段按此实现；如果需要改变，必须同步
修改本报告、契约和验收清单：

- QueryPlan v1 的 predicate 操作符、聚合函数、排序和分页 allowlist；当前报告
  使用最小安全集合作为实现范围。
- `BindingExecutionSpec` 如何表达关系基数和 fan-out 风险；当前报告建议由人工
  审批的关系路径声明，不从外键结构自动推断。
- stale/unknown freshness 的允许条件放在 `ExecutionContext` 策略、执行规格，
  还是独立权限决策中；按策略决策显式允许并附 warning。
- 独立步骤默认串行、v1 不自动重试的运行策略；如果需要并发或重试，要先定义
  幂等、预算和证据去重边界。
- knowledge、transform、hybrid 步骤的输入输出是否只能引用结构化 Result/Evidence，
  以及是否允许受限的文本摘要；不传递任意原文或可执行内容。
- 阶段三 v1 只支持 `fixture-sql`；真实方言能力和适配器属于后续独立决策门。
- 当前执行规格没有根表字段，因此阶段三要求 Binding 只有一个目标表；多目标表不自动推断。
- 阶段三使用固定 fixture 字节上界进行预算检查，不把该估算解释为生产成本模型。

- `BindingExecutionSpec` 可能与人类已发布 Binding 的业务含义不一致；必须保留
  Binding/Snapshot 精确引用和人工审批，不允许从 label 或 definition 推断。
- SQL 方言、数据库统计信息和真实执行成本尚未连接；当前成本门只能证明契约
  行为，不能证明生产性能。
- 当前权限只定义策略决策接口；行级/列级策略、凭据托管和真实身份映射属于后续
  路径，不能在本路径宣称已完成。
- KnowledgeRetriever 和 HybridStep 只冻结接口；真实文档内容、向量索引和
  飞书同步需要独立的来源、权限、新鲜度和回读门。
- ResultEnvelope 的隐私变换规则需要随着实际数据类型扩展；没有规则的敏感字段
  必须阻断，而不能靠调用方自觉删除。
- 计划持久化、长任务恢复、并发调度、重试幂等和审计存储尚未实现；本路径只做
  单次内存执行边界。

## 12. 批准状态与来源证据

- 人类已确认路径三 v1 架构方向，尤其确认 `BindingExecutionSpec`、类型化
  QueryPlan、前置权限检查、注入式只读执行器、结构化结果/证据和本地 fixture
  边界。
- 本报告已建立在 `codex/alphaox/pass-03-architecture`；阶段一至阶段六实现、本地测试和 Pass03 集成门已完成，
  已合入 `main`。
- [AlphaOx 开发路径图](../../../开发路径图.md) —— 路径三目标、状态语义和产品边界。
- [Path2 契约设计](../path-02/contract-design.md) —— Source Snapshot、Source
  Binding、Context Pack、freshness、权限和版本引用边界。
- [semantic-agent package](../../../packages/semantic-agent/package.json) ——
  当前产品包、Node/TypeScript、TypeBox 和 Vitest 依赖。
- [仓库 AGENTS.md](../../../AGENTS.md) —— 分支、架构讨论、测试和 Git 治理规则。

本报告不替代实现代码和测试输出。阶段六集成门、对抗复核和人类 Decision Gate
已通过，路径三已按本报告范围合入 `main`。未勾选的生产连接、Browser 和后续
运行能力仍是明确的后续边界，不纳入本次完成声明。
