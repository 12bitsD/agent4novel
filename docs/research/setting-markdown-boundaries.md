# Setting 排版渲染与输入边界依据

日期：2026-09-05。服务于 [#13 Wiki](../wiki/013-setting-generation-review.md)，不是通用富文本编辑器选型。产品只需要段落、粗体／斜体、引用和列表，未知语法应保留源文本而非执行或隐藏。

## 选型结论

采用 `mdast-util-from-markdown` 2.0.3（依赖声明 `^2.0.3`，精确解析见锁文件）。它将 Markdown 解析为 mdast，官方将手工处理语法树列为适用场景；本项目因此可在 React renderer 中只创建明确允许的元素，并利用节点源位置保留不支持的写法。[官方说明](https://github.com/syntax-tree/mdast-util-from-markdown)

`react-markdown` 也是可行候选，其选项支持元素允许／拒绝及自定义组件；但仅过滤生成的 HTML 元素，并不直接满足本票“未知语法原文显示”的要求。选择直接处理 mdast 是本项目的实现判断，不表示其他库不安全。[官方选项](https://github.com/remarkjs/react-markdown#options)

Markdown parser 不是安全策略。允许列表、原文降级、不透传属性、不生成资源链接和解析预算均由本项目承担；测试入口是 `apps/web/test/setting-markdown.test.tsx`，浏览器证据归本票 Wiki。AST 不写入协议或 Store。

## HTTP body 边界

Hono 的 body-limit 在超限时返回 413，并在无 Content-Length 时检查流式请求；因此本票在 JSON 解析前复用该中间件，而不是只相信 header。官方特别说明 Node adapter 下的连接行为仍需实际检验，不能用文档代替已安装版本的测试。[官方说明](https://hono.dev/docs/middleware/builtin/body-limit)

## 证据边界

官方来源于本日回读；实现测试与真实样例记录在 Wiki 013。技术上限仅为防护，不是题材配额；两个合成模型成功样例不足以证明任意题材、最大输入或所有供应商均稳定。包版本／渲染策略变更后应重跑允许列表、深度／大小回退及浏览器操作验证。
