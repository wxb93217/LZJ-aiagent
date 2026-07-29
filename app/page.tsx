"use client";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart } from "ai";
import {
  ArrowClockwise,
  ArrowSquareOut,
  ArrowUp,
  Atom,
  CaretDown,
  Check,
  Cpu,
  FileImage,
  GlobeHemisphereWest,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Paperclip,
  SpinnerGap,
  Stop,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import {
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";
import { Streamdown } from "streamdown";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  attachmentAccept,
  isAttachmentMimeType,
  maxAttachmentCount,
  maxAttachmentImageDimension,
  maxAttachmentSourceBytes,
  maxAttachmentUploadBytes,
} from "./attachment-config";
import {
  deleteAttachmentPreviews,
  getAttachmentPreview,
  saveAttachmentPreview,
} from "./attachment-preview-store";
import {
  extractSearchActivity,
  type AttachmentInputMode,
  type ChatMessage,
  type ExtractedAttachment,
  type SearchSource,
} from "./chat-types";

const suggestions = [
  "什么叫做Ai agent?",
  "帮我推荐一下Ai agent应该用怎样的框架来做?",
  "帮我讲解一下前端在Ai agent项目中应该做哪些工作?",
];
const assistantName = "一二的小笨助手";
const historyStorageKey = "yier-little-assistant-history-v1";
const maxStoredConversations = 20;
const autoScrollThreshold = 100;
const minAttachmentPreviewScale = 1;
const maxAttachmentPreviewScale = 4;
const attachmentPreviewScaleStep = 0.25;
const modelOptions = [
  {
    id: "glm-5.2",
    label: "GLM-5.2",
    description: "能力更强",
    supportsWebSearch: true,
  },
  {
    id: "glm-4.7-flash",
    label: "GLM-4.7-Flash",
    description: "免费快速",
    supportsWebSearch: true,
  },
  {
    id: "glm-4.6v",
    label: "GLM-4.6V",
    description: "视觉理解",
    supportsWebSearch: true,
  },
  {
    id: "glm-4.5-air",
    label: "GLM-4.5-Air",
    description: "高性价比",
    supportsWebSearch: true,
  },
  {
    id: "deepseek-r1-0528-qwen3-8b",
    label: "DeepSeek R1 8B",
    description: "SiliconFlow · 推理模型",
    supportsWebSearch: false,
    thinkingAlwaysOn: true,
  },
  {
    id: "qwen3.5-4b",
    label: "Qwen3.5 4B",
    description: "SiliconFlow · 通用模型",
    supportsWebSearch: false,
  },
  {
    id: "hunyuan-mt-7b",
    label: "Hunyuan MT 7B",
    description: "SiliconFlow · 翻译模型",
    supportsWebSearch: false,
  },
] as const;

type ModelId = (typeof modelOptions)[number]["id"];
const legacyModelId = "glm-4.7" as const;
const defaultModelId: ModelId = "deepseek-r1-0528-qwen3-8b";
const visionModelIds = new Set<ModelId>(["glm-4.6v", "qwen3.5-4b"]);

function isModelId(value: unknown): value is ModelId {
  return modelOptions.some((option) => option.id === value);
}

function normalizeModelId(value: unknown): ModelId {
  if (value === legacyModelId) {
    return "glm-4.7-flash";
  }

  return isModelId(value) ? value : defaultModelId;
}

function modelSupportsWebSearch(model: ModelId) {
  return (
    modelOptions.find((option) => option.id === model)?.supportsWebSearch ??
    false
  );
}

function modelSupportsImageInput(model: ModelId) {
  return visionModelIds.has(model);
}

function getAttachmentInputMode(model: ModelId): AttachmentInputMode {
  return modelSupportsImageInput(model) ? "vision" : "ocr";
}

function modelAlwaysThinks(model: ModelId) {
  const option = modelOptions.find((item) => item.id === model);
  return Boolean(
    option &&
      "thinkingAlwaysOn" in option &&
      option.thinkingAlwaysOn,
  );
}

function getModelLabel(model: ModelId) {
  return (
    modelOptions.find((option) => option.id === model)?.label ??
    model.toUpperCase()
  );
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const punctuationPattern = /[，。！？；：、…—,.!?;:]/;
const historyDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type StoredConversation = {
  id: string;
  title: string;
  updatedAt: number;
  deepThinking: boolean;
  webSearch: boolean;
  model: ModelId;
  messages: ChatMessage[];
};

type SourceDrawerState = {
  sources: SearchSource[];
  activeUrl?: string;
};

type PendingAttachment = {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  size: number;
  previewUrl: string;
  previewBlob?: Blob;
  processingMode: AttachmentInputMode;
  status: "processing" | "ready" | "error";
  text?: string;
  truncated?: boolean;
  error?: string;
};

type AttachmentPreviewState = {
  name: string;
  url: string;
};

type ReasoningStatus =
  | "waiting"
  | "thinking"
  | "complete"
  | "stopped"
  | "error";

const reasoningStatusCopy: Record<
  ReasoningStatus,
  { label: string; emptyText: string }
> = {
  waiting: {
    label: "等待思考",
    emptyText: "正在连接模型，准备开始深度思考…",
  },
  thinking: {
    label: "思考中…",
    emptyText: "正在分析问题…",
  },
  complete: {
    label: "思考完成",
    emptyText: "思考已经完成。",
  },
  stopped: {
    label: "思考已停止",
    emptyText: "本次思考已停止。",
  },
  error: {
    label: "思考失败",
    emptyText: "思考过程中出现了问题，请稍后重试。",
  },
};

function createConversationId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatReasoningDuration(milliseconds: number) {
  const totalSeconds = Math.max(0.1, milliseconds / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)} 秒`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes} 分 ${seconds} 秒`;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("无法压缩图片。"));
        }
      },
      type,
      quality,
    );
  });
}

async function prepareAttachmentUpload(file: File) {
  if (file.size <= maxAttachmentUploadBytes) return file;

  const bitmap = await createImageBitmap(file);
  try {
    let longestSide = Math.min(
      maxAttachmentImageDimension,
      Math.max(bitmap.width, bitmap.height),
    );
    let quality = 0.9;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const scale = Math.min(
        1,
        longestSide / Math.max(bitmap.width, bitmap.height),
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器无法处理这张图片。");

      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      canvas.width = 1;
      canvas.height = 1;

      if (blob.size <= maxAttachmentUploadBytes) {
        const baseName = file.name.replace(/\.[^.]+$/, "") || "attachment";
        return new File([blob], `${baseName}.webp`, {
          type: "image/webp",
          lastModified: file.lastModified,
        });
      }

      longestSide = Math.max(1280, Math.round(longestSide * 0.78));
      quality = Math.max(0.58, quality - 0.08);
    }
  } finally {
    bitmap.close();
  }

  throw new Error("图片压缩后仍然过大，请更换图片。" );
}

