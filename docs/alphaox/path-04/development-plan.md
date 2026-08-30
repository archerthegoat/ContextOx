# AlphaOx 路径四：Agent Runtime 接入与受控工具编排详细开发计划

## 0. 计划状态与决策边界

- **状态**：`IN PROGRESS`；4.0 架构基线、4.1 Runtime Host 状态机、4.2 Pi 内部 adapter、4.3 Controlled Data Tool Registry、4.4 Loop Controller、4.5 Session Context/Evidence/Trace 和 4.6 Pass 集成验证已完成；待 Pass Decision Gate 后再决定是否合入 `main`。
- **目标**：把一个 Agent Runtime 安全接入 AlphaOx 的计划、上下文、执行和证据内核。
- **首版 Runtime**：使用 Pi Agent Core，但 Pi 只存在于 AlphaOx Runtime Host 适配层内部。
- **前置门**：本地优先架构报告和 ArchScribe 图规范已于 2026-08-26 获人类 Decision Gate 批准；本计划负责记录实现阶段，不替代该报告。
- **不授权事项**：本计划不授权真实模型、真实数据库、生产身份、远程监听、外部写回、推送或发布。

## 1. 用户可见目标

用户提交一个分析问题后，Runtime 能够：

1. 请求或发现经过授权的 Context Pack、Binding 和 Snapshot。
2. 在需要时提出澄清问题，而不是猜测业务口径。
3. 生成符合 AlphaOx 契约的 Analysis Plan 和 Query Plan。
4. 只能通过 AlphaOx Controlled Data Tool 完成校验、只读执行和证据读取。
5. 在模型、工具、权限、freshness、取消或预算失败时返回真实状态。
6. 产生 AlphaOx 自有的 Run、Trace、Result 和 Evidence，不把 Pi 事件直接暴露给客户端。

## 2. 范围与非目标

### 2.1 范围

- AlphaOx Runtime Host 接口和内部 Pi adapter。
- AlphaOx 自有的消息、事件、Run、Trace 和错误协议。
- Controlled Data Tool 注册表、参数校验、权限入口和结果边界。
- 推理-行动循环、计划确认、工具调用、取消、截止时间、步数预算和终态聚合。
- 会话上下文、用户偏好和本地工作区知识的作用域边界。
- 不依赖真实 Provider 的 deterministic runtime fixture 和回归测试。

### 2.2 非目标

- 不改写 Pi 的 `agent`、`ai`、`server` 或 `protocol` 核心包来承载 AlphaOx 业务规则。
- 不让 Runtime 直接访问数据库、文件系统、Shell、网络凭据或任意代码工具。
- 不在本路径实现通用多 Runtime 插件市场或复杂多 Agent 编排。
- 不在本路径实现 Web UI、SQLite 持久化、真实 Connector 或企业身份系统。

## 3. 前置条件

- 路径二的 Source Snapshot、Binding、Context Pack 和匹配边界已可调用。
- 路径三的 Analysis Plan、Query Plan、Preflight、Compiler、Result 和 Evidence 契约已冻结。
- 本地优先架构报告已明确 Runtime Host、SecretStore、回环服务和模型外发边界。
- 测试使用 fake model、fake Pi event stream 和 fixture Controlled Data Tools；不使用真实 API key 或付费 token。

## 4. 分阶段开发计划

| 阶段 | 交付 | 关键检查 | commit 门 | 当前状态 |
| --- | --- | --- | --- | --- |
| 4.0 | 本地优先架构报告、架构图规范、边界和完整 Browser 验收清单 | 人类精确 diff Gate；图规范 validate/render/check | 文档与图工件提交后进入实现 | 已完成；基线提交 `114f33f5b` |
| 4.1 | AlphaOx Runtime Host 合同、Run/Event、取消和内存状态机 | fake event stream；终态、取消、预算、乱序和 fail-closed 测试 | Host 测试与根级 `npm run check` 通过后提交 | 已完成；本切片测试与检查已通过 |
| 4.2 | Pi 内部 adapter | Pi 事件只能进入 adapter；断流、未知事件和异常可解释；无 Pi public type | fake stream 测试通过后提交 | 已完成；8 个 adapter 测试、包级测试与根级 `npm run check` 已通过 |
| 4.3 | Controlled Data Tool Registry | 未注册、版本不匹配、越权、任意 SQL/code、无效 Schema/结果、预算和取消均阻断 | 13 个工具边界测试、包级测试和根级 `npm run check` 通过后提交 | 已完成；本切片提交 |
| 4.4 | Loop Controller | 澄清、重规划、工具调用、继续、终止和预算 | 循环耗尽、取消、截止时间、工具失败重试和重复提交有稳定终态 | 已完成；本切片提交 |
| 4.5 | Session Context、Evidence、Trace | 不跨工作区混用；撤销版本、freshness、脱敏和失败可解释 | 安全回归通过后提交 | 已完成；本切片提交 |
| 4.6 | Pass 集成 | 与路径二、三契约的完整串接 | 测试、`npm run check`、对抗审查和回滚证据齐全；已合入 `pass-04`，待 Pass Decision Gate 后再合入 `main` | 已完成；技术集成验证通过 |

