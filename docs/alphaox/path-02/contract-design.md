# AlphaOx 路径二：Analysis Context 契约、Schema Discovery 设计与阶段验收

## 0. 文档状态

- **所属分支**：`codex/alphaox/path-02`
- **当前切片**：`codex/alphaox/path-02-binding`
- **阶段**：阶段四，Binding 草稿、审核、发布和回滚
- **状态**：阶段四实现和集成验收完成；子分支 commit `bd2c27df7` 已通过非快进合并 commit `94afd22da` 合入 `codex/alphaox/path-02`；本报告不代表路径二整体完成。
- **人类授权**：人类已同意按阶段开发，并要求每个阶段完成后提交 commit。
- **路线图**：本阶段不修改 `开发路径图.md`。

## 1. 目标、事实与成功标准

### 1.1 目标

建立 AlphaOx 的第一版 Analysis Context 公共契约，使来源、结构快照、业务绑定和上下文包能够被严格校验、版本化、追溯和回滚。

### 1.2 已核实事实

- `codex/alphaox/path-02` 在阶段一开始从 `main` 创建；阶段二从已合入阶段一和根级检查修复的路径分支切出。
- 仓库尚无 `semantic-agent` 或 `semantic-web` 产品包。
- 上游已经存在 `typebox` 依赖；本阶段不新增外部依赖。
- PASS 01 已确定 Context Pack、Source Binding、权限、新鲜度和版本引用是后续路径的边界。
- 本阶段不连接真实企业数据、真实飞书 Wiki、生产身份系统或外部写回系统。
- 阶段一根级检查的已知 `packages/ai` 类型阻塞已在当前路径分支修复：生成的模型目录包装器保留稳定的静态模型类型，即使被 `.gitignore` 排除的模型 JSON 未被水合，根级检查仍可完成。

### 1.3 成功标准

- 四类核心对象具有严格的 TypeScript 类型和 JSON Schema 兼容定义。
- 不接受未知字段、凭据字段或不完整的来源/权限/版本引用。
- 合法对象可以被解析为类型安全的值；非法对象返回不泄露原始值的契约错误。
- 当前阶段的测试和构建通过，且不声称 Source 发现、Binding 发布或运行时执行已经完成。
- 阶段二能够从仅含契约安全上下文的适配器获取结构元数据，生成排序稳定、引用可验证、带 freshness 和结构指纹的 `SourceSnapshot`。
- 阶段三能够规范化、导入和导出 Context Pack 及其知识资源，并在生效窗口和生命周期状态下给出可审计的可用性结果。

## 2. 决策与理由

### D1：阶段一只建立 `semantic-agent` 侧契约

路径二涉及服务端上下文契约，因此阶段一只建立 `packages/semantic-agent`。`semantic-web`、Pi Agent Host 和查询执行器分别属于后续路径，不在本阶段创建。

### D2：使用仓库已有 TypeBox 作为可执行 Schema 来源

TypeBox 已在 monorepo 中使用，能够同时提供 TypeScript 静态类型和 JSON Schema 兼容对象。这样可以避免为第一阶段引入新的校验库、锁文件变更和供应链审查范围。根 Schema 记录 JSON Schema Draft 2020-12 标识；实际跨包兼容仍需在集成门确认。

### D3：契约对象严格拒绝未知字段

四类对象和嵌套对象使用 `additionalProperties: false`。凭据、原始企业行、任意 SQL、完整提示词和未裁剪敏感内容不属于 Context Contract。

### D4：来源、版本、权限和新鲜度是一等引用

Source Snapshot、Source Binding、Context Pack 和其资源必须携带来源引用、版本、生效期或新鲜度信息。历史版本不能被当前草稿静默覆盖；撤销和回滚必须保留历史引用。

### D5：本阶段只冻结结构，不冻结运行时执行

Connector 的能力字段、Binding 的审核状态和 Context Pack 的版本字段用于定义边界，但本阶段不实现数据库连接、查询执行、权限执行器、模型调用或向量检索。

