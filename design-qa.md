# 输入框视觉 QA

- 参考图：`C:\Users\xbwu02\AppData\Local\Temp\codex-clipboard-2cd1fa9d-74f3-44f1-b03c-b2cbe0a8cbbf.png`
- 实现截图：`F:\aiagent\qa-input-composer-final.png`
- 对比图：`F:\aiagent\qa-input-comparison-final.png`
- 视口：754 × 600
- 最终结果：通过

## 检查结果

- 输入区已改为白色半透明圆角卡片，边框、阴影和 23px 圆角与参考图接近。
- 文本输入区位于上方，操作栏独立放在底部；整体宽度 703px，参考图约 699px。
- “深度思考”使用带图标的胶囊按钮，并保留默认勾选、聚焦、禁用状态。
- 发送操作改为圆形上箭头按钮；生成中切换为停止图标。
- 文本框支持自动增高，最大高度 160px，避免长问题挤压页面。
- 未添加无后端能力支撑的“智能搜索”和附件入口，避免出现不可用控件。
- 754px 视口下未发现裁切、重叠、横向溢出或对齐错误。

## 验证

- ESLint：通过
- TypeScript：通过
- Vinext 生产构建：通过
- 渲染结构测试：通过
