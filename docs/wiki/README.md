# Project Wiki — 技术方案与实现记录

给 agent 消费的"每票实现文档"：**实现目的 + 技术方案 + 状态记录**。它是 HOW 的唯一来源，与其他文档严格分工（防重复）：

| 文档 | 管什么 | wiki 与它的关系 |
|---|---|---|
| spec（issue #1） | WHAT（做什么、为什么） | wiki 只讲 HOW，不重述产品理由 |
| `CONTEXT.md` | 领域词汇 | wiki 只用它的词，不重新定义、不造新词 |
| `docs/adr/` | 不可逆决策 | wiki 引用；实现中新出现的不可逆决策**另立 ADR**，wiki 只链接 |
| `docs/research/` | 选型依据 | wiki 只引用结论，不抄论证 |
| ticket（GitHub issue） | 验收标准 + 阻塞关系 | wiki 开头"实现目的"是 ticket 的一句话摘要 + 链接，不复制全文 |

## 命名与位置

`docs/wiki/NNNN-<slug>.md`，NNNN = GitHub issue 号。ticket 正文放一行 `## 技术方案 (wiki)` 链接指过来。

## 文档模板（每份 wiki 固定结构）

1. **实现目的** — 这张票端到端交付什么、为什么存在（2–3 句）
2. **决策基线** — 引用已对齐的决策（ADR / research / grill 结论），不重新论证
3. **技术方案** — 模块、接口、数据模型、API、UI（HOW）
4. **测试策略** — seam、fake、覆盖点
5. **实施顺序** — 红绿切片
6. **边界与错误** — 失败模式与处理
7. **明确不做** — 本票范围外
8. **状态记录** — 实现中每一次重要决定 / 偏差 / 踩坑，按时间追加

## 标准 loop（每张票都走）

1. **对齐**（grill）→ 结论进"决策基线"
2. **写技术方案** → 存到这里 → ticket 里加链接
3. **TDD 实现**，边做边更新"状态记录"
4. **code-review / debug 消费本文档**：先读 wiki，再读代码
5. **收尾**：终态与未决问题写进"状态记录"

## 消费规则（agent）

- implement 前：读 ticket → 读其 wiki 文档
- debug / code-review：先读"状态记录"+"技术方案"，再读代码；发现 wiki 与代码漂移，**以代码为准并把 wiki 改对**
- 用 `CONTEXT.md` 的词汇写 wiki，不造新词

## Index

- [002 脚手架 + 存储 + workflow 骨架 + 书架](./002-scaffold-storage-runner-bookcase.md) — issue [#2](https://github.com/12bitsD/agent4novel/issues/2) ✅
- [003 统一入口 + 创作界面 idea 状态（#3a）](./003-unified-entry-idea-workspace.md) — issue [#3](https://github.com/12bitsD/agent4novel/issues/3) ✅
- [010 预处理 RealStep + interview + outline/setting 形态对齐（#3b）](./010-preprocess-realstep-interview.md) — issue [#10](https://github.com/12bitsD/agent4novel/issues/10) ✅（产物形态被 #3c 重构，见 wiki 011）
- [011 预处理重构：Caption + Creative 方向包 + 比较界面（#3c）](./011-caption-creative-directions.md) — issue [#11](https://github.com/12bitsD/agent4novel/issues/11) ◀ 下一个