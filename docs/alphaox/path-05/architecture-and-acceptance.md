# AlphaOx Path 05：本地 Web 分析工作台与安装交付架构及验收报告

## 0. 文档状态与 Decision Gate

| 项目 | 当前值 |
| --- | --- |
| 适用范围 | Path 05：本地 Web 分析工作台与安装交付 |
| 当前工作分支 | `codex/alphaox/pass-05`，从 `main@d74ee7a6e` 创建 |
| 实现切片规则 | `codex/alphaox/pass-05-<slice>`，完成后合回 `codex/alphaox/pass-05` |
| 最终稳定分支 | `main` |
| 当前阶段 | 5.0 契约冻结；本报告为架构与验收基线，5.1 至 5.7 尚未实现 |
| 人类批准状态 | 2026-08-26 已批准本报告拟定的 Path5.0 范围和默认边界 |
| Browser 状态 | `NOT RUN`；当前仓库还没有 `semantic-web` 或可启动的 AlphaOx Local Service |
| 真实模型 / 数据源 | 未连接；只允许 fake model、确定性 fixture 和本地测试 |
| 外部写入 | 未执行；不推送、不建 PR、不部署、不发布、不连接真实企业数据 |

本报告是 Path 05 的架构与验收权威，配套的
`docs/alphaox/path-05/development-plan.md` 是阶段计划。两者都不把未实现的
服务、CLI、SQLite、SecretStore 或 Web UI 宣称为已经完成。

Path 04 已经冻结 AlphaOx-owned Runtime Host、Controlled Data Tool、Session
Context、Evidence、Trace、owner/workspace 和 Pi 内部适配边界。Path 05 负责把
这些边界接到本地服务、持久状态和 Web UI；它不能让浏览器或 Pi 绕过 Path 02/03
的上下文、计划、权限、执行和证据合同。

本报告只冻结 Path5.0 的产品边界、契约、威胁模型、迁移边界和完整验收清单。
它不授权真实凭据、真实数据库、网络写入、非回环监听、生产身份、发布或部署。

## 1. 真实目标、已核实事实与成功标准

### 1.1 真实目标

AlphaOx 的首版使用入口是一个可本地安装、通过桌面浏览器访问的 Data Agent
工作台。用户可以在自己的机器上配置经授权的数据源，查看 Schema Snapshot，
维护 Source Binding 和 Context Pack，提交分析问题，并看到澄清、计划、执行、
结果、来源、Evidence、Trace 和报告。

AlphaOx 的价值不是再造一个通用 Agent 循环，而是把 Data Agent 实际可用所需的
连接器、字段和业务语义、权限、计划、受控工具、执行边界、状态、证据和 Web
呈现统一起来。模型只能通过 AlphaOx-owned 的结构化契约提出行动；它不能生成
任意 SQL、代码、Shell、前端代码或数据写入操作。

### 1.2 已核实事实

- 当前 `packages/semantic-agent` 已包含 Path 02/03 契约和 Path 04 Runtime Host、
  Tool Registry、Loop Controller、Session Context、Evidence Store、Trace Store。
- Path 04 合并前后，`@alphaox/semantic-agent` 的 18 个测试文件、117 个测试和
  根级 `npm run check` 均已通过；这只证明本地确定性代码，不证明真实 Provider、
  Connector、SQLite、Web UI 或 Browser 通过。
- 当前 workspace 中没有 `packages/semantic-web`，也没有 AlphaOx Local Service、
  `alphaox start`、AlphaOx-owned SQLite migration 或持久化 SecretStore 实现。
- 根目录 `package.json` 当前是 Pi monorepo 的私有根包；Path 05 不能把现有 Pi
  CLI 或 Pi session 文件直接当成 AlphaOx 的服务/API/状态契约。
- 当前工作区已有用户未提交的 `开发路径图.md` 修改，以及 Path 01、02、03、05、
  06、07 的未跟踪文件。本报告只属于 Path 05.0，不拥有或清理这些内容。
- 当前没有真实模型、数据库、Feishu、向量库、生产服务、真实用户凭据或外部写回
  证据。所有测试和 Browser fixture 必须保持确定性和去敏。

### 1.3 Path 05 成功标准

1. 用户可以从 `alphaox start` 启动本地单进程服务；默认只监听回环地址，并在
   浏览器打开同源 Web UI。
2. 浏览器只访问 AlphaOx 的 HTTP JSON 和 SSE，不直接连接数据库、不读取凭据、
   不执行模型生成的任意代码。
3. 本地 Workspace、Source Snapshot、Binding、Context Pack、Run、Result、
   Evidence、Trace、Report 和审计状态由 AlphaOx-owned SQLite 版本化保存；Pi
   session 不成为持久化业务状态。
4. 数据源凭据只通过 SecretStore 引用和后端连接器使用；SecretStore 不可用时
   连接阻断，不使用明文文件 fallback。
5. `complete`、`partial`、`blocked`、`clarification_required`、`stale`、
   `zero_rows`、`cancelled` 和 `reconnecting` 等状态具有明确来源和原因，UI
   不把失败、过期或未执行伪装成“没有数据”或成功。
6. API、SSE、SQLite、SecretStore、CLI 和前端展示都只使用 AlphaOx 自有合同；
   Pi 私有类型不得进入服务 API、持久化 schema 或前端类型。
7. 在固定 fixture、fake model 和临时数据目录上完成完整 Browser 清单；所有
   项目有 `PASS`、`FAIL`、`BLOCKED` 或 `NOT RUN` 记录和可追溯证据。

## 2. 已批准的架构决定

### D5-1：本地单进程、同源、回环默认

**决定**：首版参考形态是一个 Node 进程，同时托管静态 Web 资源、同源 HTTP JSON、
SSE、本地 Runtime Host 和受控工具。默认命令为 `alphaox start`，默认绑定
`127.0.0.1`，默认端口为 `43120`，支持显式 `--port` 和 `--data-dir`。

首版不把非回环监听作为普通配置能力；如果命令收到非回环 host，应拒绝启动并
提示后续服务化决策门，而不是静默扩大暴露面。开发环境可以拆分前后端端口，
但发布验收和用户默认形态必须是同源模式。开发端口拆分不得成为 CORS 和安全
策略的正式替代品。

**理由**：用户目标是本地安装和可使用的 Data Agent 工作台。单进程同源拓扑可以
把 UI、状态、凭据、权限、执行和 Runtime Host 放在同一个本地控制面，不要求首版
先承担 OIDC、多租户、共享 PostgreSQL、网络暴露和企业运维。

**边界**：回环监听不是对同机恶意进程的绝对安全承诺。Path 05 仍必须实施
Origin 校验、CSRF 防护、请求大小/超时限制、错误脱敏、SecretStore 和敏感信息
不回显。真实服务化监听另设 Decision Gate。

### D5-2：本地单用户但不取消 owner/workspace 边界

**决定**：首版使用服务端注入的 `owner_id` 和 `workspace_id`。浏览器提交的身份
字段不具备授权效力；服务端从本地启动上下文或本地身份适配器得到当前 owner 和
workspace。首版不实现 OIDC、团队协作或共享多用户控制面，但所有状态、缓存、
Run、Evidence、Trace、Report 和审计记录仍带 owner/workspace 作用域。

