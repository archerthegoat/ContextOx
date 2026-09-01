# ContextOx 的 Pi 内核与上游同步策略

> 状态：`RECOMMENDATION DRAFT / PENDING REPOSITORY AND ARCHITECTURE GATE`
> 现场核验日：2026-08-30
> 本次已做：只读比较、创建/更新本地 `upstream/main` remote-tracking ref。
> 本次未做：GitHub re-fork、远端改动、上游合并、依赖安装/升级、代码迁移、commit、push 或 PR。

关联文档：[PRD v0.1](./PRD-v0.1.md) · [开源项目与能力复用清单](./开源项目与能力复用清单.md)

## 1. 结论先行

目标拓扑应当把两个职责彻底分开：

1. **Pi fork repository**：完整保留 `earendil-works/pi` 源码和 GitHub fork network，仅用于跟踪上游和承载极少、明确且可回馈的 Pi 补丁；不放 ContextOx 产品代码。
2. **ContextOx application repository**：独立产品仓库，只通过已发布、精确锁版的 `@earendil-works/pi-agent-core` 包和一个 ContextOx-owned 薄适配器使用 Pi；不复制 Pi monorepo，也不传播 Pi 内部类型到领域核心。

短期不应在当前共享仓库中直接做高风险拆分。先保持现状可运行，使用本地 `upstream/main` 做差异核验；产品/架构批准后，再以可回滚迁移建立上述双仓拓扑。

当前特别重要的事实是：`packages/semantic-agent/package.json` 虽精确声明 `@earendil-works/pi-agent-core: 0.84.3`，但根 npm workspace 的 lockfile 把该包链接到本仓库 `packages/agent`。因此当前开发并不是“应用只消费 npm 已发布包”；达到目标状态需要仓库/工作区迁移，不能只改一行版本号。

## 2. 现场事实

### 2.1 Git 与分支

| 项目 | 当前值 |
|---|---|
| 工作树 | clean，`main` |
| 当前 HEAD | `bc09798f3369c06d0c6c21e7074793b912973b78` |
| origin | `https://github.com/archerthegoat/alphaox.git` |
| upstream | `https://github.com/earendil-works/pi.git` |
| 本地 upstream ref | `refs/remotes/upstream/main`，本次已从官方 upstream 更新 |
| merge-base | `dcd461925db2edf69a43c8135db1180d418afd54` |
| 分叉计数 | `main...upstream/main`：本地 30 commits，上游 38 commits |

本次 fetch 还按 Git 默认行为取得了上游 tag refs，包括 `v0.84.4`。这只是本地 `.git` 变化，不代表代码已合并或依赖已升级。

GitHub 的仓库是否当前仍属于官方 fork network，不能仅由本地 remote 推断。本次公共 GitHub API 查询受 403 限制，状态保持 `UNVERIFIED`；恢复/创建 fork 是未来单独授权的远端操作。

### 2.2 差异规模

相对共同祖先：

| 方向 | 文件 | 插入 | 删除 | 含义 |
|---|---:|---:|---:|---|
| 上游独有 `main...upstream/main` | 106 | 2,532 | 363 | Pi 在当前分叉后继续演进，不能假设本地 core 等同最新上游 |
| 本地独有 `upstream/main...main` | 104 | 27,444 | 100 | 主要是 AlphaOx/ContextOx 文档和 `semantic-agent` 产品工作 |

本地相对上游的 Pi 核心路径中，没有 `packages/agent`、`packages/coding-agent` 或 `packages/tui` 的产品性修改；可见的 Pi 范围本地差异集中于 `packages/ai` 的模型生成/元数据。这降低了分离难度，但仍需精确确认这些生成变更是否应保留、上游化或放弃。

从本地 `v0.84.3` 到 `upstream/main`，`packages/agent`、`packages/ai` 和 `packages/tui` 合计约 34 个文件、1,111 行插入和 137 行删除。不能只比较包版本；升级前仍需按公开 API、事件类型、测试 harness、telemetry 和传递依赖逐项审查。

### 2.3 npm 发布与当前锁定

