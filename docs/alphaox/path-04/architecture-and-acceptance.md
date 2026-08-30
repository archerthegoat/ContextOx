# AlphaOx Path 04：Runtime Host 与受控数据工具架构及验收报告

## 0. 文档状态与 Decision Gate

| 项目 | 当前值 |
| --- | --- |
| 适用范围 | Path 04：Agent Runtime 接入与受控工具编排 |
| 当前工作分支 | `main` / `codex/alphaox/pass-04`（4.6 技术集成已完成，尚未合入 `main`）；当前无活动切片 |
| 实现切片规则 | `codex/alphaox/pass-04-<slice>`，完成后合回 `codex/alphaox/pass-04` |
| 最终稳定分支 | `main` |
| 架构状态 | 本地优先方案已获 2026-08-26 人类 Decision Gate 批准；4.0 至 4.6 技术实现与集成验证已完成，待 Pass Decision Gate 决定是否合入 `main` |
| Browser 状态 | `NOT RUN`；Path 04 不声称 Web 产品已实现 |
| 真实模型 / 数据源 | 未连接；只允许 fake model、fixture 和确定性测试 |
| 外部写入 | 未执行；不推送、不建 PR、不部署、不发布 |

本报告是 Path 04 的当前架构与验收权威。旧的
`docs/alphaox/架构与验收报告.md` 保留为 PASS 01 历史基线；其中 Docker、多用户、
PostgreSQL 优先和两个产品包的表述不覆盖本报告的本地优先决策。

本报告只在人类确认下冻结 Runtime Host、Pi 内部适配器、受控数据工具、循环、
本地状态边界和验收清单。确认架构不等于确认代码已完成，也不授权真实凭据、
真实数据、网络写入、推送或部署。

## 1. 目标、事实与成功标准

### 1.1 真实目标

AlphaOx 是一个本地优先的 Data Agent 基础设施与应用框架。它把 Web UI、会话
状态、受控数据工具、确定性执行、证据和报告能力封装在一个可本地启动的服务
中，让外部 Agent 实现可以使用一套合格、可验证、可审计的数据接口。

Agent 的推理、循环和模型调用由内部 Runtime 实现承载；Pi 只是当前内部实现
来源和适配边界，不进入 AlphaOx 的公开产品定位、HTTP 契约或前端类型。AlphaOx
不把“模型输出了一段 SQL”当作可用的 Data Agent；核心价值是字段、语义、权限、
计划、执行和证据的规范化框架。

### 1.2 已核实事实

- Path 02 已提供 Source Snapshot、Binding、Context Pack、Discovery 和匹配的
  本地契约；Path 03 已提供 Analysis Plan、Query Plan、编译/执行前置检查、
  Results、Evidence 和确定性测试边界。
- 当前 `packages/semantic-agent` 是 AlphaOx 自有契约包；当前没有真实数据库、
  真实模型、真实 Feishu、向量库或生产服务可以作为 Path 04 的证据。
- Pi 的 Agent Core 可以提供模型适配、事件、上下文、工具生命周期和取消等内部
  运行能力，但不提供 AlphaOx 的权限、语义资产、证据、状态所有权或本地部署契约。
- Path 04 的实现必须使用 fake model、fake Pi stream 和自有 fixtures；不得因为
  单元测试通过就声称真实 Provider、真实 Connector 或 Browser 通过。

### 1.3 Path 04 成功标准

1. AlphaOx 对外只暴露自己的 Run、Event、Tool、Evidence 和 Result 契约；Pi 私有
   类型不从 AlphaOx public export 泄漏。
2. Runtime Host 能把结构化用户请求交给内部 Runtime，并把模型提出的工具调用
   送入 AlphaOx-owned preflight；未注册、未授权、超预算、非结构化或含任意 SQL/
   代码的调用不会进入 Tool 执行器。
3. 运行状态、取消、澄清、有限重试、预算耗尽、部分结果和错误都能产生显式终态
   与 Trace；不能由模型文字或 HTTP 200 推断成功。
4. 受控工具注册表是唯一的数据能力入口；Path 04 不开放动态插件加载、任意命令、
   任意 SQL、文件系统、Shell、凭据或网络工具。
5. 所有测试不调用真实模型、数据库或外部网络；根级 `npm run check` 的结果单独
   记录，不把仓库既有阻塞伪装成 Path 04 通过。
6. 完整 Browser 清单保持 `NOT RUN`，直到 Path 05 的本地 Web 服务和 UI 存在；
   Path 04 的可通过证据是契约测试、fake runtime 测试、失败注入和对抗性审查。

## 2. 决策与理由

### D4-1：本地优先的单进程产品拓扑

**决定**：Path 05 的参考运行形态是一个 Node 进程，提供静态 Web UI、同源 HTTP
JSON、SSE、本地 AlphaOx Runtime Host 和受控工具。默认监听 `127.0.0.1`，默认
端口提案为 `43120`，命令提案为 `alphaox start`，并允许显式指定 `--host`、
`--port` 和 `--data-dir`。

**理由**：产品目标是个人环境可安装、可使用的规范化 Data Agent 基础设施。一个
本地服务能统一 UI、状态、权限和执行边界，避免浏览器直接碰数据库，也不要求首
版先承担企业多租户部署。

**边界**：这不是对恶意同机进程的安全承诺；Path 05 必须保留 loopback、Origin、
CSRF、请求大小、速率和错误信息边界。企业服务模式只能作为后续显式模式，不能让
本地默认配置静默暴露到公网。

