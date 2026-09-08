# #5 综合技术评审与修订记录

当前状态：**R1 修订完成，技术方案复审 PASS**。初轮 R1–R4、本轮新增 A1 及两项接口澄清均已在[修订方案](./005-beat-generation-review.md)中关闭；产品、前端、后端、运维与 Agent 视角已综合核对，无剩余必要修订。这里只是方案修订，未修业务代码。

第 1–6 节保留 2026-09-06 初轮 R0 的 **REQUEST_CHANGES** 结论及证据，行号链接指向[不可变原稿快照](./005-beat-generation-review-r0.md)。第 7 节记录后续修订与复审，不用新文案覆盖旧发现。

## 读者确认

核心读者是作者／产品负责人与下一位实现 Agent。本文回答：能否开工、必须修什么、哪些 MVP 限制可以保留；不要求作者重新确认已经决定的章纲形态和两步创作流程。

## 问题定义

检查 #5 技术方案能否在现有代码上完整、安全地实现第一章章纲关卡，并识别实施前必须消除的设计缺口。

## 核心结论（≤3条）

1. **产品方向对齐。** 四部分章纲、当前页编辑后一次通过、整份再生、通过后只读，与 [#5](https://github.com/12bitsD/agent4novel/issues/5) 及本轮 Human 决定一致；正文继续归 [#22](https://github.com/12bitsD/agent4novel/issues/22)。
2. **修订稿补齐四项问题与 Agent 信息链。** 区分命令写入结果与模型结果，返回精确目标、恢复建议及安全诊断；不引入 SQLite、队列或持久任务回执。固定版本复审关闭证据见第 7 节。
3. **接下来正式录入 Wiki，再进入 TDD。** 方案复审已完成，不是实现后的代码评审，也不代表 ticket 已完成。

## 1. 初轮 R0：评审对象与方法

本次针对固定版本草案评审，方案正文保持未修改，便于回查发现。

| 项目 | 本次证据 |
|---|---|
| 评审日期 | 2026-09-06 |
| 对象 | [原稿快照](./005-beat-generation-review-r0.md)，原路径为 `005-beat-generation-review.md` |
| 草案 SHA-256 | `0647371521f9ed82a6a17b5d915f2354a790a4917cfeb55564ab13d5ded19c91` |
| 代码固定点 | `main@70b43968de24ecf21e596bff35988feff62b73a9` |
| live 票面 | #5 OPEN、ready-for-agent、Project Backlog；#4/#13 原生依赖均 CLOSED |
| 参与方式 | 前端、后端、运维由三个未参与本稿编写的 reviewer 分别检查；主 Agent 核对产品、验收与交叉发现 |
| 方法 | 完整草案阅读，按 Wiki 路由核对相关意图，代码只读检查；后端另做一次不落盘的内存存储原语验证 |
| 执行边界 | 未实现 Beat，未启动应用或真实模型，未读取凭据，未更改 issue/Wiki/方案正文，未 commit/push |

使用 `codebase-design` 检查模块职责和 interface 是否承担了应有的一致性责任，项目 Wiki skill 核对既有约束，`documentation-writer` 将发现收敛为可行动的报告。没有用代码评审的完成门禁冒充技术方案评审。

## 2. 四个视角的结论

四个视角认可主要设计；需要修订的是可恢复性和实际复用路径。

| 视角 | 结论 | 主要判断 |
|---|---|---|
| 产品 | 范围对齐，失败体验需修订 | 不增加正文、批量章纲、比较或回流；R1 不能让“保留修改”变成“修改仍在，但只能放弃或重复失败请求” |
| 前端 | 需修订 | R1 明确模型失败缺少恢复编辑路径；另需具体的迟到响应及真实 DOM 验证 |
| 后端 | 需修订 | R2 重启身份复用会使旧请求命中新作品；按章寻址、条件写入和同版本定稿主体可行 |
| 运维／可靠性 | 需修订 | R2 跨重启隔离，R3 日志／错误脱敏，R4 首次生成等待期限；单进程和暂不持久化可以保留 |

R2 按 P1 优先修订，因为其后果是跨作品错误写入；其余三项为 P2。它们均有具体触发条件，需要在本次方案修订中解决，不是声称每次正常操作都会失败。

## 3. 必须修订的发现

初轮裁决时四项发现均保持打开。下面保留当时的评审建议；本轮设计关闭状态见第 7 节，不能据此认为代码已修复。

### R1 · P2 · 明确模型失败不应把草稿永久冻结在原请求上

当前错误分类使一次明确未写入的模型失败，也可能让作者无法继续修改和通过。

**位置：** [原稿第 283 行](/Users/bits12/Desktop/codespace/agent4novel/docs/plans/005-beat-generation-review-r0.md:283)，关联第 303、307、311 行。

触发过程是：作者修改章纲和意见 → 再生返回合法 `llm-invalid-output`／`llm-unavailable`／`llm-timeout` → 页面置 `hasUnknownWrite` → GET 仍为原 pending → 只能回读或重试完全相同的冻结请求。作者不能调整导致失败的内容／意见，也不能转回人工修改后通过；刷新则丢掉页内修改。

现有生成调用会抛出这些领域错误，Pipeline 仅在 Step 成功返回后追加；草案同样明确“失败不 append”。因此应区分“明确失败且未提交”和“请求结果未知”，而不是只依据 HTTP 5xx 一律冻结。[LLM 错误](../../apps/server/src/steps/llm-call.ts)、[Pipeline](../../apps/server/src/pipeline/pipeline.ts)

**建议修订：** 为再生结果定义可验证的“已结束且未提交”语义，且只在提交前失败路径构造它。没有更早未知写入时，可回读原基线后保留 content/instructions 并继续编辑；网络异常、坏响应、提交后异常和存在未知旧请求时仍保持保守冻结。无需为此建立持久回执系统。

**复审／测试要求：** 分别注入上述三种合法失败，断言没有 append、草稿／意见保留、可以修改再提交；再覆盖“旧 POST 超时 → 重试收到明确失败”，确保不能错误清除旧 unknown。通过和再生的失败分类应各自完整，不放松定稿的结果确认。

### R2 · P1 · 重启后旧请求可能误写另一部作品

接受重启丢测试作品，不等于接受旧身份被新作品复用；当前 ID/version 条件不足以隔离进程重启。

原始评审中后端标为 P2、运维标为 P1；主 Agent 合并时按 P1 处理，依据是它能绕过当前目标检查并错误定稿另一作品，而不只是让请求失败。

**位置：** [原稿第 222 行](/Users/bits12/Desktop/codespace/agent4novel/docs/plans/005-beat-generation-review-r0.md:222)，关联第 116、384 行。当前 [InMemoryStore 第 28 行](/Users/bits12/Desktop/codespace/agent4novel/apps/server/src/store/in-memory-store.ts:28) 每实例从零计数，作品与 Artifact ID 都来自该序号。

触发过程是：旧页或旧 CLI 保留请求 → 服务重启 → 另一部作品按相同顺序生成 → workId、Artifact ID、version 再次相同 → 旧请求迟到或被重试。已有卡片 UUID 通常能拦住旧卡，但方案允许删掉所有旧卡、以省略 ID 的新卡通过，也允许空写作安排作为再生输入，故卡片身份不能代替作品身份隔离。

后端 reviewer 用两个独立 Store 做了不落盘验证：同序创建作品、四个上游与 Beat，均得到 `work-1 / artifact-6 / v1`。在新作品当前上游通过、请求卡片全部按新项处理时，现有 finalize 成功将“旧作品 A 的修改”写入 seed 为“新作品 B”的作品并置 approved。

这是一项**现有存储原语的可执行验证，加上拟议命令校验的推演**；Beat 端点尚不存在，不能当作 Beat HTTP 集成测试结果。

**建议修订：** Work／Artifact ID 使用 UUID，或包含每个 Store／进程实例唯一的随机前缀，使重启前后不重复。此项是身份正确性补强，不是提前实现 SQLite。

**复审／测试要求：** 两个独立 Store 模拟重启，重放旧通过和再生请求，覆盖“全新卡均无 ID”和“再生卡片为空”。旧目标必须不存在或冲突，模型调用前拒绝，新作品内容与状态不变。

### R3 · P2 · 安全日志要求未覆盖实际复用的 LLM 错误分支

只限制新增业务日志不够，Beat 复用的共享调用器已经可能记录内容片段和原始供应商错误。

**位置：** [原稿第 390 行](/Users/bits12/Desktop/codespace/agent4novel/docs/plans/005-beat-generation-review-r0.md:390)。当前 [llm-call.ts 第 101 行](/Users/bits12/Desktop/codespace/agent4novel/apps/server/src/steps/llm-call.ts:101) 输出模型文本末 200 字符，第 104 行输出 causeMessage，第 122 行将原始 err.message 作为 `llm-unavailable` message 继续传递。

若无效模型输出中包含作者修改意见或章节片段，它会进入 stdout；供应商错误消息也可能含请求相关信息。现有截断只减少长度，不是脱敏。此为继承路径上的风险，不是宣称本轮已经发生真实内容或凭据泄漏。

**建议修订：** 将共享调用器的错误日志／公开错误 envelope 明确纳入本票安全改动面。使用白名单诊断字段和稳定用户消息，不默认记录原始输出、cause 文本或 provider error message；保留 attemptId、错误分类、时延、用量和长度／hash 供排查。不为此增加新监控平台。

**复审／测试要求：** 用合成秘密标记填入模型 text、cause 和 provider message，覆盖首次生成与再生失败；stdout、HTTP 错误、遥测响应均不得出现标记，同时仍能用 attemptId 关联错误。修改共享调用器后复跑既有步骤的相关测试。

### R4 · P2 · 首次章纲生成仍可能无限等待

首次生成沿用 advance，但方案的完整请求 deadline 只明确给了通过、再生和确认 GET，留下首次 Beat 生成的等待缺口。

**位置：** [原稿第 288 行](/Users/bits12/Desktop/codespace/agent4novel/docs/plans/005-beat-generation-review-r0.md:288)，关联第 263、370 行。现有 [Web request 第 16 行](/Users/bits12/Desktop/codespace/agent4novel/apps/web/src/api.ts:16) 和 [advance 第 77 行](/Users/bits12/Desktop/codespace/agent4novel/apps/web/src/api.ts:77) 没有覆盖 fetch／响应体的 deadline。

如果首次生成的连接或响应体不结束，Workspace 的 generate 会一直等在 advance，直到 promise 结束才清理生成状态；服务端模型超时无法代替浏览器传输期限。[Workspace 第 67 行](/Users/bits12/Desktop/codespace/agent4novel/apps/web/src/pages/Workspace.tsx:67)

**建议修订：** 对本票首次 Beat advance 也定义完整等待期限和结果确认路径，覆盖 fetch 与读取 body；超时后退出本地忙状态并回读，不自动重发模型请求、不撤销已通过 Setting，也不声称服务器任务已取消。不要无差别把单步预算施加到可能运行多步的既有 advance 调用。

**复审／测试要求：** 首次 advance 的 fetch 永不完成、响应头后 body 停滞、服务端已落 pending 但客户端超时三种情况，都能有界结束本地等待并进入正确恢复状态。测试替身忽略 abort 时，deadline 仍需结束调用方等待。

## 4. 应保留的设计与实施检查点

主要设计可以保留，不需要用更重的架构替代这四项局部修订。

### 4.1 产品与架构保留项

保留四部分中等结构化内容、允许不完整页内草稿用于再生、服务端生成卡片 ID、人工通过同版本定稿、AI 再生成功追加 pending，以及明确的第一章生产终点。

同时保留已明确的 MVP 限制：内存存储与单进程锁；无历史比较／回流／正文；未知的随机再生成果需作者确认载入；不承诺模型执行 exactly-once；上游重新通过后不自动重算已有下游，也不宣称语义一致性已经得到证明。

后续排期仍为 #5 → #22 → #19 → #9 → #6。上述发现不构成提前进行全仓契约治理或 SQLite 的理由。

### 4.2 不另计阻塞发现的验证补强

下列内容已有设计原则或属于校准，补成具体实施检查即可，不额外扩大 ticket。

| 检查点 | 需要补清楚什么 |
|---|---|
| 迟到响应 | S5 加入：本页再生写 v2、200 延迟；他页写 v3；GET v3 先到；旧 v2 200 后到。成功替换规则不得回退已观察到的最新 head |
| 真实交互验证 | 现有页面测试使用 `renderToStaticMarkup`，不能证明焦点约束／恢复、beforeunload 清理或导航只执行一次；选定 mounted DOM 或浏览器验证方式 |
| 消费守卫 | 当前共享 consumeGuards 只有 creative；明确补齐本票需要的 caption/outline/setting/beat 校验，并覆盖已有 approved 输出被污染的场景，不仅检查首次生成输入 |
| 合并上下文预算 | 目前分别给内容、HTTP 和输出 token 上限；补充 outline + setting + 页内章纲 + 意见合并后的技术预算与超限恢复，不静默裁掉“完整上游”要求。不声称某个 provider 已实测溢出 |
| 意见框语义 | 界面明确“仅用于重新生成”，通过只定稿当前可见章纲。意见未使用时避免让作者误以为点击通过会自动应用意见 |

第一项已有方案第 341 行的原则约束；第二项的当前证据见 [setting-page.test.tsx](../../apps/web/test/setting-page.test.tsx)，第三项见 [consume-guards.ts](../../apps/server/src/pipeline/consume-guards.ts)。这些是实现与验证提醒，不把尚未编写的代码当成已发生的新缺陷。

## 5. 验收标准覆盖判断

方案对七条 AC 都有设计入口，但“设计覆盖”不等于“实现验收通过”。

| AC | 设计评审判断 |
|---|---|
| AC1 上游与生成 | 设计覆盖；补 R4 和合并输入预算说明 |
| AC2 内容与阅读 | 设计覆盖；需实际交互／Markdown 测试 |
| AC3 人工编辑 | 设计覆盖；R1/R2 修订后才能形成可靠实现基线 |
| AC4 重新生成 | 设计覆盖；R1 的失败恢复分类必须修订 |
| AC5 关卡与终点 | 设计覆盖；维持无生产 prose、fake 消费最终人工内容 |
| AC6 保存与失败保护 | 有缺口；R1、R2、R4 均与此直接相关 |
| AC7 验证与交付 | 已完成本轮方案评审；代码、TDD、知识回写、代码评审和交付均未完成；R3 纳入安全门禁 |

## 6. 本轮验证与裁决边界

本轮获得的是方案评审证据，没有取得任何 #5 实现通过证据。

已核对 live #5/#22 票面、#5 原生依赖、Git 固定点和草案 SHA；前后端与运维 reviewer 结论均为需修订。主 Agent 合并了前端／产品的 R1 及后端／运维重复发现的 R2，保留了具体触发条件，没有把非目标或验证提醒算成新阻塞问题。

后端的小验证只涉及两个内存 Store 和合成内容，不持久写入用户数据。不将其计作未来 Beat HTTP、Web 或 CLI 测试通过；完整 test/typecheck/build、真实模型与浏览器验证留在实现阶段执行。

本次仅新增本报告，技术方案正文 hash 保持不变。四项发现状态均为 OPEN，尚未修改方案、录入 Wiki 或开始实现；也没有发布或修改 GitHub 内容。

## 7. R1 修订：四项修法与 Agent 视角

作者于 2026-09-06 要求调整／fix 方案，并新增“Agent 使用能力时是否得到足够返回和可观测信息”的评审。当前修改仅限方案与本记录，原稿快照保持原 SHA。

### 7.1 修订内容与关闭条件

| 项目 | 已写入方案的设计修订 | 复审状态 |
|---|---|---|
| R1 失败恢复 | §6.2–6.3 区分 committed/not-committed/unknown；严格匹配命令响应；提交后异常不得假报未写入；旧 unknown 不被新拒绝清除 | 方案级 CLOSED；前端、后端 PASS |
| R2 身份隔离 | §5.3 Work／Artifact UUID；跨 Store 旧请求在模型前拒绝；无 SQLite 扩张 | 方案级 CLOSED；后端、运维 PASS |
| R3 安全诊断 | §8.1 共享 callLlm 与公开错误白名单；移除 raw text/cause/message，保留安全分类、路径和关联信息 | 方案级 CLOSED；运维 PASS |
| R4 首次等待 | §6.2 通用 Web advance 1,820 秒 fetch＋body 主动 deadline，超时有界回读、不自动 POST；其他命令保留不同预算 | 方案级 CLOSED；运维、前端 PASS |
| 实施检查点 | §3.4 合并输入预算、§5.1 已有 approved 消费守卫、§7.1 迟到 head 单调性与意见框、§9.1 挂载 DOM／浏览器测试 | 已写入并通过方案复核，执行证据待 TDD |

这些是方案缺口的修订，不是声称运行中的四项问题已修复。实现、故障注入、旧链回归和代码门禁仍全部待做。

### 7.2 新增 Agent 视角

Agent 友好性的目标是“少猜测、能定位、知道何时停下来”，不是多返回日志原文。

| Agent 要回答的问题 | 原稿／当前代码的缺口 | 本次设计与验收入口 |
|---|---|---|
| 我读取的是哪章、运行在什么模式？ | CLI get 只找第一个 kind；telemetry 为空不代表 demo | §6.4 按章 get、只读 config、smoke executionMode；§9.1 精确判读测试 |
| 生成成功，是否也写入成功？ | LLM ok 在 append 前记录，没有命令提交结果 | §6.5 command.writeOutcome/failureStage，LLM 与条件写入结果分开 |
| 这条诊断属于我的调用吗？ | 同作品 cursor 区间可能混入并发请求，路由 requestId 没贯通 | §6.5 requestId/attemptIds 精确关联；锁拒绝不冒领模型遥测 |
| 我可以重试、修改，还是要等作者？ | retryable 不等于安全重试；CLI 旧错误字段会丢新元数据 | §6.3–6.5 共用恢复判定、observedHead 三态、退出码与严格解码；allowedActions 不等于作者授权 |
| 没有原始错误内容，还能排障吗？ | 原始 text/cause 既有风险；完全删错误又不够定位 | §8.1 安全类别、字段路径、长度／预算、关联 ID；§6.5 日志有界窗口与丢失语义 |

本次新增测试均进入 S1–S6 纵向切片，不单开观测平台项目。返回命令诊断、扩展现有 logs 与全局有界缓冲是本票上限；持久状态查询、任务回执、跨进程观测和 Agent 自动替作者通过均不在范围。

### 7.3 固定版本复审

三个独立 reviewer 完整阅读技术修订稿并给出 PASS；主 Agent 另核对产品边界和跨视角一致性。随后仅更新状态／评审阶段／下一步文案，reviewer 再确认最终 hash 可沿用裁决。没有把只读方案审查计作代码测试通过。

| 项目 | 当前证据 |
|---|---|
| R1 第一候选 SHA-256 | `6fc1d4574895aa3b1833280d1d06bc6f03db2f13ee0026b2fa6eb14a44c1badf`；前端／运维 PASS，后端提出 A1，不能据部分 PASS 宣称综合通过 |
| 完整技术复审基线 SHA-256 | `2f64cdec8ebc084783bd2670dcba1617da3d85b92a9237af7c89174640dc0b34`；三位 reviewer 均 PASS |
| 最终状态文案版 SHA-256 | `c91f72ce3067bbe9e68236c86c4ae47e48c91fc3991568bfb6c5a7c1f6f788b6`；只更新已完成复审的状态和后续步骤，不改协议／测试语义 |
| 原稿 SHA-256 | `0647371521f9ed82a6a17b5d915f2354a790a4917cfeb55564ab13d5ded19c91`，快照未改 |
| 前端／Agent 调用 | `beat_review_frontend`：PASS；R1、head 单调性、草稿保护、意见框、真实交互验证与 Agent 恢复协议闭合 |
| 后端／契约一致性 | `beat_review_backend`：PASS；R1/R2/A1 关闭，schema、guard、读模型与遥测归属可落地 |
| 运维／Agent 排障 | `sqlite_timing_check`：PASS；R3/R4 关闭，安全诊断保留可定位信息，窗口／重启／失败降级边界明确 |
| 产品 | 主 Agent 核对通过：仍只交付第一章章纲，无正文、比较、回流或自动批准；用户意见不会被通过动作暗中应用，失败保留修改 |
| Agent 综合判断 | 前端检查实际调用、后端检查契约、运维检查排障，主 Agent 合并：目标、写入结果、等待作者、恢复与证据缺失均有可消费信息，不要求读原始错误正文 |
| 执行边界 | 无业务代码变更、无应用／模型运行、无功能测试、无 Wiki／GitHub 发布、无 commit/push |

### 7.4 本轮新增发现与处理

**A1 · P2 · 请求边界拒绝被误归 unknown：CLOSED（方案级）。** 后端在第一候选的第 306、369 行发现：413／bad-json 尚无完整目标／版本，但客户端统一要求完整基线才能采信未提交，于是明确拒绝后仍不能修正输入。最终稿[第 372 行](/Users/bits12/Desktop/codespace/agent4novel/docs/plans/005-beat-generation-review-r1.md:372)增加严格 `request-rejected` 判别分支：限定业务执行前、code/status 白名单、当前 HTTP 方法／路径及 operation 绑定；执行期缺字段仍 unknown，更早 unknown 始终保留。[第 530 行](/Users/bits12/Desktop/codespace/agent4novel/docs/plans/005-beat-generation-review-r1.md:530)列出合法 400/413、坏 envelope、错 operation 和旧 unknown 的正反测试计划。前后端及运维复核通过；测试尚未实现。

**两项 P3 接口澄清：已关闭。** 前端指出当前 WorkView 无 pendingGate，恢复判断也需原始 baseline 的旧卡 ID 集。最终稿[第 376 行](/Users/bits12/Desktop/codespace/agent4novel/docs/plans/005-beat-generation-review-r1.md:376)只投影已有的 workflowState/nextStepId/allowedActions，[第 382 行](/Users/bits12/Desktop/codespace/agent4novel/docs/plans/005-beat-generation-review-r1.md:382)明确输入包含原始 baseline Artifact。没有为消除文案歧义增加新的 WorkView 状态机。

文档本身已检查本地链接目标、尾部空白和文件结尾；原稿快照 hash 不变，tracked 工作树仍干净。所有 R1–R4/A1 的“关闭”都指设计缺口已修订且复审通过，业务修复证据留待 S1–S6 和交付清单生成。


## 8. 2026-09-08 正式收录

作者授权正式进入 Wiki。现行工程入口为 [Wiki 005](../wiki/005-beat-generation-review.md)，内容形状／公开协议为 [schema 的待实现设计](../schema.md#beat5-当前契约)；原计划入口只保留导航。

原 R1 内容原样归档为 [已审快照](./005-beat-generation-review-r1.md)，SHA-256 仍为 `c91f72ce3067bbe9e68236c86c4ae47e48c91fc3991568bfb6c5a7c1f6f788b6`。本记录原有“最终稿第 N 行”链接改指快照，以保持评审证据可重放；不是新一轮代码评审，也不改写原来的 PASS 依据。R0 快照及研究保持不变。

本轮只有本地知识收录，未实现、运行模型、commit/push 或发布 GitHub。S1–S6 顺序沿用已审设计，新增执行依赖／公开测试边界／完成条件，待作者与实现 Agent 在首个 RED 前确认。

## 下一步

五视角方案复审与本地 Wiki/schema 收录已完成。下一步确认 Wiki 中的开发步骤及开工门禁；GitHub 正式入口同步留到获准发布且文档远端可读时，不重复 grill 已确认的产品范围。

| 行动 | 负责人 | 截止时间 |
|---|---|---|
| 保留已完成的方案裁决与证据，正式录入时核对未发生语义漂移 | 方案负责人／协作 Agent | Wiki 正式录入时 |
| 确认 Wiki 的 S1–S6 开发步骤、公开测试边界和交付模式 | 作者 + 实现 Agent | 首个 RED 前 |
| 按已确认交付方式执行 TDD、代码评审与完成清单 | 实现负责人／Agent | 对应开发和发布门禁前 |
