# AlphaOx 路径三：确定性计划、执行与证据内核详细开发计划

## 0. 计划状态与边界

- **状态**：`COMPLETED`，计划与实现证据索引。
- **目标**：把路径二上下文资产转换为可验证的 Analysis Plan、类型化 Query Plan、前置检查、参数化编译、只读执行、Result/Evidence 和可取消的确定性运行。
- **权威证据**：[architecture-and-acceptance.md](architecture-and-acceptance.md)。
- **当前实现**：路径三阶段一至六已合入 `main`；使用本地确定性 fixture，不连接真实数据库、知识服务、模型、身份系统或生产控制面。

## 1. 交付目标

路径三必须让系统在调用执行器之前完成契约、引用、权限、freshness、关系、粒度、成本和只读检查，并让结果与证据共享同一版本、来源、时间和状态边界。

## 2. 分阶段计划

| 阶段 | 交付 | 关键实现 | 通过门 |
| --- | --- | --- | --- |
| 3.0 | 架构与契约冻结 | `analysis.v1`、`BindingExecutionSpec`、状态和失败矩阵 | 报告获人类确认 |
| 3.1 | 计划 DAG | 严格字段、步骤类型、依赖、版本和引用解析 | 未知字段、断裂引用、环和版本错配阻断 |
| 3.2 | 前置检查 | 策略 `allow/deny/unknown`、freshness、关系、粒度、预算 | 未通过前置检查不得调用 executor |
| 3.3 | 编译器 | 类型化 AST、allowlist、参数绑定、方言能力和 query digest | SQL/脚本/未知标识符无法穿透 |
| 3.4 | 结果与证据 | ResultEnvelope、EvidenceEnvelope、最小化、完整性摘要 | 无证据或敏感结果不得作为成功释放 |
| 3.5 | 确定性运行时 | fixture executor、串行 DAG、取消、截止时间、预算、部分失败 | `complete/partial/blocked/clarification_required` 可重放 |
| 3.6 | Pass 集成 | 根级检查、包测试、差异、风险和回滚 | 人类 Decision Gate 后合入 `main` |

## 3. 核心契约边界

- `QueryPlan` 是不含任意 SQL 字符串的类型化 AST；编译产物只由确定性编译器生成。
- `ExecutionContext` 只携带非秘密控制信息；凭据、完整提示词、原始行和完整策略正文不得进入。
- `ReadOnlyQueryExecutor`、`KnowledgeRetriever` 和 fixture executor 都是注入边界，不由模型直接控制。
- `ResultEnvelope` 负责受限结构化结果；`EvidenceEnvelope` 负责来源、版本、时间、计划和转换链证明，不负责生成业务结论。
- 顶层状态保持显式：`complete`、`partial`、`blocked`、`clarification_required`；空结果、连接失败、权限过滤和过期状态不能混为一谈。

## 4. 失败与对抗要求

- 契约未知字段、引用断裂、权限 `unknown`、过期 freshness、关系/粒度不一致和不支持方言：执行前 `blocked`。
- 用户输入只能作为参数值，不能改变表名、列名、排序方向、查询结构或函数。
- 结果超行数/字节/截止时间或证据封装失败：返回 `partial` 或 `blocked`，不得伪装为空成功。
- 首步骤失败与后续步骤失败必须区分；后者保留已完成步骤并返回 `partial`。
- 取消、dispose、超时和依赖跳过必须释放 fixture 状态，不启动新的依赖步骤。
- query digest、参数顺序、规范化计划和状态原因在同一输入下稳定。

## 5. 测试与验收

- 运行 `@alphaox/semantic-agent` 包级确定性测试，覆盖契约、Preflight、Compiler、Result、Evidence 和 Runtime。
- 代码变更后运行根级 `npm run check`；不连接真实模型、数据库、飞书或付费 Provider。
- 对抗检查必须包含 SQL 注入、未知列、非法排序、越权 Binding、重复证据、截断结果、取消竞态、依赖失败和敏感异常文本。
- 本路径不创建 Web UI，因此 Browser 继续标记为 `NOT RUN`；路径五必须消费本路径的结构化状态。

## 6. 分支、commit 与回滚

- 历史拓扑：`codex/alphaox/pass-03` 下按阶段使用 `pass-03-<slice>`，完成后合入 Pass 分支。
- 每个阶段提交前检查 staged 文件只包含本阶段变更；不加入锁文件、真实数据、凭据或旧阶段副本。
- 回滚为代码 commit 回退；本路径没有数据库、队列、缓存或外部文件迁移。
- 任何持久化计划、并发调度、长任务恢复、真实方言或真实权限适配必须另开路径/决策门。

## 7. 后续依赖

路径四只在本路径的 AlphaOx 自有计划、执行、结果和证据契约上接入 Agent Runtime；路径五只渲染这些结构化协议，不读取 Pi 私有事件或内部异常。
