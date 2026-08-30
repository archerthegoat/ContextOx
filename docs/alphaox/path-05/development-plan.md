# AlphaOx 路径五：本地 Web 分析工作台与安装交付详细开发计划

## 0. 计划状态与决策边界

- **状态**：`PROPOSED`，尚未开始实现。
- **目标**：交付一个可本地安装、通过浏览器使用的 Data Agent 工作台。
- **默认入口**：`alphaox start` 启动本地 AlphaOx Service，并打开 Web UI。
- **前置门**：路径四 Runtime Host、HTTP JSON/SSE、状态契约和本地优先架构报告必须先通过 Decision Gate。
- **不授权事项**：不授权公网监听、生产 OIDC、真实企业生产数据库、外部写回、推送或发布。

## 1. 产品目标

用户不需要先部署企业服务或理解 Agent 内核，即可在自己的机器上：

1. 配置本地或经授权的数据源。
2. 查看 Schema Snapshot 并维护 Source Binding/Context Pack。
3. 通过 Web UI 提问并看到澄清、计划、执行、证据和报告。
4. 清楚知道结果是否完整、过期、被权限过滤、部分失败或未执行。
5. 保存、导出、备份和清理自己的本地工作区。

## 2. 范围与非目标

### 2.1 范围

- `semantic-agent` 本地服务和 `semantic-web` 前端。
- `alphaox start` 启动器/CLI、本地工作区、同源 HTTP JSON + SSE。
- 首版单用户工作区、AlphaOx 自有本地状态库和 SecretStore 边界。
- 数据源配置、连接测试、Schema 发现、Binding 审核、分析对话、结果、报告和 Trace。
- 桌面浏览器优先、窄屏可用、键盘/焦点/滚动和 reduced-motion 支持。

### 2.2 非目标

- 不以多用户、OIDC、共享 PostgreSQL 或远程服务为首版前置条件。
- 不要求 Docker 才能运行本地产品；Docker Compose 只保留为可选开发/演示方式。
- 不让浏览器直连数据库、不在前端保存完整凭据、不执行模型生成代码。
- 不在本路径实现原生桌面壳；是否使用 Electron 或其他壳由后续决策门决定。

## 3. 首版运行基线

- 一个 Node 进程同时托管本地 API、SSE、静态 Web 资源和 Runtime Host。
- 默认绑定 `127.0.0.1`，建议默认端口 `43120`，端口冲突时显式提示并允许 `--port` 覆盖。
- 前端与 API 使用同一 Origin；开发环境可以拆分端口，但发布验收按同源模式执行。
- 本地控制面使用 AlphaOx 自有 SQLite Schema；不复用 Pi session 数据模型。
- SecretStore 不可用时连接阻断，不明文持久化；环境变量/会话临时凭据与安全持久化适配器分别验收。
- 远程模型调用必须展示外发类别并使用最小上下文；凭据和未授权原始数据不得离开本地后端。

## 4. 分阶段开发计划

| 阶段 | 交付 | 关键检查 | commit 门 |
| --- | --- | --- | --- |
| 5.0 契约冻结 | API、CLI、Workspace、SQLite、SecretStore 和安全威胁模型 | 报告、Schema、错误码和端口/数据目录边界获批 | 决策文档提交 |
| 5.1 本地服务 | `alphaox start`、同源 API、SSE、健康检查和安全启动 | 回环绑定、Host/Origin、CSRF、无 CORS、端口失败可读 | 本地服务 smoke test 后提交 |
| 5.2 本地状态 | AlphaOx-owned SQLite migration、备份、恢复和数据目录 | 迁移失败不清空；状态版本可回滚；无明文凭据 | migration/secret 测试后提交 |
| 5.3 Web 骨架 | 路由、布局、空状态、加载/错误/部分/过期状态 | 不执行任意前端代码；键盘焦点和信息层级成立 | 静态 Browser 检查后提交 |
| 5.4 Context 工作台 | 数据源配置、连接测试、Snapshot、Binding 审核和 Context Pack | 版本、生效期、freshness、阻断原因可见 | fixture 流程通过后提交 |
| 5.5 分析体验 | 对话、澄清、运行进度、结果块、来源、Trace 和报告 | `run_id` 恢复、SSE 重连、partial/blocked 不伪装 | 运行契约测试后提交 |
| 5.6 安全/可访问性 | 凭据遮蔽、远程外发提示、responsive、reduced-motion | console/network 无敏感泄漏；键盘全流程可用 | Browser gate 前提交 |
| 5.7 安装交付 | CLI/启动器、升级、卸载、数据保留和最终 Browser 验收 | 使用完整 Browser 清单，所有项目有证据 | 人类 Gate 后合入 `pass-05` |

