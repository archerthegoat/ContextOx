# 自有验证材料质量报告 v0.1

> 本报告只评价静态材料是否按所列边界构成可复查的测试输入，不评价产品是否已能自主制定规范。材料级状态为 STATIC MATERIAL CHECK PASS；产品状态机、身份/权限执行、真实模型、Contract 消费、Web 与业务效果均为 NOT_RUN，人类产品验收 PENDING。

## 1. 用途、来源与核对范围

本包用于从零建立“已有购买客户的运营维护规范”的后续验证。五组事实分别保留客户关联、订单、商品行、独立收款和履约事件粒度，不提供最终分群或评分答案。目标、角色、责任与所有数值均为自有合成资料；未下载或复制 Olist 或其他第三方数据。退款、成本、未来购买与真实需求证据不存在于本包，不能从材料完整性推出这些事实成立。

- 本轮人工确认：七份 JSON/Markdown 静态材料、主 12 客户/18 订单与未见 4 客户/6 订单、UTC/CNY 范围，以及离线核对。
- 更细的枚举行值、明细数量和时间为 AUTHORED FIXTURE VALUES，不是逐值业务批准、公共 Schema 或产品阈值。
- 基础输入仅 input/facts.json 与 input/context.md；本报告、README、manifest、cases、heldout 都在评估端。本轮未实现或测试路径隔离。
- 制作细化已由独立非作者 LunaMax（gpt-5.6-luna / max）只读复审，三个发现关闭；范围是制作规格，不把其 PASS 当成本表实测或产品结论。实际材料的复核回执另记在架构报告 §13.7。

## 2. 实际离线核对收据

```json
{
  "checked_at_utc": "2026-08-31T16:01:26.984Z",
  "local_check_date": "2026-09-01 (Asia/Shanghai)",
  "runtime": "v24.20.0",
  "checker_sha256": "925b68652c5c47097ebf045c6f37dd2d3a0c700abba813be07b171029fa12667",
  "material_assertions": 2606,
  "static_material_status": "PASS",
  "product_execution": "NOT_RUN",
  "human_product_acceptance": "PENDING"
}
```

2606 是材料级低层断言计数，不是 2606 个产品测试。完整产品场景执行数为 0。

核对方式：在临时目录运行本报告附录的原生 Node 脚本，仅使用 node:fs/crypto/path/assert 读取材料、计算哈希和在内存构造副本；没有依赖安装、数据库、产品工具、网络请求、模型调用或持久化业务副作用。所有变体每次从同一新副本开始，基准内容在核对后保持不变。脚本的控制场景检查仅覆盖输入字段、必要事件、身份字符串与时间顺序等材料条件，不执行任何产品授权器或状态转换。

| 本次实际读取文件 | SHA256 |
|---|---|
| README.md | `85eb953a7ded934c9c372d2bcde70e92e6be47ad974a7a8d74be7e96de289ad9` |
| input/facts.json | `36b93ee94092b86ac50f1aee36f1aa999589e596b46b8e510b7d6398cb64c0d0` |
| input/context.md | `ed6f5f601b6b39d13b31c2279a90424191e2745d7b70a454cb7edecf4331aea4` |
| evaluation/heldout.json | `7c8383acce2d7a1d402aa59272d2ad8d4d0afafc0cc612a5a856b710dac053e8` |
| evaluation/cases.json | `832afe599ac41f001eee8f4066c05427564aa975946fe54a240bca1f07d2b18a` |

manifest 对本报告等另外六份文件保存原始 UTF-8 字节 SHA256 与字节数，不计算自身哈希。最终六项哈希读回与 manifest 自身哈希在架构报告 §13.7 记载，避免报告/manifest 互相哈希。附录 --verify-manifest 模式可重新核对文件完整性；后续重跑时间不替换本次历史收据。

## 3. 事实粒度、完整性与单位

| 事实组 | 主样本行 × 列 | 未见样本行 × 列 | 快照键 | 类型与缺失 |
|---|---:|---:|---|---|
| customer_links | 18 × 8 | 6 × 8 | order_customer_ref | 除 effective_to 外均为字符串；effective_to 全为 null，表示此合成映射无结束点 |
| orders | 18 × 7 | 6 × 7 | order_ref | 均为字符串，无 null |
| items | 24 × 9 | 8 × 9 | item_ref | 两个金额字段为安全整数，其余字符串，无 null |
| payments | 20 × 8 | 7 × 8 | payment_ref | 收款金额为安全整数，其余字符串，无 null |
| fulfillment_events | 24 × 7 | 8 × 7 | event_ref | 均为字符串，无 null |

五组共 104 条主样本事实、35 条未见事实，映射归并出 12 与 4 个业务客户。主样本客户订单数分别为 3 笔的 1 人、2 笔的 4 人、1 笔的 7 人；未见集为 2 笔的 2 人、1 笔的 2 人。这些是人为覆盖安排，不是复购率估计。