## 3. 拒绝的方案与取舍

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 新增独立 JSON Schema 校验依赖 | 拒绝 | 当前 TypeBox 已足够，避免扩大依赖和锁文件风险。 |
| 让模型直接生成并发布 Binding | 拒绝 | Agent 只能提出草稿；关键业务口径必须人工审核。 |
| 以向量检索作为 Context Pack 权威来源 | 拒绝 | 向量结果不能替代指标口径、权限或数值事实。 |
| 阶段一直接连接飞书 Wiki | 拒绝 | 外部权限、数据新鲜度和同步回读尚未单独批准。 |
| 阶段一实现真实数据库 Connector | 拒绝 | Source Connector 先冻结契约；真实来源和生产凭据属于后续独立决策门。 |

## 4. 契约与边界

阶段一提供以下核心 Schema 和类型：

- `SourceConnector`：来源类型、连接器能力和权限引用；不包含凭据。
- `SourceSnapshot`：表、字段、类型、键、方言、结构指纹、发现时间和新鲜度。
- `SourceBinding`：业务主体、物理目标、粒度、时间语义、审核状态、权限、来源和版本。
- `ContextPack`：来源、Binding 引用、术语、文档引用、数据字典、权限、版本和生效期。

当前实现的公共字段包括：

- `contractVersion`
- 资源 ID和版本 ID
- `SourceRef`、`ResourceRef`、`PermissionRef`
- `Provenance`
- `Freshness`
- `LifecycleStatus`

### 4.1 数据边界

- `DocumentResource` 只保存内容引用、摘要元数据和来源，不把真实企业文档全文写入测试 fixture。
- `PermissionRef` 只保存策略引用，不保存凭据或完整授权规则。
- 连接器能力声明不代表连接器已经可用，也不代表数据已经被授权。
- Schema 通过只读契约表达来源能力，不允许模型或客户端传入任意 SQL。

### 4.2 阶段二 Schema Discovery 设计

阶段二把真实来源接入限制在 `SchemaDiscoveryAdapter` 边界。适配器只能接收已通过 `SourceConnector` 契约校验的 `connector`、`snapshotId` 和 `version`；不向适配器传递凭据、任意查询、原始行或模型提示词。`discoverSchema` 能力为 `false` 时，在调用适配器前返回 `blocked / unsupported_capability`。

适配器返回的未知值先经过 fail-closed 解析，再生成严格的 `SourceSnapshot`：

- 表、列、主键和外键必须使用稳定 ID；不从展示名称猜 ID。
- 表、列、外键约束和关键引用必须唯一且可解析；外键列数必须与目标列数一致。
- 表按 `tableId`、列按 `ordinal` 后 `columnId`、外键按 `constraintId` 排序。排序使用稳定的 ID 比较，不依赖运行环境 locale。
- `structureFingerprint` 对方言、表/列结构和关系计算 SHA-256；输入排列变化不改变指纹，结构变化改变指纹。`rowCount` 是观察元数据，不参与结构指纹。
- `freshness` 原样进入快照并由 `SourceSnapshot` 契约校验；缺失或非法 freshness 不生成成功快照。
- 适配器异常或返回非法结构时只返回不含原始错误/数据的 `blocked` 结果，不伪造 Snapshot。合法但未定义的原始扩展字段不会进入快照。

当前 `SourceSnapshot` 契约只保留 `sourceId`、版本、发现时间、freshness 和结构字段；不在阶段二擅自扩展 `connectorId`、provenance 或权限执行字段。连接器的权限引用仍由 `SourceConnector` 携带，Binding 的业务追溯与发布规则留给后续阶段。

### 4.3 阶段三 Context Pack 与知识资源设计

阶段三在既有 `ContextPackSchema` 上增加运行时规范化边界，不修改基础 JSON Schema。Pack 内的 `resourceId` 采用全局唯一策略，不按资源类型分区；这样术语、文档和数据字典之间不会出现同 ID 冲突，外部引用和审计定位也保持单一含义。

