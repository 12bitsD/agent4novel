# LLM Provider Strategy — Research Notes (decision support)

> **Scope**: how agent4novel (local-first TS web app, already on Vercel AI SDK v7 per `docs/adr/0001-orchestration-ai-sdk-thin-workflow.md`) should build a "universal client": upstream step code calls one uniform interface and never knows which LLM provider serves it. DeepSeek is the first provider; OpenAI is the next.
> **Method**: every claim below was checked against a primary source (official provider docs, package README, published package types/source) fetched on 2026-08-24. URLs are inline. Claims I could not verify from a primary source are marked "unverified — do not rely".
> **Audience**: decision-support for `/to-spec` → ADRs, not an essay.
> **Status**: this is the historical DeepSeek-first selection record. LongCat-specific evidence is in [`longcat-provider-config.md`](./longcat-provider-config.md); the current implementation HOW and status live only in [wiki 016](../wiki/016-model-runtime-provider-config.md).

---

## Recommendation (TL;DR)

1. **Use the first-party AI SDK provider `@ai-sdk/deepseek`** — it exists, it is the officially documented DeepSeek route, and it needs **no baseURL override and no OpenAI-SDK indirection**. Install `npm i @ai-sdk/deepseek` (docs: [DeepSeek Provider, ai-sdk.dev](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek); package: [@ai-sdk/deepseek on npm](https://www.npmjs.com/package/@ai-sdk/deepseek)).
   - **Env var**: `DEEPSEEK_API_KEY` (this is the exact name both DeepSeek's own docs and the AI SDK provider use — [DeepSeek Your First API Call](https://api-docs.deepseek.com/), [DeepSeek provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)).
   - **Model string**: the provider accepts any string at runtime; DeepSeek's current docs name `deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp` ([api-docs.deepseek.com](https://api-docs.deepseek.com/)), while AI SDK examples/types use `deepseek-chat` / `deepseek-reasoner` / `deepseek-v4-flash-vision-exp` ([provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek), [package types](https://cdn.jsdelivr.net/npm/@ai-sdk/deepseek@3.0.31/dist/index.d.ts)). Pick the string your account accepts and verify once at integration — see Unverified.
   - **baseURL**: default is already `https://api.deepseek.com`; no override needed ([provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)).
2. **The universal client = `createProviderRegistry` (+ `customProvider` for per-provider settings/aliases) from `ai`**. Upstream step code only ever sees `registry.languageModel('deepseek:…')` — a string id — and never imports a provider package ([Provider & Model Management, ai-sdk.dev](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)). DeepSeek today, OpenAI later, is just a second registry entry (`openai:gpt-…`).
3. **Do NOT build the universal client on the raw OpenAI SDK `baseURL` override or on per-provider SDKs.** The OpenAI-SDK route is real and officially blessed by DeepSeek (their docs ship a `new OpenAI({ baseURL: 'https://api.deepseek.com' })` example — [api-docs.deepseek.com](https://api-docs.deepseek.com/)), but it is OpenAI-shaped: DeepSeek-specific knobs (e.g. `thinking`) fall through to `extra_body`, and it does nothing for OpenAI-as-second-provider or non-OpenAI providers. Per-provider SDKs are the worst fit: each has its own surface, and DeepSeek doesn't even publish its own SDK — its docs say to install the OpenAI SDK ([api-docs.deepseek.com](https://api-docs.deepseek.com/)).
4. **Skip the AI SDK's hosted AI Gateway (`gateway` from `ai`, plain strings like `'openai/gpt-5.4'`)** for this app: it is a Vercel-hosted service (`https://ai-gateway.vercel.sh`, Vercel dashboard/access tokens, automatic auth only when deployed on Vercel) — a mismatch for a local-first app ([AI Gateway Provider, ai-sdk.dev](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)).
5. **Other mainstream providers are also first-party in AI SDK v7** (Moonshot: `@ai-sdk/moonshotai`; Qwen/DashScope via Alibaba: `@ai-sdk/alibaba`; MiniMax: `@ai-sdk/minimax`) — see Q4. So the registry can grow without any new indirection layer.

### Exact setup

```bash
npm i @ai-sdk/deepseek      # DeepSeek first-party provider (ai SDK core is already in the stack)
```

```ts
// src/llm/registry.ts — the universal client; upstream code imports ONLY this module
import { deepSeek } from '@ai-sdk/deepseek'; // canonical export; `deepseek` also aliased
import { createProviderRegistry } from 'ai';

export const registry = createProviderRegistry({
  deepseek: deepSeek,          // reads DEEPSEEK_API_KEY; baseURL defaults to https://api.deepseek.com
  // openai: openai,           // add later: import { openai } from '@ai-sdk/openai'; OPENAI_API_KEY
});
```

```ts
// upstream step code — provider-agnostic, only ever sees a string id
import { generateText } from 'ai';
import { registry } from '../llm/registry';

const { text } = await generateText({
  model: registry.languageModel('deepseek:deepseek-chat'), // swap provider = change prefix, nothing else
  prompt: '…',
});
```

Switching provider = change the `deepseek:` prefix (or the registry entry), one place. Upstream code perceives nothing.

---

## Q1 — Can the official OpenAI SDK (openai npm package) call DeepSeek directly?

**Yes.** The mechanism is a constructor `baseURL` override, and DeepSeek officially endorses it.

- DeepSeek's own "Your First API Call" page states: *"The DeepSeek API uses an API format compatible with OpenAI/Anthropic. By modifying the configuration, you can use the OpenAI/Anthropic SDK or softwares compatible with the OpenAI/Anthropic API to access the DeepSeek API."* Its config table gives `base_url (OpenAI) = https://api.deepseek.com` and `api_key = DEEPSEEK_API_KEY` ([api-docs.deepseek.com](https://api-docs.deepseek.com/)).
- The same page's Node.js example is literally the OpenAI SDK with a baseURL override: `npm install openai` → `new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: process.env.DEEPSEEK_API_KEY })` → `openai.chat.completions.create({ model: 'deepseek-v4-pro', … })` ([api-docs.deepseek.com](https://api-docs.deepseek.com/)). This is first-party proof that the openai package works against DeepSeek.
- The override is a real, documented `openai-node` option. In the source, `ClientOptions` declares `baseURL?: string | null | undefined` with the doc comment *"Override the default base URL for the API"*; the default is `https://api.openai.com/v1`, overridable via `opts.baseURL` **or** the `OPENAI_BASE_URL` env var ([src/client.ts, openai/openai-node](https://github.com/openai/openai-node/blob/master/src/client.ts)). The README's canonical instantiation is `new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })` and shows `baseURL` used explicitly for alternate endpoints ([README, openai/openai-node](https://github.com/openai/openai-node#readme)).

Caveat for the openai-package route: the SDK surface is OpenAI-shaped. DeepSeek-specific request fields are not first-class client options — DeepSeek's own example passes `thinking` via `extra_body` ([api-docs.deepseek.com](https://api-docs.deepseek.com/)), which is exactly the "provider leaks through" smell the universal client is meant to hide.

## Q2 — Does Vercel AI SDK support DeepSeek?

**Yes — first-party provider `@ai-sdk/deepseek`.** The recommended route is that package, not `@ai-sdk/openai-compatible` and not a custom baseURL.

- Docs: [DeepSeek Provider](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek); package latest 3.0.31 as of 2026-08-24 ([npm](https://www.npmjs.com/package/@ai-sdk/deepseek)). The npm README opens with *"The DeepSeek provider for the AI SDK contains language model support for the DeepSeek platform."*
- Exact configuration (all from [the provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)):
  - Package: `@ai-sdk/deepseek` (install: `pnpm add @ai-sdk/deepseek` / `npm i @ai-sdk/deepseek`).
  - Provider instance: default export `deepSeek`, or `createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY ?? '' })`.
  - Env var: `DEEPSEEK_API_KEY` — *"API key … defaults to the DEEPSEEK_API_KEY environment variable."*
  - baseURL: *"The default prefix is `https://api.deepseek.com`"* — no override needed.
  - Model string: `deepSeek('deepseek-chat')`, `.chat('deepseek-chat')`, or `.languageModel('deepseek-chat')`; typed ids in the published dist are `'deepseek-chat' | 'deepseek-reasoner' | 'deepseek-v4-flash-vision-exp' | (string & {})` ([dist/index.d.ts, jsdelivr](https://cdn.jsdelivr.net/npm/@ai-sdk/deepseek@3.0.31/dist/index.d.ts)).
  - DeepSeek-specific options ride in `providerOptions.deepseek`: `thinking: { type: 'adaptive' | 'enabled' | 'disabled' }` and `reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'` ([provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)) — i.e. native DeepSeek features are first-class in AI SDK, unlike the raw OpenAI-SDK route.
- Fallback routes that also exist (use only if you need them):
  - `@ai-sdk/openai-compatible` — `createOpenAICompatible({ name, apiKey, baseURL })` for any provider implementing the OpenAI API ([OpenAI Compatible Providers](https://ai-sdk.dev/providers/ai-sdk-providers/openai-compatible)). The catch: it is a generic adapter with none of DeepSeek's typed options.
  - `@ai-sdk/openai` with a custom `baseURL` — supported, but the docs warn the default factory uses the Responses API and *"If your custom base URL only supports the Chat Completions API, create chat models with `openai.chat('model-id')` instead, or use the OpenAI-compatible provider"* ([OpenAI Provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)). DeepSeek is Chat-Completions-format, so this route needs extra care — one more reason to just use `@ai-sdk/deepseek`.

## Q3 — Which approach best fits "upstream code does not perceive which provider"?

| Approach | How it hides the provider | Primary source |
|---|---|---|
| **AI SDK `createProviderRegistry` + `customProvider`** | Upstream sees only `registry.languageModel('providerId:modelId')` string ids and never imports provider packages; registry mixes providers, custom providers can pre-configure settings/aliases and limit models | [Provider & Model Management, ai-sdk.dev](https://ai-sdk.dev/docs/ai-sdk-core/provider-management) |
| **AI SDK hosted AI Gateway** (`gateway` from `ai`; plain `'openai/gpt-5.4'` strings) | Strongest indirection (no provider packages at all, one auth surface) — but it is Vercel's **hosted** service: default `baseURL https://ai-gateway.vercel.sh`, `AI_GATEWAY_API_KEY` / Vercel access tokens, "automatic authentication when deployed on Vercel", Vercel dashboard pricing/observability | [AI Gateway Provider, ai-sdk.dev](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway) |
| **OpenAI SDK `baseURL` override** | One SDK, but the interface stays OpenAI-shaped: DeepSeek-only fields leak through `extra_body`, and it adds nothing for a second non-OpenAI provider | [api-docs.deepseek.com](https://api-docs.deepseek.com/), [src/client.ts, openai/openai-node](https://github.com/openai/openai-node/blob/master/src/client.ts) |
| **Per-provider SDKs** | No hiding at all — each provider has its own client and shapes; DeepSeek doesn't even publish an SDK (its docs say to install the OpenAI SDK) | [api-docs.deepseek.com](https://api-docs.deepseek.com/) |

**Verdict**: `createProviderRegistry` (+ `customProvider` when we want per-provider default settings/aliases, e.g. a stable `'text'` alias that points at `deepseek-chat` today and `gpt-5.1` tomorrow) is the best fit: it delivers exactly the required property (upstream code only sees string ids), it is local (no hosted dependency, matching the local-first ADR), and it composes with the AI SDK v7 stack already adopted in [ADR 0001](https://github.com/vercel/ai). The hosted AI Gateway is architecturally the "most universal" but is a hosted service — reject for local-first. The OpenAI-SDK baseURL route is a workable fallback if we ever drop the AI SDK, not a first choice.

## Q4 — Other mainstream providers, first-party AI SDK support (one line each)

- **Moonshot AI (Kimi)**: first-party `@ai-sdk/moonshotai`, env `MOONSHOT_API_KEY`, default baseURL `https://api.moonshot.ai/v1`, e.g. `moonshotai('kimi-k3')` ([Moonshot AI Provider](https://ai-sdk.dev/providers/ai-sdk-providers/moonshotai)).
- **Qwen / DashScope (Alibaba)**: first-party `@ai-sdk/alibaba`, env `ALIBABA_API_KEY`, default baseURL `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (DashScope's OpenAI-compatible endpoint), e.g. `alibaba('qwen-plus')` ([Alibaba Provider](https://ai-sdk.dev/providers/ai-sdk-providers/alibaba)). A separate community `Qwen` provider also exists ([community providers](https://ai-sdk.dev/providers/community-providers/qwen)).
- **MiniMax**: first-party `@ai-sdk/minimax`, env `MINIMAX_API_KEY` ([MiniMax Provider](https://ai-sdk.dev/providers/ai-sdk-providers/minimax)).
- **Zhipu AI (Z.AI / GLM)**: **community** provider only, not first-party ([Zhipu community provider](https://ai-sdk.dev/providers/community-providers/zhipu)) — use `@ai-sdk/openai-compatible` against its OpenAI-compatible endpoint if needed.
- Other first-party providers in the same v7 docs sidebar (primary listing): xAI Grok, OpenAI, Azure OpenAI, Anthropic, Google, Google Vertex AI, Amazon Bedrock, Mistral, Groq, Cohere, Fireworks, Together.ai, Cerebras, Perplexity, DeepInfra, Hugging Face, etc. ([AI SDK Providers index](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek) — sidebar on any provider page).
- Anything else that speaks the OpenAI API but has no first-party provider: `@ai-sdk/openai-compatible` covers it ([OpenAI Compatible Providers](https://ai-sdk.dev/providers/ai-sdk-providers/openai-compatible)).

---

## Unverified (do not rely without testing)

- **Exact DeepSeek model string to use at runtime**: DeepSeek's docs (2026-08-24) list `deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp` ([api-docs.deepseek.com](https://api-docs.deepseek.com/)), while AI SDK examples and typed ids use `deepseek-chat` / `deepseek-reasoner` / `deepseek-v4-flash-vision-exp` ([provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek), [dist types](https://cdn.jsdelivr.net/npm/@ai-sdk/deepseek@3.0.31/dist/index.d.ts)). The provider accepts arbitrary strings, so either family may work on a given account — confirm against a live key before wiring it into the registry.
- **`deepSeek` vs `deepseek` export name**: ai-sdk.dev docs use `deepSeek`; the npm README example uses `deepseek`. Published dist types show `deepSeek` as canonical with alias `deepSeek as deepseek`, so both imports are expected to work — unverified against a live install.
- **AI Gateway local (non-Vercel) usage**: docs describe Vercel-hosted operation; using `AI_GATEWAY_API_KEY` outside Vercel is not explicitly documented — treat as hosted-only unless tested.