| 材料检查 | 主样本分子/分母 | 未见样本分子/分母 | 含义 |
|---|---:|---:|---|
| 缺失快照键 | 0/104 | 0/35 | 五组分别检查其键，不把可重复业务客户键当主键 |
| 多出的重复键记录 | 0/104 | 0/35 | 每组键按单一可见来源版本核对 |
| 无客户映射的订单 | 0/18 | 0/6 | 不按相似字符串猜客户 |
| 无父订单的商品行 / 收款 / 履约 | 0/24、0/20、0/24 | 0/8、0/7、0/8 | 在各自子表粒度核对 |
| T0 后才可获得的事实 | 0/104 | 0/35 | 基准没有偷看未来；迟到例子只在评估副本 |
| 缺失直接业务时间（订单/收款/履约） | 0/62 | 0/21 | 商品行另查已确认父订单时间依据 |
| 缺商品行时间依据 | 0/24 | 0/8 | 均绑定 ctx-item-time-r1；不是任意来源通用继承规则 |
| 有效映射早于订单观察窗 | 18/18 | 6/6 | 合法保留，不是陈旧错误 |
| effective_to 为 null | 18/18 | 6/6 | 100% 是明确开区间约定，不是漏填的客户键 |
| 非 CNY 的金额记录 | 0/44 | 0/15 | 商品与支付各自记录币种，不假设外汇折算 |
| 非安全整数/负金额字段 | 0/68 | 0/23 | CNY 分，行总额；不是单价 |

主/未见客户、订单侧键、订单、商品行、支付和履约事件标识逐类核对交集均为 0。只核对中性 ID 和字段形状，不据此宣称防泄漏/授权控制已通过：作者、审查者和离线检查器均可见全部材料。

## 4. 时间覆盖与可获得性

| 集合 / 事实组 | 业务时间最小 → 最大 | 版本可获得时间最小 → 最大 |
|---|---|---|
| 主 / orders | 2026-04-02T10:00:00Z → 2026-06-29T16:00:00Z | 2026-04-04T11:00:00Z → 2026-06-29T18:00:00Z |
| 主 / items | 2026-04-02T10:00:00Z → 2026-06-29T16:00:00Z | 2026-04-02T11:00:00Z → 2026-06-29T17:00:00Z |
| 主 / payments | 2026-04-02T10:10:00Z → 2026-06-29T16:10:00Z | 2026-04-02T12:00:00Z → 2026-06-29T18:00:00Z |
| 主 / fulfillment_events | 2026-04-02T10:30:00Z → 2026-06-29T16:30:00Z | 2026-04-02T11:30:00Z → 2026-06-29T17:30:00Z |
| 未见 / orders | 2026-06-03T08:00:00Z → 2026-06-29T12:00:00Z | 2026-06-05T09:00:00Z → 2026-06-29T14:00:00Z |
| 未见 / items | 2026-06-03T08:00:00Z → 2026-06-29T12:00:00Z | 2026-06-03T09:00:00Z → 2026-06-29T13:00:00Z |
| 未见 / payments | 2026-06-03T08:10:00Z → 2026-06-29T12:10:00Z | 2026-06-03T10:00:00Z → 2026-06-29T14:00:00Z |
| 未见 / fulfillment_events | 2026-06-03T08:30:00Z → 2026-06-29T12:30:00Z | 2026-06-03T09:30:00Z → 2026-06-29T13:30:00Z |

表中商品行业务时间仅取已获合成来源依据的父订单购买时间，仍逐行独立验证自己的 available_at。客户关联 available_at 固定为 2026-03-02T00:00:00Z，有效起点为 2026-03-01T00:00:00Z，早于交易窗但在 T0 和对应购买时刻均适用；不存在“所有文件的业务时间都必须在交易窗内”的规则。

观察窗为 [2026-04-01T00:00:00Z, 2026-07-01T00:00:00Z)，T0 同终点，T1 为 2026-07-04T00:00:00Z。基准每条直接事件均在窗内，可获得时刻不早于其业务事件且不晚于 T0。文件编制和检查发生在实际机器时钟下，不能把合成 available_at 宣称为真实历史入库或当前数据新鲜度。

## 5. 关联与金额反例

| 独立原粒度汇总（CNY 分） | 主样本 | 未见样本 |
|---|---:|---:|
| 商品行货品总额 | 282700 | 73700 |
| 运费行总额 | 6700 | 1700 |
| 已登记收款 | 286900 | 75400 |
| 错误地把商品 × 支付联结后的行数 | 28 | 10 |
| 在该错误联结上求货品额 | 309700 | 77700 |
| 在该错误联结上求收款额 | 338900 | 84100 |

VP-02 单独保留 ord-101：两商品行与两支付形成 4 行，原粒度货品和收款各 15000 分，错误联结后各 30000 分，运费 0。这个反例验证的是材料会暴露重复计数；并未运行产品计算器。其他订单不设货品额/收款恒等式：ord-115 有货品 8000、运费 500、收款 6000 分，差额只能说明所给记录不相等，不能在无证据时命名为退款、坏账或利润。

## 6. 59 个材料变体的核对结果

| 类型 | 数量 | 本轮实际核对 | 尚未核对 |
|---|---:|---|---|
| 数据副本 | 15 | 精确目标行、可重复复制/修改、计数与算术、完整恢复改名前字段 | 产品能否识别错误/更新规范 |
| 独立时间操作数 | 5 | 边界/时区归一化；连同 3 个数据副本中的时间探针，共 8 对 T0/T1 结果 | 产品时间读取/版本选择 |
| 控制事件材料 | 38 | 必要事件与输入字段存在、基本时间顺序、重复消息/乱序事实 | 身份认证、授权、幂等、恢复、撤权与业务裁决 |
| 独立消费者材料 | 1 | 未见集 6 订单/4 客户及标识互斥 | 固定契约后的独立消费、模型未见泛化 |

