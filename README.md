# 流光对话

一个使用 Next.js App Router 与 Vercel AI SDK 构建的流式聊天应用。服务端通过
Vercel AI Gateway 调用 `openai/gpt-5-mini`，客户端使用 `useChat` 实时接收
UI Message Stream。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后在 `.env.local` 中填写：

```dotenv
AI_GATEWAY_API_KEY=你的密钥
```

## 主要文件

- `app/api/chat/route.ts`：App Router 流式聊天接口
- `app/page.tsx`：聊天页面和流式交互
- `app/globals.css`：响应式视觉样式
- `.env.example`：环境变量模板

## 验证

```bash
npm run build
npm run lint
npm test
```

AI SDK 的请求错误会在前端显示为可关闭提示；接口也限制了会话数量和请求体大小，
避免无界上下文进入模型。
