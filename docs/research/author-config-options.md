# 作者配置：三方案研究与收敛

2026-09-30，基线94054a1；继承[MVP决定D12–D15](./mvp-delivery-options.md)。这是方案和验收设计，不能代替实现证据。

| Gap | 三种可行方式及代价 | 选择和验证 |
|---|---|---|
| 配置组织 | A六步完全独立，重复；B作品默认加字段覆盖，需解释继承；C跨作品共享库，增加升级联动 | B加A的实际配置预览；省略继承、空数组清空、prompt null清空。 |
| 存储 | A扩旧Work.config原地写，难追溯；B独立revision与文件元数据表，旧接口不变；C文件配置主库，需要双重索引恢复 | B；旧Work.config只作revision0兼容来源，已保存配置只有一个可编辑来源。SQLitev1严格验证后事务迁移v2。 |
| 执行快照 | A每步读取，会混用；B操作首个可执行节点一次解析所有步骤/文件；C整个生成过程禁止配置修改，限制作者 | B；advance/start/regenerate冻结，运行期间保存只影响下一操作。fake两步暂停测试证明。 |
| 文件提交 | A先DB后文件，可能悬空；B原子文件落地后引用，失败留下未选文件；C跨资源补偿事务，复杂 | B；不可变ID/hash，冻结requestId去重和CAS；同ID异内容冲突，不覆盖旧引用。恢复包含整个数据目录。 |
| Skill | A正则解析小子集，合法YAML易误拒；B安全有界YAML，仅SKILL.md文本；C完整目录/脚本执行，增加权限与工具职责 | B；校验规范name/description，禁止alias、重复key，大小/数量/系统上下文限额；不执行脚本或展开引用。 |
| 界面 | A单独页面卸载编辑器；B创作界面配置面板保留正文；C全局设置不区分作品 | B；保存/未知结果/离开保护，配置面板不重置正文编辑，实际节点只读预览。 |

文风只作用于正文；题材作用于creative/outline/setting/beat/prose；爽点作用于creative/outline/beat/prose。caption仍从原素材提炼。高级配置提供model（provider由前缀决定）、Prompt文件、Skill文件、directionCount和生成参数；tools只允许空数组，工具执行留#28。原生任务SP保留，作者指导附加；服务端输出/schema/ID/预算不能被配置关闭。

工程限额：每文件32KiB、frontmatter4KiB、作品64文件、每步4个Skill、作者装配系统文本48K字符；偏好每项500字符。所有拒绝均在模型调用前，安全错误不回显源文本。上传请求与保存配置均有requestId；网络未知不自动重放，作者可重试同一冻结请求。

外部依据：[Agent Skills规范](https://agentskills.io/specification)定义frontmatter和目录命名；[官方YAML选项](https://github.com/eemeli/yaml/blob/main/docs/03_options.md)用于严格key/重复key和alias控制；采用已核对的yaml2.9.1。只消费name、description和正文，不把allowed-tools当执行授权。ADR0002要求Prompt/Skill存文件，数据库只存版本、hash、元数据和配置引用。

验收：共享请求/响应；CAS/请求去重；v1迁移和重启；跨作品文件/被改文件/超预算安全拒绝；fake配置装配和同操作冻结；SDK本地mock验证实际SP/模型/参数/遥测；一次授权真实调用溯源；CLI严格帮助和输入；Web真实交互；完整CI与整个数据目录容器恢复。没有新增Human保留点。

文件原子发布的进一步三案：A rename可能覆盖并发同ID；B exclusive hardlink从已fsync私有临时文件发布，存在时核对hash，随后fsync目录；C数据库/文件全局锁阻塞并扩大职责。采用B，最终版本从不被替换，DB失败留无引用文件可按同ID/hash恢复。symlink失败测试发现递归mkdir会先在目录外创建子目录，改为逐层校验再创建；不会把当前版本修改成修复前的行为。客户端进一步核对全部元数据/hash及provider归属，避免200畸形成功被认作已确认。

独立review暴露恢复gap：已保存请求的三案为A先重验当前文件（会否认历史提交）、B先取不可变回执并匹配原请求，再验证新写入、C后台持久任务对账。采用B，Repository仍在事务内去重兜底。Web三案为A仅看本次HTTP（抹掉先前unknown）、B保留先前unknown直到精确回执/回读确认、C后台自动重放；采用B，不引入任务或自动写入。兼容来源三案为A永远混入旧Work.config（隐式来源）、B只在revision0继承，作者revision作为唯一编辑来源、C首次自动迁移成revision1（隐式写入）；保持原选B，保存后的空默认明确跟随启动配置。
