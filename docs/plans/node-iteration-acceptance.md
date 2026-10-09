# #51：节点源信息验收准备

日期：2026-10-10（Asia/Shanghai）。状态：候选待正式审核。固定点 `d2669132c8598a1368f43e2b7fe66225211f09be`，候选 `b0d51d188c5b9c9db907700fec5a1cd4bfbf1138`。需求以 [#51](https://github.com/12bitsD/agent4novel/issues/51) 和当前用户决定为准；本页保存可执行验证方法，不替代 issue 的 WHAT/AC。

用户已确定：可观测性优先收集高价值源信息，AI可一次读取；未取得值为 None；分析/比较/comment/复跑工作方式进入 skill；主 Agent 先定义并校准验收，子 Agent 实现，主 Agent 复验，首次候选计第1轮，默认2轮、上限3轮，正常流程不逐票等待人工确认。目标是控制验收自证、代码膨胀和效果偏离。

## 本票起点与范围

先贯通现有六节点 run-step 的显式私有记录与一次完整读取，复用共同 callLlm 接缝和生产 Step；普通文件承担比较/comment，run-step承担复跑。实现落地后同步CLI帮助、运行skill、schema受影响部分、README中英和Wiki。代码提供源事实，skill组织工作方式。

正式Pipeline的完整私有记录接入属于需要明确区分的后续覆盖面：目前生产只有安全遥测，不能把独立实验记录或共用SDK接缝说成“正式运行已完整记录”。正式运行接入方式与保存失败语义必须先建立独立验收再派工，不在本票首轮静默重构Pipeline。

不建设eval服务、通用节点描述/规则平台、专用UI、评论API、数据库或自动judge；不修改作品关卡/历史语义，不替换现有结构校验，不调用付费provider。真实模型质量与实际付费实验须有独立授权和预算。

## 方法与假通过识别

公开接缝：可执行CLI → 实际worker → 本地provider transport；另用SDK边界mock独立截获generateObject真实入参，覆盖六节点共同调用路径。固定输入/预期选用合成材料，测试环境清空真实密钥，provider仅loopback。

| ID | 目的/票面来源 | 执行与独立期望 | 必须识别的假通过 |
|---|---|---|---|
| E1 | AC1/2 实际调用 | 六节点分别给固定合法输入；SDK mock截获实际system/prompt与传入选项，和记录逐字符/逐字段比较；正文再经CLI/worker/local transport贯通 | 重拼prompt、只保存hash、仅覆盖正文、模型选项猜默认 |
| E2 | 用户一次读全；AC3 | 通过单次显式读取取得同一run的源输入、实际调用、生效配置、版本、最终Step结果与诊断；新进程重读可用，原结果含生成后ID | 只有目录/文件链接、全null冒充完整、将provider对象当最终Step产物 |
| E3 | AC4/5 失败与兼容 | 输入/schema/预算/配置失败、本地provider失败及CLI期限分别执行；核对安全状态、真实调用次数和未捕获null；无记录选项的旧结果/退出保持兼容 | 没调用也伪造请求、任何错误都算provider失败、迟到结果覆盖首个失败、应用自动重发 |
| E4 | AC4/6 私有归档 | 临时目录检验权限、目录碰撞、符号链接、失败/部分写入；已存在记录不变，完整写入后才能报告完成 | 目录存在就称完成、覆盖旧A、归档失败冒称模型没执行 |
| E5 | AC5/6 隐私 | 合成素材/SP/provider错误中放独特标记，检验公共stdout/stderr/telemetry不新增全文/原始异常/credential；显式私有资源读取是授权全文出口 | 将完整prompt夹带到普通日志、复制凭据配置/请求头 |
| E6 | AC3/7 历史与条件 | 运行A后修改输入/SP/配置，再读A逐字符一致；B使用明确新版本并独立记录；确认commit/dirty或无法确认时null，不宣称dirty可重现 | 用当前文件补历史、把默认参数当已确认、伪造upstream ID/版本 |
| E7 | AC7/8 迭代贯通 | 本地prose A→读取→改一个因素→B→一次取得各版完整材料→普通文件diff/comment→读回；核对A复用无新请求、用户原话与Agent解释分开 | 将手改文本称新模型输出、comment触发模型/写作品、复用缓存算新样本 |
| E8 | AC9与用户loop | skill有验收追溯/反例校准/只读审查/固定派工/主Agent复验/三轮停止；独立Agent用真实任务前向检查，验证未通过不自动宣称完成 | 只匹配skill标题、实施Agent改标准自证、重置轮次绕过上限 |

None/null表示未取得值。已实际调用且本票承诺捕获的system/prompt缺失时E1/E2失败；调用前拒绝时实际调用为空是正确结果。应用记录的SDK选项缺省保留未显式传入的语义，不猜provider内部行为。SDKmock证明SDK入口一致性；transport联验另证明CLI/worker/文件实际贯通，两者互不冒充。

E1–E8均为本票必需项；每项附候选版本、命令和原始证据，PASS/FAIL/证据不足不做加权平均。性能/文学质量不以测试数量或单样例评分替代。

## 校准与执行顺序

1. R0：确认原基线不支持记录/一次读取；用独立reviewer审查上述方法的可作弊方式。候选产生后再执行成功路径校准，不把基线或文档当作GREEN。
2. S1：SDK边界捕获的有效RED→最小GREEN，六节点、并发隔离与无sink兼容。
3. S2：CLI/worker显式私有归档和一次读取；真实文件/transport RED→GREEN，补失败/期限/路径联验。
4. S3：A/B/comment与skill前向验证；主Agent亲自执行E1–E8，记录第1轮候选与差距，最多两次修复复验。
5. 通过后按项目完成清单进行知识回写、独立双轴、attestation和已授权发布。第3轮仍FAIL/证据不足则保持OPEN；其他二期票不联动关闭。

全test/typecheck/build命令以根package.json为准。实施子Agent可新增开发测试，不能修改本页/原固定预期绕过失败；标准纠错保留版本与理由，重做受影响校准，继续计轮。每轮代码增加必须能映射到失败条目或已确认AC；新依赖/平台抽象不作为默认优化。

## 当前证据

- 原基线、干净main与#51 OPEN已回读；未加入Project，无开放PR。
- 基线RED已保存于 `/tmp/a4n-loop-start-20261010/baseline.json`；第1轮实现和第2/3轮定向修复已在隔离候选中完成。主 Agent 已独立复跑 E1/E3/E4/E5，并按四文件资源规则核对 E2/E6；真实 CLI/worker 的正文 A/B/comment/复跑联验已执行，真实 provider 质量、进程崩溃级归档恢复保持未验证。
- E7/E8 联验命令：在候选 worktree 执行一次内联 `node --input-type=module` loopback-provider 脚本，使用 `run-step prose` 两个全新目录 A/B，读取两版 `meta.json`/`invocation.json`/`result.json`，写入旁置 `comments.md`，再检查 A 未被 B 覆盖、两次 provider 请求、同一 prompt、评论分离和四个记录文件 `0600`。输出：`{"ok":true,"calls":2,"aComplete":true,"bComplete":true,"samePrompt":true,"aPreserved":true,"commentSeparated":true,"filesPrivate":true}`。
- `pnpm test`、`pnpm typecheck`、`pnpm build` 以及受影响包定向门禁均通过；Markdown链接、skill validator和diff check通过。独立 Standards/Spec reviewer 已完成前置候选审查，发现 AC7/AC8 证据缺口后已补做上述联验；正式 C5/C6 审查仍待最终候选冻结。