## 5. 计划中的代码边界

拟新增目录/模块：

- `packages/semantic-agent/src/server/`：本地 HTTP/SSE 和错误映射。
- `packages/semantic-agent/src/workspace/`：本地状态、migration、备份和清理边界。
- `packages/semantic-agent/src/secrets/`：SecretStore 接口和 fail-closed 适配器。
- `packages/semantic-web/`：Web UI、结构化结果块和无代码执行的渲染器。
- 根目录 CLI/启动器入口及其 deterministic smoke tests。

具体包名、文件名和数据库驱动必须在 5.0 决策门确认，不从计划直接推导实现。

## 6. Browser 验收基线

完整清单以新的架构与验收报告为唯一权威；本计划固定以下可执行条件：

- 构建：已合入 `codex/alphaox/pass-05` 的构建。
- 起始状态：使用明确的临时目录 `/tmp/alphaox-browser-acceptance`，无真实数据和凭据。
- 启动：`alphaox start --host 127.0.0.1 --port 43120 --data-dir /tmp/alphaox-browser-acceptance`。
- 一个可复用标签页，URL 为 `http://127.0.0.1:43120/`，健康检查为同源 `/api/v1/health`。
- 视口：1440×900 和 390×844，缩放 100%；桌面为主要体验。
- 测试数据：项目自有固定 seed 的两套物理 Schema、术语、退款政策、freshness 和权限文档。

有序操作：

1. 首次打开，检查产品名、空状态、无 console error 和当前工作区。
2. 配置 fixture 数据源，验证连接测试、能力声明和错误状态。
3. 查看 Snapshot，起草并人工发布一个 Binding，检查版本和生效期。
4. 输入缺少时间范围的问题，确认 `clarification_required`，不自动猜测。
5. 提交正常分析，检查 planning/executing、KPI、图表、表格、方法、来源、`as_of`、`run_id`。
6. 观察 Source、Binding、Context、Query、Evidence 和 Trace，确认不显示凭据、任意 SQL 或未经裁剪行。
7. 触发无权字段、过期 Snapshot、来源失败和零行场景，分别检查 `blocked`、`partial`、`stale` 和 `zero_rows`。
8. 点击取消并断开/恢复网络，检查取消边界、SSE 重连、幂等和不重复执行。
9. 检查远程模型外发提示、键盘 Tab 顺序、焦点、滚动、图表替代文本和 reduced-motion。
10. 在窄屏重复核心流程，确认无水平溢出且结果/报告/来源仍可操作。
11. 打开 console/network，确认无明文凭据、任意 SQL、未处理异常或跨源请求。
12. 使用应用内范围化清理和备份恢复，确认只影响临时工作区，清理可审计并能回到空状态。

每项记录 `PASS`、`FAIL`、`BLOCKED` 或 `NOT RUN`，附 URL、时间、构建标识、截图和 `run_id/trace_id`。任何凭据泄露、任意代码执行、错误伪装为空结果或 `partial` 伪装为 `complete` 都直接 FAIL。

## 7. 失败与运行维护

| 场景 | 处理 |
| --- | --- |
| 端口被占用 | 启动失败并提供显式端口选择，不改为非回环监听 |
| 数据目录不可写/损坏 | `blocked` 并保留原目录，不自动清空 |
| SecretStore 不可用 | 连接阻断，不明文落盘 |
| API/SSE 断线 | 有界重连和状态快照，不重跑查询 |
| 数据源/工具失败 | 显示 `partial` 或 `blocked` 和影响范围 |
| 远程模型未获外发确认 | 模型调用前阻断 |
| 迁移失败 | 停在旧版本并保留备份，不能半迁移继续运行 |
| 用户清理 | 只清理明确的工作区范围，不能递归删除 workspace 或整库 |

## 8. 分支、commit 与回滚

- 从当前 `main` 使用 `codex/alphaox/pass-05`；切片使用 `codex/alphaox/pass-05-<slice>`。
- 每阶段完成后运行适用测试和根级 `npm run check`，审查 staged 路径，再提交该阶段文件。
- 回滚范围包括代码 commit、本地 migration 版本和静态资源版本；不得自动删除用户数据。
- 真实数据库、生产身份、多用户和远程服务模式必须另开服务化决策门。

## 9. 人类 Decision Gate

实现前必须确认：SQLite 是否作为本地控制面、SecretStore 的最低安全实现、默认端口/数据目录、远程模型外发提示、CLI 安装形态和完整 Browser 清单。未确认前只能完善计划和 fixture，不开始 Web 或本地服务实现。