| 项目 | 当前事实 |
|---|---|
| `semantic-agent` manifest | devDependency 精确写为 `@earendil-works/pi-agent-core: 0.84.3` |
| 根 lockfile | `node_modules/@earendil-works/pi-agent-core` 链接到 workspace `packages/agent` |
| npm registry latest | [`@earendil-works/pi-agent-core@0.84.4`](https://registry.npmjs.org/%40earendil-works%2Fpi-agent-core/latest) |
| latest gitHead | `b79e4cc834970cca69daebffab7df1da7d1e52c4` |
| latest license | MIT |
| latest provenance | registry metadata披露 npm trusted publisher / GitHub Actions OIDC 与 SLSA provenance endpoint |

即使应用精确锁定直接包版本，Pi Core 的发布包仍可声明对其他 Pi 包的 semver range；最终可复现性依赖 app lockfile、registry integrity、provenance 和安装策略，而不只是 `package.json`。

## 3. 当前 Pi 依赖面

### 3.1 代码绑定

当前 `semantic-agent` 对 Pi 的直接绑定很薄：

- `src/internal/pi-agent-adapter.ts` 顶层导入 Pi `Agent` 类型；
- 内部 helper 将 Pi Agent 交给 AlphaOx-owned adapter 的 `attach` 边界；
- 测试使用 Pi `Agent` 类型验证适配；
- 对外 `src/index.ts` 不导出内部 Pi adapter；
- `src/pi-adapter.ts` 使用 AlphaOx-owned 结构事件，不让 Pi 类型进入领域 public API。

这是正确的隔离方向。需要保持的核心不是某个文件名，而是：**领域内核拥有自己的 command/event/state 契约；Pi 只是可替换运行时适配器。**

### 3.2 当前没有的能力

不能从依赖声明推断下列状态已经成立：

- Pi 已在 ContextOx 生产运行；
- 真实模型/provider 调用已通过安全和成本门；
- 持久 Session、恢复、取消和跨日 Human Task 已完成；
- Pi 事件与 ContextOx 领域审计已完整映射；
- app 已经从 npm tarball 而非 workspace source 运行；
- 上游 0.84.4 已通过本项目兼容性测试。

这些均为 `NOT IMPLEMENTED` 或 `NOT VERIFIED`。

## 4. 三种仓库方案

| 方案 | 优点 | 成本/风险 | 结论状态 |
|---|---|---|---|
| A. 继续把完整 Pi monorepo 与 ContextOx 放在同一仓库 | 本地 source 调试简单；当前无需迁移 | 产品和上游历史持续耦合；workspace link 掩盖发布包差异；同步、CI、许可证和审查面过大 | `SHORT-TERM HOLD ONLY` |
| B. 在当前仓库持续 merge/cherry-pick 上游 Pi | 可以直接获得上游源码更新 | 容易混入无关包、冲突和生成文件；让产品提交与 upstream 维护纠缠；回滚边界差 | `NOT RECOMMENDED AS DEFAULT` |
| C. Pi 完整源码留在独立 fork；ContextOx app 只依赖已发布 Pi Core | 职责、供应链、升级和回滚边界清晰；产品仓库更小；可用契约测试验证真实包 | 需要一次受控历史/工作区迁移；调试和未发布补丁流程要设计；依赖 registry/lock/provenance | `TARGET CANDIDATE / PENDING GATE` |

方案 C 是当前推荐的目标，不是已批准迁移。若试点证明必须长期修改 Pi Core 且无法上游化，需要重新评估；不能一边称“只依赖发布包”，一边在 app 内维护隐形 fork。

## 5. 目标拓扑

```text
earendil-works/pi (official upstream)
          |
          | GitHub fork network + explicit sync
          v
dedicated Pi fork (full source, minimal patches)
          |
          | upstream contribution / release verification
          v
npm registry: @earendil-works/pi-agent-core@exact-version
          |
          | lockfile + integrity/provenance + thin adapter
          v
ContextOx app repository
  - domain core
  - PiRuntimeAdapter
  - fake stream contract tests
  - no Pi monorepo workspaces
```

### 5.1 Pi fork repository

职责：

- 保持官方 fork network；
- `upstream` 指向 `earendil-works/pi`，`origin` 指向专用 fork；
- 官方同步分支不混入 ContextOx 文档或产品代码；
- 只有无法通过 adapter 解决、且有明确上游价值的最小补丁；
- 优先向官方提交，不长期维护私有大分叉。

禁止：

- 把它当 ContextOx integration branch；
- 在 fork 中加入 Business Definition 领域代码；
- 为本地便利修改已发布 package contract 而不记录 patch 和退出策略；
- 用 Git remote 的存在声称 GitHub fork network 已恢复。

### 5.2 ContextOx application repository

职责：

- 自有产品历史、roadmap、PRD、架构和领域代码；
- 精确版本依赖 Pi Agent Core；
- 通过 ContextOx-owned adapter 和 event schema 隔离；
- 用 fake runtime、published tarball 和 fail-closed 反例测试；
- 将 provider、模型、工具、trace、成本和权限纳入 ContextOx 控制面。

禁止：

- 从 Pi 源仓复制大段 core 形成不可见 fork；
- 在 public API 导出 Pi 内部类型；
- 依赖未发布 commit 或本机相对路径作为正式版本；
- 用 `latest`、宽泛 range 或未锁传递依赖进入发布构建。

## 6. 短期策略：拆分前

在仓库迁移获批前：

1. 保留当前 `main`，不默认合并 `upstream/main`；
2. 使用本地 upstream ref 做只读差异和 release 审查；
3. `semantic-agent` 继续只通过内部 adapter 接触 Pi；
4. 不新增对 `packages/agent` 内部文件路径的导入；
5. 为 adapter 建立/保持 fake stream public-seam 契约测试；
6. 需要验证发布包时，应在独立临时目录或未来 app worktree 使用 registry tarball，防止 npm workspace link 产生假阳性；
7. 没有明确 Pi 缺陷前，不在本仓修改 core；有缺陷时先判断能否在 adapter 修复或向上游贡献；
8. 每次研究记录 `as_of`、upstream commit、registry version、差异和未验证项。

短期不升级到 0.84.4。本文件只确认它存在；升级需要 release notes/源码差异、依赖和回归测试的独立批准。

## 7. 长期迁移候选

### 7.1 前置条件

- 数契/ContextOx 产品方向和 roadmap 精确 diff 已获人类批准；
- 新产品包边界和部署模式完成架构讨论；
- 所有当前本地 Pi 改动被分类为：丢弃、上游已有、向上游提交、或临时 fork patch；
- 当前 `semantic-agent` 的导出、测试和历史保留方案明确；
- GitHub namespace、fork network 状态和目标仓库名通过只读 API/UI 核验；
- 新仓和 fork 的创建、可见性、权限、保护规则、secret 和 CI 迁移分别获授权。

### 7.2 迁移阶段

| 阶段 | 动作 | 验证 | 回滚边界 |
|---|---|---|---|
| M0 Inventory | 固化当前 commit、文件/依赖/历史映射和 secret 清单 | 双人审阅路径与敏感项；不写远端 | 无状态变化 |
| M1 App extraction rehearsal | 在临时本地仓抽取产品路径和必要历史；移除 Pi workspaces | npm install/lock 使用发布包；类型、单测和 adapter contract | 删除临时演练目录 |
| M2 Published-package proof | 精确锁定批准的 Pi Core 版本，验证 registry integrity/provenance | 从仓库外安装和运行 public seam；workspace source 不可解析 | 回到演练快照和旧 lock |
| M3 Dedicated fork | 经授权创建/确认官方 GitHub fork，配置 upstream | GitHub UI/API 读回 parent、default branch 和权限 | 删除新 fork仅在单独破坏性授权下；否则保留空闲 |
| M4 App remote | 经授权创建独立 ContextOx repo，设置保护/CI/secret | 远端 readback、最小 clone、无敏感历史泄漏 | 原 AlphaOx 保持只读权威，尚不切换 |
| M5 Cutover | 冻结迁移窗口，执行最终增量，更新团队入口 | exact commit、CI、发布包运行、文档和人工验收 | 切回原仓；新仓标记未生效 |
| M6 Archive decision | 确认旧仓保留、只读或重命名方式 | 链接、历史、issue/PR 和依赖方盘点 | 必须另获远端/破坏性授权 |

### 7.3 历史选择

历史迁移有三种不同目标，必须单独选择：

- **完整历史**：保留 Pi 上游和产品历史，app repo 仍很重，难实现真正独立；
- **路径过滤历史**：保留选定产品路径提交，需审查提交身份、敏感内容和重写风险；
- **squashed baseline + archive link**：新仓最清晰，但细粒度 blame 留在旧仓。

当前倾向是“产品路径过滤或干净 baseline + 旧仓只读保留”，但这是迁移决策，不在本文冻结。任何历史重写、仓库删除、重命名或可见性变化都需单独批准。

## 8. 上游同步流程

### 8.1 当前混合仓的只读检查

```bash
git status --short --branch
git fetch --no-tags upstream +refs/heads/main:refs/remotes/upstream/main
git merge-base main upstream/main
git rev-list --left-right --count main...upstream/main
git diff --stat main...upstream/main -- packages/agent packages/ai packages/tui packages/coding-agent
git log --oneline --decorate <previous-tag>..upstream/main -- packages/agent packages/ai
```

规则：

- 在 clean worktree 和已确认分支上执行；
- fetch 只更新 remote-tracking ref，不自动 merge/rebase；
- `--no-tags` 避免无意同步大量 tag；需要 release tag 时单独 fetch 精确 tag；
- 先读 release notes、目标版本 manifest、导出和依赖，再决定是否提出升级；
- 不用提交数量或终端退出码代替兼容性结论。

### 8.2 目标 app repo 的包升级

每次升级提案至少记录：

- old/new package version、npm integrity、provenance、gitHead 和发布日期；
- Pi Core public exports、event/type、session/testing harness 和 Node engine 差异；
- 直接和传递依赖、install scripts、license 和漏洞变化；
- ContextOx adapter 精确 diff；
- 兼容测试、失败反例、性能/成本和人工 smoke test；
- 回滚到旧 package/lock 的精确边界。

经批准后才可按仓库规则更新：

```bash
npm install --package-lock-only --ignore-scripts
```

实际版本变更必须精确指定，审查 lockfile；不得用 `latest` 自动漂移。代码变更需跑仓库要求的 `npm run check` 和具体测试；是否运行 build/full test 继续服从实时仓库规则和用户授权。

### 8.3 专用 Pi fork 的同步

- 官方 `upstream/main` 始终保持可识别；
- 同步前先核对 fork 是否有私有 patch 和开放 PR；
- 官方 release/tag 与 fork branch 的更新是独立动作；
- 有冲突时按文件 Owner 审阅，不通过重置、强推或广泛清理解决；
- 只在需要调试、贡献或验证未发布修复时使用 fork source；正式 app 默认仍消费 registry release；
- 每个临时 patch 必须有 upstream issue/PR 或明确退出日期。

## 9. 兼容性契约

ContextOx 与 Pi 的接缝应限制为：

- 创建/附着 Agent 的 adapter factory；
- 输入 message/tool configuration 的 ContextOx-owned DTO；
- 输出为 ContextOx-owned normalized events；
- 取消、超时、错误、partial、tool request/result 和 completion 的明确映射；
- model/provider/usage/trace metadata 的脱敏映射；
- fake stream harness 可制造乱序、重复、缺失、取消和失败。

不得让领域包依赖：

- Pi 的 internal module path；
- 未公开的 concrete class 状态；
- UI/TUI/coding-agent 包；
- Pi session 作为 Definition Case 真相；
- provider-specific event 作为业务审计格式。

### 必测反例

- Pi 在 tool call 前失败；
- tool 已执行但 completion 丢失；
- 重复 event 或重连重放；
- cancel 与 tool result 竞态；
- usage/finish reason 缺失；
- 新版本增加未知 event；
- provider 返回 partial 或结构无效；
- adapter 不得把这些状态归一成成功。

## 10. 供应链与商业风险

| 风险 | 具体表现 | 控制 |
|---|---|---|
| Workspace 假阳性 | 本地测试解析到 `packages/agent`，而非 npm tarball | 在仓库外/独立 app 安装已发布包做 smoke 和 contract test |
| 直接版本精确但传递依赖漂移 | 发布包可能对同族包使用 semver range | commit lockfile、核验 integrity/provenance、CI clean install |
| 上游 API 变化 | 类型通过但事件/错误语义改变 | AlphaOx-owned adapter、fake 反例、逐版本升级 |
| 未发布 patch 依赖 | app 只能在某人本机 fork 工作 | 正式版本只用 registry；临时 patch 有期限和上游路径 |
| 大 monorepo 审查面 | 无关 TUI/client/model metadata 进入产品 diff | 拆分 app；当前只做路径限定比较 |
| License/notice 遗漏 | MIT 及传递依赖声明未进入分发 | 生成并审查 SBOM/NOTICE；逐版本 license scan |
| Registry/账号事件 | 包撤回、凭证或发布链问题 | lock + integrity、批准的缓存/镜像策略、应急回滚版本 |
| Node engine 漂移 | 最新包要求 Node `>=22.19.0` | app runtime/CI 明确版本；升级前 smoke |
| Telemetry 数据泄漏 | 上游 telemetry 或 trace 默认携带敏感数据 | adapter 最小化、默认关闭未批准 exporter、数据路径审查 |
| Fork 漂移 | 私有 patch 累积导致无法升级 | patch budget、upstream-first、定期差异报告和退出门 |

## 11. 故障与回滚

| 故障 | 停止条件 | 回滚 |
|---|---|---|
| 新 Pi 版本类型/契约失败 | 不进入 app main | 恢复旧 manifest/lock/adapter commit |
| npm tarball 与 workspace 行为不同 | 视为 release blocker | 保持当前运行，修复 adapter 或等待上游 |
| 上游 fork patch 与 release 冲突 | 停止同步，不强推 | fork 保留旧 release branch，逐 patch 分类 |
| 新 app repo 丢历史/文件 | 不切换权威入口 | 原仓不变，新仓标记演练失败 |
| GitHub fork network 未正确建立 | 不声称恢复 | 保持 local upstream；重新核验 namespace/权限/官方流程 |
| 远端权限/secret/CI 不完整 | 不做 cutover | 继续使用原仓，只读保存新仓 |
| 已切换后严重 runtime 回归 | 停止发布并按批准 runbook 回切 | app 锁回旧 Pi 版本；必要时流量/入口切回原部署 |

回滚计划必须保留数据/领域状态兼容性。只回退 npm 包但无法读取新版本已写状态，不算可行回滚。

## 12. 决策门

| ID | 决策 | 当前状态 | 所需证据/批准 |
|---|---|---|---|
| PI-01 | 目标采用“双仓 + 发布包”拓扑 | `PENDING ARCHITECTURE GATE` | 产品方向、包边界、运维和迁移讨论 |
| PI-02 | 专用 Pi fork 的 GitHub 名称、Owner 和可见性 | `PENDING REMOTE-WRITE APPROVAL` | 当前 fork metadata、namespace、权限和官方 fork 流程核验 |
| PI-03 | ContextOx app repo 的历史迁移方式 | `PENDING REPOSITORY GATE` | 完整/过滤/baseline 的成本、敏感历史和追溯需求 |
| PI-04 | 从 0.84.3 升级到 0.84.4 或更高 | `NOT PROPOSED` | release/source/dependency diff + adapter tests + rollback |
| PI-05 | 当前 `packages/ai` 本地差异如何处理 | `PENDING INVENTORY` | 逐文件判断：产品需要、上游已有、上游贡献或丢弃 |
| PI-06 | 何时切换 app 到真实 registry package | `PENDING MIGRATION GATE` | 独立安装证明、CI、功能/失败测试和人工 smoke |

## 13. 本次研究的对抗性结论

- “manifest 精确依赖 0.84.3”不足以证明使用了发布包；workspace link 是反例。
- “配置了 upstream remote”不足以证明 GitHub fork network 已恢复；远端 parent metadata 是必要读回。
- “本地没有改 `packages/agent`”不足以证明可无损拆分；`packages/ai`、根脚本、lockfile、CI、文档和历史仍可能耦合。
- “0.84.4 是最新”不足以证明应升级；兼容、依赖、telemetry 和 Node runtime 仍未验证。
- “双仓更干净”不足以授权迁移；历史、secret、CI、权限、remote 和团队入口都是外部状态变化。
- “published package”也不是零供应链风险；必须保留 lock、integrity、provenance、缓存/镜像和回滚策略。

因此，本次最安全的结论是：目标拓扑明确、当前差距可描述，但迁移和升级仍保持 `PENDING`。