### D4-2：本地单用户身份和工作区

**决定**：本地首版使用受服务端控制的 `owner_id` 与 `workspace_id`。浏览器传入
的身份字段不具备授权效力；服务端从本地启动上下文或本地身份适配器注入身份。首
版不做企业登录和多租户共享，但所有状态、缓存、工具上下文和报告仍必须带 owner/
workspace 边界，为后续服务模式保留扩展点。

**理由**：单用户不等于无边界。现在就保留所有权字段，可以防止把后续 SQLite、报告
和缓存做成全局单例，同时不虚构首版已有 OIDC 或组织权限。

### D4-3：AlphaOx 拥有状态；Path 04 使用 StateStore 抽象

**决定**：Runtime 状态、Run、Trace、Result 和 Report 的所有权属于 AlphaOx，
不使用 Pi session schema 作为公开持久化契约。Path 04 只实现可替换的 StateStore
接口和内存/fixture 实现；Path 05 再将本地状态绑定到 AlphaOx-owned SQLite 文件，
服务模式另行评估 PostgreSQL。

**理由**：Runtime 实现可以替换，历史运行和证据仍需稳定可读。把 Pi 会话文件当成
产品数据库会把内部实现细节扩散到迁移、恢复和 UI，且无法表达 AlphaOx 的证据和
所有权边界。

### D4-4：凭据和模型外发必须显式授权

**决定**：数据源和模型凭据通过 SecretStore 抽象取得；不会进入浏览器、普通 Trace、
模型上下文、Tool 参数或 Git。模型调用必须显式配置 provider/model、超时、预算、
最小上下文和允许外发范围；模型不可用或 SecretStore 缺失时 fail closed。

### D4-5：Pi 是内部 Runtime 适配边界

**决定**：AlphaOx 内部可用 Pi adapter 把模型消息、事件、工具生命周期、取消和
停止信号转换为 AlphaOx-owned Runtime Host contract。Pi 类型、session 类型和
上游 transport 类型不出现在 AlphaOx public export；不直接把 `pi-server` 当作
AlphaOx HTTP API。

**理由**：薄适配层保留上游同步和替换余地；AlphaOx 的权限、计划、证据和状态不能
依赖某个上游私有类型。当前不建立通用的第二套 Runtime plugin API；只有出现第二
个真实 Runtime 实现并完成新的 Decision Gate 后，才重新评估抽象。

### D4-6：受控数据工具是唯一数据入口

**决定**：所有数据能力只能通过静态注册、版本化、带输入/输出 Schema 和策略元数
据的 Controlled Data Tool。Tool 接收结构化的已验证计划引用，不接受模型提供的
任意 SQL、JavaScript、TypeScript、Shell、文件路径、凭据或网络地址。

**理由**：Prompt 不是权限边界。工具注册表、Path 03 编译器和执行前置检查才是可
测试的安全边界；任何绕过注册表的“方便接口”都直接破坏本项目定位。

### D4-7：确定性循环由 AlphaOx 控制

**决定**：内部 Runtime 可以提出下一步和工具调用，但 Run 状态机、最大步数、模型
轮次、工具并发、字节/行数、超时、重试、取消和终态由 AlphaOx Runtime Host 控制。
澄清和重规划必须回到结构化 Context/Plan 流程，不能由模型自行改变权限或预算。

## 3. 拒绝的方案与取舍

| 方案 | 处理 | 主要理由 |
| --- | --- | --- |
| 首版继续以 Docker 多用户服务为主 | 拒绝作为默认形态 | 与个人本地安装目标不符，提前引入登录、PostgreSQL、网络和运维面。 |
| 直接把 Pi Server 暴露给 Web | 拒绝 | 不能替代 AlphaOx 的 owner、policy、tool、evidence 和状态契约。 |
| 浏览器直接连接数据库或保存凭据 | 拒绝 | 无法建立服务端只读、脱敏、审计和凭据边界。 |
| 模型直接生成 SQL/代码再执行 | 拒绝 | 无法稳定强制权限、方言、成本、只读和证据最小化。 |
| Path 04 先做 JSON 文件持久化 | 拒绝 | 并发、迁移、原子写入和审计边界不足；Path 04 使用 StateStore，Path 05 决定 SQLite。 |
| 为未来可能的 Runtime 先建通用插件系统 | 延后 | 当前只有一个内部 Runtime，额外抽象会扩大权限和兼容面。 |
| 用真实模型/数据库做 Path 04 单测 | 拒绝 | 不可重复、可能泄露凭据且无法定位契约失败；真实接入是后续独立 Gate。 |

## 4. 契约与边界

### 4.1 组件和数据流

```text
本地 Web UI
    │ same-origin HTTP JSON / SSE
    ▼
AlphaOx Local Service ──► Owner / Workspace / SecretStore
    │ start Run
    ▼
AlphaOx Runtime Host
    ├── internal Pi Adapter ──► explicit Model Egress
    ├── Context + Plan ──► Path 02 / Path 03 contracts
    ├── Policy + Budget Preflight
    └── Controlled Data Tool Registry
            │ validated call only
            ▼
    Deterministic Executor ──► Source Connector boundary / fixtures
            │ bounded result
            ▼
    Evidence + Trace ──► AlphaOx StateStore ──► Result / Report
```

浏览器不直接连接数据源。模型不直接调用 Connector。Connector 不决定用户授权。
AlphaOx 负责把已授权的 Context、Plan、Tool、Result 和 Evidence 串成一个可回放
的 Run；Pi adapter 只负责内部 Runtime 能力转换。