- Pack、provenance、资源和引用集合按稳定键排序；别名和数据字典 `termIds` 视为集合并排序，重复项直接阻断。文档只保留 `ContentRef`，不接收或持久化全文和原始企业数据。
- Pack 顶层 `sources` 必须覆盖 provenance 和每个资源的来源；数据字典的 `termIds` 必须指向同一 Pack 中的术语资源。`bindings` 只能引用 `source_binding`，Binding 对象本身由后续阶段解析和发布。
- 导入先做严格契约校验，再做引用和时间窗口校验；未知字段、断裂引用、重复资源和无效生效窗口不生成部分 Pack。导出使用规范化后的紧凑 JSON，导入/导出 round-trip 必须保持同一规范化值。
- `published` 且处于 `[effectiveFrom, effectiveTo)` 窗口内的 Pack 才可用；`draft`、`in_review`、`revoked`、`expired` 和 `rolled_back` 均阻断。窗口外阻断，`effectiveTo` 等于当前时间即视为已过期。
- freshness 为 `expired` 时阻断；`stale` 和 `unknown` 不被标记为新鲜权威，但阶段三返回可用加警告，是否在具体分析中转为 `partial` 或 `blocked` 留给路径三。

### 4.4 阶段四 Binding 生命周期、冲突与回滚设计

阶段四只提供纯内存的 Binding 规范化、生命周期转换和注册表，不连接数据库、权限执行器、模型、飞书 Wiki 或其他外部系统。Binding 的语义内容和生命周期元数据分开比较：同一 `bindingId + version` 允许 `draft`、`in_review`、`published` 等状态转换，但语义字段发生变化时必须阻断为 identity mismatch。

- `normalizeSourceBinding` 先执行严格契约校验，再对 provenance 来源、target 列和 target 集合做确定性规范化；可选的 `SourceSnapshot` 交叉校验会拒绝不存在的表、列、时间列和不匹配的快照引用。
- 生命周期只允许 `draft -> in_review`、`in_review -> draft`、`in_review -> published` 和 `published -> revoked / expired`。发布必须带 `approved` 审批；撤销或过期保留历史审批记录。`rolled_back` 不作为原地状态修改，而是注册表移动历史版本指针的结果。
- `BindingRegistry` 只在内存中保存按 `bindingId + version` 索引的规范化历史版本和每个 Binding ID 的一个活动版本指针。发布新版本先校验当前活动 Binding 的冲突，再写入版本并切换指针；冲突或失败时不改变当前指针。
- 冲突规则包括：同一 `bindingId + version` 的语义内容不一致、同一 Binding ID 出现多个活动版本、不同 Binding ID 复用同一 `subjectId`。完全相同的别名对象不产生冲突，冲突结果按稳定键排序。
- 回滚只允许切回曾经发布过、当前仍可发布且 freshness 未过期的历史版本；回滚返回 `rolled_back` 结果和前后版本，不删除版本和审计信息。

## 5. 状态与失败矩阵

