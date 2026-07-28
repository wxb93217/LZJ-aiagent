import {
  isAttachmentMimeType,
  maxAttachmentUploadBytes,
  maxExtractedAttachmentCharacters,
} from "../../../attachment-config";

export const maxDuration = 60;

const ocrModel = "deepseek-ai/DeepSeek-OCR";

type SiliconFlowResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  message?: unknown;
};

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }

  return btoa(binary);
}

function cleanOcrOutput(text: string) {
  return text
    .replace(
      /<\|ref\|>[\s\S]*?<\|\/ref\|>\s*<\|det\|>[\s\S]*?<\|\/det\|>/g,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.SILICONFLOW_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "附件读取服务尚未配置。" },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "无法读取上传的附件。" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "请选择需要读取的图片。" },
      { status: 400 },
    );
  }

  if (!isAttachmentMimeType(file.type)) {
    return Response.json(
      { error: "仅支持 JPEG、PNG 和 WebP 图片。" },
      { status: 415 },
    );
  }

  if (file.size === 0) {
    return Response.json({ error: "图片内容为空。" }, { status: 400 });
  }

  if (file.size > maxAttachmentUploadBytes) {
    return Response.json(
      { error: "图片处理后仍然过大，请更换图片。" },
      { status: 413 },
    );
  }

  const imageData = arrayBufferToBase64(await file.arrayBuffer());
  const baseUrl = (
    process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1"
  ).replace(/\/$/, "");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ocrModel,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${file.type};base64,${imageData}`,
                  detail: "high",
                },
              },
              {
                type: "text",
                text: "<image>\n<|grounding|>Convert the document to markdown.",
              },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0,
        stream: false,
      }),
    });
  } catch (error) {
    console.error("Attachment OCR request failed:", error);
    return Response.json(
      { error: "附件读取服务暂时不可用，请稍后重试。" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const providerError = await response.text();
    console.error(
      `Attachment OCR returned HTTP ${response.status}:`,
      providerError.slice(0, 500),
    );
    return Response.json(
      { error: "附件读取失败，请重试或更换图片。" },
      { status: 502 },
    );
  }

  let payload: SiliconFlowResponse;
  try {
    payload = (await response.json()) as SiliconFlowResponse;
  } catch {
    return Response.json(
      { error: "附件读取服务返回了无效结果。" },
      { status: 502 },
    );
  }

  const rawText = payload.choices?.[0]?.message?.content;
  const text = typeof rawText === "string" ? cleanOcrOutput(rawText) : "";

  if (!text) {
    return Response.json(
      { error: "没有从图片中识别到可用内容。" },
      { status: 422 },
    );
  }

  const truncated = text.length > maxExtractedAttachmentCharacters;
  const extractedText = truncated
    ? `${text.slice(0, maxExtractedAttachmentCharacters)}\n\n[附件内容过长，已截断]`
    : text;

  return Response.json({
    text: extractedText,
    truncated,
    model: ocrModel,
  });
}