### 4.2 AlphaOx-owned Runtime 合同

公开合同至少表达：

- `Run`：`run_id`、`trace_id`、`owner_id`、`workspace_id`、创建时间、当前状态、
  budget 使用、Context/Plan/Policy/Tool 版本指针和终态原因。
- `RuntimeEvent`：稳定 `event_id`、`run_id`、`trace_id`、事件类型、发生时间、
  payload 版本、最小 payload。事件必须可去重、可排序或显式标记乱序。
- `RunStatus`：`queued`、`planning`、`awaiting_clarification`、`executing`、
  `cancelling`、`reconnecting`、`complete`、`partial`、`blocked`、
  `clarification_required`，以及原因字段 `cancelled`、`budget_exhausted`、
  `source_unavailable`、`query_not_run` 等。
- `RuntimeCommand`：开始、继续澄清、取消、有限重试和恢复快照；每个命令都经过
  owner/workspace、状态和幂等检查。
- `Result` / `EvidenceEnvelope`：结果状态、数值/文字证据、来源版本、`as_of`、
  freshness、权限范围、警告、Trace 指针和裁剪边界；不得把原始全量行当作 UI 合同。

AlphaOx public export 不包含 Pi `Agent`、Pi session、Pi event union 或 Pi
transport 类型。内部 adapter 可以依赖它们，但要在边界处转换为上述合同。

### 4.3 Controlled Data Tool 合同

每个注册工具至少拥有：工具名和版本、能力描述、输入 Schema、输出 Schema、只读
标记、支持的来源类型、超时/行数/字节预算、需要的策略类别、证据生成规则和 owner。

一次调用必须经历：

1. Runtime Host 校验事件和结构化参数；
2. Registry 查找工具名与版本；
3. Policy Preflight 检查 owner、workspace、Binding/Source 版本、freshness、
   只读、预算和取消信号；
4. 确定性执行器调用工具；
5. 结果 Schema、脱敏、行/字节限制和 Evidence 封装；
6. 写入 Trace/StateStore 后才向 Runtime 和 UI 返回结果。

未知工具、未知字段、任意 SQL/代码、未授权来源和无效结果均在第 4 步以前阻断。

4.3 的确定性实现把上述边界落成 `ControlledToolRegistry`：

- `register()` 只接受带工具 ID/版本、能力、来源类型、输入/输出 Schema、只读标记、策略类别、超时、行/字节预算和 Evidence 要求的静态定义；同一 ID/版本不能重复注册，Schema 不允许声明 `sql`、`raw_query`、`command`、`credential` 等危险字段。
- `invoke()` 先查找精确版本，再校验来源类型、输入 Schema、纯 JSON 可序列化边界、SQL/code-like 值、步数预算和取消信号；授权回调只收到 owner/workspace、版本、来源、策略、输入 digest 和剩余预算，不收到原始输入。
- 执行器只接收已校验的结构化输入和受控 `AbortSignal`。结果返回前重新校验输出 Schema、纯 JSON/敏感字段、行数、UTF-8 字节数和 `evidenceReady`；不满足任一条件就返回结构化 `blocked`，不释放结果。
- Registry 只记录 `invocation_started`、`invocation_completed`、`invocation_partial` 和 `invocation_blocked` 的最小生命周期事件，不保存原始输入或输出。超时/取消会 abort 执行信号并清理活动调用；同一 invocation ID 仍保留幂等阻断。
- Registry 是 AlphaOx 的数据能力入口，但不代替 Path 02/03 的 Binding、Snapshot、freshness 和 Query Plan 编译；这些版本语义由上游 Context/Preflight 注入授权决策，真实 Connector 仍不在 Path 04。

4.4 的确定性实现落成 `LoopController`，并把 Runtime Host 与 Registry 串成单个 AlphaOx-owned loop：

- `LoopDriver` 只能返回结构化的 `clarification_required`、`tool_call`、`complete`、`partial` 或 `blocked` 决策；未知字段、任意文字事件、无效 digest 和非法资源引用直接进入 `invalid_runtime_event`，不调用工具。
- Controller 每次只允许一个工具调用；工具请求的 `run_id`、`owner_id` 和 `workspace_id` 必须与 Run 一致，`remaining` budget 根据 Host 实际使用量重建，不能由 driver 或模型上报、放宽或覆盖。
- 澄清通过 digest 进入 `awaiting_clarification`；`continue()` 只接受 digest，并将 Host 重新置于 `planning`，后续工具/终态必须再次提交 plan digest。工具输出不进入 Host 事件或下一轮上下文，只暴露 complete/partial/blocked、行/字节计数和结果 digest。
- Registry 的 `executor_failed` 与 `timeout_exceeded` 是默认可重试原因，重试次数受 `maxRetries` 和总 `maxTurns` 双重限制；权限、安全、输入、Evidence、预算和重复调用失败不自动重试。
- 用户取消和截止时间都会 abort driver/Tool 的协作信号；取消按 `cancelling` → `cancelled` 收敛，截止时间按 `deadline_exceeded` 收敛。控制器不等待非协作 driver 或 executor 的迟到 Promise，也不把迟到结果写成成功。

### 4.4 Runtime 与 Pi adapter 的边界