## 5. 计划中的代码边界

拟新增或调整的代码只限于 `packages/semantic-agent`，例如：

- `src/runtime-host.ts`：AlphaOx Host 的公开边界。
- `src/loop-controller.ts`：确定性串行循环、澄清继续、有限重试和终态收敛。
- `src/agent-runtime.ts`：运行状态和循环控制。
- `src/tool-registry.ts`：受控工具注册与调用边界。
- `src/trace.ts`：AlphaOx 事件和 Trace 脱敏映射。
- `src/session-context.ts`：会话、偏好和工作区上下文作用域。
- `src/evidence-store.ts`：EvidenceEnvelope 的 owner/workspace/Trace 作用域包装和内存 StateStore。
- 对应 `test`：fake Runtime、工具越权、取消、预算、异常和证据边界。

以上文件名是实现边界内的建议；架构报告已通过 Decision Gate，但具体文件名仍不等同于冻结 API，公开契约必须以 AlphaOx 类型和测试为准。

## 6. 不可违反的运行边界

- Pi 只负责模型调用、消息/事件以及候选下一步；adapter 可以提供生命周期和取消信号，但不能自行决定 AlphaOx 终态。
- AlphaOx 负责权限、上下文、计划、编译、执行、结果、证据、状态和审计引用。
- Loop Controller 负责串行工具调用、实际剩余预算注入、有限重试、截止时间、取消传播和终态收敛。
- Runtime 只能获得 AlphaOx 机器契约定义的工具名称、版本化输入和结构化输出。
- Tool 不能把 SQL、代码、凭据、完整提示词或未裁剪数据作为输入/输出返回给模型。
- 模型或 Runtime 替换不能改变确定性计划、执行、Evidence 和状态语义。

## 7. 失败矩阵

| 场景 | 结果 | 边界 |
| --- | --- | --- |
| Runtime 返回未知事件 | `blocked / invalid_runtime_event` | 不转发原始 payload |
| Pi adapter 断流 | `blocked / runtime_unavailable` 或已有结果 `partial` | 不自动重放已执行工具 |
| Tool 未注册或版本不匹配 | `blocked / tool_not_registered` 或 `tool_version_mismatch` | 不调用工具 |
| Tool 输入或计划引用不符合 Schema | `blocked / invalid_tool_input` | 不调用工具，返回结构化校验错误 |
| Runtime 请求任意 SQL/code/Shell/path | `blocked / unsafe_tool_request` | 不调用工具 |
| 工具返回未知字段或敏感字段 | `blocked / invalid_tool_result` | 不交给模型/前端 |
| 计划需要澄清 | `clarification_required` | 不调用执行器 |
| 循环达到步数/字节预算 | `blocked` 或 `partial` / `budget_exhausted` | 保存已完成证据，不继续循环 |
| Loop Controller 截止时间到达 | `blocked / deadline_exceeded` | abort 当前协作调用，不接受迟到结果 |
| 用户取消 | `blocked / cancelled` 或 `partial / cancelled` | 不启动新的依赖步骤 |
| 上下文版本被撤销 | `blocked / context_revoked` | 必须重新发现 |
| Trace 脱敏失败 | `blocked` | 不释放事件和结果 |

## 8. 验收与回滚

- 使用 fake model 和 deterministic tool fixture 重复运行，计划摘要、工具顺序、Trace 引用和状态保持稳定。
- 检查所有 Runtime 公开导出，不允许出现 Pi 私有类型、任意执行器或凭据字段。
- 证明前置失败不会调用 Controlled Data Tool；工具失败不会伪造 `complete`。
- 证明 Registry 只暴露版本化只读工具描述；调用前校验来源类型、输入 Schema、JSON 可序列化边界、授权、步数预算和取消信号；调用后校验输出 Schema、敏感字段、行/字节预算和 Evidence。
- 证明生命周期只记录脱敏元数据：`invocation_started` 后只能收敛为 `completed`、`partial` 或 `blocked`；超时/取消会 abort 执行信号、清理活动调用并保留重复调用阻断。
- 证明 Loop Controller 不接受模型自报的剩余预算；澄清后必须重新提交 plan digest；工具失败只能按明确可重试原因进行有限重试。
- 覆盖 Provider 不可用、未知事件、工具异常、循环耗尽、截止时间、driver/工具取消竞态、SSE 尚未接入前的事件积压和证据失败。
- 代码变更后运行包级测试和根级 `npm run check`；不运行真实 Provider、数据库或部署流程。
- 本路径无产品 Web UI，Browser 保持 `NOT RUN`；路径五负责视觉和交互验收。
- 采用 `codex/alphaox/pass-04`，切片使用 `codex/alphaox/pass-04-<slice>`；每个阶段完成并提交后才能进入下阶段。
- 回滚只需回到上一个已验收 commit；本路径不创建外部持久化资源。

