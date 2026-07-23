import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";

export const maxDuration = 30;

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
      ? (body.messages as UIMessage[])
      : null;

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

  const glm = createOpenAICompatible({
    name: "zhipu",
    apiKey: process.env.ZHIPU_API_KEY,
    baseURL:
      process.env.ZHIPU_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    includeUsage: true,
  });

  const result = streamText({
    model: glm(process.env.GLM_MODEL ?? "glm-5.2"),
    system:
      "你是一个清晰、友善、可靠的中文 AI 助手。默认使用简体中文回答；当用户使用其他语言时，跟随用户语言。答案应直接、准确，并在不确定时明确说明。",
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse({
    onError: () => "生成回答时出现问题，请稍后重试。",
  });
}
