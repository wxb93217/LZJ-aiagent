import type { UIMessage } from "ai";

export type SearchSource = {
  id: string;
  title: string;
  url: string;
  media: string;
  publishDate: string;
  snippet: string;
  icon: string;
};

export type ExtractedAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  text: string;
  truncated: boolean;
};

export type ChatDataParts = {
  searchSources: SearchSource[];
  attachments: ExtractedAttachment[];
};

export type ChatMessage = UIMessage<unknown, ChatDataParts>;

const searchActivityPattern =
  /搜索\s*\d+\s*个关键词\s*[，,]\s*参考\s*\d+\s*篇资料[。.]?/;

export function extractSearchActivity(text: string) {
  const match = text.match(searchActivityPattern);

  return {
    activityText: match?.[0].replace(/[。.]$/, "") ?? "",
    cleanText: match
      ? text
          .replace(match[0], "")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      : text,
  };
}