<details>
<summary>展开逐变体的本次材料核对结果</summary>

| 变体 | 实际核对结果 | 边界 |
|---|---|---|
| VP-01-confirmed | orders=2；customers=1；customer_links=2 | 材料 PASS；产品 NOT_RUN |
| VP-01-missing-link | orders=2；customer_links=1；orphan_order_links=1 | 材料 PASS；产品 NOT_RUN |
| VP-02-two-by-two | orders=1；items=2；payments=2；naive_join_rows=4；goods_minor=15000；receipts_minor=15000；freight_minor=0；naive_goods_minor=30000；naive_receipts_minor=30000 | 材料 PASS；产品 NOT_RUN |
| VP-03-duplicate-key | items=25；duplicate_keys=1 | 材料 PASS；产品 NOT_RUN |
| VP-03-null-key | items=24；missing_keys=1 | 材料 PASS；产品 NOT_RUN |
| VP-03-orphan-item | orphan_items=1 | 材料 PASS；产品 NOT_RUN |
| VP-03-empty | orders=0；customers=0；items=0；payments=0；fulfillment_events=0 | 材料 PASS；产品 NOT_RUN |
| VP-03-mixed-currency | currencies=["CNY","USD"] | 材料 PASS；产品 NOT_RUN |
| VP-04-older-valid-mapping | customers=1；customer_links=2；mappings_before_window=2 | 材料 PASS；产品 NOT_RUN |
| VP-04-late-event | fulfillment_events=25；late_versions=1；T0=excluded，T1=included | 材料 PASS；产品 NOT_RUN |
| VP-04-late-item-with-parent | items=25；late_versions=1；T0=excluded，T1=included | 材料 PASS；产品 NOT_RUN |
| VP-04-unknown-parent-basis | missing_time_basis=1；T0=unknown，T1=unknown | 材料 PASS；产品 NOT_RUN |
| VP-04-start-inclusive | time_probe_present=true；T0=included，T1=included | 材料 PASS；产品 NOT_RUN |
| VP-04-end-exclusive | time_probe_present=true；T0=excluded，T1=excluded | 材料 PASS；产品 NOT_RUN |
| VP-04-availability-inclusive | time_probe_present=true；T0=included，T1=included | 材料 PASS；产品 NOT_RUN |
| VP-04-offset-before-end | time_probe_present=true；T0=included，T1=included | 材料 PASS；产品 NOT_RUN |
| VP-04-offset-at-end | time_probe_present=true；T0=excluded，T1=excluded | 材料 PASS；产品 NOT_RUN |
| VP-04-missing-business-time | missing_business_times=1 | 材料 PASS；产品 NOT_RUN |
| VP-05-single-large-purchase | orders=1；customers=1；goods_minor=160000 | 材料 PASS；产品 NOT_RUN |
| VP-05-creation-without-future-labels | required_events=["prepare_current_operational_candidate"] | 材料 PASS；产品 NOT_RUN |
| VP-06-conflicting-opinions | required_events=["business_opinion_received"] | 材料 PASS；产品 NOT_RUN |
| VP-06-owner-missing | required_events=["consider_evidence_task"] | 材料 PASS；产品 NOT_RUN |
| VP-06-exception-expired | required_events=["request_continue_using_exception"] | 材料 PASS；产品 NOT_RUN |
| VP-06-exception-out-of-scope | required_events=["request_continue_using_exception"] | 材料 PASS；产品 NOT_RUN |
| VP-06-exception-stale-dependency | required_events=["request_continue_using_exception"] | 材料 PASS；产品 NOT_RUN |
| VP-07-valid | required_events=["evidence_response_received"] | 材料 PASS；产品 NOT_RUN |
| VP-07-duplicate | required_events=["evidence_response_received"]；duplicate_message_refs=1 | 材料 PASS；产品 NOT_RUN |
| VP-07-out-of-order-notification | required_events=["evidence_response_received","notification_receipt_received"]；out_of_order_occurrences=true | 材料 PASS；产品 NOT_RUN |
| VP-07-expired | required_events=["evidence_response_received"] | 材料 PASS；产品 NOT_RUN |
| VP-07-old-version | required_events=["evidence_response_received"] | 材料 PASS；产品 NOT_RUN |
| VP-07-delegation-revoked | required_events=["task_delegation_revoked","evidence_response_received"] | 材料 PASS；产品 NOT_RUN |
| VP-07-task-cancelled | required_events=["task_cancelled","evidence_response_received"] | 材料 PASS；产品 NOT_RUN |
| VP-07-case-closed | required_events=["case_closed","evidence_response_received"] | 材料 PASS；产品 NOT_RUN |
| VP-07-notification-failure | required_events=["notification_failed"] | 材料 PASS；产品 NOT_RUN |
| VP-08-authorized-creation | required_events=["request_creation"] | 材料 PASS；产品 NOT_RUN |
| VP-08-unknown-coverage | required_events=["search_returns_no_visible_match"] | 材料 PASS；产品 NOT_RUN |
| VP-08-hidden-resource | required_events=["request_restricted_evidence"] | 材料 PASS；产品 NOT_RUN |
| VP-08-revision-without-baseline | required_events=["request_revision"] | 材料 PASS；产品 NOT_RUN |
| VP-08-current-revocation | required_events=["historical_view_read_authorized","delegation_revoked","request_current_evidence_or_approval"] | 材料 PASS；产品 NOT_RUN |
| VP-08-current-policy-expiry | required_events=["historical_view_read_authorized","policy_expired","request_current_evidence_or_approval"] | 材料 PASS；产品 NOT_RUN |
| VP-08-current-scope-change | required_events=["historical_view_read_authorized","case_scope_changed","request_current_evidence_or_approval"] | 材料 PASS；产品 NOT_RUN |
| VP-09-evidence-changed | required_events=["approval_precondition_present","dependency_changed"] | 材料 PASS；产品 NOT_RUN |
| VP-09-mapping-changed | required_events=["approval_precondition_present","dependency_changed"] | 材料 PASS；产品 NOT_RUN |
| VP-09-scope-changed | required_events=["approval_precondition_present","dependency_changed"] | 材料 PASS；产品 NOT_RUN |
| VP-09-authorization-changed | required_events=["approval_precondition_present","dependency_changed"] | 材料 PASS；产品 NOT_RUN |
| VP-09-future-effective | required_events=["inspect_business_effective_view"]；current_read_authorizations=2；current_read_bindings_complete=true；current_read_authorized_queries=2；business_effective_operand_results=["not_yet_effective","effective"] | 材料 PASS；产品 NOT_RUN |
| VP-09-historical-correction | required_events=["append_correction"] | 材料 PASS；产品 NOT_RUN |
| VP-10-heldout-consumer | heldout_orders=6；heldout_customers=4；heldout_id_overlap=0 | 材料 PASS；产品 NOT_RUN |
| VP-10-alternate-fields | renaming_roundtrip_equal=true | 材料 PASS；产品 NOT_RUN |
| VP-10-capacity-3 | required_events=["capacity_constraint_provided"] | 材料 PASS；产品 NOT_RUN |
| VP-10-capacity-6 | required_events=["capacity_constraint_provided"] | 材料 PASS；产品 NOT_RUN |
| VP-11-proposal-only | required_events=["fixture_review_signal"] | 材料 PASS；产品 NOT_RUN |
| VP-11-linked-case-authorized | required_events=["fixture_review_signal"] | 材料 PASS；产品 NOT_RUN |
| VP-12-model-failure | required_events=["prior_confirmed_read_receipt","fake_model_error"] | 材料 PASS；产品 NOT_RUN |
| VP-12-invalid-output | required_events=["prior_confirmed_read_receipt","fake_model_output"] | 材料 PASS；产品 NOT_RUN |
| VP-12-cancelled | required_events=["prior_confirmed_read_receipt","mission_cancelled"] | 材料 PASS；产品 NOT_RUN |
| VP-12-budget-exhausted | required_events=["prior_confirmed_read_receipt","budget_limit_reached"] | 材料 PASS；产品 NOT_RUN |
| VP-12-partial-source | required_events=["prior_confirmed_read_receipt","source_returned_partial"] | 材料 PASS；产品 NOT_RUN |
| VP-12-stale-source | required_events=["prior_confirmed_read_receipt","source_version_stale"] | 材料 PASS；产品 NOT_RUN |