**理由**：单用户不等于全局单例。现在保留作用域，可以避免把 SQLite、缓存和
SSE 恢复做成无法迁移的全局状态，同时不虚构已经存在的企业身份系统。

### D5-3：SQLite 是 AlphaOx-owned 本地控制面

**决定**：首版本地控制面使用 AlphaOx-owned SQLite 文件，保存版本化的 Workspace
状态、语义资产、Run、事件、结果引用、Evidence、Trace、Report、偏好和审计元数据。
不使用 Pi session schema，不让浏览器直接打开 SQLite，也不把共享 PostgreSQL
作为普通本地用户的前置依赖。

SQLite 必须具备 schema version、显式 migration、事务原子性、备份、恢复、磁盘
损坏/空间不足处理和失败保留。migration 失败时保留旧版本和备份，不清空数据库、
不半迁移继续服务。具体 Node SQLite 驱动和 migration 库不在本报告中猜定，必须
在 5.1/5.2 实现门中按 Node 版本、许可证、生命周期脚本和恢复能力审查后固定。

**理由**：本地单用户需要可靠的原子状态、可恢复迁移和离线工作，不需要首版引入
远程数据库。AlphaOx 自有 schema 也保持 Runtime、Web 和后续服务模式与 Pi 解耦。

### D5-4：SecretStore 缺失时 fail closed

**决定**：数据源和模型凭据只能通过 SecretStore 抽象取得。持久化场景优先使用
操作系统凭据存储；环境变量或进程会话凭据只用于用户明确选择的临时模式和确定性
测试。SQLite 只保存 `secret_ref`、提供商类别和非敏感状态，不保存密钥值。

SecretStore 不可用、secret 引用不存在、权限不足、凭据读取失败或用户没有明确
允许远程模型外发时，相关连接/模型调用进入 `blocked`，不得退化为明文文件、
日志、SSE、Trace、Tool 参数或前端状态。首版不为了“能连接”而提供明文 fallback。
操作系统适配器的具体库和跨平台覆盖属于后续实现决策，不能在 5.0 把某一个平台
实现冒充为所有平台支持。

### D5-5：AlphaOx-owned HTTP JSON + SSE

**决定**：服务 API 使用版本化的 `/api/v1` 路径和 AlphaOx 自有 JSON 合同。长任务
事件使用同源 SSE；每个 Run 具有稳定 `run_id`、`trace_id`、`event_id` 和可恢复
的事件序号。浏览器重连时读取已持久化快照和事件，不重新执行已经提交的查询。

API 错误必须包含稳定错误码、可读但不泄露内部敏感信息的 message、是否可重试、
`request_id` 和影响范围。HTTP 200 只表示请求合同被接受或读取成功，不表示分析
业务成功；业务状态必须从 Run/Result/Evidence 合同读取。

服务 API 不暴露 Pi Agent、Pi session、Pi event union、Pi transport、任意 SQL、
任意代码、完整凭据或未裁剪原始数据。内部 adapter 可以继续使用 Pi，但必须在
Runtime Host 边界转换成 AlphaOx-owned 类型。

### D5-6：远程模型外发默认关闭、最小化且可见

**决定**：本地模型和远程模型都通过 AlphaOx Runtime Host 调用。远程模型只有在
workspace policy 明确允许 provider/model、上下文类别和预算后才可调用。每次
允许外发时，UI 和 Trace 元数据都展示 provider/model、外发类别、字段/文档数量、
大小、版本、`as_of`、脱敏状态和 policy 引用；不保存或展示完整凭据和未经裁剪的
原始企业行。

不能把“用户已经打开 Web UI”推断为允许外发，不能把模型返回的文字当作授权，也
不能让模型自行扩大上下文、权限、预算或数据范围。外发策略缺失或冲突时，先
`blocked`，不自动重试或改用未授权 provider。

### D5-7：结构化 UI 只渲染合同，不执行模型代码

**决定**：`semantic-web` 只渲染 AlphaOx-defined 的状态、文本、KPI、表格、图表、
来源、Evidence、Trace 和报告块。模型或数据源返回的 HTML、JavaScript、TypeScript、
Shell、SQL 和组件代码均视为文本或被拒绝，不作为前端代码执行。结果块必须携带
来源、状态、`as_of`、freshness、权限过滤和裁剪边界。

**理由**：前端是用户观察和操作控制面，不是第二个任意代码运行器。把展示协议和
代码执行分开，才能测试 XSS、敏感信息、部分失败和可访问性边界。

### D5-8：CLI 命令稳定，打包实现后置

**决定**：首版面向用户的启动合同是 `alphaox start`，而不是 Pi 的 `pi` 命令、
Pi session 参数或开发服务器命令。项目继续采用 TypeScript/Node，不引入 Python
运行时作为 AlphaOx 首版依赖。安装形态可以是 Node CLI package、捆绑 Node 启动器
或后续桌面壳，但它们必须调用同一 Local Service contract。

5.0 只冻结命令、参数、退出码和数据目录语义；具体 npm 包名、单文件 bundle、
PyInstaller/原生桌面壳与自动更新不在本阶段假定，须在 5.7 的安装决策门确认。

### D5-9：Browser 是独立的人类验收层

**决定**：契约测试、类型检查和 fake service 不能代替 Browser 验收。Browser 必须
在明确的 `pass-05` 构建、固定 fixture、临时数据目录、单个可复用标签页和两个
视口下执行完整清单。当前所有 Browser 项目为 `NOT RUN`，直到服务和 UI 真实存在。

## 3. 拒绝的方案与取舍

| 方案 | 处理 | 主要理由 |
| --- | --- | --- |
| Docker Compose 作为普通用户的启动前置条件 | 拒绝作为默认 | 与本地安装目标不符，提前引入容器、网络和运维依赖。 |
| 首版做远程多用户 Web 服务 | 延后 | 需要 OIDC、租户隔离、共享数据库、部署和生产安全决策，不是本地首版的必要条件。 |
| 直接暴露 Pi Server 或 Pi session API | 拒绝 | 无法替代 AlphaOx 的 owner、policy、Tool、Evidence、状态和隐私边界。 |
| 浏览器直接连接数据库 | 拒绝 | 凭据、只读、脱敏、审计、取消和结果最小化无法由浏览器可靠控制。 |
| 用 JSON 文件取代 SQLite 控制面 | 拒绝 | 并发、事务、迁移、恢复、事件顺序和磁盘失败边界不足。 |
| SQLite 保存凭据密文或明文 | 拒绝 | 首版无法把密钥保护、轮换和备份泄漏风险变成可接受的默认行为。 |
| SecretStore 不可用时回退到明文文件 | 拒绝 | “能连上”不能覆盖凭据泄漏风险；正确结果是 `blocked`。 |
| 模型直接生成 SQL、代码或前端组件 | 拒绝 | 无法稳定强制权限、方言、成本、只读、证据和 XSS 边界。 |
| 把 `complete` 绑定为 HTTP 200 或模型最后一句话 | 拒绝 | 请求成功、运行成功和业务结果完整性是不同状态。 |
| 首版允许 `0.0.0.0` 或任意 host | 拒绝 | 会把本地工具静默变成网络服务；服务化能力必须另行批准。 |
| 为未来 Runtime 预建通用插件系统 | 延后 | 当前只有一个内部 Runtime，额外扩展面会扩大权限和兼容风险。 |
| 为 Path5.0 先接真实数据库或真实模型 | 拒绝 | 不可重复、可能泄露凭据，且不能替代契约与 Browser 证据。 |