| 场景 | 当前行为 | 后续运行语义 |
| --- | --- | --- |
| 未知字段或错误类型 | 契约校验失败 | `blocked`，不得继续发布 |
| 缺少来源、版本或权限引用 | 契约校验失败 | `blocked`，不使用不完整上下文 |
| Snapshot 新鲜度未知 | 结构可保存但显式标记 `unknown` | 由路径三决定是否 `partial` 或 `blocked` |
| Binding 未人工审核 | 允许保存草稿，不允许当作已发布资产 | 新运行不得使用未发布版本 |
| Context Pack 被撤销 | 保留历史对象和审计引用 | 新运行拒绝使用，旧报告保留原版本 |
| 来源发现失败 | 不生成伪造 Snapshot | 后续 Connector 返回 `blocked` 或 `partial` |
| 连接器未声明 `discoverSchema` 能力 | 在调用适配器前返回 `blocked / unsupported_capability` | 不执行发现，不产生 Snapshot |
| 适配器返回空表、重复 ID 或断裂引用 | 规范化失败，返回 `blocked / invalid_schema` | 不接受不完整结构 |
| 输入表/列/FK 顺序变化 | 规范化后顺序和结构指纹不变 | 可安全比较同一结构的重复发现 |
| 仅 rowCount 变化 | 快照保留新 rowCount，但结构指纹不变 | freshness 和行数新鲜度由后续策略判断 |
| 表/列/关系结构变化 | 生成不同结构指纹 | 后续 Binding 必须重新审查适配范围 |
| Pack 内资源 ID 重复或跨类型冲突 | 规范化失败，返回 `invalid_pack` | 不产生可导入 Pack |
| 资源来源、provenance 或术语引用断裂 | 规范化失败，返回 `invalid_pack` | 不使用不完整追溯链 |
| Pack 为草稿、审核中、撤销、过期或回滚 | 可保存历史对象，但可用性返回 `blocked` | 新运行不得使用该版本 |
| Pack 尚未生效或已超过 `effectiveTo` | 可保存对象，但当前时点返回 `blocked` | 按版本和生效窗口选择 |
| freshness 为 `stale` 或 `unknown` | 可用性返回 warning，不声称新鲜 | 路径三决定 `partial` 或 `blocked` |
| freshness 为 `expired` | 可用性返回 `blocked / freshness_expired` | 不进入当前分析上下文 |
| Binding 为草稿或审核中 | 可登记和修改生命周期，不可发布 | 新运行不得使用未发布 Binding |
| Binding 发布缺少 approved 审批 | 发布转换阻断 | 不创建活动版本指针 |
| Binding 同版本语义内容变化 | 注册或冲突检查阻断 | 保持已有版本和活动指针不变 |
| 不同 Binding ID 复用 subjectId | 发布和冲突检查阻断 | 不切换活动指针 |
| Binding freshness 为 expired | 发布和回滚阻断 | 不使用过期版本 |
| 回滚目标未曾发布或不存在 | 返回安全错误 | 当前活动指针不变 |
| 导入 JSON 非法或包含未知字段 | 返回安全错误，不保留原始内容 | 不回退为部分成功 |
| 歧义字段或同名业务概念 | 不自动选择 | 路径二进入人工审核或 `clarification_required` |
| 凭据或原始企业行进入对象 | 严格字段拒绝 | 不发送、不持久化、不回退为成功 |

## 6. 边界情况与对抗问题

- ID 只能使用受约束的非空格式，避免空 ID、路径注入和不可追踪引用。
- 版本只作为不透明引用，不在阶段一假设发布系统或数据库迁移已经存在。
- 同一物理字段可能被多个 Binding 引用；冲突解决属于后续 Binding 规则，不由字段名猜测。
- `effectiveTo` 可以缺省表示持续有效，但过期判断必须由新鲜度/策略层决定。
- 资源来源与 Context Pack 来源可以不同；两者都必须保留，不能只保留最终 Pack ID。
- 当前只做结构校验，不把 Schema 结构有效误判为业务口径正确。

## 7. 依赖、迁移与回滚

### 7.1 依赖

- Node.js / TypeScript。
- 仓库已有 TypeBox 1.3.7。
- Vitest 仅用于确定性契约测试。
- 不依赖真实数据库、飞书、模型服务、向量库或生产控制面。

### 7.2 迁移顺序

后续持久化实现必须先建立版本记录，再写入新的 Binding、Context Pack 和策略版本，最后切换读取指针。旧版本保持只读可回放。

### 7.3 回滚边界

- 本阶段代码回滚到上一个已验收 commit。
- Context Pack 回滚只切换发布指针，不删除新版本和审计记录。
- Schema 不兼容时拒绝导入，不把未知字段静默降级到旧版本。
- 本阶段不执行数据库迁移、生产切换或数据删除。
- 阶段二只在内存中规范化适配器结果，不新增持久化迁移；回滚到阶段二前的已验收 commit 即可移除发现边界，不需要删除外部数据。
- 阶段三同样只在内存中规范化和导入/导出，不新增数据库或外部存储迁移；回滚到阶段三前的已验收 commit 不需要删除外部数据。
- 阶段四只在内存中保存 Binding 版本和活动指针，不新增数据库或外部存储迁移；回滚到阶段四前的已验收 commit 不需要删除外部数据，失败发布不会留下外部半提交状态。