</details>

这些 PASS 只表示 material_expected 中列明的材料条件得到静态核对；expected_behavior / forbidden_behavior 的 59 项产品执行状态仍全部 NOT_RUN。duplicate-key 副本是额外 1 个重复记录/25 商品行（受影响同键记录 2/25），null-key 是 1/24，孤儿商品行 1/24，缺映射订单 1/2；混币副本有 USD 1/44 个金额记录，没有汇率。两份基线不因此变成坏数据或混币资料。

实际材料独立复核发现 ENG-AUTH-TIME-01：未来生效案例第二次查询在 09-02，但默认策略于 09-01 到期，原前提混合了生效和拒绝读取两种行为。本轮仅为该案例补充两份分别绑定主体、角色、资源/版本、动作、scope、Case 和 policy 的合成当前读权限，并明确两次 recorded_as_of / business_as_of。材料检查确认两组绑定和有效区间、两种生效视图操作数相符；默认策略、其他 58 个变体及初始 context 不延长。实际策略必须由未来获准装置建立并校验，不能据此报告权限已执行。独立定点复审的版本与结论见架构报告 §13.7。

## 7. 可用性结论与后续门

这份资料足以作为已列数据/控制情形的后续输入基线；不能证明它足以覆盖真实公司的业务，更不能证明产品已经能完成闭环。主与 heldout 规模小且由作者选择，没有真实目标/政策、真实多角色、真实模型表现或客户经济结果。heldout 只能在协议、规则/映射、当前消费主体与授权固定后给独立受控消费者；作者/检查器已经曝光，未来消费也要记录曝光。容量/字段变化使用已曝光主样本副本，不把用 heldout 调整规则后再消费包装成泛化。