async function readAttachmentResponse(response: Response) {
  const responseBody = await response.text();

  try {
    const payload: unknown = responseBody ? JSON.parse(responseBody) : {};
    return typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  } catch {
    return responseBody ? { error: responseBody } : {};
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("无法读取图片内容。"));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图片内容。"));
    reader.readAsDataURL(blob);
  });
}

function stripFilePartsForStorage(messages: ChatMessage[]) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => part.type !== "file"),
  }));
}

async function restoreVisionFileParts(
  messages: ChatMessage[],
  model: ModelId,
) {
  if (!modelSupportsImageInput(model)) return messages;

  return Promise.all(
    messages.map(async (message) => {
      if (
        message.role !== "user" ||
        message.parts.some((part) => part.type === "file")
      ) {
        return message;
      }

      const visionAttachments = message.parts.flatMap((part) =>
        part.type === "data-attachments"
          ? part.data.filter(
              (attachment) => attachment.inputMode === "vision",
            )
          : [],
      );
      const fileParts = (
        await Promise.all(
          visionAttachments.map(async (attachment) => {
            try {
              const blob = await getAttachmentPreview(attachment.id);
              if (!blob) return null;

              return {
                type: "file" as const,
                mediaType: blob.type || attachment.mimeType,
                filename: attachment.name,
                url: await blobToDataUrl(blob),
              } satisfies FileUIPart;
            } catch {
              return null;
            }
          }),
        )
      ).filter((part): part is FileUIPart => part !== null);

      return fileParts.length > 0
        ? { ...message, parts: [...message.parts, ...fileParts] }
        : message;
    }),
  );
}

function getMessageText(message: ChatMessage) {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

function getAttachmentIds(messages: ChatMessage[]) {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "data-attachments"
        ? part.data.map((attachment) => attachment.id)
        : [],
    ),
  );
}

function getConversationTitle(messages: ChatMessage[]) {
  const firstQuestion = messages.find((message) => message.role === "user");
  const text = firstQuestion
    ? extractSearchActivity(getMessageText(firstQuestion)).cleanText.trim()
    : "";
  const characters = Array.from(text || "新对话");

  return `${characters.slice(0, 22).join("")}${
    characters.length > 22 ? "…" : ""
  }`;
}

function isStoredConversation(value: unknown): value is StoredConversation {
  if (typeof value !== "object" || value === null) return false;

  const conversation = value as Partial<StoredConversation>;
  return (
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    typeof conversation.updatedAt === "number" &&
    typeof conversation.deepThinking === "boolean" &&
    (conversation.webSearch === undefined ||
      typeof conversation.webSearch === "boolean") &&
    (conversation.model === undefined ||
      isModelId(conversation.model) ||
      conversation.model === legacyModelId) &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        typeof message.id === "string" &&
        Array.isArray(message.parts),
    )
  );
}

function readConversationHistory() {
  if (typeof window === "undefined") return [];

  try {
    const storedValue = window.localStorage.getItem(historyStorageKey);
    const parsedValue: unknown = storedValue ? JSON.parse(storedValue) : [];

    return Array.isArray(parsedValue)
      ? parsedValue
          .filter(isStoredConversation)
          .map((conversation) => ({
            ...conversation,
            webSearch: conversation.webSearch ?? true,
            model: normalizeModelId(conversation.model),
          }))
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, maxStoredConversations)
      : [];
  } catch {
    return [];
  }
}

function writeConversationHistory(history: StoredConversation[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
  } catch {
    // Browser privacy settings or a full storage quota can block local history.
  }
}

function cleanupAttachmentPreviews(ids: string[]) {
  if (ids.length === 0) return;
  void deleteAttachmentPreviews(ids).catch((cleanupError) => {
    console.error("Attachment preview cleanup failed:", cleanupError);
  });
}

function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function getSearchSources(message: ChatMessage) {
  return message.parts.flatMap((part) =>
    part.type === "data-searchSources" ? part.data : [],
  );
}

function getReasoningTiming(message: ChatMessage) {
  return message.parts
    .flatMap((part) =>
      part.type === "data-reasoningTiming" ? [part.data] : [],
    )
    .at(-1);
}

function subscribeToReducedMotion(callback: () => void) {
  const mediaQuery = window.matchMedia(reducedMotionQuery);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(reducedMotionQuery).matches;
}