## 8. 分阶段实施

| 阶段 | 交付 | 完成门 |
| --- | --- | --- |
| 0 | 范围和决策门 | 人类确认只做 `semantic-agent` 上下文契约，不连接真实外部系统 |
| 1 | 公共类型、四类 Schema、边界解析和测试 | 包测试、TypeScript 构建、根级检查、对抗审查通过并提交 |
| 2 | Connector 契约、Schema 发现规范化和 Snapshot 生成 | 稳定 ID、能力门、引用校验、结构指纹、freshness、失败阻断和根级检查通过并提交 |
| 3 | Context Pack 和知识资源描述 | 全局资源 ID、资源引用、导入/导出、生命周期、freshness 和根级检查通过并提交 |
| 4 | Binding 草稿、审核、发布和回滚 | 状态机、权限引用、历史版本和冲突测试通过 |
| 5 | 精确/别名匹配和可选适配边界 | 歧义、未知、向量非权威边界测试通过 |
| 6 | 集成门 | 差异、测试、风险、回滚和未决项展示后进行人类 Decision Gate |

## 9. 验收清单

### 9.1 阶段一验收

- [x] 四类核心对象具备严格 TypeBox / JSON Schema 兼容定义。
- [x] 公共 ID、版本、来源、权限、新鲜度和生效时间字段已定义。
- [x] 未知字段和凭据字段被拒绝。
- [x] 合法 Connector、Snapshot、Binding 和 Context Pack fixture 可解析。
- [x] 非法对象产生不包含原始输入的安全错误。
- [x] `npm run test --workspace=@alphaox/semantic-agent` 通过。
- [x] `npm run build --workspace=@alphaox/semantic-agent` 通过。
- [x] 根级 `npm run check` 通过；另在移走被忽略的 `packages/ai/src/providers/data` 后复跑，确认未水合模型 JSON 时仍通过。
- [x] 提交范围已审查为仅包含本切片文件；阶段 commit 结果以 Git readback 为准。

### 9.2 阶段二验收

- [x] `SourceConnector` 先校验，凭据和额外字段不进入适配器上下文；未声明 `discoverSchema` 能力的连接器不会调用适配器。
- [x] 适配器上下文只包含 `connector`、`snapshotId` 和 `version`；不包含 SQL、凭据、原始行或模型输入。
- [x] 表、列、主键和外键引用完成稳定 ID、重复值、缺失目标和列数匹配校验。
- [x] 输入顺序变化得到相同规范化 Snapshot 和结构指纹；结构变化得到新指纹。
- [x] 结构指纹不因 rowCount 单独变化而变化，并保留 freshness 元数据。
- [x] 适配器异常、空结构、非法结构返回 `blocked`，不返回伪造 Snapshot，也不泄露原始错误。
- [x] 原始 schema 扩展字段不会写入 Snapshot；SourceSnapshot 仍由严格契约校验。
- [x] `npm run test --workspace=@alphaox/semantic-agent` 通过：2 个测试文件、12 个测试。
- [x] `npm run build --workspace=@alphaox/semantic-agent` 通过。
- [x] 对抗复核已处理 locale 依赖排序、重复外键列和能力未声明三类边界。

### 9.3 阶段三验收

- [x] Context Pack 内资源 ID 全局唯一，跨类型重复也会阻断。
- [x] Pack、provenance、资源来源、数据字典术语和 Binding 类型引用完成闭合校验。
- [x] Pack、资源集合、别名、来源和权限集合完成确定性规范化排序。
- [x] 非法生效窗口、未知字段、非法 JSON 和断裂引用返回安全错误，不保留原始输入。
- [x] 规范化导出和导入 round-trip 得到相同值。
- [x] `published` 生效窗口、草稿、审核中、撤销、过期、回滚和未来生效状态均有明确可用性结果。
- [x] `stale` / `unknown` freshness 返回 warning，`expired` freshness 返回 blocked。
- [x] `npm run test --workspace=@alphaox/semantic-agent` 通过：3 个测试文件、18 个测试。
- [x] `npm run build --workspace=@alphaox/semantic-agent` 通过。
- [x] 根级 `npm run check` 通过，且无锁文件或依赖变更。

