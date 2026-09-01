# AlphaOx 路径二：Analysis Context 标准与接入流程详细开发计划

## 0. 计划状态与边界

- **状态**：`COMPLETED`，计划与实现证据索引。
- **目标**：建立 Source Connector、Source Snapshot、Source Binding 和 Context Pack 的严格、可版本化、可追溯契约。
- **权威证据**：[contract-design.md](contract-design.md)。
- **当前实现**：契约、Schema Discovery、Context Pack 生命周期、Binding 生命周期、精确/别名匹配和向量建议边界已在 `packages/semantic-agent` 中实现并通过路径二集成门。
- **外部边界**：不连接真实数据库、飞书、模型、生产身份、向量服务或外部写回。

## 1. 交付目标

路径二只解决“Agent 能否得到可信且可审核的分析上下文”，不解决“Agent 如何循环”。交付必须让调用方区分结构有效、业务口径已审核、来源新鲜和权限已执行这几种不同状态。

## 2. 分阶段计划

| 阶段 | 交付 | 关键实现 | 验收证据 |
| --- | --- | --- | --- |
| 2.0 | 契约基线 | TypeBox/JSON Schema、稳定 ID、版本、来源、权限和 freshness 字段 | 未知字段、凭据字段和断裂引用阻断 |
| 2.1 | Schema Discovery | `SchemaDiscoveryAdapter`、能力前置、稳定排序、结构指纹 | 输入顺序不影响 Snapshot；结构变化改变指纹；异常不伪造 Snapshot |
| 2.2 | Context Pack | 资源引用闭合、全局 resource ID、规范化导入/导出、生效窗口 | round-trip 稳定；草稿、撤销、过期和未来生效状态可区分 |
| 2.3 | Binding 生命周期 | 草稿、审核、发布、撤销、过期、回滚、活动版本指针 | 未批准不能发布；版本冲突不改变活动指针；历史版本保留 |
| 2.4 | 匹配边界 | ID、标签、显式别名、物理名称和可选向量建议 | 唯一命中为 `matched`；歧义为 `clarification_required`；向量永远为非权威 `suggested` |
| 2.5 | 集成门 | 文档、测试、根级检查、差异和对抗审查 | 只在人类 Decision Gate 后合入 Pass 分支 |

## 3. 代码与契约边界

- 主要代码目录：`packages/semantic-agent/src` 与对应 `test`。
- 允许的模块责任：`contracts`、`discovery`、`context-pack`、`binding`、`matching`。
- 本路径不创建 Web、Runtime Host、真实数据库执行器、持久化控制面或模型适配器。
- `DocumentResource` 只保留引用和摘要元数据，不把完整企业文档或原始行写入 fixture。
- `PermissionRef` 表达策略引用，不携带凭据；匹配结果不等于权限已经执行。

## 4. 失败与安全要求

- 未知字段、无效 ID、重复资源、断裂引用、非法 freshness 和非法生效窗口：`blocked`。
- 来源发现能力未声明、适配器异常或非法结构：不调用后续流程，不生成成功 Snapshot。
- Binding 未审核、Pack 未发布、版本不一致或已过期：保留历史对象，但不可用于新运行。
- 确定性匹配出现多候选：必须澄清，不使用输入顺序、模糊距离或向量分数静默裁决。
- 任何向量适配器异常、未知候选、重复候选或非法分数：不采用建议，保留结构化警告/阻断原因。

## 5. 测试与验收

- 运行包级 `semantic-agent` 确定性测试，覆盖 Schema、发现、生命周期、规范化、匹配和失败矩阵。
- 代码变更后运行根级 `npm run check`；不运行未获授权的完整 `npm test` 或发布流程。
- 对抗复核必须检查 locale 依赖排序、同名字段、跨类型 ID、过期版本、向量越权和敏感内容进入对象。
- 本路径无 Web UI，因此不声明 Browser 通过；Browser 状态由路径五报告统一验收。

## 6. 分支、commit 与回滚

- 历史拓扑：`codex/alphaox/pass-02` 下按阶段使用明确的 `pass-02-<slice>` 子分支。
- 每阶段只提交本阶段文件；提交前检查 staged 路径和工作区，禁止锁文件或旧阶段副本混入。
- 回滚只需回到阶段前已验收 commit；本路径未创建外部数据库、索引、队列或真实数据。
- 后续持久化 Context Pack/Binding 时必须另开迁移、备份、双读和回滚决策门。

## 7. 后续依赖

路径三消费本路径的 Context Pack、Binding 和 Snapshot；路径四通过 Runtime Host 调用这些能力；路径五只通过 AlphaOx 自有 API 展示，不直接暴露内部 TypeBox 或 Pi 类型。