| 能力 | AlphaOx 拥有 | Pi adapter 可提供 | 不允许穿过边界 |
| --- | --- | --- | --- |
| 模型调用 | provider/model allowlist、预算、外发最小化、错误分类 | 请求/流式消息转换 | 凭据、未裁剪数据、AlphaOx 权限决定 |
| Agent 事件 | 稳定 event、Trace、状态机、去重、持久化 | 上游事件接收和转换 | Pi event union 作为公开 API |
| 工具调用 | Registry、Schema、Policy、Executor、Evidence | 生命周期桥接、取消信号 | 任意 Tool、任意代码、绕过 preflight |
| 会话上下文 | owner/workspace、Context Pack、计划和结果 | 内部 prompt/message 组装 | Pi session 文件成为业务状态 |
| 循环控制 | 步数、并发、重试、取消、终态 | 下一轮模型请求 | 模型自行放宽预算或权限 |

### 4.5 状态和终态规则

当前 4.5 切片已把 Session Context、Evidence 和 Trace 落成 AlphaOx-owned 的可替换
内存状态边界。Session Context 只保存 owner/workspace、Context Pack/Plan 版本指针、
freshness 和偏好/工作区知识 digest；Evidence Store 只接收已通过 Path 03 完整性校验
的 `EvidenceEnvelope`，再附加 owner/workspace/Trace 作用域；Trace Store 只保存固定的
生命周期和资源摘要，不接收自由文本、SQL、凭据、原始输入或原始结果。该切片不改变
Path 03 的 Evidence 合同，也不提前决定 Path 05 的 SQLite schema、恢复策略或 Web API。

成功只允许在：计划、工具结果、Evidence、Trace 和 StateStore 写入都满足合同后
进入 `complete`。部分来源完成进入 `partial`；权限、策略、安全、依赖或持久化
阻断进入 `blocked`；口径或范围不足进入 `clarification_required`。`zero_rows`、
`permission_filtered`、`source_unavailable` 和 `query_not_run` 必须保留为不同
结构化原因，不得统一显示为“没有数据”。

## 5. 权限、隐私、新鲜度、状态和失败

### 5.1 权限顺序

1. 服务端注入 owner/workspace 和策略版本；不信任客户端身份字段。
2. Context Resolver 只向 Runtime 暴露已授权的 Snapshot、Binding 和 Context Pack。
3. Plan/Tool Preflight 再次检查来源、字段、粒度、时间、预算、只读和 freshness。
4. Executor 使用服务端 SecretStore 和固定 Connector 能力，不接受 SQL/凭据/地址。
5. Result/Evidence 做列裁剪、聚合、脱敏、行/字节限制后才可进入 Trace 和 UI。
6. 运行中重新检查取消、权限撤销、上下文版本和预算；不能沿用初始授权到底。

### 5.2 状态 / 失败矩阵

| 场景 | 状态/原因 | 必须行为 | 是否允许 Tool |
| --- | --- | --- | --- |
| Runtime 事件无法解析 | `blocked / invalid_runtime_event` | 记录脱敏错误，停止该 Run | 否 |
| Pi adapter 断开或事件不完整 | `partial` 或 `blocked / runtime_unavailable` | 保留已完成证据；不猜测未收到的调用 | 否，除非重新验证 |
| 未注册工具/版本不匹配 | `blocked / tool_not_registered` 或 `tool_version_mismatch` | 记录工具类别，不向模型伪造成功 | 否 |
| 输入 Schema 或计划引用无效 | `blocked / invalid_tool_input` | 返回结构化校验错误，允许重新规划 | 否 |
| 模型提出 SQL、代码、Shell 或路径 | `blocked / unsafe_tool_request` | 在 Registry 前拒绝，Trace 不保存原始敏感文本 | 否 |
| 缺少口径、时间或权限信息 | `clarification_required` | 只提出最小澄清问题 | 否 |
| 超出步数/并发/字节预算 | `partial` 或 `blocked / budget_exhausted` | 固定预算内停止，不隐式放宽 | 否 |
| Loop Controller 截止时间到达 | `blocked / deadline_exceeded` | abort 当前协作调用，不接受迟到结果 | 否 |
| 用户取消 | `blocked / cancelled` | 进入 `cancelling` 后收敛终态，保留已完成块 | 取消传播后否 |
| Context/Binding 被撤销 | `blocked / context_revoked` | 阻止下一步和结果发送 | 否 |
| SecretStore 缺失或外发未授权 | `blocked / secret_or_egress_denied` | 不重试凭据错误，不输出凭据 | 否 |
| Tool 返回无效结果/脱敏失败 | `blocked / invalid_tool_result` | 不把结果交给模型或 UI | 否 |
| 来源失败但已有其他来源结果 | `partial / source_unavailable` | 列出缺失来源与影响，有限重试 | 仅已授权重试 |
| Trace/StateStore 写入失败 | `blocked` 或保守 `partial` | 不能宣称可回放的 complete | 不新增调用 |
| 重复/乱序事件 | 保持状态或 `blocked / trace_anomaly` | 按 event_id 去重；不可解释时停止 | 否 |

### 5.3 对抗边界

- 模型返回未知字段、超长参数、嵌套循环或伪造 `complete`：Schema/预算/状态机
  拒绝，不能由 UI 文案纠正。
- 同一工具被重放：必须有 `run_id`、`call_id` 和幂等语义；不确定是否已执行时，
  不能盲目重复有副作用的调用。Path 04 工具只允许只读调用。