## 4. 组件、数据流和所有权边界

### 4.1 参考拓扑

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Desktop Browser                                                      │
│ Structured UI: source / context / conversation / result / report    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ same-origin HTTP JSON + SSE
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ AlphaOx Local Service                                                │
│ Origin + CSRF + request limits + owner/workspace + API v1            │
│                                                                      │
│  Source/Context API ──► SQLite Workspace ──► Snapshot/Binding/Pack   │
│  Run API + SSE ────────► Runtime Host ───────► Run/Events/Reports    │
│  SecretStore boundary ─► secret_ref only; no secret in HTTP/UI      │
└───────────────┬──────────────────────┬───────────────────┬───────────┘
                │                      │                   │
                ▼                      ▼                   ▼
       AlphaOx Runtime Host     Controlled Data Tool   SQLite StateStore
       ├─ internal Pi adapter   ├─ plan/preflight       ├─ versioned state
       ├─ loop/timeout/cancel   ├─ connector boundary   ├─ append-only events
       ├─ egress policy         ├─ bounded result       └─ backup/migration
       └─ result/evidence        └─ evidence envelope
                │                      │
                ▼                      ▼
       Explicit model egress    Authorized source connector
       (local or allowlisted)   (fixture first; real source later)
```

浏览器不直接连接数据源、SQLite 或 SecretStore。模型不直接调用 Connector。
Connector 不决定用户授权。SQLite 不保存凭据。Pi adapter 不拥有 AlphaOx 的业务
状态和公开协议。Local Service 只在所有权、来源、上下文、计划、权限、预算、
新鲜度、取消和安全边界通过后，才把请求交给 Runtime 或 Controlled Data Tool。

### 4.2 数据流顺序

一次分析至少按以下顺序经过边界：

1. 浏览器提交带 `request_id` 的结构化用户请求；服务端注入当前 owner/workspace，
   不信任浏览器身份字段。
2. Local Service 读取已发布且仍适用的 Context Pack、Source Snapshot、Binding、
   freshness 和 policy；缺少口径、时间或权限时返回 `clarification_required`。
3. Runtime Host 让内部 Runtime 提出 AlphaOx-owned 的 Analysis Plan/Query Plan
   引用；计划验证、权限、粒度、成本、只读和结果最小化仍由确定性代码完成。
4. Controlled Data Tool Registry 对工具版本、输入 Schema、来源、owner/workspace、
   预算、取消、Evidence 要求和输出边界进行前置检查；失败不进入 executor。
5. Executor 使用服务端 SecretStore 和受控 Connector 访问来源，产生有界结果；
   不接受模型提供的 SQL、代码、凭据或任意网络地址。
6. Result/Evidence/Trace 经完整性、脱敏、freshness、权限和持久化检查后写入
   SQLite；写入成功才向 Runtime 和 UI 发出相应结果/事件。
7. SSE 只传输 AlphaOx-owned 的最小事件和可读取的资源引用；断线后根据事件序号
   和快照恢复，不重复执行已经提交的查询。

## 5. 对外契约

### 5.1 HTTP JSON 通用边界

5.0 设计的每个 HTTP 响应都必须能区分传输成功和业务成功。字段名在实现中必须
保持稳定，Pi 类型不得进入 JSON：

```json
{
  "contract_version": "http.v1",
  "request_id": "req_01",
  "data": {}
}
```

错误响应使用同一版本包装，并至少包含：

```json
{
  "contract_version": "http.v1",
  "request_id": "req_01",
  "error": {
    "code": "workspace_not_writable",
    "message": "本地工作区不可写",
    "retryable": false,
    "status": "blocked"
  }
}
```

`message` 只提供可操作且去敏的信息；路径、凭据、原始 SQL、原始模型消息、
内部堆栈和数据库连接串不进入 API。错误码必须映射到稳定的状态原因，而不是
从 HTTP 状态码推测分析是否完成。

### 5.2 5.0 计划冻结的 API 表面

下表是 AlphaOx API 的边界草案，供 5.1 实现逐项落地。它不是当前已存在的
服务证据，也不授权 5.1 之外的额外能力。

| 方法与路径 | 用途 | 关键边界 |
| --- | --- | --- |
| `GET /api/v1/health` | 读取服务、schema、runtime 和 SecretStore 能力状态 | 不返回凭据、连接串或完整路径；健康不等于数据源可用 |
| `GET /api/v1/workspace` | 读取当前本地 workspace 摘要 | owner/workspace 由服务端注入；只返回安全配置和版本 |
| `GET/POST /api/v1/sources` | 列出或创建数据源配置摘要 | 创建只保存 secret_ref；不回显 secret；source 类型和能力需 Schema 校验 |
| `POST /api/v1/sources/{source_id}/test` | 连接测试 | 只返回脱敏能力/错误分类；不执行用户查询 |
| `POST /api/v1/sources/{source_id}/discover` | 触发 Schema Snapshot 发现 | 后端执行；Snapshot 带版本、结构指纹和 freshness |
| `GET /api/v1/snapshots/{snapshot_id}` | 读取 Snapshot | 只返回已授权结构和元数据，不返回原始数据行 |
| `GET/POST /api/v1/bindings` | 读取或起草 Source Binding | Agent 可起草；发布需要人类审核，版本不可静默覆盖 |
| `POST /api/v1/bindings/{binding_id}/publish` | 发布审核通过的 Binding | 记录 reviewer、时间、生效期和 provenance；冲突时阻断 |
| `POST /api/v1/bindings/{binding_id}/revoke` | 撤销 Binding | 阻止后续使用；历史 Run 保留原引用和状态 |
| `GET/POST /api/v1/context-packs` | 读取或起草 Context Pack | 版本、来源、freshness、权限和生效期必须完整 |
| `POST /api/v1/runs` | 创建一次分析 Run | 接收结构化问题/配置，不接收任意 SQL、代码、凭据或任意工具名 |
| `GET /api/v1/runs/{run_id}` | 读取 Run 快照 | 按 owner/workspace 隔离；返回状态、原因、预算和版本引用 |
| `GET /api/v1/runs/{run_id}/events` | 以 SSE 读取事件 | 支持 event id/序号恢复和有限重连；不重复执行 Run |
| `POST /api/v1/runs/{run_id}/clarifications` | 提交澄清后的结构化引用 | 只能继续处于允许状态的 Run；重复请求必须幂等 |
| `POST /api/v1/runs/{run_id}/cancel` | 取消 Run | 传播 AbortSignal，进入 `cancelling` 后收敛为明确终态 |
| `GET /api/v1/runs/{run_id}/evidence` | 读取已保存 Evidence 摘要 | 不返回未裁剪原始行和凭据；按 Trace/owner/workspace 校验 |
| `GET /api/v1/runs/{run_id}/trace` | 读取脱敏 Trace | 只返回固定事件和资源摘要，不返回 prompt、SQL、credential、原始 output |
| `GET /api/v1/reports/{report_id}` | 读取结构化报告 | 报告块带 Result/Evidence 来源和状态，不能执行嵌入代码 |
| `POST /api/v1/workspace/backup` | 创建范围化本地备份 | 使用一致快照；结果只返回备份标识和校验摘要 |
| `POST /api/v1/workspace/restore/preview` | 预览恢复影响 | 先显示 schema、workspace 和文件影响；不得直接覆盖当前数据 |
| `POST /api/v1/workspace/cleanup` | 清理明确范围的本地数据 | 必须范围化、可审计、可预览；不能递归删除整个 workspace |

不存在返回 secret、任意文件、任意 SQL、任意 Shell、任意 HTTP proxy、任意前端
代码或未授权 raw rows 的 API。下载、导出、写回和远程服务化能力不属于当前首版
默认范围，若后续提出必须单独经过 Decision Gate。

### 5.3 SSE 事件边界

每个 SSE 事件至少包含：

- `event_id`：稳定幂等标识；
- `sequence`：同一 Run 内连续或明确跳号的序号；
- `run_id`、`trace_id`、`owner_id`、`workspace_id`；
- AlphaOx-owned `event_type` 和 payload 版本；
- 事件状态、资源类别、版本引用、digest、行/字节计数或失败原因；
- `occurred_at` 和持久化状态。

SSE 不发送完整 prompt、模型原始消息、SQL、凭据、连接串、原始企业行或任意
HTML/JavaScript。客户端携带 `Last-Event-ID` 或 AlphaOx 的序号请求恢复时，服务
端先读取快照和事件，再按幂等规则补发；断线期间不得因为浏览器重连而自动重跑
查询。重复的 `event_id` 在 UI 端也必须去重。

### 5.4 API 错误码基线

| 错误码 | 状态 | 处理 |
| --- | --- | --- |
| `invalid_request` | `blocked` | 不调用 Runtime 或 Tool，返回字段级去敏校验错误 |
| `origin_denied` / `csrf_denied` | `blocked` | 拒绝状态变更，不返回内部服务细节 |
| `workspace_not_writable` | `blocked` | 保留原状态，提示选择明确的数据目录或恢复路径 |
| `schema_migration_failed` | `blocked` | 停留旧 schema，保留备份和迁移错误 |
| `secret_unavailable` | `blocked` | 不连接来源，不明文落盘，不自动降级 |
| `source_unavailable` | `partial` 或 `blocked` | 按是否已有可用来源区分影响范围 |
| `context_revoked` / `binding_not_published` | `blocked` | 不执行过期/撤销资源引用 |
| `clarification_required` | `clarification_required` | 只询问影响口径的必要字段，不自动猜测 |
| `tool_not_registered` / `unsafe_tool_request` | `blocked` | 在执行器前阻断，Trace 只留安全摘要 |
| `budget_exhausted` / `deadline_exceeded` | `partial` 或 `blocked` | 停止并保留已完成边界，不隐式放宽预算 |
| `run_not_found` / `scope_denied` | `blocked` | 不泄露其他 owner/workspace 是否存在该资源 |
| `run_cancelled` | `blocked` | 保留已完成块，明确未完成范围 |
| `sse_reconnect_required` | `reconnecting` | 读取快照和事件，不重新执行查询 |
| `invalid_result` / `evidence_required` | `blocked` | 不把结果释放给模型或 UI |
| `zero_rows` | `complete` 或 `partial` | 明确表示查询已执行且返回零行，不等同于查询未执行 |

## 6. SQLite Workspace 状态模型

### 6.1 数据分类与保存原则

| 数据类别 | 保存位置 | 允许内容 | 禁止内容 |
| --- | --- | --- | --- |
| Workspace 元数据 | AlphaOx SQLite | owner/workspace、schema、偏好引用、版本 | 认证 token、完整凭据 |
| Source 配置 | SQLite + SecretStore | source id、类型、display name、能力、secret_ref | password、API key、连接串中的秘密部分 |
| Snapshot | SQLite | 表/字段/关系、结构指纹、freshness、版本、来源引用 | 未授权原始行、完整导入数据 |
| Binding / Context Pack | SQLite | 版本、状态、术语、来源、权限、生效期、digest | 未审核内容被标作 published |
| Run / Event | SQLite | 状态、原因、版本指针、预算、时间、digest、计数 | 完整 prompt、SQL、credential、原始 output |
| Result / Evidence | SQLite 或受控结果存储 | 结果摘要、来源、`as_of`、freshness、权限范围、证据引用 | 未裁剪全量原始行、无来源数字 |
| Trace | SQLite | 固定事件、资源类别、digest、状态、计数、序号 | 自由文本、prompt、SQL、凭据 |
| Report | SQLite | 结构化展示块、Result/Evidence 引用、警告、版本 | 可执行 HTML/JS/TS/Shell |
| 审计记录 | SQLite | 操作类别、actor kind、资源、状态、时间、digest | secret 值、原始敏感输入 |
| Secret | 操作系统凭据存储或显式临时会话 | secret_ref 对应的秘密值 | SQLite、日志、SSE、Git、Browser |

所有可持久化资源都必须能追溯到 owner/workspace、contract version、created_at、
updated_at、版本或 digest。历史 Run 引用的 Snapshot、Binding、Context Pack、
Policy、Tool 和 Evidence 版本不能因为当前指针移动而改变含义。

### 6.2 最小逻辑表边界

具体列和 SQL 在 5.2 迁移实现时确定，但不得脱离下列逻辑边界：

| 逻辑集合 | 作用 | 关键不变量 |
| --- | --- | --- |
| `schema_migrations` | 记录已应用 migration | 每次 migration 有唯一版本；失败不可写成已完成 |
| `workspace` | 保存当前本地 workspace | owner/workspace 是服务端边界；不从请求覆盖 |
| `source` / `source_version` | 保存来源摘要和版本 | secret 只存 ref；版本和状态不可静默覆盖 |
| `snapshot` | 保存结构发现结果 | structure fingerprint、freshness、来源版本完整 |
| `binding` / `binding_version` | 保存语义映射 | draft/review/published/revoked 生命周期明确 |
| `context_pack` / `context_resource` | 保存结构和文字上下文 | 来源、权限、生效期、freshness 可验证 |
| `run` | 保存一次用户分析 | 状态、原因、版本指针和预算与 owner 绑定 |
| `run_event` | 保存可恢复事件 | event_id/sequence 幂等；append-only 语义 |
| `result` / `evidence_record` | 保存结果与证据引用 | 完整性、来源、as_of、Trace 和裁剪边界先验证 |
| `trace_event` | 保存脱敏生命周期 | 固定字段、连续序号、digest；无自由敏感字段 |
| `report` | 保存结构化报告 | 只能引用已保存 Result/Evidence；无可执行代码 |
| `preference` | 保存本地用户偏好 | 不保存 secret；变更可审计 |
| `audit_event` | 保存范围化操作记录 | 不写原始敏感值；清理和恢复必须留痕 |

### 6.3 版本、生效和回滚

- Source、Snapshot、Binding、Context Pack、Policy、Tool、Evidence 和 Report 都
  必须以版本或 digest 引用；发布是显式状态转换，不是写入即生效。
- Binding/Context Pack 由 Agent 起草并不等于已批准。只有人类审核、时间、生效期、
  provenance 和权限条件满足后，才能成为 Runtime 可解析的 published 版本。
- 撤销版本阻止新 Run 使用，但历史 Run 仍保留其原始引用和结果状态；不能把历史
  结果改写成当前版本的结果。
- SQLite 回滚优先使用一致备份恢复或禁用新版本；不做未经审查的自动降级，也不
  删除用户数据作为“修复迁移”的副作用。

## 7. 状态、失败与边界矩阵

| 场景 | 状态/原因 | 必须行为 | 是否继续执行 |
| --- | --- | --- | --- |
| 首次启动、无 workspace | `ready / empty` | 显示空状态和设置入口；不虚构数据源 | 否，等待用户配置 |
| 端口被占用 | `blocked / port_in_use` | 明确提示端口，允许显式 `--port`；不换成公网 host | 否 |
| 请求非回环 host | `blocked / non_loopback_denied` | 拒绝启动，提示服务化决策门 | 否 |
| 数据目录不存在 | `ready` 或 `blocked` | 只创建明确目录；权限失败不清空上级目录 | 按创建结果 |
| 数据目录不可写 | `blocked / workspace_not_writable` | 保留原目录和状态；不可继续写入 | 否 |
| SQLite schema 过旧 | `migrating` | 先备份、加锁、事务迁移；迁移前不接收请求 | 是，成功后 |
| SQLite migration 失败 | `blocked / schema_migration_failed` | 保留旧 DB、备份和错误；不半迁移运行 | 否 |
| 磁盘空间不足/事务失败 | `blocked / persistence_failed` | 不发送“已保存”事件，保留已提交状态 | 否，等待恢复 |
| SecretStore 不可用 | `blocked / secret_unavailable` | 不连接数据源/模型，不明文 fallback | 否 |
| Origin/CSRF 不合法 | `blocked / origin_denied` 或 `csrf_denied` | 拒绝状态变更，不泄露内部状态 | 否 |
| 来源连接测试失败 | `blocked / source_unavailable` | 显示脱敏原因和能力边界，不创建假 Snapshot | 否 |
| Snapshot 过期/未知 | `blocked / stale_context` 或 `clarification_required` | 按 freshness policy 阻断或要求刷新 | 否 |
| Binding 未发布/已撤销 | `blocked / binding_not_published` 或 `context_revoked` | 不进入计划编译和 Tool executor | 否 |
| 缺少时间、粒度或指标口径 | `clarification_required` | 询问最小必要信息，不猜测默认口径 | 否 |
| 模型提出任意 SQL/代码/工具 | `blocked / unsafe_tool_request` | 在 Registry 前拒绝，不保存原文到 Trace | 否 |
| 远程外发未允许 | `blocked / egress_denied` | 不调用 provider，不用未授权模型替代 | 否 |
| 工具/来源部分失败但已有证据 | `partial / source_unavailable` | 保留完成部分、缺失来源和影响范围 | 仅按有限重试 |
| 查询成功且零行 | `complete / zero_rows` | 显示已执行且零行；不显示为未执行 | 否 |
| 查询未运行 | `blocked / query_not_run` | 明确没有查询证据，不显示空图表 | 否 |
| 运行中取消 | `cancelling` → `blocked / cancelled` | 传播取消；保留已完成块；拒绝迟到结果 | 否 |
| SSE 断开 | `reconnecting` | 读取快照/事件并按 event_id 去重 | 不重复执行 |
| 浏览器重复提交 | `accepted` 或既有 Run | 用 request/idempotency key 返回既有 Run | 不创建重复 Run |
| 浏览器刷新运行页 | `reconnecting`/原状态 | 恢复原 run_id、trace_id 和事件位置 | 不重跑 |
| Trace/Evidence 写入失败 | `blocked / persistence_failed` | 不宣称 complete；不释放无证据结果 | 否 |
| 报告块含任意代码 | `blocked / unsafe_render_block` | 当作文本拒绝或不渲染；不执行 | 否 |
| 备份文件损坏 | `blocked / backup_invalid` | 不覆盖当前 DB；显示校验失败 | 否 |
| 用户清理数据 | `ready` 或 `blocked` | 只清理明确范围，预览/审计，不能递归删整库 | 按范围 |

## 8. 安全与威胁模型

### 8.1 主要威胁与控制

| 威胁 | 具体例子 | Path 05 控制 | 证据要求 |
| --- | --- | --- | --- |
| 恶意网页访问本地服务 | 其他站点向 `127.0.0.1:43120` 发起写请求 | 严格 Origin、CSRF、无宽松 CORS、请求 token | Browser network/Origin 负例 |
| 同机进程读取本地状态 | 读取 SQLite 或日志 | 回环不是绝对隔离；权限目录、SecretStore、最小日志和文档化边界 | 安全报告不夸大保护 |
| 凭据进入前端或 Trace | source 配置/错误响应中回显 password | secret_ref、后端读取、固定脱敏、敏感字段 schema 检查 | console/network/Trace 检查 |
| 模型外发原始数据 | 把完整表行放进远程 prompt | egress allowlist、Context 最小化、字段/数量/大小限制、默认阻断 | fake provider 收到的摘要 |
| Prompt injection 改变权限 | 文档要求模型绕过 policy 或输出 SQL | 文本是上下文而不是授权；Plan/Tool/Policy 确定性校验 | injection fixture |
| 模型生成任意 SQL/代码 | 请求带 `sql`、`command` 或组件代码 | 结构化 Plan、危险字段阻断、Registry 前置拒绝 | API/Tool 负例 |
| XSS 或任意前端执行 | 报告块返回 `<script>` 或 HTML | 结构化展示块、转义、CSP/脚本边界、无任意渲染 | Browser console/network |
| 越权读取 Run | 修改 URL 中的 run_id | server-side owner/workspace scope；错误不泄露存在性 | scope fixture |
| SSE 重放或重复查询 | 断线重连导致查询再跑 | 持久 event_id/sequence、idempotency、快照恢复 | disconnect/reconnect fixture |
| 路径遍历或清理越界 | `--data-dir`/cleanup 指向上级目录 | 明确路径解析、范围确认、禁止递归整库删除 | cleanup negative tests |
| 迁移损坏用户状态 | 半迁移或失败后启动新 schema | 备份、锁、事务、旧版本保留、恢复预览 | migration fault injection |
| 磁盘/进程故障伪造成功 | 写入失败但 UI 显示 complete | 事件和终态在持久化成功后才发布 | persistence failure test |

### 8.2 安全不变量

1. 任何凭据、原始 SQL、任意代码和未裁剪原始数据都不能进入 Browser、普通
   Trace、SSE 或 Git。
2. 客户端身份字段、模型文字和 HTTP 200 都不能单独授予权限或表示成功。
3. 所有数据执行必须经过 AlphaOx-owned Context/Plan/Policy/Tool/Evidence 边界。
4. 所有影响用户数据的操作都要有明确范围、幂等或审计记录；失败时保留旧状态。
5. 回环默认、单用户默认和本地模型默认不能被描述成生产网络安全、企业身份或
   真实数据正确性的证明。

## 9. 迁移、备份、恢复、清理与回滚

### 9.1 数据目录边界

`--data-dir` 是用户明确选择的 AlphaOx 工作区根目录。实现需要使用平台应用
数据目录作为默认候选，并允许用户显式覆盖；具体 macOS、Linux 和 Windows 路径
命名属于 5.1 CLI 实现决策，不能在 5.0 假装已经统一。

目录布局的逻辑边界为：

```text
<data-dir>/
  alphaox.sqlite          # AlphaOx-owned state; no secret values
  backups/                # consistent, checksummed workspace backups
  logs/                   # redacted operational logs only
  runtime/                # bounded transient files; safe to recreate
