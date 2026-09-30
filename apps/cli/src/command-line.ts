import { CliError } from './client.js'

type CommandDefinition = {
  syntax: string
  input: string
  example: string
  effects: string
  flags: readonly string[]
  positionals: readonly [number, number]
  required?: readonly string[]
  exactlyOne?: readonly [string, string]
}

const commands: Record<string, CommandDefinition> = {
  'mark-bad-example': { positionals: [1, 1], flags: ['file'], required: ['file'], syntax: 'mark-bad-example <workId> --file <f>', input: 'JSON: {requestId:<UUID>,chapter,sourceArtifactId,sourceVersion,sourceHash:<SHA256>,start,end,text,note?}，UTF-16选段位置，绑定已保存正文。', example: 'a4n mark-bad-example work-id --file sample.json', effects: '手工采集，无模型调用；保留原请求及基线，unknown先按id读取，仅明确重试同一文件。' },
  'bad-examples': { positionals: [1, 1], flags: ['chapter', 'after'], syntax: 'bad-examples <workId> [--chapter <n>] [--after <cursor>]', input: '正安全整数chapter/after；每页50，nextCursor可继续读取。', example: 'a4n bad-examples work-id --chapter 1', effects: '只读历史样本快照，不重定位当前正文。' },
  'bad-example': { positionals: [2, 2], flags: [], syntax: 'bad-example <workId> <sampleId>', input: '采集请求UUID即sampleId。', example: 'a4n bad-example work-id 00000000-0000-4000-8000-000000000001', effects: '只读原请求回执；404不证明先前未知写入不会稍后完成。' },
  'agent-config': { positionals: [1, 1], flags: [], syntax: 'agent-config <workId>', input: '作品配置、文件和六节点实际配置。', example: 'a4n agent-config work-id', effects: '只读；不返回凭据，不生成。' },
  'save-agent-config': { positionals: [1, 1], flags: ['file'], required: ['file'], syntax: 'save-agent-config <workId> --file <f>', input: '严格UTF-8 JSON: {requestId:<UUID>,expectedRevision:0,document:{preferences:{style?,genre?,payoff?},defaults:{model?,systemPromptRef?,skills?,tools:[],thinking?,temperature?,topP?,directionCount?},steps:{caption?,creative?,outline?,setting?,beat?,prose?}}。省略继承；数组替换，null清Prompt。', example: 'a4n save-agent-config work-id --file config.json', effects: '只影响未来操作；不调用模型。保留冻结请求，不替换版本、不自动重发；unknown可明确重试原文件。' },
  'upload-skill': { positionals: [1, 1], flags: ['file', 'request-id'], required: ['file', 'request-id'], syntax: 'upload-skill <workId> --file <SKILL.md> --request-id <UUID>', input: '32KiB以内严格UTF-8 SKILL.md，name/description frontmatter和正文必需；request-id原样保留。', example: 'a4n upload-skill work-id --file SKILL.md --request-id 00000000-0000-4000-8000-000000000001', effects: '保存不可变版本文件，返回id；选入配置才作用于未来生成。不执行脚本或工具；不自动重放。' },
  'upload-prompt': { positionals: [1, 1], flags: ['file', 'request-id'], required: ['file', 'request-id'], syntax: 'upload-prompt <workId> --file <f> --request-id <UUID>', input: '有界UTF-8作者写作指导；服务包装为SKILL.md，文件总长≤32KiB。', example: 'a4n upload-prompt work-id --file prompt.md --request-id 00000000-0000-4000-8000-000000000002', effects: '保存版本文件，选入systemPromptRef后生效，不替换内置任务契约；不自动重放。' },
  'get-agent-file': { positionals: [2, 2], flags: [], syntax: 'get-agent-file <workId> <fileId>', input: '同作品的受管文件id。', example: 'a4n get-agent-file work-id 00000000-0000-4000-8000-000000000001', effects: '显式只读文件全文和hash；没有模型调用。' },
  list: { positionals: [0, 0], flags: [],
    syntax: 'list',
    input: '无需作品 ID。',
    example: 'a4n list',
    effects: '只读作品列表。',
  },
  config: { positionals: [0, 0], flags: [],
    syntax: 'config',
    input: '无需参数；返回公开运行模式。',
    example: 'a4n config',
    effects: '只读，不返回密钥。',
  },
  create: { exactlyOne: ['seed', 'seed-file'], positionals: [0, 0], flags: ['seed', 'seed-file', 'title'],
    syntax: 'create --seed <text> | --seed-file <f> [--title <t>]',
    input: '--seed 与 --seed-file 恰好一个；文件为 UTF-8 原始素材。',
    example: 'a4n create --seed-file seed.txt --title 故事',
    effects: '创建作品，不调用模型。',
  },
  get: { positionals: [1, 1], flags: ['kind', 'chapter'],
    syntax: 'get <workId> [--kind caption|creative|outline|setting|beat|prose] [--chapter <n>]',
    input: '省略 kind 返回作品快照及章节目录；beat/prose 必须给正安全整数 chapter，其他 kind 不带 chapter。',
    example: 'a4n get work-id --kind beat --chapter 1',
    effects: '只读当前产物和允许动作。',
  },
  'run-step': { exactlyOne: ['input-file', 'seed-file'], positionals: [1, 1], flags: ['input-file', 'seed-file', 'system-prompt-file', 'config-file', 'thinking', 'temperature', 'top-p'],
    syntax: 'run-step <node> --input-file <f> | --seed-file <f> [--system-prompt-file <sp>] [--config-file <f>] [--thinking on|off] [--temperature 0..1] [--top-p 0..1]',
    input: 'node: caption|creative|outline|setting|beat|prose。input-file: {"seed":"素材","upstream":{...}}；Beat/Prose 另需正安全整数 chapter，chapter>1 必须提供 upstream.previousChapter={chapter:当前章号-1,beat:<完整章纲>,prose:{text:<前章最终正文>}}，首章不提供。Beat另需outline/setting，Prose另需beat/setting。config-file 仅接受 model/directionCount/thinking/temperature/topP，flags 按字段覆盖；top-p 必须大于 0，不支持 --top-k。',
    example: 'a4n run-step caption --seed-file seed.txt --thinking off',
    effects: '启动本地 worker，真实调用已配置 provider；不写作品。无需启动作品服务，不支持 --url。',
  },
  advance: { positionals: [1, 1], flags: [],
    syntax: 'advance <workId>',
    input: '推进到下一人工关卡；默认等待 1820000 ms。',
    example: 'a4n advance work-id',
    effects: '可能调用模型并写入产物；HTTP 200 的 kind:failed 仍 exit 0，必须检查 kind。',
  },
  'start-chapter': { required: ['file'], positionals: [1, 1], flags: ['file'],
    syntax: 'start-chapter <workId> --file <f>',
    input: 'UTF-8 JSON 文件≤1 MiB: {"chapter":2,"expectedPreviousProseId":"...","expectedPreviousProseVersion":3}；目标章号为≥2的安全整数，前章正文须已通过，基线取实际读取版本。',
    example: 'a4n start-chapter work-id --file next-chapter.json',
    effects: '显式生成目标章章纲并停在关卡；不自动通过或继续下一章，不替换文件基线、不自动重复POST。结果未知先get回读；HTTP 200 kind:failed仍exit 0，必须检查kind。',
  },
  select: { positionals: [1, 2], flags: [],
    syntax: 'select <workId> [directionId]',
    input: '省略 directionId 选第一个；自动读取当前 head 版本。',
    example: 'a4n select work-id direction-id',
    effects: '追加只保留选定方向的 approved 版本。',
  },
  'save-outline': { required: ['file'], positionals: [1, 1], flags: ['file'],
    syntax: 'save-outline <workId> --file <f>',
    input: '文件为大纲 content JSON：{"arcs":[...]}；命令自动读取当前 head 版本。',
    example: 'a4n save-outline work-id --file outline.json',
    effects: '追加 pending 大纲版本；不自动通过。',
  },
  approve: { positionals: [2, 2], flags: [],
    syntax: 'approve <workId> <kind>',
    input: '例如 outline；creative 需 select，setting/beat/prose 需专用完整内容命令。',
    example: 'a4n approve work-id outline',
    effects: '通过服务器当前产物。pending 和 allowedActions 不等于作者授权。',
  },
  'approve-setting': { required: ['file'], positionals: [1, 1], flags: ['file'],
    syntax: 'approve-setting <workId> --file <f>',
    input: '文件: {"content":<完整设定>,"expectedHeadVersion":1}；不替换为最新版本。',
    example: 'a4n approve-setting work-id --file setting-request.json',
    effects: '同版本定稿；结果未知时最多回读一次，不自动重复写入。',
  },
  'approve-beat': { required: ['file'], positionals: [1, 1], flags: ['file'],
    syntax: 'approve-beat <workId> --file <f>',
    input: '文件: {"chapter":1,"expectedArtifactId":"...","expectedHeadVersion":1,"content":<完整章纲>}。',
    example: 'a4n approve-beat work-id --file beat-request.json',
    effects: '同版本定稿；通过后只读，不生成正文；未知时最多回读一次。',
  },
  'regenerate-beat': { required: ['file'], positionals: [1, 1], flags: ['file'],
    syntax: 'regenerate-beat <workId> --file <f>',
    input: '文件: {"chapter":1,"expectedArtifactId":"...","expectedHeadVersion":1,"content":<章纲草稿>,"instructions":"修改意见"}；草稿可未填完，意见可空。',
    example: 'a4n regenerate-beat work-id --file beat-request.json',
    effects: '调用模型并追加 pending 章纲；结果未知时最多回读一次，不自动重发。',
  },
  'save-prose': { required: ['file'], positionals: [1, 1], flags: ['file'],
    syntax: 'save-prose <workId> --file <f>',
    input: '文件: {"chapter":1,"expectedArtifactId":"...","expectedHeadVersion":1,"expectedHumanStatus":"pending","content":{"text":"当前编辑正文"}}；expectedHumanStatus 与读取基线一致（pending 或 approved）。pending 正文可空，approved 正文不可空。',
    example: 'a4n save-prose work-id --file prose-request.json',
    effects: '追加正文版本并保留当前 pending/approved 状态；不调用模型、不替换文件基线。未知时最多回读一次，不自动重发。',
  },
  'approve-prose': { required: ['file'], positionals: [1, 1], flags: ['file'],
    syntax: 'approve-prose <workId> --file <f>',
    input: '文件: {"chapter":1,"expectedArtifactId":"...","expectedHeadVersion":1,"content":{"text":"完整正文"}}。',
    example: 'a4n approve-prose work-id --file prose-request.json',
    effects: '同版本定稿，本章完成；通过后可用 save-prose 编辑且保留 approved，不自动生成下一章。未知时最多回读一次，不自动重发。',
  },
  'regenerate-prose': { required: ['file'], positionals: [1, 1], flags: ['file'],
    syntax: 'regenerate-prose <workId> --file <f>',
    input: '文件: {"chapter":1,"expectedArtifactId":"...","expectedHeadVersion":1,"content":{"text":"当前编辑正文"},"instructions":"修改意见"}；正文和意见可空。',
    example: 'a4n regenerate-prose work-id --file prose-request.json',
    effects: '调用模型并追加 pending 正文，保持章纲不变；未知时最多回读一次，不自动重发。保留请求文件。',
  },
  logs: { positionals: [1, 1], flags: ['request-id', 'attempt-id'],
    syntax: 'logs <workId> [--request-id <id>] [--attempt-id <id>]',
    input: 'request-id 为 UUID；过滤当前进程保留的诊断窗口。',
    example: 'a4n logs work-id',
    effects: '只读诊断；空日志不能证明命令没有执行。',
  },
  smoke: { exactlyOne: ['seed', 'seed-file'], positionals: [0, 0], flags: ['seed', 'seed-file', 'title'],
    syntax: 'smoke --seed <text> | --seed-file <f> [--title <t>]',
    input: '--seed 与 --seed-file 恰好一个；使用合成素材。',
    example: 'a4n smoke --seed-file seed.txt',
    effects: '创建作品、调用生成并自动选定/编辑/通过到第一章正文通过；失败非零退出，不自动重试。仅用于已授权的探针。',
  },
}