function TypewriterText({
  text,
  active,
  startEmpty = false,
  markdown = false,
  onSourceClick,
}: {
  text: string;
  active: boolean;
  startEmpty?: boolean;
  markdown?: boolean;
  onSourceClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const initialTextRef = useRef(startEmpty ? "" : text);
  const [renderedText, setRenderedText] = useState(initialTextRef.current);
  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    () => false,
  );
  const targetTextRef = useRef(text);
  const renderedTextRef = useRef(initialTextRef.current);
  const frameRef = useRef<number | null>(null);
  const punctuationPauseFramesRef = useRef(0);
  const reduceMotionRef = useRef(reduceMotion);

  targetTextRef.current = text;
  reduceMotionRef.current = reduceMotion;

  const renderFrame = useCallback(function renderFrame() {
    frameRef.current = null;

    const targetText = targetTextRef.current;
    const currentText = renderedTextRef.current;

    if (reduceMotionRef.current) {
      if (currentText !== targetText) {
        renderedTextRef.current = targetText;
        setRenderedText(targetText);
      }

      return;
    }

    if (!targetText.startsWith(currentText)) {
      renderedTextRef.current = targetText;
      punctuationPauseFramesRef.current = 0;
      setRenderedText(targetText);
      return;
    }

    const remainingCharacters = Array.from(
      targetText.slice(currentText.length),
    );

    if (remainingCharacters.length === 0) return;

    if (punctuationPauseFramesRef.current > 0) {
      punctuationPauseFramesRef.current -= 1;
      frameRef.current = window.requestAnimationFrame(renderFrame);
      return;
    }

    const charactersPerFrame =
      remainingCharacters.length > 48
        ? 3
        : remainingCharacters.length > 12
          ? 2
          : 1;
    const candidateCharacters = remainingCharacters.slice(
      0,
      charactersPerFrame,
    );
    const punctuationIndex = candidateCharacters.findIndex((character) =>
      punctuationPattern.test(character),
    );
    const takeCount =
      punctuationIndex >= 0 ? punctuationIndex + 1 : charactersPerFrame;
    const charactersToRender = remainingCharacters.slice(0, takeCount);
    const nextText = currentText + charactersToRender.join("");

    renderedTextRef.current = nextText;
    setRenderedText(nextText);

    if (
      punctuationPattern.test(
        charactersToRender[charactersToRender.length - 1] ?? "",
      )
    ) {
      punctuationPauseFramesRef.current = 1;
    }

    if (nextText !== targetTextRef.current) {
      frameRef.current = window.requestAnimationFrame(renderFrame);
    }
  }, []);

  useEffect(() => {
    if (
      frameRef.current === null &&
      renderedTextRef.current !== targetTextRef.current
    ) {
      frameRef.current = window.requestAnimationFrame(renderFrame);
    }
  }, [text, reduceMotion, renderFrame]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const visibleText = reduceMotion ? text : renderedText;
  const hasBufferedText = !reduceMotion && renderedText !== text;
  const isAnimating = !reduceMotion && (active || hasBufferedText);

  if (markdown) {
    return (
      <div
        className="answer-markdown"
        aria-label={text}
        onClick={onSourceClick}
      >
        <div>
          <Streamdown
            className="answer-markdown-content"
            mode={isAnimating ? "streaming" : "static"}
            isAnimating={isAnimating}
            caret="block"
          >
            {visibleText}
          </Streamdown>
        </div>
      </div>
    );
  }

  return (
    <span className="typewriter-output" aria-label={text}>
      <span aria-hidden="true">
        {visibleText}
        {isAnimating && <span className="typewriter-cursor" />}
      </span>
    </span>
  );
}

function ReasoningBlock({
  text,
  status,
  startedAt,
  durationMs,
}: {
  text: string;
  status: ReasoningStatus;
  startedAt?: number;
  durationMs?: number;
}) {
  const active = status === "waiting" || status === "thinking";
  const [open, setOpen] = useState(active);
  const fallbackStartedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(durationMs ?? 0);
  const previousStatusRef = useRef(status);
  const copy = reasoningStatusCopy[status];
  const displayedElapsedMs = durationMs ?? elapsedMs;

  useEffect(() => {
    if (!active || durationMs !== undefined) return;

    fallbackStartedAtRef.current ??= Date.now();
    const effectiveStartedAt =
      startedAt ?? fallbackStartedAtRef.current;
    let timeoutId: number | undefined;
    const updateElapsed = () => {
      setElapsedMs(Math.max(0, Date.now() - effectiveStartedAt));
      timeoutId = window.setTimeout(updateElapsed, 100);
    };

    timeoutId = window.setTimeout(updateElapsed, 100);
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [active, durationMs, startedAt]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const wasActive =
      previousStatus === "waiting" || previousStatus === "thinking";

    if (wasActive && !active) {
      setOpen(false);
    } else if (!wasActive && active) {
      setOpen(true);
    }

    previousStatusRef.current = status;
  }, [active, status]);

  return (
    <details
      className={`reasoning-block reasoning-${status}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="reasoning-spark" aria-hidden="true">
          ✦
        </span>
        <span className="reasoning-title">{copy.label}</span>
        <span className="reasoning-status" aria-hidden="true" />
        {(active || durationMs !== undefined || displayedElapsedMs > 0) && (
          <span className="reasoning-duration">
            思考耗时 {formatReasoningDuration(displayedElapsedMs)}
          </span>
        )}
        <span className="reasoning-toggle">{open ? "收起" : "展开"}</span>
      </summary>
      <div className="reasoning-content">
        {text ? (
          <TypewriterText text={text} active={active} />
        ) : (
          <span>{copy.emptyText}</span>
        )}
      </div>
    </details>
  );
}

function SearchActivityNote({ text }: { text: string }) {
  return (
    <div className="search-activity-note" role="status">
      <GlobeHemisphereWest size={15} weight="bold" aria-hidden="true" />
      <span className="search-activity-label">联网搜索</span>
      <span className="search-activity-detail">{text}</span>
    </div>
  );
}

function AssistantMessage({
  message,
  isLatest,
  isBusy,
  thinkingExpected,
  hasError,
  onOpenSources,
}: {
  message: ChatMessage;
  isLatest: boolean;
  isBusy: boolean;
  thinkingExpected: boolean;
  hasError: boolean;
  onOpenSources: (state: SourceDrawerState) => void;
}) {
  const searchSources = getSearchSources(message);
  const reasoningTiming = getReasoningTiming(message);
  const reasoningParts = message.parts.filter(
    (
      part,
    ): part is Extract<
      (typeof message.parts)[number],
      { type: "reasoning" }
    > => part.type === "reasoning",
  );
  const reasoningText = reasoningParts.map((part) => part.text).join("");
  const rawAnswerText = message.parts
    .filter(
      (
        part,
      ): part is Extract<
        (typeof message.parts)[number],
        { type: "text" }
      > => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
  const {
    activityText: searchActivityText,
    cleanText: bufferedAnswerText,
  } = extractSearchActivity(rawAnswerText);
  const hasReasoning = reasoningParts.length > 0;
  const reasoningStreaming = reasoningParts.some(
    (part) => part.state === "streaming",
  );
  const reasoningComplete =
    hasReasoning &&
    reasoningParts.every((part) => part.state === "done");
  const pipelineWaiting =
    isLatest && isBusy && thinkingExpected && !reasoningComplete;
  const answerReleased =
    !thinkingExpected ||
    reasoningComplete ||
    (!isBusy && !hasReasoning);
  const [answerWasBuffered] = useState(pipelineWaiting);
  const handleSourceClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;

      const normalizedHref = normalizeSourceUrl(href);
      const matchingSource = searchSources.find(
        (source) => normalizeSourceUrl(source.url) === normalizedHref,
      );
      if (!matchingSource) return;

      event.preventDefault();
      onOpenSources({
        sources: searchSources,
        activeUrl: matchingSource.url,
      });
    },
    [onOpenSources, searchSources],
  );

  let reasoningStatus: ReasoningStatus = "complete";

  if (hasError && isLatest) {
    reasoningStatus = "error";
  } else if (reasoningStreaming) {
    reasoningStatus = isBusy ? "thinking" : "stopped";
  } else if (!reasoningComplete) {
    reasoningStatus = "waiting";
  }

  return (
    <>
      {searchActivityText && (
        <SearchActivityNote text={searchActivityText} />
      )}

      {(hasReasoning || pipelineWaiting) && (
        <ReasoningBlock
          text={reasoningText}
          status={reasoningStatus}
          startedAt={
            reasoningTiming?.startedAt ??
            message.metadata?.reasoningStartedAt
          }
          durationMs={reasoningTiming?.durationMs}
        />
      )}

      {answerReleased && bufferedAnswerText.length > 0 && (
        <article className="message message-assistant">
          <div className="message-meta">
            <span className="avatar" aria-hidden="true">
              AI
            </span>
            <span>小笨助手</span>
          </div>

          <div className="message-content">
            <TypewriterText
              text={bufferedAnswerText}
              active={isLatest && isBusy}
              startEmpty={answerWasBuffered}
              markdown
              onSourceClick={handleSourceClick}
            />
          </div>

          {searchSources.length > 0 && (
            <button
              className="search-sources-trigger"
              type="button"
              onClick={() => onOpenSources({ sources: searchSources })}
            >
              <MagnifyingGlass size={15} weight="bold" aria-hidden="true" />
              <span>搜索结果 {searchSources.length}</span>
              <span className="search-sources-trigger-arrow" aria-hidden="true">
                →
              </span>
            </button>
          )}
        </article>
      )}
    </>
  );
}

function SearchSourcesDrawer({
  state,
  onClose,
}: {
  state: SourceDrawerState;
  onClose: () => void;
}) {
  const activeSourceRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    activeSourceRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [state.activeUrl]);

  return (
    <>
      <button
        className="search-drawer-backdrop"
        type="button"
        aria-label="关闭搜索结果"
        onClick={onClose}
      />
      <aside
        className="search-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="搜索结果"
      >
        <div className="search-drawer-header">
          <div>
            <span className="search-drawer-eyebrow">WEB SOURCES</span>
            <h2>搜索结果</h2>
          </div>
          <button
            className="search-drawer-close"
            type="button"
            aria-label="关闭搜索结果"
            onClick={onClose}
          >
            <X size={19} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="search-drawer-list">
          {state.sources.map((source, index) => {
            const isActive =
              normalizeSourceUrl(source.url) ===
              normalizeSourceUrl(state.activeUrl ?? "");

            return (
              <a
                className={`search-result-card ${
                  isActive ? "is-active" : ""
                }`}
                href={source.url}
                key={source.id}
                ref={isActive ? activeSourceRef : undefined}
                target="_blank"
                rel="noreferrer"
              >
                <div className="search-result-meta">
                  <span className="search-result-icon" aria-hidden="true">
                    <GlobeHemisphereWest size={15} weight="fill" />
                    {source.icon && (
                      <span
                        className="search-result-icon-image"
                        style={{
                          backgroundImage: `url(${JSON.stringify(source.icon)})`,
                        }}
                      />
                    )}
                  </span>
                  <span>{source.media || `来源 ${index + 1}`}</span>
                  {source.publishDate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <time>{source.publishDate}</time>
                    </>
                  )}
                </div>
                <strong>{source.title}</strong>
                {source.snippet && <p>{source.snippet}</p>}
                <span className="search-result-open">
                  打开原文
                  <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
                </span>
              </a>
            );
          })}
        </div>
      </aside>
    </>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [deepThinking, setDeepThinking] = useState(true);
  const [webSearch, setWebSearch] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ModelId>(defaultModelId);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceDrawer, setSourceDrawer] =
    useState<SourceDrawerState | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreviewState | null>(null);
  const [attachmentPreviewScale, setAttachmentPreviewScale] = useState(
    minAttachmentPreviewScale,
  );
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [conversationHistory, setConversationHistory] = useState<
    StoredConversation[]
  >(readConversationHistory);
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
  } = useChat<ChatMessage>();
  const chatStageRef = useRef<HTMLElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldFollowOutputRef = useRef(true);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentUrlsRef = useRef(new Set<string>());
  const activePreviewObjectUrlRef = useRef<string | null>(null);
  const attachmentPreviewCloseRef = useRef<HTMLButtonElement>(null);
  const submittingMessageRef = useRef(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const isBusy = status === "submitted" || status === "streaming";
  const hasBlockingAttachments = attachments.some(
    (attachment) => attachment.status !== "ready",
  );
  const readyAttachments = attachments.filter(
    (attachment) => attachment.status === "ready",
  );
  const canSend =
    !isBusy &&
    !hasBlockingAttachments &&
    (Boolean(input.trim()) || readyAttachments.length > 0);
  const latestMessageId = messages[messages.length - 1]?.id;

  const persistConversation = useCallback(
    (
      conversationId: string,
      conversationMessages: ChatMessage[],
      thinkingEnabled: boolean,
      webSearchEnabled: boolean,
      model: ModelId,
    ) => {
      if (conversationMessages.length === 0) return;

      const storedMessages = stripFilePartsForStorage(conversationMessages);

      const conversation: StoredConversation = {
        id: conversationId,
        title: getConversationTitle(conversationMessages),
        updatedAt: Date.now(),
        deepThinking: thinkingEnabled,
        webSearch: webSearchEnabled,
        model,
        messages: storedMessages,
      };

      setConversationHistory((currentHistory) => {
        const nextHistory = [
          conversation,
          ...currentHistory.filter((item) => item.id !== conversationId),
        ].slice(0, maxStoredConversations);
        const retainedConversationIds = new Set(
          nextHistory.map((item) => item.id),
        );
        const removedAttachmentIds = currentHistory
          .filter((item) => !retainedConversationIds.has(item.id))
          .flatMap((item) => getAttachmentIds(item.messages));

        writeConversationHistory(nextHistory);
        cleanupAttachmentPreviews(removedAttachmentIds);
        return nextHistory;
      });
    },
    [],
  );

  const openSourceDrawer = useCallback((state: SourceDrawerState) => {
    setSourceDrawer(state);
  }, []);

  const closeSourceDrawer = useCallback(() => {
    setSourceDrawer(null);
  }, []);

  const closeAttachmentPreview = useCallback(() => {
    if (activePreviewObjectUrlRef.current) {
      URL.revokeObjectURL(activePreviewObjectUrlRef.current);
      activePreviewObjectUrlRef.current = null;
    }
    setAttachmentPreviewScale(minAttachmentPreviewScale);
    setAttachmentPreview(null);
  }, []);

  const handleChatScroll = useCallback(
    (event: ReactUIEvent<HTMLElement>) => {
      const container = event.currentTarget;
      const distanceFromBottom =
        container.scrollHeight -
        container.scrollTop -
        container.clientHeight;

      shouldFollowOutputRef.current =
        distanceFromBottom <= autoScrollThreshold;
    },
    [],
  );

  const scrollToLatest = useCallback(() => {
    if (!shouldFollowOutputRef.current) return;
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = chatStageRef.current;
      if (!container || !shouldFollowOutputRef.current) return;

      container.scrollTop = container.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToLatest();
  }, [messages, scrollToLatest, status]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }

      attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      attachmentUrlsRef.current.clear();
      if (activePreviewObjectUrlRef.current) {
        URL.revokeObjectURL(activePreviewObjectUrlRef.current);
        activePreviewObjectUrlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!attachmentPreview) return;

    attachmentPreviewCloseRef.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeAttachmentPreview();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [attachmentPreview, closeAttachmentPreview]);

  useEffect(() => {
    const container = chatStageRef.current;
    if (!container) return;

    const outputObserver = new MutationObserver(scrollToLatest);
    outputObserver.observe(container, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      outputObserver.disconnect();
    };
  }, [scrollToLatest]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (!modelMenuOpen) return;

    const closeModelMenu = (event: MouseEvent) => {
      if (
        modelPickerRef.current &&
        !modelPickerRef.current.contains(event.target as Node)
      ) {
        setModelMenuOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeModelMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeModelMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!activeConversationId || messages.length === 0) return;

    const saveTimer = window.setTimeout(() => {
      persistConversation(
        activeConversationId,
        messages,
        deepThinking,
        webSearch,
        selectedModel,
      );
    }, 250);

    return () => window.clearTimeout(saveTimer);
  }, [
    activeConversationId,
    deepThinking,
    messages,
    persistConversation,
    selectedModel,
    webSearch,
  ]);

  function openPendingAttachmentPreview(attachment: PendingAttachment) {
    if (activePreviewObjectUrlRef.current) {
      URL.revokeObjectURL(activePreviewObjectUrlRef.current);
      activePreviewObjectUrlRef.current = null;
    }
    setAttachmentPreviewScale(minAttachmentPreviewScale);
    setAttachmentPreview({
      name: attachment.name,
      url: attachment.previewUrl,
    });
  }

  async function openStoredAttachmentPreview(
    attachment: ExtractedAttachment,
  ) {
    if (previewLoadingId) return;

    setPreviewLoadingId(attachment.id);
    setAttachmentNotice("");
    try {
      const blob = await getAttachmentPreview(attachment.id);
      if (!blob) {
        setAttachmentNotice(
          "未找到这张图片的本地预览，可能已被浏览器清理。",
        );
        return;
      }

      if (activePreviewObjectUrlRef.current) {
        URL.revokeObjectURL(activePreviewObjectUrlRef.current);
      }
      const previewUrl = URL.createObjectURL(blob);
      activePreviewObjectUrlRef.current = previewUrl;
      setAttachmentPreviewScale(minAttachmentPreviewScale);
      setAttachmentPreview({ name: attachment.name, url: previewUrl });
    } catch {
      setAttachmentNotice("图片预览读取失败，请稍后重试。");
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function processAttachment(id: string, file: File, model: ModelId) {
    const processingMode = getAttachmentInputMode(model);

    setAttachments((current) =>
      current.map((attachment) =>
        attachment.id === id
          ? {
              ...attachment,
              processingMode,
              status: "processing",
              text: undefined,
              truncated: undefined,
              error: undefined,
            }
          : attachment,
      ),
    );

    try {
      const uploadFile = await prepareAttachmentUpload(file);

      if (processingMode === "vision") {
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === id &&
            attachment.processingMode === processingMode
              ? {
                  ...attachment,
                  status: "ready",
                  previewBlob: uploadFile,
                  text: undefined,
                  truncated: false,
                  error: undefined,
                }
              : attachment,
          ),
        );
        return;
      }

      const response = await fetch("/api/attachments/ocr", {
        method: "POST",
        headers: { "Content-Type": uploadFile.type },
        body: uploadFile,
      });
      const result = await readAttachmentResponse(response);

      if (!response.ok || typeof result.text !== "string") {
        const fallbackMessage =
          response.status === 413
            ? "图片处理请求过大，请压缩后重试。"
            : "附件读取失败，请稍后重试。";
        throw new Error(
          typeof result.error === "string" &&
            result.error !== "Payload Too Large"
            ? result.error
            : fallbackMessage,
        );
      }

      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === id &&
          attachment.processingMode === processingMode
            ? {
                ...attachment,
                status: "ready",
                previewBlob: uploadFile,
                text: result.text as string,
                truncated: result.truncated === true,
                error: undefined,
              }
            : attachment,
        ),
      );
    } catch (attachmentError) {
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === id &&
          attachment.processingMode === processingMode
            ? {
                ...attachment,
                status: "error",
                error:
                  attachmentError instanceof Error
                    ? attachmentError.message
                    : "附件读取失败，请稍后重试。",
              }
            : attachment,
        ),
      );
    }
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length === 0 || isBusy) return;

    const remainingSlots = maxAttachmentCount - attachments.length;
    if (remainingSlots <= 0) {
      setAttachmentNotice(`每次最多添加 ${maxAttachmentCount} 张图片。`);
      return;
    }

    const acceptedFiles: PendingAttachment[] = [];
    const processingMode = getAttachmentInputMode(selectedModel);
    let notice =
      selectedFiles.length > remainingSlots
        ? `每次最多添加 ${maxAttachmentCount} 张图片。`
        : "";

    selectedFiles.slice(0, remainingSlots).forEach((file) => {
      if (!isAttachmentMimeType(file.type)) {
        notice = "仅支持 JPEG、PNG 和 WebP 图片。";
        return;
      }

      if (file.size === 0) {
        notice = "不能添加空图片。";
        return;
      }

      if (file.size > maxAttachmentSourceBytes) {
        notice = "单张原始图片不能超过 100 MB。";
        return;
      }

      const id = createConversationId();
      const previewUrl = URL.createObjectURL(file);
      attachmentUrlsRef.current.add(previewUrl);
      acceptedFiles.push({
        id,
        file,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        previewUrl,
        processingMode,
        status: "processing",
      });
    });

    setAttachmentNotice(notice);
    if (acceptedFiles.length === 0) return;

    setAttachments((current) => [...current, ...acceptedFiles]);
    acceptedFiles.forEach((attachment) => {
      void processAttachment(attachment.id, attachment.file, selectedModel);
    });
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const removedAttachment = current.find(
        (attachment) => attachment.id === id,
      );
      if (removedAttachment) {
        URL.revokeObjectURL(removedAttachment.previewUrl);
        attachmentUrlsRef.current.delete(removedAttachment.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== id);
    });
    setAttachmentNotice("");
  }

  function retryAttachment(id: string) {
    const attachment = attachments.find((item) => item.id === id);
    if (attachment) void processAttachment(id, attachment.file, selectedModel);
  }

  function selectModel(model: ModelId) {
    const inputModeChanged =
      getAttachmentInputMode(model) !== getAttachmentInputMode(selectedModel);

    setSelectedModel(model);
    if (modelAlwaysThinks(model)) setDeepThinking(true);
    setModelMenuOpen(false);

    if (inputModeChanged) {
      setAttachmentNotice("");
      attachments.forEach((attachment) => {
        void processAttachment(attachment.id, attachment.file, model);
      });
    }
  }

  function clearComposerAttachments() {
    attachments.forEach((attachment) => {
      URL.revokeObjectURL(attachment.previewUrl);
      attachmentUrlsRef.current.delete(attachment.previewUrl);
    });
    setAttachments([]);
    setAttachmentNotice("");
  }

  async function submitMessage(text: string) {
    const message = text.trim();
    if (!canSend || submittingMessageRef.current) return;
    submittingMessageRef.current = true;

    const previewSaveResults = await Promise.allSettled(
      readyAttachments.map((attachment) =>
        saveAttachmentPreview(
          attachment.id,
          attachment.previewBlob ?? attachment.file,
        ),
      ),
    );
    const previewSaveFailed = previewSaveResults.some(
      (result) => result.status === "rejected",
    );

    const attachmentData: ExtractedAttachment[] = readyAttachments.map(
      (attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        text: attachment.text ?? "",
        truncated: attachment.truncated === true,
        inputMode: attachment.processingMode,
      }),
    );
    let visionFileParts: FileUIPart[] = [];

    if (modelSupportsImageInput(selectedModel)) {
      try {
        visionFileParts = await Promise.all(
          readyAttachments.map(async (attachment) => ({
            type: "file" as const,
            mediaType:
              attachment.previewBlob?.type || attachment.mimeType,
            filename: attachment.name,
            url: await blobToDataUrl(
              attachment.previewBlob ?? attachment.file,
            ),
          })),
        );
      } catch {
        setAttachmentNotice("图片读取失败，请重试或重新添加图片。");
        submittingMessageRef.current = false;
        return;
      }
    }
    const visibleMessage = message || "请阅读并总结附件内容。";

    shouldFollowOutputRef.current = true;

    const conversationId =
      activeConversationId ?? createConversationId();

    if (!activeConversationId) {
      setActiveConversationId(conversationId);
    }

    clearError();
    setInput("");
    clearComposerAttachments();
    if (previewSaveFailed) {
      setAttachmentNotice(
        "消息已发送，但部分图片预览未能保存在当前浏览器。",
      );
    }

    try {
      await sendMessage(
        {
          role: "user",
          parts: [
            { type: "text", text: visibleMessage },
            ...(attachmentData.length > 0
              ? [
                  {
                    type: "data-attachments" as const,
                    data: attachmentData,
                  },
                ]
              : []),
            ...visionFileParts,
          ],
        },
        {
          body: {
            deepThinking: modelAlwaysThinks(selectedModel) || deepThinking,
            webSearch: modelSupportsWebSearch(selectedModel) && webSearch,
            model: selectedModel,
          },
        },
      );
    } finally {
      submittingMessageRef.current = false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage(input);
    }
  }

  function handleSuggestionClick(suggestion: string) {
    setInput(suggestion);
    composerTextareaRef.current?.focus();
  }

  function saveCurrentConversation() {
    if (activeConversationId && messages.length > 0) {
      persistConversation(
        activeConversationId,
        messages,
        deepThinking,
        webSearch,
        selectedModel,
      );
    }
  }

  function startNewConversation() {
    saveCurrentConversation();
    if (isBusy) stop();
    shouldFollowOutputRef.current = true;
    setMessages([]);
    setActiveConversationId(null);
    setInput("");
    clearComposerAttachments();
    setDeepThinking(true);
    setWebSearch(true);
    setSelectedModel(defaultModelId);
    setModelMenuOpen(false);
    setSourceDrawer(null);
    clearError();
    setHistoryOpen(false);
  }

  async function openConversation(conversation: StoredConversation) {
    saveCurrentConversation();
    if (isBusy) stop();
    shouldFollowOutputRef.current = true;
    setMessages(
      await restoreVisionFileParts(
        conversation.messages,
        conversation.model,
      ),
    );
    clearComposerAttachments();
    setActiveConversationId(conversation.id);
    setDeepThinking(
      modelAlwaysThinks(conversation.model) || conversation.deepThinking,
    );
    setWebSearch(conversation.webSearch);
    setSelectedModel(conversation.model);
    setModelMenuOpen(false);
    setSourceDrawer(null);
    clearError();
    setHistoryOpen(false);
  }

  function deleteConversation(conversationId: string) {
    setConversationHistory((currentHistory) => {
      const removedConversation = currentHistory.find(
        (conversation) => conversation.id === conversationId,
      );
      const nextHistory = currentHistory.filter(
        (conversation) => conversation.id !== conversationId,
      );
      writeConversationHistory(nextHistory);
      cleanupAttachmentPreviews(
        removedConversation
          ? getAttachmentIds(removedConversation.messages)
          : [],
      );
      return nextHistory;
    });

    if (activeConversationId === conversationId) {
      if (isBusy) stop();
      setMessages([]);
      clearComposerAttachments();
      setActiveConversationId(null);
      setDeepThinking(true);
      setWebSearch(true);
      setSelectedModel(defaultModelId);
      setModelMenuOpen(false);
      setSourceDrawer(null);
    }
  }

  return (
    <main className="app-shell">
      {sourceDrawer && (
        <SearchSourcesDrawer
          state={sourceDrawer}
          onClose={closeSourceDrawer}
        />
      )}

      {attachmentPreview && (
        <>
          <button
            className="attachment-preview-backdrop"
            type="button"
            aria-label="关闭图片预览"
            onClick={closeAttachmentPreview}
          />
          <section
            className="attachment-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`图片预览：${attachmentPreview.name}`}
          >
            <TransformWrapper
              key={attachmentPreview.url}
              initialScale={minAttachmentPreviewScale}
              minScale={minAttachmentPreviewScale}
              maxScale={maxAttachmentPreviewScale}
              limitToBounds={false}
              centerOnInit
              centerZoomedOut
              disablePadding
              smooth={false}
              wheel={{ step: attachmentPreviewScaleStep }}
              panning={{ velocityDisabled: true }}
              pinch={{ step: 5, allowPanning: true }}
              doubleClick={{ mode: "toggle", step: 1, animationTime: 120 }}
              zoomAnimation={{ disabled: true }}
              autoAlignment={{ disabled: true }}
              velocityAnimation={{ disabled: true }}
              onTransform={(_, state) =>
                setAttachmentPreviewScale(state.scale)
              }
            >
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  <header className="attachment-preview-header">
                    <strong title={attachmentPreview.name}>
                      {attachmentPreview.name}
                    </strong>
                    <div className="attachment-preview-actions">
                      <div
                        className="attachment-preview-zoom-controls"
                        aria-label="图片缩放"
                      >
                        <button
                          type="button"
                          aria-label="缩小图片"
                          title="缩小图片"
                          disabled={
                            attachmentPreviewScale <=
                            minAttachmentPreviewScale
                          }
                          onClick={() =>
                            zoomOut(attachmentPreviewScaleStep, 0)
                          }
                        >
                          <MagnifyingGlassMinus
                            size={18}
                            weight="bold"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          className="attachment-preview-percent"
                          type="button"
                          aria-label="恢复图片为 100%"
                          title="恢复为 100%"
                          onClick={() => resetTransform(0)}
                        >
                          {Math.round(attachmentPreviewScale * 100)}%
                        </button>
                        <button
                          type="button"
                          aria-label="放大图片"
                          title="放大图片"
                          disabled={
                            attachmentPreviewScale >=
                            maxAttachmentPreviewScale
                          }
                          onClick={() =>
                            zoomIn(attachmentPreviewScaleStep, 0)
                          }
                        >
                          <MagnifyingGlassPlus
                            size={18}
                            weight="bold"
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                      <button
                        ref={attachmentPreviewCloseRef}
                        type="button"
                        aria-label="关闭图片预览"
                        title="关闭图片预览"
                        onClick={closeAttachmentPreview}
                      >
                        <X size={18} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  </header>
                  <TransformComponent
                    wrapperClass="attachment-preview-canvas"
                    contentClass="attachment-preview-content"
                    wrapperProps={{ "aria-label": "图片缩放画布" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="attachment-preview-image"
                      src={attachmentPreview.url}
                      alt={attachmentPreview.name}
                      draggable={false}
                    />
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>
          </section>
        </>
      )}

      {historyOpen && (
        <>
          <button
            className="history-backdrop"
            type="button"
            aria-label="关闭历史对话"
            onClick={() => setHistoryOpen(false)}
          />
          <aside
            className="history-panel"
            role="dialog"
            aria-modal="true"
            aria-label="历史对话"
          >
            <div className="history-panel-header">
              <div>
                <span className="history-eyebrow">LOCAL HISTORY</span>
                <h2>历史对话</h2>
              </div>
              <button
                className="history-close"
                type="button"
                aria-label="关闭历史对话"
                onClick={() => setHistoryOpen(false)}
              >
                ×
              </button>
            </div>

            <button
              className="new-chat-button"
              type="button"
              onClick={startNewConversation}
            >
              <span aria-hidden="true">＋</span>
              新对话
            </button>

            <div className="history-list">
              {conversationHistory.length > 0 ? (
                conversationHistory.map((conversation) => (
                  <div
                    className={`history-item ${
                      conversation.id === activeConversationId
                        ? "is-active"
                        : ""
                    }`}
                    key={conversation.id}
                  >
                    <button
                      className="history-item-main"
                      type="button"
                      onClick={() => void openConversation(conversation)}
                    >
                      <span className="history-title">
                        {conversation.title}
                      </span>
                      <span className="history-meta">
                        {conversation.deepThinking ? "深度思考" : "快速回答"}
                        <span aria-hidden="true"> · </span>
                        {modelSupportsWebSearch(conversation.model) &&
                          (conversation.webSearch ? "联网" : "未联网")}
                        {modelSupportsWebSearch(conversation.model) && (
                          <span aria-hidden="true"> · </span>
                        )}
                        {getModelLabel(conversation.model)}
                        <span aria-hidden="true"> · </span>
                        {historyDateFormatter.format(conversation.updatedAt)}
                      </span>
                    </button>
                    <button
                      className="history-delete"
                      type="button"
                      aria-label={`删除对话：${conversation.title}`}
                      onClick={() => deleteConversation(conversation.id)}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <div className="history-empty">
                  <span aria-hidden="true">☁</span>
                  <p>还没有历史对话</p>
                  <small>开始提问后会自动保存在这里</small>
                </div>
              )}
            </div>

            <p className="history-footnote">
              对话仅保存在当前浏览器，最多保留 20 条
            </p>
          </aside>
        </>
      )}

      <header className="topbar">
        <Link className="brand" href="/" aria-label="一二的小笨助手首页">
          <span className="brand-icon" aria-hidden="true" />
          <span>一二的小笨助手</span>
        </Link>

        <div className="topbar-actions">
          <button
            className="history-trigger"
            type="button"
            onClick={() => setHistoryOpen(true)}
          >
            <span aria-hidden="true">◷</span>
            <span>历史对话</span>
          </button>
        </div>
      </header>

      <section
        ref={chatStageRef}
        className={`chat-stage ${messages.length === 0 ? "is-empty" : ""}`}
        aria-label="AI 对话"
        onScroll={handleChatScroll}
        tabIndex={0}
      >
        {messages.length === 0 ? (
          <div className="welcome">
            <h1 aria-label={assistantName}>
              {Array.from(assistantName).map((character, index) => (
                <span
                  aria-hidden="true"
                  className={`title-character title-character-${index + 1}`}
                  key={`${character}-${index}`}
                >
                  {character}
                </span>
              ))}
            </h1>
            <p>一个小笨AI想要回答一二完成各种问题</p>

            <div className="suggestion-grid" aria-label="试试这些问题">
              {suggestions.map((suggestion, index) => (
                <button
                  className="suggestion-card"
                  key={suggestion}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  <span className="suggestion-number">0{index + 1}</span>
                  <span>{suggestion}</span>
                  <span className="suggestion-arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list" aria-live="polite">
            {messages.map((message) => {
              const isLatest = message.id === latestMessageId;

              if (message.role === "assistant") {
                return (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    isLatest={isLatest}
                    isBusy={isBusy}
                    thinkingExpected={
                      modelAlwaysThinks(selectedModel) || deepThinking
                    }
                    hasError={Boolean(error)}
                    onOpenSources={openSourceDrawer}
                  />
                );
              }

              const rawQuestionText = message.parts
                .filter(
                  (
                    part,
                  ): part is Extract<
                    (typeof message.parts)[number],
                    { type: "text" }
                  > => part.type === "text",
                )
                .map((part) => part.text)
                .join("\n");
              const {
                activityText: searchActivityText,
                cleanText: questionText,
              } = extractSearchActivity(rawQuestionText);
              const questionAttachments = message.parts.flatMap((part) =>
                part.type === "data-attachments" ? part.data : [],
              );

              return (
                <div className="user-message-group" key={message.id}>
                  <article
                    className={`message message-${message.role}`}
                  >
                    <div className="message-meta">
                      <span className="avatar" aria-hidden="true">
                        你
                      </span>
                      <span>你的问题</span>
                    </div>

                    <div className="message-content">
                      {questionAttachments.length > 0 && (
                        <div
                          className="message-attachment-list"
                          aria-label="本条消息的附件"
                        >
                          {questionAttachments.map((attachment) => (
                            <button
                              className="message-attachment"
                              title={`${attachment.name} · ${formatFileSize(attachment.size)}`}
                              key={attachment.id}
                              type="button"
                              aria-label={`预览附件 ${attachment.name}`}
                              aria-busy={previewLoadingId === attachment.id}
                              disabled={previewLoadingId === attachment.id}
                              onClick={() =>
                                void openStoredAttachmentPreview(attachment)
                              }
                            >
                              {previewLoadingId === attachment.id ? (
                                <SpinnerGap
                                  className="message-attachment-spinner"
                                  size={15}
                                  weight="bold"
                                  aria-hidden="true"
                                />
                              ) : (
                                <FileImage
                                  size={15}
                                  weight="bold"
                                  aria-hidden="true"
                                />
                              )}
                              <span>{attachment.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <p>{questionText}</p>
                    </div>
                  </article>

                  {searchActivityText && (
                    <SearchActivityNote text={searchActivityText} />
                  )}
                </div>
              );
            })}

            {status === "submitted" && deepThinking && (
              <ReasoningBlock
                text=""
                status="waiting"
              />
            )}

            {status === "error" &&
              deepThinking &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <ReasoningBlock text="" status="error" />
              )}

            <div aria-hidden="true" />
          </div>
        )}
      </section>

      <div className="composer-wrap">
        {error && (
          <div className="error-banner" role="alert">
            <span>请求失败，请稍后重试。</span>
            <button type="button" onClick={clearError}>
              关闭
            </button>
          </div>
        )}

        {attachmentNotice && (
          <div className="attachment-notice" role="alert">
            <span>{attachmentNotice}</span>
            <button
              type="button"
              aria-label="关闭附件提示"
              onClick={() => setAttachmentNotice("")}
            >
              <X size={14} weight="bold" aria-hidden="true" />
            </button>
          </div>
        )}

        <form className="composer" onSubmit={handleSubmit}>
          <input
            ref={attachmentInputRef}
            className="attachment-input"
            type="file"
            accept={attachmentAccept}
            multiple
            disabled={isBusy || attachments.length >= maxAttachmentCount}
            onChange={handleAttachmentChange}
          />

          {attachments.length > 0 && (
            <div className="attachment-tray" aria-live="polite">
              {attachments.map((attachment) => (
                <div
                  className={`attachment-item attachment-${attachment.status}`}
                  key={attachment.id}
                >
                  <button
                    className="attachment-thumbnail"
                    type="button"
                    aria-label={`预览附件 ${attachment.name}`}
                    onClick={() => openPendingAttachmentPreview(attachment)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachment.previewUrl} alt="" />
                    {attachment.status === "processing" && (
                      <span
                        className="attachment-progress"
                        aria-label="正在读取附件"
                      >
                        <SpinnerGap
                          size={20}
                          weight="bold"
                          aria-hidden="true"
                        />
                      </span>
                    )}
                    {attachment.status === "ready" && (
                      <span
                        className="attachment-ready-badge"
                        aria-label="附件已读取"
                      >
                        <Check size={12} weight="bold" aria-hidden="true" />
                      </span>
                    )}
                  </button>

                  <div className="attachment-copy">
                    <strong title={attachment.name}>{attachment.name}</strong>
                    {attachment.status === "processing" && (
                      <small>正在读取附件…</small>
                    )}
                    {attachment.status === "ready" && (
                      <small>
                        {formatFileSize(attachment.size)}
                        {attachment.truncated ? " · 内容已截断" : " · 已就绪"}
                      </small>
                    )}
                    {attachment.status === "error" && (
                      <button
                        className="attachment-retry"
                        type="button"
                        title={attachment.error}
                        onClick={() => retryAttachment(attachment.id)}
                      >
                        <ArrowClockwise
                          size={12}
                          weight="bold"
                          aria-hidden="true"
                        />
                        重试
                      </button>
                    )}
                  </div>

                  <button
                    className="attachment-remove"
                    type="button"
                    aria-label={`删除附件 ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X size={13} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={composerTextareaRef}
            aria-label="输入消息"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="给一二的小笨助手发送消息"
            rows={2}
            disabled={isBusy}
          />

          <div className="composer-toolbar">
            <div className="composer-options">
              <label className="thinking-option">
                <input
                  type="checkbox"
                  checked={modelAlwaysThinks(selectedModel) || deepThinking}
                  disabled={isBusy || modelAlwaysThinks(selectedModel)}
                  onChange={(event) =>
                    setDeepThinking(event.target.checked)
                  }
                />
                <Atom size={15} weight="bold" aria-hidden="true" />
                <span className="option-label-desktop">深度思考</span>
                <span className="option-label-mobile">思考</span>
              </label>
              {modelSupportsWebSearch(selectedModel) && (
                <label className="thinking-option search-option">
                  <input
                    type="checkbox"
                    checked={webSearch}
                    disabled={isBusy}
                    onChange={(event) => setWebSearch(event.target.checked)}
                  />
                  <GlobeHemisphereWest
                    size={15}
                    weight="bold"
                    aria-hidden="true"
                  />
                  <span className="option-label-desktop">联网搜索</span>
                  <span className="option-label-mobile">搜索</span>
                </label>
              )}
            </div>

            <div className="composer-actions">
              <div className="model-picker" ref={modelPickerRef}>
                {modelMenuOpen && (
                  <div
                    className="model-menu"
                    role="listbox"
                    aria-label="选择对话模型"
                  >
                    <div className="model-menu-heading">选择模型</div>
                    {modelOptions.map((option) => {
                      const isSelected = selectedModel === option.id;

                      return (
                        <button
                          className={`model-menu-item ${
                            isSelected ? "is-selected" : ""
                          }`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          key={option.id}
                          onClick={() => selectModel(option.id)}
                        >
                          <span className="model-menu-icon" aria-hidden="true">
                            <Cpu size={17} weight="bold" />
                          </span>
                          <span className="model-menu-copy">
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                          {isSelected && (
                            <Check
                              className="model-menu-check"
                              size={16}
                              weight="bold"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <button
                  className="model-picker-trigger"
                  type="button"
                  aria-label={`选择模型，当前 ${getModelLabel(selectedModel)}`}
                  title={`当前模型：${getModelLabel(selectedModel)}`}
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  disabled={isBusy}
                  onClick={() => setModelMenuOpen((open) => !open)}
                >
                  <Cpu size={15} weight="bold" aria-hidden="true" />
                  <span className="model-picker-label">
                    {getModelLabel(selectedModel)}
                  </span>
                  <CaretDown
                    className={`model-picker-caret ${
                      modelMenuOpen ? "is-open" : ""
                    }`}
                    size={13}
                    weight="bold"
                    aria-hidden="true"
                  />
                </button>
              </div>

              <div className="attachment-button-wrap">
                <div
                  className="attachment-tooltip"
                  id="attachment-upload-tip"
                  role="tooltip"
                >
                  <span>支持 JPEG、PNG、WebP 图片</span>
                  <span>
                    最多 {maxAttachmentCount} 张，每张 100 MB
                  </span>
                </div>
                <button
                  className="attachment-button"
                  type="button"
                  aria-label="添加图片附件"
                  aria-describedby="attachment-upload-tip"
                  disabled={isBusy || attachments.length >= maxAttachmentCount}
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  <Paperclip size={19} weight="bold" aria-hidden="true" />
                </button>
              </div>

              {isBusy ? (
                <button
                  className="send-button stop-button"
                  type="button"
                  onClick={stop}
                  aria-label="停止生成"
                >
                  <Stop size={14} weight="fill" aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  disabled={!canSend}
                  aria-label="发送消息"
                >
                  <ArrowUp size={19} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