- 运行中撤销权限：下一步和发往 UI 的每个结果都重新检查，不沿用旧快照。
- 模型外发上下文超过 allowlist：在模型请求前阻断，并且 Trace 只记录类别和大小。
- 恶意列名、异常 Unicode、巨大结果和零除：确定性执行/封装器返回结构化失败，
  不让列名进入前端代码，不生成伪造数字。

## 6. 依赖、迁移、回滚与维护

### 6.1 依赖与证据等级

| 依赖 | Path 04 用途 | 当前状态 | 证据边界 |
| --- | --- | --- | --- |
| `packages/semantic-agent` | AlphaOx 自有合同、Host 和 Tool 实现 | 本地仓库 | 代码/测试可证明，不代表真实服务 |
| Pi `agent` / `ai` | 内部 adapter 的运行能力来源 | 上游 checkout | 需薄适配和契约测试，不公开 Pi 类型 |
| TypeBox / Vitest | Schema 与确定性测试 | 仓库已有依赖 | 不调用真实 Provider |
| StateStore | Run/Trace/Result 所有权边界 | Path 04 fake/内存 | SQLite 属于 Path 05 决策 |
| SecretStore | 凭据与模型外发边界 | Path 04 interface/fail-closed fake | 无真实 secret |
| ArchScribe | 架构图规范与输出 | 本地技能 | 图形不是运行时证据 |