export function parseCommandLine(argv: string[]): { _: string[]; flags: Record<string, string> } {
  const positional: string[] = []
  const flags: Record<string, string> = Object.create(null)
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token === '--') continue // pnpm's separator, not an escape for unknown options.
    if (!token.startsWith('-')) {
      positional.push(token)
      continue
    }
    if (!token.startsWith('--')) throw new CliError('Unknown command option; use --help', 'usage')
    const equals = token.indexOf('=')
    const key = token.slice(2, equals === -1 ? undefined : equals)
    if (Object.hasOwn(flags, key)) throw new CliError('Duplicate command option; use --help', 'usage')
    const value = equals === -1 ? argv[++i] : token.slice(equals + 1)
    // Signed numeric controls still reach their existing semantic validators.
    if (value === undefined || value.trim() === '' || (equals === -1 && value.startsWith('-') && !/^-(?:\d|\.\d)/.test(value))) {
      throw new CliError('Command option requires a non-empty value; use --help', 'usage')
    }
    flags[key] = value
  }
  const command = positional[0]
  if (!command || !Object.hasOwn(commands, command)) throw new CliError('Unknown or missing command; use --help', 'usage')
  const definition = commands[command]!
  const allowed = [...definition.flags, 'timeout-ms', ...(command === 'run-step' ? [] : ['url'])]
  for (const key of Object.keys(flags)) {
    if (command === 'run-step' && key === 'top-k') throw new CliError('--top-k is not supported by the documented LongCat-2.0 API; use --top-p instead', 'usage')
    if (!allowed.includes(key)) throw new CliError('Unknown command option; use --help', 'usage')
  }
  const [minimum, maximum] = definition.positionals
  const args = positional.slice(1)
  if (args.length < minimum || args.length > maximum || args.some(value => value.trim() === '')) {
    throw new CliError('Invalid command arguments; use --help', 'usage')
  }
  const { required = [], exactlyOne } = definition
  if (required.some(key => flags[key] === undefined) || (exactlyOne && exactlyOne.filter(key => flags[key] !== undefined).length !== 1)) {
    throw new CliError('Missing or mutually exclusive command inputs; use --help', 'usage')
  }
  return { _: positional, flags }
}