```

不把用户数据、凭据、真实外部数据或模型缓存写入 Git、默认安装包或仓库目录。
临时 fixture 必须显式使用临时目录，不得复用用户的默认 data-dir。

### 9.2 Migration 顺序

1. 启动时读取 schema version 和 workspace 元数据，不接收业务写请求。
2. 检查目录权限、磁盘空间、SQLite 完整性和已有 migration 锁。
3. 生成一致备份并记录备份 digest；不能在写事务中直接复制不一致的数据库文件。
4. 在事务和明确的 schema lock 内应用单调版本 migration，逐步验证关键不变量。
5. 验证所有 owner/workspace、版本引用、事件序号、secret_ref 和审计边界。
6. 只有 migration 成功并持久化成功后才对外报告 `ready`；失败则停在旧版本，
   保留备份和错误，不半迁移启动。

### 9.3 备份与恢复

- 备份是范围化、可校验的一致快照；必须包括 schema version、workspace id、创建
  时间、来源类别和 digest，不包括 SecretStore 的秘密值。
- 恢复先执行 preview，说明将替换的 schema、workspace、Run、Report 和审计范围；
  默认不覆盖当前状态。
- 恢复前必须保留当前状态备份；恢复失败不删除当前有效数据库。
- 恢复后对版本引用、Evidence/Trace 完整性、SecretStore 引用存在性和事件序号
  执行校验；无法校验时进入 `blocked`。

### 9.4 清理和回滚

- 清理必须指定范围，例如 transient runtime、某个 Run、缓存或备份；不能把
  “清理 workspace”实现为无确认的递归删除。
- 清理操作要预览影响、要求明确确认、写入审计，并在失败时保留未清理部分。
- 代码回滚通过版本化 commit；schema 回滚优先恢复经校验的旧备份，不自动把
  新 schema 降级成旧 schema。
- Tool、Binding、Context Pack 或 Report 回滚只切换已知版本指针并保留历史引用；
  不能静默改写历史 Run 的证据含义。
- 本阶段不执行 `git reset --hard`、`git clean`、用户数据删除、远程推送或部署。

## 10. 分阶段实施计划与阶段门

| 阶段 | 交付范围 | 必须证明 | commit / 下一步门 |
| --- | --- | --- | --- |
| 5.0 | 本报告、API/CLI/Workspace/SQLite/SecretStore 契约、威胁模型、状态矩阵、Browser 清单 | 文档自洽、来源可追溯、未实现项没有被宣称完成 | 本阶段文档检查后提交；5.1 另行启动 |
| 5.1 | Local Service、`alphaox start`、同源 HTTP/SSE、health、Origin/CSRF、端口和退出码 | 回环绑定、端口失败可读、无宽松 CORS、API 错误契约和 fake Run smoke test | service smoke test 后提交 |
| 5.2 | SQLite schema、migration、备份/恢复、Workspace Store、SecretStore 接口和 fail-closed adapter | migration fault injection、磁盘失败、无明文 secret、恢复不覆盖原状态 | migration/secret 测试后提交 |
| 5.3 | `semantic-web` 骨架、路由、布局、结构化结果块、空/加载/错误/partial/stale 状态 | 不执行任意前端代码；键盘、焦点、滚动和信息层级可操作 | 静态 Browser 检查后提交 |
| 5.4 | 数据源配置、连接测试、Snapshot、Binding 审核、Context Pack 版本/生效期 | draft/review/published/revoked、freshness、权限和阻断原因可见 | fixture Context 流程后提交 |
| 5.5 | 对话、澄清、Run 进度、结果、来源、Trace、Evidence、Report | run_id 恢复、SSE 重连去重、partial/blocked 不伪装、取消幂等 | 运行契约测试后提交 |
| 5.6 | 凭据遮蔽、外发提示、CSP/输入处理、responsive、reduced-motion、可访问性 | console/network 无敏感泄漏；键盘核心流程可用 | Browser gate 前提交 |
| 5.7 | CLI 打包、安装、升级、卸载、数据保留、最终 Browser 验收 | 本地干净目录可安装/启动/恢复；清单逐项有证据 | 人类 Path5 Decision Gate 后合回 `pass-05` |

每一阶段只实现已批准的范围，使用确定性 fixture，不自动修改根路线图。阶段提交
必须只包含本阶段由当前任务实际修改的路径；现有未跟踪 Path5 计划文件不能被
顺手纳入，除非另行确认其归属和内容。

## 11. 完整 Browser 验收清单

### 11.1 固定构建、起始状态和记录方式

- **构建/分支**：Path5 完成阶段对应的 `codex/alphaox/pass-05` 构建；若使用
  `pass-05-<slice>`，记录切片 commit 和合回前后的 commit。当前 5.0 只有文档，
  因此所有项目为 `NOT RUN`。
- **启动命令**：
  `alphaox start --host 127.0.0.1 --port 43120 --data-dir /tmp/alphaox-browser-acceptance`
  。当前 CLI 尚未实现，不能用文档存在冒充启动通过。
- **起始数据**：先创建或清空明确的临时目录；只使用项目自有固定 seed 的两套
  物理 Schema、术语、数据字典、退款政策、促销日历、freshness、权限和 fake
  model stream；不使用 Olist、AdventureWorks、真实数据库或真实凭据。
- **标签页**：内置 Browser 只打开一个可复用标签页；不为同一流程反复新建标签。
- **URL**：起始 `http://127.0.0.1:43120/`；健康检查
  `http://127.0.0.1:43120/api/v1/health`；SSE 使用
  `http://127.0.0.1:43120/api/v1/runs/{run_id}/events`。
