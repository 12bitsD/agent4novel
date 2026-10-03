# #35 字体选型研究与三案比较

研究日期：2026-10-03。范围：黑白灰写作工具的像素字体与正文阅读字体。初始研究只取得官方实验文件，未安装依赖或读取凭据。视觉方案 A/B/C、首轮像素字体 F1/F2/F3 与第二轮阅读策略 R1/R2/R3 是三组选择，不能混用编号。

当前选择 F1 的 Fusion Pixel 12px proportional zh-Hans，只用于品牌；正文采用系统中文宋体与拉丁衬线字体，书名、界面、输入框、操作按钮和详细状态采用系统无衬线字体。第二轮不新增大型中文正文字库，不从外部 CDN 加载字体。分层字体和下文排版参数是本项目的设计判断；实际产品字体加载、回退与阅读验收从 [Wiki035](../wiki/035-frontend-design.md#测试与验证) 读取。

## 首轮像素字体比较（F1/F2/F3）

首轮建议 F1 用于品牌和短标题，正文与重要操作使用常规字体，以保留中文像素风格并控制识别成本。下表保留当时的比较、推荐理由与备选边界；第二轮将实际像素使用范围进一步收窄到品牌，见后文收敛结果。

| 方案 | 已验证事实 | 项目中的用途与取舍 |
|---|---|---|
| F1：Fusion Pixel 12px proportional zh-Hans + 系统中文字体 | 官方 2026.09.25 版本。12px 比例模式共 36,999 字符；GB2312 一级汉字 3,755/3,755，二级 2,865/3,008。所取得中文 WOFF2 为 666,264 B，约 651 KiB。字体采用 OFL 1.1。[官方仓库](https://github.com/TakWolf/fusion-pixel-font)、[固定版本字符统计](https://github.com/TakWolf/fusion-pixel-font/blob/2026.09.25/docs/info-12px-proportional.md)、[固定 release](https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.09.25) | 推荐。品牌、页级标题可有中文像素风格。缺字仍会回退；不能声明中文全覆盖。一级字覆盖优于 F2。完整文件体积可以接受，但不应让所有界面依赖字体下载。 |
| F2：Ark Pixel 12px proportional zh-Hans + 系统中文字体 | 官方同版 2026.09.25。共 24,869 字符；GB2312 一级 3,583/3,755，二级 2,696/3,008。取得中文 WOFF2 为 552,028 B，约 539 KiB。OFL 1.1。当前官方 README 明示缺大量字符；16px 已废弃，2026.09.01 是最后包含该尺寸的构建。[官方仓库](https://github.com/TakWolf/ark-pixel-font)、[固定版本字符统计](https://github.com/TakWolf/ark-pixel-font/blob/2026.09.25/docs/info-12px-proportional.md)、[固定 release](https://github.com/TakWolf/ark-pixel-font/releases/tag/2026.09.25) | 不优先。比 F1 小约 112 KiB，但更容易发生中文标题混用回退字体。只做固定短标志也可用，最终必须逐字验证。 |
| F3：NeoDunggeunmo 英文像素标志 + 系统中文字体 | 官方 v1.601 于 2026-03-18 发布。普通 NeoDGM WOFF2 为 44,352 B，约 43 KiB，下载文件 SHA256 与官方 release 一致。官方使用指南要求屏幕文字使用 16px 的整数倍，避免伪粗体和斜体。OFL 1.1。[官方 release](https://github.com/neodgm/neodgm/releases/tag/v1.601)、[官方使用指南](https://neodgm.dalgona.dev/guides.html)、[官方英文说明](https://github.com/neodgm/neodgm/blob/main/README.en.md) | 最轻量的替代方案。仅品牌文字 `AGENT4NOVEL` 和短英文编号使用。中文全部用系统字体。官方定位以韩文字体为主，本研究未验证中文覆盖，不把它用作中文像素字体。 |

## 授权与分发

F1、F2 的字体许可证与构建程序 MIT 许可证是两回事。字体分发按 OFL 1.1 处理。OFL 允许字体随商业软件嵌入和分发，要求保留版权声明和许可证全文，不允许单独出售字体；修改版本还需检查保留字体名条件。[OFL 官方文本](https://openfontlicense.org/open-font-license-official-text/)

实施建议是使用原版二进制，不重命名字体内部 family，不生成子集。这样省去变体命名、字符清单维护和新增构建依赖。F1 的发布包除了根 `OFL.txt`，还包含 `LICENSES/ark-pixel/OFL.txt`、`LICENSES/cubic-11/OFL.txt`、`LICENSES/galmuri/LICENSE.txt`；这些原文件都已保存在实验目录，正式分发应一起保留。[Fusion 固定版本许可证](https://github.com/TakWolf/fusion-pixel-font/blob/2026.09.25/LICENSE-OFL)

F3 的固定许可证声明了 `NeoDunggeunmo` 等保留字体名。使用原版文件并随软件保存固定版本许可证和版权声明，不收取字体单独费用。[NeoDGM 固定版本许可证](https://github.com/neodgm/neodgm/blob/v1.601/LICENSE.txt)、[官方嵌入说明](https://neodgm.dalgona.dev/embedding_fonts.html)

## 渲染与阅读

F1、F2 的官方构建配置以 12 为基本字体网格。标题建议 24px 或 36px。整数倍是由该网格作出的设计推断；不是“所有浏览器和缩放级别完全无抗锯齿”的保证。不要把 12px 中文用于长篇正文或重要控件。不要通过 CSS transform 缩放像素标题。不要给像素字使用伪粗体、斜体或负字距。[Fusion 固定配置](https://github.com/TakWolf/fusion-pixel-font/blob/2026.09.25/assets/configs/fonts/font-12px.yaml)、[Ark 固定配置](https://github.com/TakWolf/ark-pixel-font/blob/2026.09.25/assets/configs/fonts/font-12px.yaml)

F3 使用官方建议的 16px、32px、48px。品牌和编号的像素字体只作为风格，不承担保存、生成、错误等唯一状态表达。动态数字使用 `font-variant-numeric: tabular-nums`；是否有相应 OpenType 特性不作为功能前提，等宽数字仍需在 mockup 检查。

首轮正文建议为 18px、1.8 行高的常规宋体/衬线中文栈，表单和操作建议为至少 14px 的系统无衬线中文栈；首版实际实现为宽屏 19px、窄屏 18px、阅读行高 1.95、编辑行高 1.9。第二轮已替换这些现行参数，见后文阅读策略与实现边界。两轮参数均为项目设计判断，必须在实际最小目标屏和最大目标屏看图验证，不能用字体官方字符统计代替可读性验收。

## 本地加载与失败回退

最终字体放在项目本地静态资产并随构建输出。运行时不引用 GitHub、jsDelivr、Google Fonts 或其他外部 CDN。字体研发时联网取得文件与软件运行时联网加载字体是两个阶段。

正式分发目录为 `apps/web/public/fonts/`，文件保持原二进制；许可证目录为 `apps/web/public/fonts/licenses/`。CSS 的公开路径如下，品牌字体别名只作用于样式，不修改字体内部 family。以下示例对应第二轮候选，实际样式以 [styles.css](../../apps/web/src/styles.css) 为准：

```css
@font-face {
  font-family: "A4N Pixel";
  src: url("/fonts/fusion-pixel-12px-proportional-zh_hans.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
:root {
  --font-ui: system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --font-reading: "Iowan Old Style", "Palatino Linotype", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", "SimSun", serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --prose-size: 20px;
  --prose-leading: 1.85;
  --reading-width: 36em;
}
.brand {
  font: 400 24px/1 "A4N Pixel", var(--font-mono);
  font-synthesis: none;
}
.prose-reading {
  font: 400 var(--prose-size)/var(--prose-leading) var(--font-reading);
  max-width: var(--reading-width);
  margin-inline: auto;
}
@media (max-width: 700px) {
  :root { --prose-size: 18px; }
}
```

字体不存在、下载失败或缺字时用后续系统字体回退。正文独立于像素字体，生成、保存和阅读不等待它。`swap` 在字体成功读取之前显示回退字，之后切换；失败时仍按字体栈显示。这是 CSS 规范行为，项目中的实际加载和失败回退结果另看 [Wiki035](../wiki/035-frontend-design.md#测试与验证)。[CSS Fonts Module Level 4：font-display](https://drafts.csswg.org/css-fonts-4/#font-display-desc)

## 文件与验证结果

| 文件 | 大小 | SHA256 |
|---|---:|---|
| `/tmp/a4n-35-evidence/font-research/fusion-pixel-font/fusion-pixel-12px-proportional-zh_hans.otf.woff2` | 666,264 B | `0ebd99e6f1e9b650a793a3f759c1c3dfa99f0c5b6502e78569b48ddb43767e40` |
| `/tmp/a4n-35-evidence/font-research/ark-pixel-font/ark-pixel-12px-proportional-zh_hans.otf.woff2` | 552,028 B | `2525091999215101d0d9ad1ec13595dfdbb7f182461c01aa7c72b2c6504c2da3` |
| `/tmp/a4n-35-evidence/font-research/neodgm.woff2` | 44,352 B | `0c0ca9cd73f692a5da5d7fb39737902aa9ea312537237779972a9d81ef0a33bf` |

官方 release API 回读保存于同目录的 `fusion-pixel-font-release.json`、`ark-pixel-font-release.json`、`neodgm-release.json`。F1/F2 发布包和保留层级的许可证也在同目录。`download-manifest.json` 记录实际解包大小和 SHA256。F1/F2 的单文件 SHA256 是本机计算，尚无逐文件官方校验对照；F3 的 SHA256 已与官方 release 对照相同。文件成功取得不等于浏览器字体加载验证通过。

本机和打包 Python 均未提供 FontTools。未为研究安装依赖，未运行二进制 cmap 检查。中文覆盖数字来自固定版本官方统计。需要在 mockup 中验证实际标题、浏览器 `document.fonts`、缺字回退、100%/200% 缩放和字体文件请求失败后仍可阅读。

## 收敛结果

选择 F1，第二轮只用在品牌；正文和操作采用下文 R2 的分层系统字体。用户选择视觉 B/C 组合，不等于选择字体 F2/F3。首轮采用 F1 的理由仍保留：相比 F2 的缺字风险和 F3 的英文品牌限制，F1 更适合中文短标题。第二轮将动态长书名和页级标题改为常规无衬线字体，以减少不规则字形与长标题换行的干扰；这项判断不改变 F1 的文件、许可证或回退方式。不得因为视觉硬边扩大像素字体到长文、表单或状态词。F2/F3 保留为研究备选。

正式文件为 [Fusion Pixel WOFF2](../../apps/web/public/fonts/fusion-pixel-12px-proportional-zh_hans.woff2)。2026-10-03 回读分发文件为 666,264 B，SHA256 与上表 F1 相同。分发保留 [根 OFL](../../apps/web/public/fonts/licenses/OFL.txt) 及 [Ark Pixel OFL](../../apps/web/public/fonts/licenses/upstream/ark-pixel/OFL.txt)、[Cubic 11 OFL](../../apps/web/public/fonts/licenses/upstream/cubic-11/OFL.txt)、[Galmuri 许可证](../../apps/web/public/fonts/licenses/upstream/galmuri/LICENSE.txt)。浏览器验收由 Wiki035 记录；资产完整不等于字体加载或阅读验收通过。

## 第二轮阅读策略（R1/R2/R3）

**触发与比较范围**：用户在首版界面后授权“导航页和重复说明改进掉，然后字体这些你看着怎么优化更有质感一些”。三种策略均保留同一 F1 品牌字体，只比较正文与界面的搭配、分发成本和回退边界。

| 策略 | 字体与分发方式 | 项目判断与边界 |
|---|---|---|
| R1：正文与界面统一系统无衬线字体 | 正文和 UI 都使用 `--font-ui`，不增加正文字体资产。 | 实现与回退最简单；长篇与操作区字形相近，需要更多依靠字号、间距和边界建立层次。当前希望正文具有独立的阅读感，因此不采用。 |
| R2：正文系统衬线字体 + UI 系统无衬线字体 + 像素品牌 | 中文优先使用可用的宋体类字体，拉丁文字使用 Iowan Old Style、Palatino Linotype 等衬线字体；UI 使用系统无衬线栈。正文字体均来自本机，末尾保留 `serif`/`sans-serif` 通用回退。 | 本轮采用。用字形和行宽区分阅读与操作，保留像素品牌，同时不增加大型中文字体下载。不同系统的字形、度量与可用字体会不同，不能承诺跨平台完全一致或覆盖所有字符。 |
| R3：完整本地正文字库 + UI 系统无衬线字体 + 像素品牌 | 随应用分发固定版本的思源宋体或 Noto Serif CJK，并配置本地 `@font-face`。思源宋体官方提供 OTF、字库集合及可变 OTF/TTF/WOFF2 等部署格式；选择具体资源需按官方配置说明核对。[思源宋体官方仓库](https://github.com/adobe-fonts/source-han-serif)、[Noto CJK 官方仓库](https://github.com/notofonts/noto-cjk) | 可减少所选字符范围内的系统差异；需要额外维护文件版本、许可证、字符覆盖、缓存和加载失败验证。本轮未取得或测量这类完整正文资产，不填写推测体积，也不引入新的分发与构建工作。 |

**选择依据**：R2 的阅读与操作分层最符合当前正文为主角的方向；系统字体差异可接受。CSS 按字体列表与字符覆盖选择可用字形，通用字体族提供最终回退，因此列出一个名字不代表用户设备一定有该字体，也不代表整段文字只由一个字体渲染。[CSS Fonts：字体列表与匹配](https://drafts.csswg.org/css-fonts-4/#font-family-prop)

**排版参数**：桌面正文 20px、手机正文 18px，阅读与编辑行高统一为 1.85。阅读列最大 36em，在桌面字号下约为 720px；手机正文区域左右各 20px。主要操作为 14px，保存与辅助说明以 12–13px 为主。字号、行高、行宽和边距均为本项目的设计选择，不是通用可读性标准、无障碍合规结论或字体上游承诺。

**文本边界**：正文继续保存和显示原始纯文本，保留已有换行；阅读视图仅按可用宽度自动折行，不改写段落数据。700px 及以下的章节目录通过原生 `details` 默认折叠，目录和正文各保留一份；正文页头收拢章号、保存提示、编辑和下一章动作。布局变化与参数是否适合实际阅读，须由第二轮亮暗主题、手机与桌面验收确认。

**上下文处理**：`preserve` 首轮 F1/F2/F3 的比较理由、下载记录、许可证与字体请求失败实验；`replace` 当前字体使用范围、CSS 示例和排版参数；`append` 本节三种阅读策略和选择依据。首轮文件取得与浏览器结果保留其原验证边界，不能作为第二轮候选已通过的证据。

## 实现与验证边界

第二轮候选的 [styles.css](../../apps/web/src/styles.css) 已使用 R2 字体栈、桌面 20px/手机 18px、统一 1.85 行高和 36em 最大阅读列。像素字体仅作用于品牌，继续使用本地 `@font-face`、`font-display: swap` 和常规字体回退；正文不依赖像素字体请求。

2026-10-03 在隔离的演示服务中验证字体请求失败：浏览器 `document.fonts.check` 返回 false，品牌回退为常规字体，书架标题、作品文字和操作仍可读；随后恢复字体资产。原截图在 `/tmp/a4n-35-evidence/font-fallback.jpg`，完整步骤和最终产品验收从 Wiki035 接手。这项结果不等于全部中文字符、全部平台或 200% 缩放都已验证。README 中的亮暗截图来自实际演示作品，正文为经页面编辑保存的示例，不是上述字体官方样例或真实模型质量证明。

第二轮已在实际演示作品上验证2181字符正文：桌面20px、37px行高、720px宽；手机18px、33.3px行高、335px宽。375px与1440px页面无横向溢出，手机目录默认折叠并可展开切章，正文页头续章动作与配置保护实际通过。README已使用对应实际第二轮亮暗截图，完整证据见Wiki035。系统字体的跨平台一致性、全部字符与200%浏览器缩放仍未验证。

分发许可证保留版权与全部条文；Cubic 11 的 OFL 文件仅移除一处上游行尾空格，以通过仓库 diff 空白检查。字体二进制不修改。