### 9.4 阶段四验收

- [x] Binding 规范化严格拒绝未知字段、重复目标列、重复关系路径和重复目标，并可按 Source Snapshot 校验表、列和时间语义引用。
- [x] 生命周期状态机覆盖草稿、审核中、退回草稿、发布、撤销和过期；发布需要 `approved` 审批，撤销和过期保留审批记录。
- [x] 注册表允许同一版本的生命周期更新，但拒绝同一 `bindingId + version` 的语义内容变化。
- [x] 注册表保证每个 Binding ID 一个活动版本；发布新版本和回滚只移动指针，不删除历史版本。
- [x] 冲突检测覆盖同版本内容不一致、多活动版本和跨 Binding ID 的 subject 冲突；相同规范化对象不误报冲突。
- [x] freshness 为 `expired` 时发布和回滚阻断；不存在或从未发布的回滚目标返回安全错误，冲突发布不改变当前指针。
- [x] `npm run test --workspace=@alphaox/semantic-agent` 通过：4 个测试文件、23 个测试。
- [x] `npm run build --workspace=@alphaox/semantic-agent` 通过。
- [x] 根级 `npm run check` 通过，且无锁文件或依赖变更。
- [x] 对抗复核已覆盖状态更新返回值、审批保留、同版本内容保护、活动指针不变和快照引用边界。

### 9.5 Browser 验收

路径二不创建 Web UI，因此本阶段没有可执行的 Browser 视觉验收。Browser 清单继续由路径五执行；路径二只提供可供路径五渲染的结构化状态、来源、版本和错误契约，不能把未实现 UI 标记为通过。

## 10. 未决风险与批准状态

- TypeBox 输出的跨语言 JSON Schema 兼容性需要在后续导入/导出门复核。
- 当前适配器仍是接口边界和本地 fixture；真实数据库/API/文件/知识库连接器、凭据托管、权限执行和连接健康度尚未实现或验收。
- rowCount 不参与结构指纹；如果后续需要对行数 freshness 做决策，必须在独立数据质量契约中定义，不能把结构指纹当作行数据新鲜度证明。
- Context Pack 导入/导出当前是进程内边界，尚未接入持久化版本库、签名校验或跨服务传输协议。
- 当前 Binding 冲突规则仅在内存注册表中实现；向量检索、飞书适配器和持久化存储仍未实现。
- 当前实现是路径二阶段一、二、三的可审查起点，不代表生产数据库迁移或生产 API 已完成。
- 当前批准状态：人类已批准按本计划分阶段开发并确认阶段四设计；阶段一、二、三已通过前置集成门，阶段四已通过子分支和集成分支验收并合入 `codex/alphaox/path-02`，仍需路径二最终 Decision Gate。

## 11. 来源证据

- [开发路径图](../../../开发路径图.md)
- [PASS 01 架构与验收报告](../架构与验收报告.md)
- [仓库治理规则](../../../AGENTS.md)
- [阶段一实现](../../../packages/semantic-agent/src/contracts.ts)
- [阶段一测试](../../../packages/semantic-agent/test/contracts.test.ts)
- [阶段二发现实现](../../../packages/semantic-agent/src/discovery.ts)
- [阶段二发现测试](../../../packages/semantic-agent/test/discovery.test.ts)
- [阶段三 Context Pack 实现](../../../packages/semantic-agent/src/context-pack.ts)
- [阶段三 Context Pack 测试](../../../packages/semantic-agent/test/context-pack.test.ts)
- [阶段四 Binding 实现](../../../packages/semantic-agent/src/binding.ts)
- [阶段四 Binding 测试](../../../packages/semantic-agent/test/binding.test.ts)
- [阶段一根级检查修复](../../../packages/ai/scripts/generate-models.ts)