- **视口与缩放**：桌面 `1440×900`、移动 `390×844`，均为 100%；桌面是主要
  体验，移动检查不得只截屏而不操作。
- **记录字段**：每项记录 `PASS`、`FAIL`、`BLOCKED` 或 `NOT RUN`，附 build/commit、
  URL、时间、截图、`request_id`、`run_id`、`trace_id`、console/network 结论和
  失败影响范围。
- **直接失败条件**：凭据泄露、任意代码执行、浏览器直连数据库、未授权 Tool
  调用、重复执行查询、`partial/blocked` 伪装成 `complete`、错误伪装成 `zero_rows`
  或清理超出指定临时目录，任何一项直接 `FAIL`。

### 11.2 有序执行清单

| ID | 人类操作与检查 | 预期结果 | 当前结果 |
| --- | --- | --- | --- |
| B5-01 | 启动命令并打开起始 URL，确认窗口、标题和服务 commit | 只监听回环；首屏稳定；显示本地 workspace 和空状态；无启动堆栈 | `NOT RUN` |
| B5-02 | 访问同源 health URL，观察 loading/ready/error | health 只返回安全能力和 schema 状态；不返回 secret/path/连接串 | `NOT RUN` |
| B5-03 | 用鼠标和 Tab 依次访问标题、导航、主要内容、输入、提交和状态区 | 焦点始终可见、顺序合理、无焦点陷阱；跳过重复导航可用 | `NOT RUN` |
| B5-04 | 在空状态打开数据源设置 | 明确说明需要配置来源；不显示假数据、假指标或凭据输入回显 | `NOT RUN` |
| B5-05 | 用 fixture 配置一个可用来源，执行连接测试 | 显示连接能力、只读能力和 source id；不显示 secret；网络只到本地服务 | `NOT RUN` |
| B5-06 | 配置错误来源、不可用来源和 SecretStore 不可用 fixture | 分别显示脱敏的 `source_unavailable`、`secret_unavailable`；不创建假 Snapshot | `NOT RUN` |
| B5-07 | 触发 Schema 发现，滚动查看 Snapshot 表、字段、关系、fingerprint、freshness | loading、完成、部分和错误状态清楚；长内容可滚动；无原始未授权行 | `NOT RUN` |
| B5-08 | 起草一个 Binding，修改 metric/dimension/time 语义并保存 | 进入 draft/in_review；显示来源、版本、provenance 和待审核状态 | `NOT RUN` |
| B5-09 | 人工发布、撤销并切换 Binding 版本 | 发布需要明确操作；生效期/版本可见；撤销后新 Run 被阻断，历史引用保留 | `NOT RUN` |
| B5-10 | 创建 Context Pack，检查术语、数据字典、文档、权限和 freshness | 资源有来源和版本；过期/未知 freshness 不被静默当作 fresh | `NOT RUN` |
| B5-11 | 提交缺少时间范围或粒度的问题 | 显示 `clarification_required`，只询问影响口径的必要信息，不自动猜测 | `NOT RUN` |
| B5-12 | 提交正常 fixture 分析并等待 fake stream | 依次看到 planning/executing 和明确终态；显示 run_id/trace_id、预算和版本 | `NOT RUN` |
| B5-13 | 打开 KPI、图表、表格、方法和报告块 | 每块带状态、来源、`as_of`、freshness、裁剪边界和可读替代文本 | `NOT RUN` |
| B5-14 | 打开 Source、Binding、Context、Query、Evidence 和 Trace 详情 | 可以追溯版本和事件；不显示凭据、原始 SQL、完整 prompt 或未裁剪行 | `NOT RUN` |
| B5-15 | 触发 stale snapshot、revoked binding、无权字段和未注册工具 fixture | 分别显示 `stale/context_revoked/scope_denied/tool_not_registered`；executor 未调用 | `NOT RUN` |
| B5-16 | 触发来源失败、部分结果、零行和查询未运行 fixture | `partial`、`zero_rows`、`query_not_run` 分开显示；不把失败显示为“无数据” | `NOT RUN` |
| B5-17 | 触发预算耗尽、超时和有限重试 | 不超过预算；重试次数/原因/最终状态可读；不隐式放宽限制 | `NOT RUN` |
| B5-18 | 运行中点击取消，并观察鼠标、键盘和状态变化 | `cancelling` 后收敛到 cancelled；已完成块与未完成范围清楚；迟到结果不写入 | `NOT RUN` |
| B5-19 | 断开并恢复本地 SSE，刷新同一 Run，重复双击提交 | 快照/事件恢复，event_id 去重，run_id 不变，不重复执行查询 | `NOT RUN` |
| B5-20 | 修改远程模型外发配置并提交需要外发的 fixture | 默认阻断；允许后显示 provider/model、类别、大小、版本和 policy；不外发 secret/raw rows | `NOT RUN` |
| B5-21 | 在 console/network 检查请求、响应、SSE 和错误 | 无明文凭据、任意 SQL/代码、跨源请求、未处理异常或敏感堆栈；错误码一致 | `NOT RUN` |
| B5-22 | 在桌面视口用鼠标滚动到长表、Trace、报告和错误详情 | 滚动容器无锁死；表头/标题层级可理解；横向内容有明确处理方式 | `NOT RUN` |
| B5-23 | 切换 `390×844`，重复 B5-11、B5-12、B5-14、B5-18 | 无不必要水平溢出；核心输入、状态、结果、来源、Trace 和取消仍可操作 | `NOT RUN` |
| B5-24 | 启用 reduced-motion 后重载并重新运行 | 动画降级但不丢失状态、进度、焦点和错误提示；无闪烁阻断操作 | `NOT RUN` |
| B5-25 | 创建备份、预览恢复并恢复到固定临时目录 | 展示影响范围和校验摘要；失败不覆盖当前状态；恢复后版本/事件可读 | `NOT RUN` |
| B5-26 | 只清理 transient、指定 Run 和临时 workspace，随后重开页面 | 只影响选择范围；有审计；无残留凭据；不递归删除仓库或用户上级目录 | `NOT RUN` |

