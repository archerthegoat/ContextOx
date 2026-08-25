# AlphaOx 路径二：Analysis Context 契约设计与阶段一验收

## 0. 文档状态

- **所属分支**：`codex/alphaox/path-02`
- **当前切片**：`codex/alphaox/path-02-contracts`
- **阶段**：阶段一，公共契约
- **状态**：阶段一目标实现完成；根级检查受仓库既有类型错误阻塞，待集成门复核；本报告不代表路径二整体完成。
- **人类授权**：人类已同意按阶段开发，并要求每个阶段完成后提交 commit。
- **路线图**：本阶段不修改 `开发路径图.md`。

## 1. 目标、事实与成功标准

### 1.1 目标

建立 AlphaOx 的第一版 Analysis Context 公共契约，使来源、结构快照、业务绑定和上下文包能够被严格校验、版本化、追溯和回滚。

### 1.2 已核实事实

- `codex/alphaox/path-02` 从当前 `main` 创建，当前工作区干净。
- 仓库尚无 `semantic-agent` 或 `semantic-web` 产品包。
- 上游已经存在 `typebox` 依赖；本阶段不新增外部依赖。
- PASS 01 已确定 Context Pack、Source Binding、权限、新鲜度和版本引用是后续路径的边界。
- 本阶段不连接真实企业数据、真实飞书 Wiki、生产身份系统或外部写回系统。

### 1.3 成功标准

- 四类核心对象具有严格的 TypeScript 类型和 JSON Schema 兼容定义。
- 不接受未知字段、凭据字段或不完整的来源/权限/版本引用。
- 合法对象可以被解析为类型安全的值；非法对象返回不泄露原始值的契约错误。
- 当前阶段的测试和构建通过，且不声称 Source 发现、Binding 发布或运行时执行已经完成。

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

## 5. 状态与失败矩阵

| 场景 | 阶段一行为 | 后续运行语义 |
| --- | --- | --- |
| 未知字段或错误类型 | 契约校验失败 | `blocked`，不得继续发布 |
| 缺少来源、版本或权限引用 | 契约校验失败 | `blocked`，不使用不完整上下文 |
| Snapshot 新鲜度未知 | 结构可保存但显式标记 `unknown` | 由路径三决定是否 `partial` 或 `blocked` |
| Binding 未人工审核 | 允许保存草稿，不允许当作已发布资产 | 新运行不得使用未发布版本 |
| Context Pack 被撤销 | 保留历史对象和审计引用 | 新运行拒绝使用，旧报告保留原版本 |
| 来源发现失败 | 不生成伪造 Snapshot | 后续 Connector 返回 `blocked` 或 `partial` |
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

## 8. 分阶段实施

| 阶段 | 交付 | 完成门 |
| --- | --- | --- |
| 0 | 范围和决策门 | 人类确认只做 `semantic-agent` 上下文契约，不连接真实外部系统 |
| 1 | 公共类型、四类 Schema、边界解析和测试 | 包测试、TypeScript 构建、根级检查、对抗审查通过并提交 |
| 2 | Connector 契约、Schema 发现规范化和 Snapshot 生成 | 本地确定性 fixture 覆盖结构变化、发现失败和 freshness |
| 3 | Context Pack 和知识资源描述 | 导入、导出、来源追溯、撤销和过期测试通过 |
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
- [ ] 根级 `npm run check` 通过；本次执行被既有 `packages/ai` 模型目录类型错误阻塞，未出现 `semantic-agent` 新增类型错误。
- [x] 提交范围已审查为仅包含本切片文件；阶段 commit 结果以 Git readback 为准。

### 9.2 Browser 验收

路径二不创建 Web UI，因此本阶段没有可执行的 Browser 视觉验收。Browser 清单继续由路径五执行；路径二只提供可供路径五渲染的结构化状态、来源、版本和错误契约，不能把未实现 UI 标记为通过。

## 10. 未决风险与批准状态

- TypeBox 输出的跨语言 JSON Schema 兼容性需要在后续导入/导出门复核。
- Binding 的业务冲突规则、向量检索实现、飞书适配器和持久化存储仍未冻结。
- 当前 Schema 是路径二阶段一的可审查起点，不代表生产数据库迁移或生产 API 已完成。
- 当前批准状态：人类已批准按本计划分阶段开发；阶段一 commit 和后续阶段仍需分别验收。

## 11. 来源证据

- [开发路径图](../../../开发路径图.md)
- [PASS 01 架构与验收报告](../架构与验收报告.md)
- [仓库治理规则](../../../AGENTS.md)
- [阶段一实现](../../../packages/semantic-agent/src/contracts.ts)
- [阶段一测试](../../../packages/semantic-agent/test/contracts.test.ts)