- 后续产品门：由主 Agent 与人类确认最小领域/规则/权限接缝及运行维护人，再按独立实施范围创建真实前置状态和执行测试。
- 正向规范创建不需要未来购买标签；依赖未知退款/成本的候选不能补造值，允许裁决选择不依赖它们的合法方案。
- 公共 Schema、数据库、DBOS、真实模型/预算、Olist/企业数据、外部发送/发布分别授权。本材料制作不触发这些行动。
- 人类可先按 [README 的材料复核清单](../README.md#材料人工复核尚未代填) 查阅；未代填 PASS。没有产品 build 或 URL，既有架构图验收不继承为产品验收。

## 附录：可复查的材料核对脚本

本轮只运行下列评估端脚本，不把它安装为产品能力或塞入未来 Agent 上下文。复查时将代码块原样保存到自己新建的临时目录中，文件名 check-materials.mjs，换成本机实际路径执行；不需 npm install。

```bash
node /absolute/path/to/check-materials.mjs /Users/archer/Documents/ChatGPT/alphaox/docs/contextox/validation/high-potential-customer-v0.1 --verify-manifest
```

脚本只输出 JSON，不写文件。含核对版本、完整逐字段 profile、59 项材料结果、8 对时间探针、六份文件哈希读回和明确 NOT_RUN 边界。不同运行的 checked_at 不同；若材料/脚本哈希改变，旧收据不能替代重验。核对失败时抛出原始断言错误，不能改成 PASS。以下脚本在本次质量检查期间由主 Agent 编制，不是经过产品工程评审的通用检验库。

<details>
<summary>展开原生 Node 核对脚本</summary>

```js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const withManifest = process.argv.includes("--verify-manifest");
const read = (name) => readFileSync(resolve(root, name));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (name) => JSON.parse(read(name).toString("utf8"));
const main = json("input/facts.json");
const held = json("evaluation/heldout.json");
const cases = json("evaluation/cases.json");
const tables = ["customer_links", "orders", "items", "payments", "fulfillment_events"];
const keys = { customer_links: "order_customer_ref", orders: "order_ref", items: "item_ref", payments: "payment_ref", fulfillment_events: "event_ref" };
const sources = { customer_links: "src-customers", orders: "src-orders", items: "src-items", payments: "src-payments", fulfillment_events: "src-fulfillment" };
const fields = {
  customer_links: ["order_customer_ref", "customer_ref", "mapping_basis_ref", "effective_from", "effective_to", "source_ref", "source_version", "available_at"],
  orders: ["order_ref", "order_customer_ref", "purchased_at", "status_at_snapshot", "source_ref", "source_version", "available_at"],
  items: ["order_ref", "item_ref", "goods_amount_minor", "freight_amount_minor", "currency", "time_basis_ref", "source_ref", "source_version", "available_at"],
  payments: ["order_ref", "payment_ref", "received_amount_minor", "currency", "paid_at", "source_ref", "source_version", "available_at"],
  fulfillment_events: ["order_ref", "event_ref", "event_type", "event_at", "source_ref", "source_version", "available_at"],
};
const T0 = Date.parse("2026-07-01T00:00:00Z");
const T1 = Date.parse("2026-07-04T00:00:00Z");
const start = Date.parse("2026-04-01T00:00:00Z");
const end = T0;
let assertions = 0;
function same(actual, expected, label) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, label);
}
function check(value, label) {
  assertions += 1;
  assert.ok(value, label);
}
function stamp(value) {
  check(typeof value === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), "explicit valid time: " + value);
  return Date.parse(value);
}
const sorted = (values) => [...values].sort();
const unique = (values) => [...new Set(values)];
const countBy = (values) => Object.fromEntries(unique(values).sort().map((v) => [v, values.filter((x) => x === v).length]));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function measure(data) {
  const orders = new Set(data.orders.map((r) => r.order_ref));
  const aliases = new Set(data.customer_links.map((r) => r.order_customer_ref));
  const all = tables.flatMap((t) => data[t]);
  const currencies = sorted(unique([...data.items, ...data.payments].map((r) => r.currency)));
  let duplicateKeys = 0;
  let duplicateAffectedRows = 0;
  let missingKeys = 0;
  for (const table of tables) {
    const present = data[table].map((r) => r[keys[table]]).filter((v) => v !== null && v !== undefined && v !== "");
    missingKeys += data[table].length - present.length;
    for (const n of Object.values(countBy(present))) {
      duplicateKeys += Math.max(0, n - 1);
      if (n > 1) duplicateAffectedRows += n;
    }
  }
  let naiveRows = 0, naiveGoods = 0, naiveReceipts = 0;
  for (const order of data.orders) {
    const items = data.items.filter((r) => r.order_ref === order.order_ref);
    const payments = data.payments.filter((r) => r.order_ref === order.order_ref);
    for (const item of items) for (const payment of payments) {
      naiveRows += 1;
      naiveGoods += item.goods_amount_minor;
      naiveReceipts += payment.received_amount_minor;
    }
  }
  return {
    customers: new Set(data.customer_links.map((r) => r.customer_ref)).size,
    ...Object.fromEntries(tables.map((t) => [t, data[t].length])),
    duplicate_keys: duplicateKeys, duplicate_affected_rows: duplicateAffectedRows, missing_keys: missingKeys,
    orphan_order_links: data.orders.filter((r) => !aliases.has(r.order_customer_ref)).length,
    orphan_items: data.items.filter((r) => !orders.has(r.order_ref)).length,
    orphan_payments: data.payments.filter((r) => !orders.has(r.order_ref)).length,
    orphan_events: data.fulfillment_events.filter((r) => !orders.has(r.order_ref)).length,
    late_versions: all.filter((r) => Date.parse(r.available_at) > T0).length,
    missing_business_times: [
      ...data.orders.map((r) => r.purchased_at), ...data.payments.map((r) => r.paid_at), ...data.fulfillment_events.map((r) => r.event_at),
    ].filter((v) => !v).length,
    missing_time_basis: data.items.filter((r) => !r.time_basis_ref).length,
    mappings_before_window: data.customer_links.filter((r) => Date.parse(r.effective_from) < start).length,
    currencies, goods_minor: data.items.reduce((n, r) => n + r.goods_amount_minor, 0),
    freight_minor: data.items.reduce((n, r) => n + r.freight_amount_minor, 0),
    receipts_minor: data.payments.reduce((n, r) => n + r.received_amount_minor, 0),
    naive_join_rows: naiveRows, naive_goods_minor: naiveGoods, naive_receipts_minor: naiveReceipts,
  };
}
function baseline(data, expectedCounts) {
  same(sorted(Object.keys(data)), sorted(["metadata", ...tables]), "only raw fact groups");
  same(data.metadata.source_type, "self_authored_synthetic", "synthetic origin");
  same(data.metadata.currency, "CNY", "base currency");
  same(data.metadata.timezone, "UTC", "base timezone");
  same(data.metadata.amount_unit, "integer_minor_unit_1_100", "base units");
  same(stamp(data.metadata.as_of), T0, "base as_of");
  same(stamp(data.metadata.coverage_window.from_inclusive), start, "window start");
  same(stamp(data.metadata.coverage_window.to_exclusive), end, "window end");
  stamp(data.metadata.authored_at);
  const measures = measure(data);
  for (const [key, value] of Object.entries(expectedCounts)) same(measures[key], value, "baseline count " + key);
  for (const key of ["duplicate_keys", "missing_keys", "orphan_order_links", "orphan_items", "orphan_payments", "orphan_events", "late_versions", "missing_business_times", "missing_time_basis"]) same(measures[key], 0, key);
  same(measures.currencies, ["CNY"], "homogeneous base currency");
  const orders = new Map(data.orders.map((r) => [r.order_ref, r]));
  const links = new Map(data.customer_links.map((r) => [r.order_customer_ref, r]));
  const profile = {};
  for (const table of tables) {
    const rows = data[table];
    const businessTimes = [];
    for (const row of rows) {
      same(sorted(Object.keys(row)), sorted(fields[table]), "raw fields only: " + table);
      same(row.source_ref, sources[table], "source group");
      same(row.source_version, "r1", "single visible source version");
      check(typeof row[keys[table]] === "string" && row[keys[table]].length > 0, "nonempty key");
      const available = stamp(row.available_at);
      check(row.available_at.endsWith("Z") && available <= T0, "base available UTC at T0");
      let business;
      if (table === "customer_links") {
        same(row.mapping_basis_ref, "ctx-map-r1", "confirmed mapping basis");
        check(stamp(row.effective_from) <= T0 && (row.effective_to === null || stamp(row.effective_to) > T0), "mapping applicable at T0");
        check(typeof row.customer_ref === "string", "business customer reference");
        continue;
      }
      if (table === "orders") {
        business = stamp(row.purchased_at);
        const link = links.get(row.order_customer_ref);
        check(link && stamp(link.effective_from) <= business && (link.effective_to === null || business < stamp(link.effective_to)), "mapping applicable at purchase");
        check(["registered", "delivered"].includes(row.status_at_snapshot), "observed order state");
        if (row.status_at_snapshot === "delivered") check(data.fulfillment_events.some((r) => r.order_ref === row.order_ref && r.event_type === "delivered" && stamp(r.available_at) <= available), "delivered state supported by available event");
      } else {
        const parent = orders.get(row.order_ref);
        check(parent, "child has parent");
        if (table === "items") {
          same(row.time_basis_ref, "ctx-item-time-r1", "confirmed item-parent time basis");
          business = stamp(parent.purchased_at);
        } else business = stamp(table === "payments" ? row.paid_at : row.event_at);
        check(business >= stamp(parent.purchased_at), "child event not before purchase");
      }
      businessTimes.push(business);
      check(business >= start && business < end && available >= business, "business/availability interval");
      for (const key of ["goods_amount_minor", "freight_amount_minor", "received_amount_minor"]) {
        if (key in row) check(Number.isSafeInteger(row[key]) && row[key] >= 0, "nonnegative integer minor amount");
      }
      if ("currency" in row) same(row.currency, "CNY", "row currency");
    }
    profile[table] = {
      rows: rows.length, columns: fields[table].length,
      fields: Object.fromEntries(fields[table].map((key) => [key, {
        types: countBy(rows.map((r) => r[key] === null ? "null" : typeof r[key])),
        null_count: rows.filter((r) => r[key] === null).length,
        null_fraction: rows.filter((r) => r[key] === null).length / rows.length,
      }])),
      available_min: new Date(Math.min(...rows.map((r) => Date.parse(r.available_at)))).toISOString(),
      available_max: new Date(Math.max(...rows.map((r) => Date.parse(r.available_at)))).toISOString(),
      business_min: businessTimes.length ? new Date(Math.min(...businessTimes)).toISOString() : null,
      business_max: businessTimes.length ? new Date(Math.max(...businessTimes)).toISOString() : null,
    };
  }
  return { measures, profile, orders_per_customer: countBy(data.orders.map((r) => links.get(r.order_customer_ref).customer_ref)) };
}
function rename(data, mapping, reverse = false) {
  for (const [table, changes] of Object.entries(mapping)) {
    const pairs = reverse ? Object.fromEntries(Object.entries(changes).map(([a, b]) => [b, a])) : changes;
    data[table] = data[table].map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [pairs[key] ?? key, value])));
  }
}
function recipe(operations) {
  const data = structuredClone(main);
  let renaming;
  for (const op of operations) {
    check(cases.evaluation_protocol.permitted_recipe_operations.includes(op.operation), "known recipe operation");
    if (op.operation === "empty_fact_groups") for (const table of tables) data[table] = [];
    else if (op.operation === "retain_orders") {
      for (const ref of op.order_refs) check(data.orders.some((r) => r.order_ref === ref), "retained order exists");
      data.orders = data.orders.filter((r) => op.order_refs.includes(r.order_ref));
      const aliases = data.orders.map((r) => r.order_customer_ref);
      data.customer_links = data.customer_links.filter((r) => aliases.includes(r.order_customer_ref));
      for (const table of ["items", "payments", "fulfillment_events"]) data[table] = data[table].filter((r) => op.order_refs.includes(r.order_ref));
    } else if (op.operation === "rename_fields") {
      renaming = op.mapping;
      rename(data, renaming);
    } else {
      check(tables.includes(op.table), "known recipe table");
      const matches = data[op.table].map((r, i) => Object.entries(op.match).every(([k, v]) => r[k] === v) ? i : -1).filter((i) => i >= 0);
      same(matches.length, 1, "exactly one mutation target");
      const index = matches[0];
      if (op.operation === "update_record") Object.assign(data[op.table][index], op.changes);
      else if (op.operation === "append_record_copy") data[op.table].push({ ...structuredClone(data[op.table][index]), ...op.changes });
      else if (op.operation === "delete_record") data[op.table].splice(index, 1);
      else assert.fail("unhandled recipe operation: " + op.operation);
    }
  }
  return { data, renaming };
}
function readOperands(variant) {
  const grants = variant.control_overrides.current_read_authorizations;
  if (!grants) return {};
  const bindings = ["actor_ref", "role_ref", "resource_ref", "resource_version", "business_scope", "case_ref", "policy_version"];
  same(new Set(grants.map((grant) => grant.authorization_ref)).size, grants.length, "distinct read operand identities");
  const material = variant.events.map((event) => {
    const grant = grants.find((candidate) => candidate.authorization_ref === event.authorization_ref);
    const bound = Boolean(grant && bindings.every((key) => Object.hasOwn(event, key) && event[key] === grant[key])
      && grant.action === event.kind
      && grant.actor_ref === cases.default_control_fixture.role_refs[grant.role_ref]
      && grant.business_scope === cases.default_control_fixture.business_scope
      && grant.case_ref === cases.default_control_fixture.case_ref
      && grant.resource_ref === variant.control_overrides.decision_ref
      && grant.resource_version === variant.control_overrides.decision_version);
    const interval = Boolean(grant && stamp(grant.valid_from) <= stamp(event.occurred_at) && stamp(event.occurred_at) < stamp(grant.valid_until));
    same(event.view_kind, "business_effective", "explicit view kind");
    same(stamp(event.fact_snapshot_as_of), T0, "historical facts separate from current view");
    const recordedVisible = stamp(event.recorded_as_of) >= stamp(variant.control_overrides.decision_recorded_at);
    const effective = stamp(event.business_as_of) >= stamp(variant.control_overrides.business_effective_from);
    return { bound, interval, view: !recordedVisible ? "not_recorded" : effective ? "effective" : "not_yet_effective" };
  });
  return {
    current_read_authorizations: grants.length,
    current_read_bindings_complete: material.every((row) => row.bound),
    current_read_authorized_queries: material.filter((row) => row.bound && row.interval).length,
    business_effective_operand_results: material.map((row) => row.view),
  };
}
const mainBefore = JSON.stringify(main);
const mainResult = baseline(main, { customers: 12, customer_links: 18, orders: 18, items: 24, payments: 20, fulfillment_events: 24 });
const heldResult = baseline(held, { customers: 4, customer_links: 6, orders: 6, items: 8, payments: 7, fulfillment_events: 8 });
const overlap = {};
for (const [table, field] of [["customer_links", "customer_ref"], ...Object.entries(keys)]) {
  const mainValues = new Set(main[table].map((r) => r[field]));
  overlap[table + "." + field] = unique(held[table].map((r) => r[field])).filter((value) => mainValues.has(value)).length;
}
same(Object.values(overlap).reduce((a, b) => a + b, 0), 0, "main/heldout identities disjoint");
for (const snapshot of Object.values(cases.base_snapshots)) same(digest(read(snapshot.path)), snapshot.sha256, "case source hash");
same(digest(read(cases.initial_context.path)), cases.initial_context.sha256, "context source hash");
same(cases.product_execution, "NOT_RUN", "root product status");
same(cases.evaluation_protocol.runtime_execution, "NOT_RUN", "protocol status");
same(cases.evaluation_protocol.human_product_acceptance, "PENDING", "human gate");
same(cases.evaluation_protocol.initial_agent_paths, ["input/facts.json", "input/context.md"], "declared initial allowlist only");
same(cases.evaluation_protocol.current_visibility_enforcement, "NOT_IMPLEMENTED", "not an IAM proof");
same(cases.families.length, 12, "family count");
const variants = cases.families.flatMap((f) => f.variants);
same(variants.length, 59, "variant count");
same(new Set(variants.map((v) => v.id)).size, 59, "unique variant identity");
const variantResults = [];
for (const family of cases.families) {
  same(family.product_execution, "NOT_RUN", "family runtime status");
  for (const variant of family.variants) {
    same(variant.product_execution, "NOT_RUN", "variant runtime status");
    for (const name of ["preconditions", "expected_behavior", "forbidden_behavior"]) check(Array.isArray(variant[name]) && variant[name].length > 0, "nonempty " + name);
    check(Array.isArray(variant.events) && Array.isArray(variant.data_recipe), "events and recipe arrays");
    const { data, renaming } = recipe(variant.data_recipe);
    let roundtrip = false;
    if (renaming) {
      for (const [table, changes] of Object.entries(renaming)) {
        for (const [oldName, newName] of Object.entries(changes)) {
          check(data[table].every((r) => !(oldName in r) && newName in r), "renamed physical fields");
          check(newName in variant.agent_source_dictionary, "new source dictionary");
        }
      }
      rename(data, renaming, true);
      same(canonical(data), canonical(main), "physical rename round trip");
      roundtrip = true;
    }
    const measured = { ...measure(data), ...readOperands(variant) };
    const times = variant.events.map((event) => {
      check(typeof event.kind === "string" && typeof event.actor_ref === "string", "event type and actor");
      const occurred = stamp(event.occurred_at), received = stamp(event.received_at);
      check(received >= occurred, "received not before occurrence");
      if (event.synthetic_error) check(event.synthetic_error.startsWith("FIXTURE_"), "label synthetic errors");
      return { occurred, received };
    });
    check(times.every((t, i) => i === 0 || t.received >= times[i - 1].received), "events listed by receipt order");
    const messageRefs = variant.events.flatMap((event) => event.message_ref ? [event.message_ref] : []);
    const checks = {};
    for (const [key, expected] of Object.entries(variant.material_expected)) {
      let actual;
      if (Object.hasOwn(measured, key)) actual = measured[key];
      else if (key === "time_probe_present") actual = Boolean(variant.time_probe);
      else if (key === "required_events") actual = expected.filter((kind) => variant.events.some((event) => event.kind === kind));
      else if (key === "duplicate_message_refs") actual = messageRefs.length - new Set(messageRefs).size;
      else if (key === "out_of_order_occurrences") actual = times.some((t, i) => i > 0 && t.occurred < times[i - 1].occurred);
      else if (key === "heldout_orders") actual = heldResult.measures.orders;
      else if (key === "heldout_customers") actual = heldResult.measures.customers;
      else if (key === "heldout_id_overlap") actual = Object.values(overlap).reduce((a, b) => a + b, 0);
      else if (key === "renaming_roundtrip_equal") actual = roundtrip;
      else assert.fail("unhandled material assertion: " + key);
      same(actual, expected, variant.id + ": " + key);
      checks[key] = actual;
    }
    let timeProbe;
    if (variant.time_probe) {
      const probe = variant.time_probe;
      const business = stamp(probe.business_at), available = stamp(probe.available_at);
      const view = (asOf) => probe.basis === null ? "unknown" : business >= start && business < end && available <= asOf ? "included" : "excluded";
      timeProbe = { T0: view(T0), T1: view(T1) };
      same(timeProbe.T0, probe.expected_at_t0, "T0 pure temporal operand");
      same(timeProbe.T1, probe.expected_at_t1, "T1 pure temporal operand");
    }
    variantResults.push({ id: variant.id, kind: variant.kind, material: "PASS", checks, ...(timeProbe ? { time_probe: timeProbe } : {}), product: "NOT_RUN" });
  }
}
same(JSON.stringify(main), mainBefore, "all recipes preserve baseline in memory");
const fileHashes = Object.fromEntries(["README.md", "input/facts.json", "input/context.md", "evaluation/heldout.json", "evaluation/cases.json"].map((name) => [name, digest(read(name))]));
let manifestResult = "NOT_CHECKED_PRE_MANIFEST";
if (withManifest) {
  const manifest = json("manifest.json");
  const names = ["README.md", "input/facts.json", "input/context.md", "evaluation/heldout.json", "evaluation/cases.json", "evaluation/quality-report.md"];
  same(sorted(manifest.files.map((file) => file.path)), sorted(names), "exact six manifest entries");
  for (const file of manifest.files) {
    same(file.sha256, digest(read(file.path)), "manifest file hash: " + file.path);
    same(file.bytes, read(file.path).byteLength, "manifest byte count: " + file.path);
  }
  same(manifest.status.product_execution, "NOT_RUN", "manifest runtime");
  same(manifest.status.human_product_acceptance, "PENDING", "manifest human gate");
  manifestResult = { status: "PASS", entries: names.length, manifest_sha256: digest(read("manifest.json")) };
}
console.log(JSON.stringify({
  checked_at: new Date().toISOString(), checker_sha256: digest(readFileSync(process.argv[1])), node: process.version,
  material_status: "PASS", assertions, input_sha256: fileHashes, main: mainResult, heldout: heldResult, identity_overlap: overlap,
  variants_by_kind: countBy(variants.map((v) => v.kind)), variant_results: variantResults, manifest: manifestResult,
  product_execution: "NOT_RUN", human_product_acceptance: "PENDING",
  limitation: "Raw material/recipe/time-operand checks only; control events checked for presence and basic chronology, not executed as product state transitions. No model, policy enforcement, database, network, UI or business-effect test.",
}, null, 2));
```

</details>

