# 模型选择器视觉 QA

- source visual truth path: `C:\Users\xbwu02\AppData\Local\Temp\codex-clipboard-754a43db-0fe5-47dd-9f12-271470555849.png`
- implementation screenshot path: `F:\aiagent\qa-model-picker-page-final.png`
- focused implementation path: `F:\aiagent\qa-model-picker-implementation-final.png`
- full comparison path: `F:\aiagent\qa-model-picker-comparison.png`
- desktop viewport: 1280 × 720 CSS px, device scale factor 1
- mobile viewport: 390 × 844 CSS px, device scale factor 1
- source pixels: 428 × 431
- implementation full pixels: 1280 × 720
- implementation focused pixels: 360 × 240
- state: 模型菜单展开，GLM-5.2 选中；另验证 GLM-4.7 切换成功

## Findings

- 无 P0/P1/P2 问题。
- 参考图的核心结构已保留：发送按钮左侧的当前模型触发器、向上展开菜单、选中状态标记和固定模型列表。
- 深色参考主题已按现有应用的奶油白、珊瑚色和动漫圆角设计系统适配；这是有意的产品一致性调整。
- 右上角不再显示模型状态，只保留历史对话入口。

## Required fidelity surfaces

- Fonts and typography: 沿用应用现有圆体；模型名称 13px/700，说明文字 10px，层级清晰。
- Spacing and layout rhythm: 触发器紧邻发送按钮；菜单宽 226px、向上展开，桌面和 390px 移动端均未遮挡发送按钮。
- Colors and visual tokens: 选中态使用现有珊瑚色 token，保持足够对比度并与输入框一致。
- Image quality and asset fidelity: 本功能无新增位图；CPU、勾选、箭头均使用现有 Phosphor 图标库。
- Copy and content: 固定提供 GLM-5.2 与 GLM-4.7，不提供自定义模型入口。

## Interaction and responsive checks

- 模型菜单可展开和关闭。
- GLM-4.7 可选中，触发器文本随之更新，菜单自动关闭。
- 点击外部和 Escape 可关闭菜单。
- 生成期间模型选择器禁用，防止一次请求中途切换模型。
- 390 × 844 下菜单完整可见，横向滚动条已隐藏。
- 当前预览控制台无错误或警告。

## Comparison history

- P2: 首轮移动端检查出现横向滚动条。
- Fix: 为页面加入 `overflow-x: clip`，保留向上浮层并消除页面横向滚动。
- Post-fix evidence: `F:\aiagent\qa-model-picker-mobile-final.png`，390 × 844 下无可见横向滚动条。

## Focused comparison

使用 `qa-model-picker-comparison.png` 对比参考菜单与实现菜单。实现按现有品牌主题适配，但模型入口位置、菜单方向、选中反馈和信息层级均与参考目标一致，因此无进一步 P0/P1/P2 修复项。

final result: passed