function commandForHelp(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token === '--' || token === '--help' || token === '-h') continue
    if (token.startsWith('--')) {
      if (!token.includes('=') && argv[i + 1] && !argv[i + 1]!.startsWith('-')) i++
      continue
    }
    if (token.startsWith('-')) continue
    return Object.hasOwn(commands, token) ? token : undefined
  }
}

export function helpFor(argv: string[]): string {
  const command = commandForHelp(argv)
  const definition = command ? commands[command] : undefined
  const timeout = '--timeout-ms <milliseconds> 覆盖请求期限；普通 300000，advance 1820000，start-chapter 920000，Beat/Prose 通过 30000、Prose 保存 30000、再生 920000/回读 10000，run-step 920000。'
  const flags = `${command === 'run-step' ? '' : '--url <baseUrl> 覆盖作品服务地址（默认 A4N_BASE_URL 或 http://localhost:8787）。\n'}${timeout}`
  const convention = '--help / -h 是零副作用帮助，任意独立 token 优先；字面值请用 --seed=--help。帮助输出 stderr，正常结果 stdout 为 JSON。'
  if (definition) return `用法: a4n ${definition.syntax}\n输入: ${definition.input}\n示例: ${definition.example}\n副作用: ${definition.effects}\n选项: ${flags}\n${convention}`
  return `agent4novel cli — 命令:\n${Object.values(commands).map(d => `  ${d.syntax}`).join('\n')}\n${flags}\nrun-step 不支持 --url，不支持 --top-k；用 <command> --help 查看输入形状、示例和副作用。\nadvance 的 HTTP 200 kind:failed 仍 exit 0；smoke 遇 failed 非零退出。pending 和 allowedActions 不等于作者授权。\n${convention}`
}
