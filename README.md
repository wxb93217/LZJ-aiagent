# 一二的小笨助手

一个使用 Next.js App Router 与 Vercel AI SDK 构建的流式聊天应用。服务端通过
智谱的 OpenAI 兼容接口调用 `glm-5.2`，客户端使用 `useChat` 实时接收
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
ZHIPU_API_KEY=你的智谱密钥
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-5.2
```

如果使用的是 GLM Coding Plan 套餐，把 `ZHIPU_BASE_URL` 改为
`https://open.bigmodel.cn/api/coding/paas/v4`。普通开放平台 Key 和 Coding
Plan Key 使用不同端点。

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