### 11.3 验收后的清理

1. 停止本地 AlphaOx 服务，确认没有把真实 provider、凭据或用户目录留在测试
   fixture 中。
2. 只删除或移走 `/tmp/alphaox-browser-acceptance` 范围内的测试数据；不运行整库
   清理，不修改仓库用户未提交文件。
3. 保存截图、console/network 结果、build commit、`run_id`/`trace_id` 和每项状态。
4. 如果中途 `BLOCKED`，记录阻断原因和已执行到的步骤；不得把未执行项改成 PASS。

## 12. 依赖、运维和未决风险

### 12.1 依赖边界

| 依赖 | Path 05 用途 | 当前状态 | 证据边界 |
| --- | --- | --- | --- |
| `@alphaox/semantic-agent` | Runtime Host、Context、Plan、Tool、Result、Evidence、Trace | 本地包，Path4 已验证 | 确定性代码/测试，不代表真实连接 |
| Node.js `>=22.19.0` | Local Service、CLI 和 Web 资产宿主 | 根/包 engines 已声明 | 需在安装与启动 smoke test 中复核 |
| TypeBox / Vitest | 合同校验和确定性测试 | 已在 semantic-agent 使用 | 不调用真实 Provider |
| SQLite driver / migration library | 本地控制面 | 尚未选择 | 需许可证、Node 兼容、失败恢复和锁行为审查 |
| OS SecretStore adapter | 持久化凭据 | 尚未实现 | 不可用必须 fail closed；不能以明文 fallback |
| Web UI toolchain | `semantic-web` 和静态资源 | 当前不存在 | 需在 5.3 决策和依赖审查中固定 |
| Pi Agent Core | 内部 Runtime 实现来源 | Path4 internal adapter | Pi 类型不得进入 AlphaOx 公开边界 |
| 固定 fixtures/fake model | CI、Browser 和负例 | 待 Path5 实现补齐 | 不支撑真实数据质量或模型质量 |