## 9. 人类 Decision Gate 记录

2026-08-26 已确认：Pi 只作为内部实现，Controlled Data Tool Registry 是唯一数据能力入口，AlphaOx 拥有完整状态/证据协议，首版不抽象第二个 Runtime；同时批准本地优先架构报告、边界、拒绝方案、Browser `NOT RUN` 状态和后续分阶段实施。

当前实现门已完成 4.4：本阶段实现 AlphaOx-owned `loop.v1` 确定性串行循环；Loop Controller 驱动澄清、重规划、工具调用、有限重试、实际剩余预算注入、截止时间、取消和 complete/partial/blocked 终态。driver 输出只接受结构化决策；工具输出只向下一轮暴露状态、行/字节计数和结果 digest，不把原始结果写入 Host 事件。新增 10 个 Loop Controller 对抗/回归测试；完整包测试为 15 个测试文件、106 个测试，根级 `npm run check` 通过。不接入真实模型、真实数据库、网络写入或 Web UI。driver 和 Tool executor 仍必须协作响应 `AbortSignal`；同一 Node 进程无法强制终止非协作 CPU 工作，这是后续隔离执行的明确风险。

当前实现门已完成 4.5：本阶段新增 AlphaOx-owned `session.v1`、`evidence-record.v1` 和 `trace.v1` 的内存状态边界。Session Context 以 owner/workspace 为作用域，使用显式版本替换和撤销状态，按 `fresh_only`、`allow_stale`、`allow_unknown` 策略返回可用或阻断结果；偏好和工作区知识只保存内容 digest，不保存原始值。Evidence Store 只接收并重新验证 Path 03 `EvidenceEnvelope`，附加 owner/workspace/trace 指针，按 Evidence identity 幂等写入并阻断跨作用域、跨 Trace、完整性或版本冲突。Trace Store 只接受固定的 session/context/plan/tool/result/evidence/runtime 摘要字段，自动分配连续 sequence 和确定性 event digest，拒绝任意 prompt、SQL、credential、output 等自由字段；内存 Store 支持注入写入失败且不会留下半条记录。新增 11 个 4.5 确定性测试；完整包测试为 18 个测试文件、117 个测试，根级 `npm run check` 通过。不接入真实模型、真实数据库、SQLite、网络写入或 Web UI；Browser 仍为 `NOT RUN`。4.5 完成后，下一个人类可审查边界是 4.6 Pass 集成。
当前实现门已完成 4.5：本阶段新增 AlphaOx-owned `session.v1`、`evidence-record.v1` 和 `trace.v1` 的内存状态边界。Session Context 以 owner/workspace 为作用域，使用显式版本替换和撤销状态，按 `fresh_only`、`allow_stale`、`allow_unknown` 策略返回可用或阻断结果；偏好和工作区知识只保存内容 digest，不保存原始值。Evidence Store 只接收并重新验证 Path 03 `EvidenceEnvelope`，附加 owner/workspace/trace 指针，按 Evidence identity 幂等写入并阻断跨作用域、跨 Trace、完整性或版本冲突。Trace Store 只接受固定的 session/context/plan/tool/result/evidence/runtime 摘要字段，自动分配连续 sequence 和确定性 event digest，拒绝任意 prompt、SQL、credential、output 等自由字段；内存 Store 支持注入写入失败且不会留下半条记录。新增 11 个 4.5 确定性测试；完整包测试为 18 个测试文件、117 个测试，根级 `npm run check` 通过。不接入真实模型、真实数据库、SQLite、网络写入或 Web UI；Browser 仍为 `NOT RUN`。

当前实现门已完成 4.6 技术集成验证：4.5 commit `6904ee761` 已 fast-forward 合入 `codex/alphaox/pass-04`；`main` 保持不变。完整 semantic-agent 测试为 18 个测试文件、117 个测试，根级 `npm run check` 通过；`main` 是 `pass-04` 的祖先，集成差异通过 `git diff --check`。公开入口只新增 AlphaOx Session Context、Evidence Store 和 Trace 导出，未把 Pi 私有类型导出为 AlphaOx 契约。对抗复核确认：跨 owner/workspace/run 的数据不能读取或追加，非当前 Context 版本不能被解析为当前版本，Trace/Evidence 写入失败不产生半条新记录；未合入 `main`、未 push、未部署，Browser 仍为 `NOT RUN`。下一步仅是人类 Pass Decision Gate 和是否合入 `main` 的独立决定。
