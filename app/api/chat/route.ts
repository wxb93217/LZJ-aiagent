import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
} from "ai";
import type { ChatMessage, SearchSource } from "../../chat-types";

export const maxDuration = 60;

const supportedModels = [
  "glm-5.2",
  "glm-4.7-flash",
  "glm-4.6v",
  "glm-4.5-air",
] as const;
type SupportedModel = (typeof supportedModels)[number];
const webSearchModels = new Set<SupportedModel>([
  "glm-5.2",
  "glm-4.7-flash",
  "glm-4.6v",
  "glm-4.5-air",
]);

function isSupportedModel(value: unknown): value is SupportedModel {
  return supportedModels.includes(value as SupportedModel);
}

function getLatestUserQuery(messages: ChatMessage[]) {
  const latestUserMessage = messages.findLast(
    (message) => message.role === "user",
  );
  const query =
    latestUserMessage?.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim() ?? "";

  return Array.from(query).slice(0, 70).join("");
}

function getStringField(
  value: Record<string, unknown>,
  field: string,
  fallback = "",
) {
  return typeof value[field] === "string" ? value[field] : fallback;
}

async function getWebSearchContext(apiKey: string, query: string) {
  if (!query) return { context: "", sources: [] as SearchSource[] };

  try {
    const response = await fetch(
      process.env.ZHIPU_WEB_SEARCH_URL ??
        "https://open.bigmodel.cn/api/paas/v4/web_search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          search_query: query,
          search_engine: "search_std",
          search_intent: false,
          count: 5,
          search_recency_filter: "noLimit",
          content_size: "medium",
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Web search returned HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    const searchResults =
      typeof payload === "object" &&
      payload !== null &&
      "search_result" in payload &&
      Array.isArray(payload.search_result)
        ? payload.search_result
        : [];

    const sources = searchResults
      .filter(
        (result): result is Record<string, unknown> =>
          typeof result === "object" && result !== null,
      )
      .slice(0, 5)
      .flatMap((result, index): SearchSource[] => {
        const title = getStringField(result, "title", "未命名来源");
        const link = getStringField(result, "link");
        const media = getStringField(result, "media");
        const publishDate = getStringField(result, "publish_date");
        const content = getStringField(result, "content");
        const icon = getStringField(result, "icon");

        try {
          const url = new URL(link);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            return [];
          }
        } catch {
          return [];
        }

        return [
          {
            id: `search-${index + 1}`,
            title,
            url: link,
            media,
            publishDate,
            snippet: content,
            icon,
          },
        ];
      });

    if (sources.length === 0) {
      return {
        context:
          "【联网搜索状态】本次搜索没有返回可用来源。请明确告诉用户未找到可验证的网络信息，不要把模型记忆描述成实时搜索结果。",
        sources,
      };
    }

    const contextSources = sources.map((source, index) =>
      [
        `[${index + 1}] ${source.title}`,
        source.media ? `来源：${source.media}` : "",
        source.publishDate ? `发布日期：${source.publishDate}` : "",
        `链接：${source.url}`,
        source.snippet ? `摘要：${source.snippet}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    return {
      context: `【联网搜索结果】
以下资料来自当前问题的实时网络检索。涉及事实和时效性信息时，应优先依据这些资料。每个使用到搜索资料的事实，都要在对应句子或短语后用 [来源名称](完整链接) 标注；链接必须完整使用下方结果中的 URL。不要只在答案末尾堆叠来源，也不要编造不存在的来源。

${contextSources.join("\n\n")}`,
      sources,
    };
  } catch (error) {
    console.error("Web search failed:", error);
    return {
      context:
        "【联网搜索状态】联网搜索服务本次不可用。请向用户明确说明无法取得实时来源，不要把模型记忆描述成联网结果。",
      sources: [] as SearchSource[],
    };
  }
}

export async function POST(request: Request) {
  if (!process.env.ZHIPU_API_KEY) {
    return Response.json(
      {
        error:
          "ZHIPU_API_KEY is not configured. Add it to .env.local and restart the server.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages =
    typeof body === "object" &&
    body !== null &&
    "messages" in body &&
    Array.isArray(body.messages)
      ? (body.messages as ChatMessage[])
      : null;
  const deepThinking =
    typeof body === "object" &&
    body !== null &&
    "deepThinking" in body &&
    typeof body.deepThinking === "boolean"
      ? body.deepThinking
      : true;
  const webSearch =
    typeof body === "object" &&
    body !== null &&
    "webSearch" in body &&
    typeof body.webSearch === "boolean"
      ? body.webSearch
      : true;
  const requestedModel =
    typeof body === "object" && body !== null && "model" in body
      ? body.model
      : undefined;

  if (requestedModel !== undefined && !isSupportedModel(requestedModel)) {
    return Response.json(
      { error: "The selected model is not supported." },
      { status: 400 },
    );
  }

  const environmentModel = process.env.GLM_MODEL;
  const selectedModel =
    requestedModel ??
    (isSupportedModel(environmentModel) ? environmentModel : "glm-5.2");
  const webSearchEnabled =
    webSearch && webSearchModels.has(selectedModel);

  if (!messages) {
    return Response.json(
      { error: "The messages field must be an array." },
      { status: 400 },
    );
  }

  if (messages.length > 40 || JSON.stringify(messages).length > 100_000) {
    return Response.json(
      { error: "Conversation is too large." },
      { status: 413 },
    );
  }

  const modelMessages = await convertToModelMessages(messages);
  const webSearchResult = webSearchEnabled
    ? await getWebSearchContext(
        process.env.ZHIPU_API_KEY,
        getLatestUserQuery(messages),
      )
    : { context: "", sources: [] as SearchSource[] };
  const systemPrompt =
    "你是一个清晰、友善、可靠的中文 AI 助手。默认使用简体中文回答；当用户使用其他语言时，跟随用户语言。答案应直接、准确，并在不确定时明确说明。回答支持 Markdown：内容较长或有清晰层级时，使用简短标题、加粗关键词和列表组织信息；简单问题保持自然正文，避免为了排版滥用标题。";
  const systemPromptWithSearch = webSearchResult.context
    ? `${systemPrompt}\n\n${webSearchResult.context}`
    : systemPrompt;

  const glm = createOpenAICompatible({
    name: "zhipu",
    apiKey: process.env.ZHIPU_API_KEY,
    baseURL:
      process.env.ZHIPU_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    includeUsage: true,
  });

  const result = streamText({
    model: glm(selectedModel),
    system: systemPromptWithSearch,
    messages: modelMessages,
    providerOptions: {
      zhipu: {
        thinking: {
          type: deepThinking ? "enabled" : "disabled",
        },
        ...(deepThinking && selectedModel === "glm-5.2"
          ? { reasoningEffort: "max" }
          : {}),
      },
    },
  });

  const stream = createUIMessageStream<ChatMessage>({
    originalMessages: messages,
    execute: ({ writer }) => {
      if (webSearchResult.sources.length > 0) {
        writer.write({
          type: "data-searchSources",
          data: webSearchResult.sources,
        });
      }

      writer.merge(
        result.toUIMessageStream<ChatMessage>({
          sendReasoning: true,
        }),
      );
    },
    onError: () => "生成回答时出现问题，请稍后重试。",
  });

  return createUIMessageStreamResponse({ stream });
}