证据链接：[路线图](/Users/archer/Documents/ChatGPT/alphaox/开发路径图.md)、
[Path 02 契约报告](/Users/archer/Documents/ChatGPT/alphaox/docs/alphaox/path-02/contract-design.md)、
[Path 03 架构与验收报告](/Users/archer/Documents/ChatGPT/alphaox/docs/alphaox/path-03/architecture-and-acceptance.md)、
[semantic-agent package](/Users/archer/Documents/ChatGPT/alphaox/packages/semantic-agent/package.json)、
[仓库 AGENTS.md](/Users/archer/Documents/ChatGPT/alphaox/AGENTS.md)、
[Pi Agent Core](https://github.com/earendil-works/pi/tree/main/packages/agent) 和
[ArchScribe 技能](/Users/archer/.codex/skills/archscribe/SKILL.md)。这些证据只能证明
设计背景与本地合同，不能支撑真实数据库可用性、模型质量、数据正确性、生产安全
或 Browser 通过。

### 6.2 迁移顺序

1. 先冻结 AlphaOx-owned Host、Event、Tool、Result、Evidence 和 StateStore 合同。
2. Path 04 先使用内存/fixture 实现完成状态机和失败注入；不产生用户持久数据。
3. Path 05 将相同合同接入 AlphaOx-owned SQLite，先做 schema version、原子写入、
   备份和恢复测试，再开启本地默认持久化。
4. 后续服务模式如引入 PostgreSQL，采用版本 migration 和双读验证；不把 SQLite
   文件或 Pi session 文件直接当作服务模式数据库。

### 6.3 回滚边界

- Path 04 代码回滚到上一个已验收的 pass-04 slice；不删除用户目录和上游工作区。
- Tool 版本回滚时禁用新版本、保留旧版本和 Trace 引用；未知输入不能静默降级。
- Runtime adapter 出现不兼容时切换到 fake/blocked adapter，不绕过 Policy/Registry。
- Path 05 数据迁移失败时停在旧 schema，保留备份和失败日志；不可逆删除另行批准。
- 不执行 `git reset --hard`、整库清理、远程推送、部署或真实连接切换。

### 6.4 可观测性、清理和维护责任

每个 Run 至少记录脱敏的 `run_id`、`trace_id`、owner/workspace、版本指针、阶段、
耗时、重试、预算、来源类别、`as_of`、错误类别和持久化结果。日志不得保存凭据、
原始企业行、完整敏感提示词或未经裁剪的文档。

- AlphaOx maintainer：Host、Tool、Result、Evidence 合同和上游 adapter。
- Policy owner：owner/workspace、策略、预算、脱敏和 SecretStore 边界。
- Connector owner：只读能力、Snapshot、freshness 和来源错误。
- Web owner：Path 05 的状态呈现、SSE 重连、可访问性和 Browser 清单。
- Release owner：check、依赖、迁移、回滚和最终 Gate。

Path 04 只清理测试 fixture 和内存状态；任何用户目录、SQLite、日志、缓存和凭据
清理都必须在后续路径定义 owner、保留期、dry-run 和审计记录。

## 7. Path 04 分阶段实施计划

| 阶段 | 交付 | 通过证据 | 当前状态 |
| --- | --- | --- | --- |
| 4.0 | 本报告、架构图规范、边界和完整验收清单 | 人类精确 diff Gate；图规范 validate/render/check | 已批准，文档已写入 |
| 4.1 | AlphaOx Runtime Host 合同和内存状态机 | fake event stream、终态/取消/预算测试 | 已完成；11 个 Host 测试，semantic-agent 完整测试与根级 `npm run check` 通过 |
| 4.2 | Pi 内部 adapter | fake Pi stream、事件转换和无 Pi public type 检查 | 已完成；8 个 adapter 测试、semantic-agent 完整测试与根级 `npm run check` 通过 |
| 4.3 | Controlled Data Tool Registry | unknown/unsafe/invalid call、预算/取消和无证据结果在执行前或结果释放前阻断 | 已完成；13 个 Registry 测试、包级测试与根级 `npm run check` 通过 |
| 4.4 | Loop Controller | 澄清、重规划、有限重试、取消、截止时间和步数/行/字节预算 | 已完成；10 个 Loop Controller 测试、包级测试与根级 `npm run check` 通过 |
| 4.5 | Session Context、Evidence、Trace | owner/version/freshness/脱敏/失败注入测试 | 已完成；11 个新增确定性测试、包级测试和根级 `npm run check` 通过 |
| 4.6 | Pass 04 集成 | Path 02/03 contract、根级 check、对抗审查 | 已完成；4.5 fast-forward 合入 `pass-04`，技术验证通过，待 Pass Decision Gate |

实现目录只允许在 `packages/semantic-agent` 及其测试/fixture 范围内展开；不修改
Pi 上游核心、不接真实 Provider/DB、不提前实现 Path 05 Web/SQLite/身份登录。

## 8. 完整内置 Browser 验收清单

本清单为后续本地 Web 产品的可执行基线。Path 04 当前没有可运行 UI，所有结果
保持 `NOT RUN`；实现后必须在指定构建和固定 fixture 上逐项记录证据，不得用契约
测试代替 Browser 结果。

### 8.1 固定起始条件

- **构建/分支**：Path 04 集成到 `codex/alphaox/pass-04` 后的本地构建；Path 05
  再将同一清单扩展到 `main` 集成构建。当前不声称已有可启动 Web 构建。
- **启动**：使用临时空数据目录运行 `alphaox start --host 127.0.0.1 --port 43120`
  （命令和端口仍是本次 Gate 的提案），模型为 fake provider，数据为仓库自有 fixture。
- **标签页**：内置 Browser 只打开一个可复用标签页；所有操作在该标签完成。
- **URL**：起始 `http://127.0.0.1:43120/`；健康检查
  `http://127.0.0.1:43120/api/v1/health`；Run 事件使用同源
  `/api/v1/runs/{run_id}/events`。
- **视口**：桌面 1440×900、缩放 100%；移动 390×844、缩放 100%。
- **身份**：`local-owner` / `default-workspace`；不注入真实凭据。
- **数据**：自有确定性 fixture、固定 fake model stream、已发布的 Snapshot/Binding/
  Context Pack；不使用 Olist、AdventureWorks 或真实企业数据。
- **记录**：每项记录 PASS、FAIL、BLOCKED 或 NOT RUN，附构建、URL、时间、截图、
  `run_id`/`trace_id` 和 console/network 结果。

### 8.2 逐项执行

| ID | 人类操作 | 预期结果与检查 | 结果 |
| --- | --- | --- | --- |
| B4-01 | 启动本地服务并打开起始 URL | 首屏稳定、显示本地工作区和空状态；无未处理 console error | `NOT RUN` |
| B4-02 | 用键盘按 Tab 浏览标题、问题输入、提交和状态区 | 焦点可见、顺序合理、无焦点陷阱；状态区可读 | `NOT RUN` |
| B4-03 | 提交固定正常问题并等待 fake stream | 看到 planning/executing，最终 complete；UI 显示 run/trace 和证据来源 | `NOT RUN` |
| B4-04 | 打开 Trace 和来源详情 | 可看到步骤、版本、as_of、预算和警告；不显示凭据、原始 SQL 或未裁剪行 | `NOT RUN` |
| B4-05 | 提交缺少时间范围的问题 | 显示 clarification_required；只问影响口径的澄清问题 | `NOT RUN` |
| B4-06 | 触发未注册工具/任意 SQL fixture | 显示 blocked；请求未到达 Tool executor；无 SQL/代码进入网络和 UI | `NOT RUN` |
| B4-07 | 触发工具返回 partial/zero_rows/source_unavailable | 状态和原因区分；不把失败显示为“无数据”或 complete | `NOT RUN` |
| B4-08 | 在运行中点击取消 | 经过 cancelling 到取消终态；已完成块和未完成边界清晰 | `NOT RUN` |
| B4-09 | 触发预算耗尽和有限重试 fixture | 不超过预算；重试次数、原因和最终状态可读 | `NOT RUN` |
| B4-10 | 断开并恢复本地 SSE 网络 | 只有限重连/读快照；按 event_id 去重；不重复执行只读调用 | `NOT RUN` |
| B4-11 | 刷新同一 Run 并重复双击提交 | 能恢复同一 run_id；幂等约束不产生重复运行 | `NOT RUN` |
| B4-12 | 切换 390×844 并重复 B4-03/B4-04/B4-08 | 无水平溢出；结果、来源、Trace、取消和焦点仍可操作 | `NOT RUN` |
| B4-13 | 启用 reduced-motion 后重载 | 动画降级但状态、进度和错误信息不丢失 | `NOT RUN` |
| B4-14 | 检查 Browser console/network | 无未处理异常；无明文凭据、任意 SQL/代码或跨源请求；错误码与 UI 一致 | `NOT RUN` |
| B4-15 | 清理临时数据目录并重新打开同一 URL | 只清理测试范围；无残留凭据；回到可重复的空状态 | `NOT RUN` |

任一凭据泄露、任意代码执行、未授权 Tool 调用、`partial/blocked` 冒充 complete、
或状态错误被冒充 zero_rows，直接 FAIL。Path 04 的 Browser 结论在 UI 不存在时只能
是 `NOT RUN`，不能写成 PASS。

## 9. 未决风险

| 风险 | 影响 | 处理 | 责任/触发门 |
| --- | --- | --- | --- |
| Pi 上游事件/API 演进 | adapter 失配或丢事件 | 薄 adapter、fake stream、契约测试 | maintainer / Path 04 |
| Runtime Host 误把模型输出当授权 | 数据越权或任意执行 | Registry + preflight + adversarial tests | Policy owner / Path 04 |
| 本地服务被同机进程访问 | 本地数据暴露 | loopback、Origin/CSRF、SecretStore；威胁模型另行确认 | Security / Path 05 |
| 模型外发范围失控 | 凭据或敏感数据泄露 | allowlist、最小 Context、fail closed、network 检查 | Security / Path 04-05 |
| 状态持久化与恢复不足 | 丢 Run、重复执行 | StateStore 合同、幂等、Path 05 SQLite 恢复测试 | maintainer / Path 05 |
| 预算/取消传播不完整 | 长任务、成本和重复调用 | 全链路 signal、步数/字节/并发限制 | maintainer / Path 04 |
| Tool executor 不协作取消 | 超时后同进程工作仍可能继续消耗资源 | 工具必须监听 `AbortSignal`；Registry 立即阻断输出；强制隔离执行延后单独 Decision Gate | maintainer / Path 04-05 |
| Loop driver 不协作取消 | 控制器可收敛，但底层模型 Promise 仍可能占用资源 | driver 必须监听 `AbortSignal`；控制器不接收迟到决策；Provider/执行隔离另行评估 | maintainer / Path 04-05 |
| Connector/Binding 语义错误 | 结果口径错误 | 沿用 Path 02/03 版本、freshness 和证据边界 | Data steward / Path 02-03 |
| 未来服务模式扩大范围 | 本地合同被多租户反向污染 | 服务模式单独 Decision Gate，不提前抽象 | human Gate / Path 07 |

## 10. 人类 Decision Gate 记录

本次 Gate 必须明确批准以下精确范围：

1. 以本报告作为 Path 04 当前架构与验收权威；旧 PASS 01 报告仅作历史基线。
2. 采用本地优先单进程、loopback、默认端口提案 `43120`、`alphaox start` 提案和
   本地单用户 owner/workspace 边界；不把服务模式作为默认实现。
3. Path 04 使用 AlphaOx-owned StateStore 抽象和内存/fixture，不提前实现 SQLite、
   Web、真实身份、真实 Connector 或真实模型。
4. Pi 只作为内部 adapter；AlphaOx 自有 Runtime/Tool/Event/Result/Evidence 合同
   是唯一公开边界；Controlled Data Tool 是唯一数据能力入口。
5. 接受本报告的拒绝方案、状态/失败矩阵、Browser `NOT RUN` 状态、迁移/回滚边界和
   未决风险；批准后才创建实现切片。

**批准状态：已批准（2026-08-26）。用户明确回复“可以”，批准本报告列明的 Path 04
4.0 架构范围和后续实施边界。**

## 11. 交付物与后续动作

Gate 通过后已写入：

- `docs/alphaox/path-04/architecture-and-acceptance.md`（本报告）
- `docs/alphaox/architecture/alphaox-local-first-architecture.spec.json`
- 同名 `.png`、`.svg`、`.excalidraw`、`.html` 工件；不生成 GIF/MP4
- Path 04 实现切片：`codex/alphaox/pass-04-runtime-host` 等明确名称

4.1 已完成的实现证据：

- `packages/semantic-agent/src/runtime-host.ts`：AlphaOx-owned `runtime.v1` 合同、事件归一化、Run 状态机、预算、取消、断线状态和内存 StateStore；不导入 Pi，不执行 Tool。
- `packages/semantic-agent/test/runtime-host.test.ts`：11 个确定性测试，覆盖正常终态、证据缺失、活动调用、预算、非法输入、澄清、断线重连、取消、Runtime 失败和返回值隔离。
- `npm run test --workspace @alphaox/semantic-agent`：完整包测试通过（12 个测试文件、75 个测试）。根级 `npm run check` 通过。
- 对抗复核确认：原始问题不写入 StateStore，未知/非法事件 fail closed，终态失败默认清理活动调用；4.1 不声称 Tool Registry、真实 Runtime、数据库、Web 或 Browser 已完成。

4.2 已完成的实现证据：

- `packages/semantic-agent/src/pi-adapter.ts`：只公开 AlphaOx 结果和摘要类型；将 Pi 生命周期、消息、工具调用和 Runtime 错误转换为 Host 输入，原始消息/参数/结果只产生形状摘要或 digest。
- `packages/semantic-agent/src/internal/pi-agent-adapter.ts`：仅在未从 `index.ts` 导出的 internal 文件中绑定 Pi `Agent` 类型；公开 API 不包含 Pi Agent、Session、Event Union 或 Transport 类型。
- `packages/semantic-agent/test/pi-adapter.test.ts`：8 个确定性测试，覆盖 fake stream attach/detach、消息脱敏、工具摘要、未知事件、非法工具身份、Runtime 错误、agent_end 终态边界和不可用事件源。
- `@earendil-works/pi-agent-core@0.84.3` 仅作为内部桥接的精确版本开发依赖；未引入真实模型、数据库、网络或运行时 Provider。
- 对抗复核确认：`agent_end` 不会自动写入 `complete`，成功工具结果没有 AlphaOx 摘要时进入 `evidence_required`，未知/非法输入进入 Host fail closed；4.2 不声称 Tool Registry、Loop Controller、真实 Runtime、数据库、Web 或 Browser 已完成。

4.3 已完成的实现证据：

- `packages/semantic-agent/src/tool-registry.ts`：版本化只读工具注册和描述、来源类型门、输入/输出 Schema、纯 JSON 边界、SQL/code-like 输入阻断、确定性授权入口、步数/行/字节预算、Evidence 门、超时/取消传播、幂等和最小生命周期事件。
- `packages/semantic-agent/test/tool-registry.test.ts`：13 个确定性测试，覆盖注册/重复版本、成功/partial、未注册/版本/来源/输入/安全前置阻断、授权拒绝/未知/挂起取消、输出/预算/Evidence 失败、运行中取消、超时、重复调用、观察者异常和无效时钟清理。
- `npm run test --workspace @alphaox/semantic-agent`：完整包测试通过（14 个测试文件、96 个测试）；根级 `npm run check` 通过。
- 对抗复核确认：授权回调和生命周期事件不接收原始输入/输出；前置失败不调用执行器；超时/取消不重复写 blocked 事件并清理活动调用；同一 invocation ID 不会被重放；非协作执行器无法被同一 Node 进程强制终止，已记录为后续隔离风险。

4.4 已完成的实现证据：

- `packages/semantic-agent/src/loop-controller.ts`：AlphaOx-owned `loop.v1` 串行循环控制；驱动决策归一化、Run/owner/workspace 绑定、Host 实际剩余预算注入、澄清继续、plan digest 重规划、有限重试、截止时间、取消传播、工具结果摘要和终态收敛。
- `packages/semantic-agent/test/loop-controller.test.ts`：10 个确定性测试，覆盖正常闭环、澄清/重复继续、可重试工具失败与耗尽、Host/Loop 预算、活动工具取消、非协作 driver 取消、活动工具截止时间、非法决策/所有权错配、Evidence 缺失和 partial 终态。
- `packages/semantic-agent/src/runtime-host.ts`：补充 `deadline_exceeded` Host 原因，保证截止时间不是模糊的通用失败。
- `npm run test --workspace @alphaox/semantic-agent`：完整包测试通过（15 个测试文件、106 个测试）；根级 `npm run check` 通过。
- 对抗复核确认：控制器不接受模型自报的 `remaining` budget；重复继续不会再调用 driver；非协作 driver 不会阻塞取消返回；活动工具截止后只保留 `deadline_exceeded` 终态，不接受迟到工具结果；Registry 精确失败原因仍保留在工具生命周期事件中。未接入真实模型、真实数据库、网络写入或 Web UI；Browser 仍为 `NOT RUN`。

4.5 已完成的实现证据：

- `packages/semantic-agent/src/session-context.ts`：AlphaOx-owned `session.v1` 作用域合同和内存 Store；Session Context 绑定 owner/workspace、Trace、Context Pack/Plan 版本指针、偏好/工作区知识 digest 和 freshness，支持显式版本替换、激活、撤销以及 `fresh_only`/`allow_stale`/`allow_unknown` 解析策略。
- `packages/semantic-agent/src/evidence-store.ts`：`evidence-record.v1` 作用域包装；只接收并重新验证 Path 03 `EvidenceEnvelope`，按 Run/Evidence identity 幂等写入，阻断 owner/workspace、Trace、完整性和内容冲突，不复制结果行。
- `packages/semantic-agent/src/trace.ts`：AlphaOx-owned `trace.v1` 脱敏事件和内存 Store；固定摘要字段只允许资源类别、版本、digest、状态、freshness、行/字节和尝试次数，自动生成连续 sequence 与事件 digest，不接受任意 prompt、SQL、credential、output 等自由字段。
- `packages/semantic-agent/test/session-context.test.ts`、`packages/semantic-agent/test/evidence-store.test.ts`、`packages/semantic-agent/test/trace.test.ts`：11 个确定性测试，覆盖 owner/workspace 隔离、版本冲突/撤销、freshness 策略、Evidence 完整性和 Trace 绑定、敏感字段阻断以及注入 StateStore 写入失败后的无半条记录状态。
- `npm run test --workspace @alphaox/semantic-agent`：完整包测试通过（18 个测试文件、117 个测试）；根级 `npm run check` 通过。
- 对抗复核确认：旧的非当前 Session Context 版本不能被 `resolve` 当成当前版本；过期、撤销或不满足 freshness policy 的上下文 fail closed；Evidence 完整性失败不会进入 Store；Trace 的 scope、run、sequence 和固定字段边界不能由调用方绕过。未接入真实模型、真实数据库、SQLite、网络写入或 Web UI；Browser 仍为 `NOT RUN`。

4.6 Pass 集成验证已完成：4.5 commit `6904ee761` 已 fast-forward 合入
`codex/alphaox/pass-04`，未改变 `main`。`main` 是 `pass-04` 的祖先，Path 04 集成差异通过
`git diff --check`；semantic-agent 的 18 个测试文件、117 个测试和根级 `npm run check`
均通过。公开入口只新增 AlphaOx Session Context、Evidence Store 和 Trace 导出，没有新增
Pi 私有类型作为 AlphaOx 契约。对抗复核确认跨 owner/workspace/run 的读取与追加会被阻断，
非当前 Context 版本不会被解析为当前版本，Trace/Evidence 写入失败不会产生半条新记录。
当前没有合入 `main`、push、部署或 Browser 验收；Browser 仍为 `NOT RUN`，下一步为独立的
Pass Decision Gate。

随后进行 Pass Decision Gate；若获明确批准，再单独决定是否将 `pass-04` 合入 `main`。每个阶段跑适用测试与根级 `npm run check`，只提交本阶段
修改的文件。所有阶段性 commit 需在用户明确授权后执行；不自动 push、建 PR 或部署。