### 12.2 未决风险

| 风险 | 影响 | 处理 | 触发门 |
| --- | --- | --- | --- |
| SQLite 驱动/迁移库选择不当 | 锁、恢复、Node 兼容或许可证问题 | 5.1/5.2 比较并固定精确版本；先做故障注入 | 5.2 前 |
| OS SecretStore 跨平台差异 | 某平台无法安全持久化凭据 | 适配器接口、平台能力探测、不可用即阻断 | 5.2/5.7 |
| 现有 monorepo 没有 Web package/CLI | 包边界和发布形态返工 | 5.1/5.3 先冻结 package/entrypoint，不复用 Pi 身份 | 5.1 前 |
| 同源开发端口被误当正式安全边界 | CORS/CSRF 或 Browser 行为失真 | 发布验收使用同源；开发拆分只作开发配置 | 5.1/5.6 |
| 进程崩溃或非协作执行器仍运行 | 重复执行、资源泄漏、状态不一致 | 持久化状态机、幂等、AbortSignal；强制隔离另设 Gate | 5.2/5.5 |
| 本地回环服务被同机进程访问 | 本地数据暴露 | 明确威胁边界、权限目录、SecretStore、Origin/CSRF | 5.1/5.6 |
| 外发策略与 UI 不一致 | 凭据或敏感上下文外发 | policy 在后端强制，UI 只作说明；fake provider 验证 | 5.5/5.6 |
| 长任务 SSE 恢复不完整 | 重跑查询或丢失证据 | event_id/sequence、快照、重连和重复提交测试 | 5.5 |
| Browser 清单随实现漂移 | 假验收 | 清单是报告权威；每次变更先更新报告并重新 Gate | 5.6/5.7 |
| 安装/卸载误删用户数据 | 不可恢复损失 | 数据保留与清理范围独立；卸载默认不删工作区 | 5.7 |
| 真实数据许可和来源未固定 | 分发/CI 侵权或不合规 | 只使用自有 fixture；外部参考数据走 Path6 Source Finding | 5.7/Path6 |

