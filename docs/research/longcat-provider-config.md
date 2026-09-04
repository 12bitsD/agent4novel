# LongCat 2.0 provider configuration — primary-source notes

> **Scope:** LongCat 2.0 API base URL, authentication, model identifiers, OpenAI compatibility, Chat Completions, Responses API support, and evidence for choosing an adapter.
> **Method:** checked only first-party pages on LongCat's `longcat.chat` domain on 2026-08-29. Documentation research did not read or use a credential. The two independent validations recorded below used a synthetic credential with mocked transport and an ignored local environment file respectively; no credential value is recorded here. Where the official pages disagree or omit a detail, that is called out rather than resolved by a third-party source. Current implementation HOW and product-level status live only in [wiki 016](../wiki/016-model-runtime-provider-config.md).

## Provider-config answer

| Topic | Primary-source finding | Confidence / caveat |
|---|---|---|
| Production root | `https://api.longcat.chat` | Explicit in the [API Overview](https://longcat.chat/platform/docs/APIDocs.html). |
| OpenAI-compatible base for clients that append resource paths | `https://api.longcat.chat/openai/v1` | Explicit in the official [Codex integration](https://longcat.chat/platform/docs/Codex.html) and [CC Switch integration](https://longcat.chat/platform/docs/cc-switch). See the URL-convention caveat below. |
| Authentication | HTTP `Authorization` header with the `Bearer` scheme and a LongCat API credential | Explicit in the [API Overview](https://longcat.chat/platform/docs/APIDocs.html) and endpoint references. |
| Current model ID | `LongCat-2.0` (use the exact spelling and casing shown by LongCat) | The Chat reference says it is the currently supported model, and the [List Models reference](https://longcat.chat/platform/docs/api/models) shows it as the sole item in the example response. |
| OpenAI compatibility | LongCat describes the `/openai/` surface as OpenAI-compatible and designed for the OpenAI Python SDK | Explicit in the [API Overview](https://longcat.chat/platform/docs/APIDocs.html) and [Quick Start](https://longcat.chat/platform/docs/). Treat compatibility as endpoint-specific; the public API reference does not document every OpenAI API resource. |
| Chat Completions | Supported at `POST https://api.longcat.chat/openai/v1/chat/completions` | Directly specified by the [Chat Completions reference](https://longcat.chat/platform/docs/api/chat.html), including streaming and non-streaming text responses. |
| Responses API | Official integration docs affirm native/direct Responses-protocol support with base URL `https://api.longcat.chat/openai/v1` and `wire_api = "responses"` | Explicit support claim in the [CC Switch integration](https://longcat.chat/platform/docs/cc-switch), corroborated by the [Codex integration](https://longcat.chat/platform/docs/Codex.html). However, the current API Overview/navigation has no dedicated Responses endpoint reference or request/response schema. |

## URL convention and recommended value

The first-party documentation uses three related values for different abstraction levels:

- Unified production host: `https://api.longcat.chat` ([API Overview](https://longcat.chat/platform/docs/APIDocs.html)).
- OpenAI-format prefix in the Quick Start: `https://api.longcat.chat/openai`; the same page passes this shorter value to its OpenAI Python SDK example ([Quick Start](https://longcat.chat/platform/docs/)).
- OpenAI versioned base used by Codex and CC Switch: `https://api.longcat.chat/openai/v1` ([Codex](https://longcat.chat/platform/docs/Codex.html), [CC Switch](https://longcat.chat/platform/docs/cc-switch)). The detailed Chat and Models references likewise place resources under `/openai/v1/...` ([Chat Completions](https://longcat.chat/platform/docs/api/chat.html), [List Models](https://longcat.chat/platform/docs/api/models)).

For a generic OpenAI-compatible client whose `baseURL` is joined with `/chat/completions`, `/models`, or `/responses`, use:

```text
https://api.longcat.chat/openai/v1
```

Use the shorter `https://api.longcat.chat/openai` only when a client itself inserts `/v1`. The Quick Start's SDK snippet uses the shorter form while the exact endpoint references and tool integrations use the versioned form. The independent live validation below exercised the versioned base; the shorter form was not tested.

## Authentication

LongCat requires an API credential in the HTTP `Authorization` header using the Bearer scheme ([API Overview](https://longcat.chat/platform/docs/APIDocs.html)). The Chat Completions and List Models references both mark this header as required ([Chat Completions](https://longcat.chat/platform/docs/api/chat.html), [List Models](https://longcat.chat/platform/docs/api/models)).

## Model identifiers

Use the exact current identifier:

```text
LongCat-2.0
```

Evidence:

- The Chat Completions reference states that its required `model` field currently supports `LongCat-2.0` ([Chat Completions](https://longcat.chat/platform/docs/api/chat.html)).
- The authenticated model-list resource is `GET https://api.longcat.chat/openai/v1/models`; its official example response contains only `LongCat-2.0` ([List Models](https://longcat.chat/platform/docs/api/models)).
- The Quick Start's current supported-model table also contains only `LongCat-2.0`, available through both OpenAI and Anthropic formats ([Quick Start](https://longcat.chat/platform/docs/)).

Do not select older `LongCat-Flash-*` identifiers for a new configuration: the official change log says six legacy models were retired on 2026-05-29, before the full `LongCat-2.0` release on 2026-06-30 ([Change Log](https://longcat.chat/platform/docs/ChangeLog.html)). The current docs no longer list `LongCat-2.0-Preview` as the supported ID; because the change log does not separately state its retirement, treat the preview ID as unavailable unless an authenticated `/models` response for the specific account says otherwise.

## OpenAI-compatible Chat Completions

The directly documented call is:

```text
POST https://api.longcat.chat/openai/v1/chat/completions
```

The official reference describes it as OpenAI-compatible, text-input only, and supporting both non-streaming output and SSE streaming with `stream: true` ([Chat Completions](https://longcat.chat/platform/docs/api/chat.html)). It documents `system`, `user`, and `assistant` message roles and the exact current model ID above.

The API Overview also says the OpenAI Python SDK is compatible with `/openai/` endpoints ([API Overview](https://longcat.chat/platform/docs/APIDocs.html)). This is solid evidence for Chat Completions compatibility, not evidence that every OpenAI endpoint or optional field is implemented.

## Responses API: supported, but incompletely specified

There is first-party evidence of support:

- The official CC Switch page instructs Codex users to keep the native Responses protocol, states that LongCat supports it directly without local routing, and configures `base_url = "https://api.longcat.chat/openai/v1"` with `wire_api = "responses"` ([CC Switch](https://longcat.chat/platform/docs/cc-switch)).
- The official Codex page independently provides the same base URL and `wire_api = "responses"` configuration ([Codex](https://longcat.chat/platform/docs/Codex.html)).

There is also a documentation gap:

- The current API Overview's endpoint list and API navigation expose Chat Completions, Anthropic Messages, List Models, and Retrieve Model, but no Responses reference ([API Overview](https://longcat.chat/platform/docs/APIDocs.html)).
- The official pages above do not print a complete Responses HTTP method/path, body schema, event schema, or feature matrix. Combining the documented versioned base with the standard resource name implies `POST https://api.longcat.chat/openai/v1/responses`, but that full URL is an inference rather than a directly printed endpoint in the public LongCat API reference.

Accordingly, it is reasonable to configure a client that LongCat explicitly supports (such as Codex) with the Responses wire protocol. It is not yet source-supported to claim full parity for optional OpenAI Responses features such as stored response retrieval, response deletion, or every OpenAI tool type. Those details require either a newer first-party reference or credentialed integration testing.

## Vercel AI SDK v7: provider capability boundaries

### Version basis in this repository

This assessment is tied to the repository's installed stack, not to an unspecified AI SDK release:

- [`apps/server/package.json`](../../apps/server/package.json) declares `ai` `^7.0.79`, `@ai-sdk/deepseek` `^3.0.32`, and `@ai-sdk/openai-compatible` `^3.0.40`; [`pnpm-lock.yaml`](../../pnpm-lock.yaml) resolves those provider packages for the server workspace.

The behavior below was checked against Vercel's first-party documentation and package source, as well as the installed published package files.

### `@ai-sdk/deepseek`

The DeepSeek provider is a vendor-specific implementation, not a generic OpenAI-compatible transport:

- It has DeepSeek defaults and DeepSeek-specific request/response handling. Vercel documents a default API prefix of `https://api.deepseek.com`, plus optional overrides for the base URL, authentication input, headers, and `fetch` ([DeepSeek provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)).
- Its language-model factory is a chat model. The package source joins the configured base URL to `/chat/completions`; it does not expose a Responses-model factory ([DeepSeek provider factory](https://github.com/vercel/ai/blob/main/packages/deepseek/src/deepseek-provider.ts), [DeepSeek chat implementation](https://github.com/vercel/ai/blob/main/packages/deepseek/src/chat/deepseek-chat-language-model.ts)).
- The installed provider exposes language/chat generation and a files interface, while embedding and image-model requests are rejected. That boundary is visible in the published `DeepSeekProvider` interface and factory implementation linked above.
- Vercel exposes typed DeepSeek-only options such as `thinking` and `reasoningEffort`; that is useful when the upstream is actually DeepSeek, but is not evidence that the adapter is correct for a different OpenAI-compatible service ([DeepSeek provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)).

Although `createDeepSeek` accepts a base-URL override and LongCat documents a Chat-Completions-shaped endpoint, redirecting this vendor-specific adapter to LongCat would rely on accidental wire compatibility. There is no first-party statement from Vercel or LongCat that this pairing is supported. Use the generic OpenAI-compatible adapter for the formally documented LongCat Chat Completions surface.

### `@ai-sdk/openai-compatible`

This is the appropriate AI SDK v7 transport abstraction for LongCat's formally documented OpenAI-compatible Chat Completions endpoint:

- `createOpenAICompatible` requires a provider `name` and `baseURL`, and can attach Bearer authentication, custom headers, query parameters, a custom `fetch`, request transforms, and metadata/usage converters ([provider docs](https://ai-sdk.dev/providers/openai-compatible-providers), [provider source](https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/openai-compatible-provider.ts)).
- Calling the provider directly, or calling `languageModel` / `chatModel`, creates an OpenAI-compatible chat model. The chat implementation appends `/chat/completions`, matching the versioned LongCat base identified above ([provider source](https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/openai-compatible-provider.ts), [chat source](https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts)).
- The factory also exposes legacy completion, embedding, and image model factories. Their existence in the adapter does **not** prove that a configured upstream implements those endpoints; capability still belongs to the upstream service. LongCat's current public reference formally documents Chat Completions and model listing, not those additional resources.
- Provider-specific request fields can be passed through `providerOptions`, while flags and hooks exist for structured outputs and non-standard request/response details ([provider docs](https://ai-sdk.dev/providers/openai-compatible-providers), [provider source](https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/openai-compatible-provider.ts)). This is an escape hatch, not automatic compatibility: unsupported fields or response shapes still need explicit verification.
- The provider interface has no `responses` method and its callable/language-model default is the Chat Completions implementation. Therefore `@ai-sdk/openai-compatible` does **not** consume the OpenAI Responses protocol, even though LongCat's official Codex guides say their service can ([provider source](https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/openai-compatible-provider.ts)).

Consequently, the low-risk first integration is LongCat through Chat Completions. Using LongCat's Responses protocol would require a different Responses-capable transport and separate testing against the incompletely specified LongCat surface; switching only a model ID or wrapping the chat adapter does not change the wire protocol.

### `customProvider` and `createProviderRegistry`

These two AI SDK Core helpers solve model management, not HTTP compatibility:

- `customProvider` maps aliases to already-created model objects, can preconfigure models, restrict the exposed model set, and can delegate unknown IDs to a fallback provider. It does not take a base URL and does not itself implement Chat Completions or Responses ([provider-management guide](https://ai-sdk.dev/docs/ai-sdk-core/provider-management), [`customProvider` reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/custom-provider)).
- `createProviderRegistry` combines multiple provider implementations and resolves string IDs in `providerId:modelId` form. It supplies the desired upstream-facing indirection, but does not create credentials, choose a wire protocol, or validate that a model supports a requested feature ([provider-management guide](https://ai-sdk.dev/docs/ai-sdk-core/provider-management), [`createProviderRegistry` reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry)).

For this repository, register the DeepSeek provider and a separately constructed LongCat OpenAI-compatible provider in one registry. `customProvider` is optional: add it only if stable aliases or per-model defaults are wanted. It cannot turn the existing DeepSeek adapter into a LongCat adapter, nor can it add Responses support to the OpenAI-compatible chat adapter.

## Baseline repository assessment (historical, before issue #16)

The code had a good seam, but the application was single-provider in practice.

| Area | State observed at research start | Multi-platform impact |
|---|---|---|
| Central provider module | [`llm.ts`](../../apps/server/src/steps/llm.ts) is the sole provider-aware module and already uses `createProviderRegistry`. | Good foundation: a second provider can be registered centrally. |
| Registered providers | The registry contains only DeepSeek, and the server has no OpenAI-compatible dependency. | LongCat cannot be selected today. |
| Model ID type | [`llm-call.ts`](../../apps/server/src/steps/llm-call.ts) casts every configured model to ``deepseek:${string}``. | The upstream step API accepts a string, but this cast erases any real multi-provider type safety and states the wrong invariant for a LongCat prefix. |
| Default and runtime selection | The default is DeepSeek, while [`index.ts`](../../apps/server/src/index.ts) supplies an empty `AgentConfig` at runtime. | The schema permits a model override, but the production pipeline currently never resolves one; only tests exercise the override path. |
| Availability / demo mode | Availability detection, server logging, tests, and the entry-page message are tied to DeepSeek-specific configuration ([`llm.ts`](../../apps/server/src/steps/llm.ts), [`index.ts`](../../apps/server/src/index.ts), [`Entry.tsx`](../../apps/web/src/pages/Entry.tsx), [`llm.test.ts`](../../apps/server/test/llm.test.ts)). | A valid LongCat configuration alone would still leave the application in demo mode and show misleading vendor-specific UI. |
| LLM feature used | [`callLlm`](../../apps/server/src/steps/llm-call.ts) calls `generateObject` with a Zod schema for every real step. | Transport compatibility is not enough. LongCat's public Chat reference does not document JSON Schema / `response_format`, so structured-object compatibility is unverified and must be proven before changing the default. |
| Provider-neutral step code | Caption, creative, and outline steps call the shared `callLlm` helper rather than importing a provider. | Once registry selection and availability are generalized, the creative pipeline should not need provider-specific edits. |

Baseline assessment: **provider abstraction existed, but end-to-end multi-platform support did not**. The main work was configuration and selection plumbing, not rewriting the creative steps.

## Recommended integration boundary

The source-supported, low-risk target is:

```text
registry id: longcat:LongCat-2.0
transport: OpenAI-compatible Chat Completions
baseURL: https://api.longcat.chat/openai/v1
resource: /chat/completions
authentication: Authorization header, Bearer scheme, runtime-supplied credential
```

This is a selection conclusion, not the current implementation specification. Provider registration, configuration precedence, credential isolation, timeout policy, model overrides, and operational status are owned by [wiki 016](../wiki/016-model-runtime-provider-config.md).

## Independent validation evidence (2026-08-29)

These checks reduced protocol risk independently; neither is the canonical end-to-end product smoke. In particular, the live table below is **not** the CLI `work-4` run and its measurements must not be merged with that run.

### 1. Mocked transport contract

With a synthetic credential and mocked `fetch`, the candidate OpenAI-compatible adapter produced the expected versioned `/chat/completions` URL, Bearer header, exact `LongCat-2.0` model ID, and JSON-object response-mode fallback. This check made no network request and proves request construction only, not upstream service behavior.

### 2. Isolated live protocol/step smoke

These checks predated and were independent from the later CLI `work-4` case: caption and creative ran in an earlier server process, while the successful outline retry ran through a standalone step harness. Taken together, the three production step paths completed against `LongCat-2.0` through the OpenAI-compatible Chat Completions adapter:

| Step | Result | Latency | Input tokens | Output tokens |
|---|---|---:|---:|---:|
| caption | schema-valid output, `finishReason=stop` | 36.959 s | 461 | 1,296 |
| creative | schema-valid output, `finishReason=stop` | 67.498 s | 1,018 | 2,833 |
| outline | schema-valid output with 5 arcs and 10 segments, `finishReason=stop` | 110.867 s | 983 | 4,187 |

The first isolated outline attempt hit the then-fixed 120-second timeout at 120.004 seconds. A second isolated run with a 300-second allowance succeeded in 110.867 seconds, which is evidence that the tested authentication, URL, transport, and schema path could complete when given more time. These timings are protocol/step evidence only; [wiki 016](../wiki/016-model-runtime-provider-config.md) owns the later end-to-end CLI result and current timeout policy.

LongCat's public Chat reference still does not promise JSON Schema structured outputs. The validation therefore exercised JSON-object response mode plus local Zod validation; the isolated live calls returned objects accepted by all three production schemas. This supports that conservative adapter choice for the tested prompts and model version, but is not a contractual guarantee of every structured-output workload.

## LongCat source boundary

Primary sources used:

- [LongCat API Overview](https://longcat.chat/platform/docs/APIDocs.html)
- [LongCat API Platform Quick Start](https://longcat.chat/platform/docs/)
- [LongCat Chat Completions reference](https://longcat.chat/platform/docs/api/chat.html)
- [LongCat List Models reference](https://longcat.chat/platform/docs/api/models)
- [LongCat Codex integration](https://longcat.chat/platform/docs/Codex.html)
- [LongCat CC Switch integration](https://longcat.chat/platform/docs/cc-switch)
- [LongCat API Platform Change Log](https://longcat.chat/platform/docs/ChangeLog.html)

No community integration guide, issue comment, secondary article, or third-party compatibility claim was used as evidence.