## 13. 对抗性复核

本报告完成前按以下反例检验其是否把计划冒充成实现：

- **启动反例**：当前不存在 `alphaox start` 和 Local Service，因此 Browser 清单
  明确保持 `NOT RUN`，没有把命令示例当作启动证据。
- **包边界反例**：当前没有 `semantic-web`；报告把它列为后续新增边界，没有把
  Pi 的 `coding-agent` 或现有 server package 误写成 AlphaOx Web 已完成。
- **凭据反例**：SQLite 逻辑状态只允许 `secret_ref`；SecretStore 缺失时明确
  `blocked`，没有隐含明文 fallback。
- **安全反例**：回环地址没有被描述为绝对安全；同机进程、Origin/CSRF、XSS、
  prompt injection 和外发风险均单列控制和证据。
- **状态反例**：`zero_rows`、`query_not_run`、`partial`、`blocked`、`stale` 和
  `clarification_required` 分开，不能由 HTTP 200 或空数组重建。
- **恢复反例**：SSE 断线、浏览器刷新和重复提交以 event/idempotency 处理，不得
  让重连触发第二次查询。
- **迁移反例**：migration、备份、恢复、磁盘失败和清理均规定保留旧状态；没有
  使用整库删除作为修复手段。
- **路线图反例**：本阶段不修改 `开发路径图.md`，也不把文档状态自动回写路线图。
- **工作区反例**：当前既有路线图修改和 Path 01/02/03/05/06/07 未跟踪文件不
  属于本报告，提交时必须通过显式路径 staging 排除它们。

对抗性结论：Path5.0 的文档边界可以作为后续实现基线；SQLite 驱动、SecretStore
适配器、Web toolchain、CLI 打包形态和真实运行证据仍是明确的后续决策/实现门。
本报告不声称 Path 05 产品功能、Browser、真实模型、真实数据库或安装包已完成。

## 14. 路线图扫描与变更提案

已只读检查根目录 `开发路径图.md` 的项目愿景、设计基线、核心契约、路径二至
路径七、长期方向、明确不做和人工决策门。路线图已经覆盖 Path5.0 的本地优先、
单用户、同源 Web、SQLite、SecretStore、CLI、Browser 和后续服务化边界。

**本报告不提出路线图变更。** 不把 Path5.0 的文档状态写回路线图，不新增、删除、
改写、移动或重命名 `开发路径图.md`。若后续实现暴露路线图缺口，必须先展示精确
diff 并得到人类对该 diff 的明确批准，且只在 `main` 修改。

## 15. 来源证据与交付物

### 15.1 来源证据

- [根路线图](/Users/archer/Documents/ChatGPT/alphaox/开发路径图.md)：项目愿景、
  本地优先设计基线、Path5 范围和人工决策门。
- [Path5 development plan](/Users/archer/Documents/ChatGPT/alphaox/docs/alphaox/path-05/development-plan.md)：
  5.0 至 5.7 阶段计划和 Browser 操作基线；当前是工作区中的未跟踪计划文件。
- [Path4 architecture and acceptance](/Users/archer/Documents/ChatGPT/alphaox/docs/alphaox/path-04/architecture-and-acceptance.md)：
  Runtime Host、Controlled Data Tool、Session Context、Evidence、Trace、Pi
  adapter 和 Path5 的前置边界。
- [Path3 architecture and acceptance](/Users/archer/Documents/ChatGPT/alphaox/docs/alphaox/path-03/architecture-and-acceptance.md)：
  Analysis Plan、Query Plan、执行前置检查、Result 和 Evidence 的上游契约。
- [Path2 contract design](/Users/archer/Documents/ChatGPT/alphaox/docs/alphaox/path-02/contract-design.md)：
  Source Connector、Snapshot、Binding、Context Pack、版本、freshness 和来源边界。
- [semantic-agent package](/Users/archer/Documents/ChatGPT/alphaox/packages/semantic-agent/package.json)：
  当前 AlphaOx 自有 package 的 Node 版本、TypeBox、Vitest 和内部 Pi Agent Core 依赖。
- [repository AGENTS.md](/Users/archer/Documents/ChatGPT/alphaox/AGENTS.md)：分支、
  人类路线图、测试、提交、架构报告和 Browser 验收治理规则。

这些证据能支撑本地代码合同和计划边界，不能支撑真实 Provider、真实 Connector、
用户数据正确性、安装包可用性、生产安全或 Browser 通过。

### 15.2 Path5.0 交付物

- 本报告：`docs/alphaox/path-05/architecture-and-acceptance.md`
- 已存在且保留的阶段计划：`docs/alphaox/path-05/development-plan.md`
- API/CLI/Workspace/SQLite/SecretStore 契约边界
- 状态/失败/安全/迁移/清理/回滚矩阵
- 完整 Browser 验收清单，当前全部 `NOT RUN`
- Path5.1 至 5.7 的实现阶段门和未决风险

## 16. 人类 Decision Gate 记录

2026-08-26，用户明确回复“可以”，批准按以下范围启动 Path5.0：

1. Path5 的目标是本地 Web 分析工作台和安装交付，不把 Docker、多用户、生产
   OIDC 或远程服务作为普通本地用户前置条件。
2. 首版使用同源本地服务，默认回环地址 `127.0.0.1`、默认端口 `43120`、
   `alphaox start`、显式 `--port` 和 `--data-dir`。
3. 使用 AlphaOx-owned SQLite 作为本地单用户控制面；凭据通过 SecretStore，
   不可用时阻断，不落明文。
4. 使用 AlphaOx 自有 HTTP JSON + SSE、owner/workspace、Run/Result/Evidence/
   Trace 和结构化 Web 展示边界；不暴露 Pi 类型，不允许浏览器直连数据库。
5. 远程模型外发必须最小化、可见、可配置；真实模型、真实数据和外部写入不在
   本阶段范围内。
6. 完整 Browser 清单作为独立人类验收层，当前保持 `NOT RUN`。

该批准只覆盖 Path5.0 文档和契约冻结范围，不等于 5.1 至 5.7 已完成，也不授权
推送、Pull Request、部署、发布、真实凭据、真实数据库或外部写回。SQLite 驱动、
SecretStore 具体平台适配、Web toolchain、CLI 打包和自动更新仍须在后续实现门
中固定并验证。

**当前状态：Path5.0 架构与验收基线已形成，待文档检查和阶段 commit；Path5.1
实现尚未开始。**
