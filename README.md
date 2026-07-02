# Questflow 2API

> ⚠️ **免责声明：本项目仅供学习研究使用，不保证稳定性与可用性。请遵守 Questflow 的服务条款，使用本项目造成的任何后果由使用者自行承担。**

将 [Questflow AI](https://next.questflow.ai/) 的 TARS 聊天接口反向代理为 **OpenAI 兼容格式** 的 API 服务，使你能够在任何支持 OpenAI API 的客户端或应用中使用 Questflow 的 AI 能力。

## 功能特性

- ✅ 支持 OpenAI 兼容的 `/v1/chat/completions` 接口
- ✅ 支持 **SSE 流式输出** 和非流式输出
- ✅ 支持 `/v1/models` 获取模型列表
- ✅ 支持多种认证方式 (Cookie / Bearer / API Key / Custom Header)
- ✅ **Web 配置面板** — 手机浏览器打开即可修改 .env，无需手动编辑
- ✅ 可配置访问密钥保护本服务
- ✅ **Termux 一键部署** — Android 手机秒变 API 服务器

## 快速开始

### 1. 安装依赖

```bash
cd questflow-2api
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的 Questflow 认证信息
```

### 3. 启动服务

```bash
# 开发模式
npm run dev

# 或构建后运行
npm run build
npm start
```

服务默认运行在 `http://localhost:3000`

### 📱 Web 配置面板

启动后打开 `http://localhost:3000` 即可进入配置面板，支持：

- 在线编辑所有 `.env` 配置项
- 保存后重启服务生效
- 移动端适配，手机浏览器操作流畅

**免去手动 vi/nano 编辑文件的麻烦。**

## 环境变量配置

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 否 | `3000` | 服务监听端口 |
| `QUESTFLOW_BASE_URL` | 是 | - | Questflow API 基础地址 |
| `QUESTFLOW_AUTH_TYPE` | 是 | `cookie` | 认证方式: `cookie` / `bearer` / `apikey` / `custom` |
| `QUESTFLOW_AUTH_TOKEN` | 是 | - | 认证凭证 (Cookie/Token/APIKey) |
| `QUESTFLOW_CUSTOM_HEADER` | 否 | `X-Custom-Auth` | 自定义认证头名称 (auth_type=custom 时) |
| `QUESTFLOW_CHAT_ENDPOINT` | 否 | `/api/v1/chat/completions` | Questflow 聊天接口路径 |
| `STREAM_ENABLED` | 否 | `true` | 是否启用流式输出 |
| `REQUEST_TIMEOUT` | 否 | `60000` | 请求超时 (毫秒) |
| `ACCESS_TOKEN` | 否 | - | 本服务的访问密钥 (可选) |
| `LOG_LEVEL` | 否 | `info` | 日志级别: `debug` / `info` / `warn` / `error` |
| `HTTP_PROXY` | 否 | - | HTTP 代理地址 |
| `HTTPS_PROXY` | 否 | - | HTTPS 代理地址 |

## 获取 Questflow 认证信息

由于 Questflow 没有公开的 API 文档，你需要通过浏览器开发者工具抓包获取认证信息：

### Cookie 方式 (推荐)

1. 打开浏览器，登录 [https://next.questflow.ai/](https://next.questflow.ai/)
2. 打开开发者工具 (F12) → Network 标签
3. 发送一条聊天消息
4. 找到对应的 API 请求 (通常是 `chat` 或 `completion` 相关的请求)
5. 右键请求 → Copy → Copy as cURL (bash)
6. 从 cURL 命令中提取 `Cookie` 值，填入 `.env` 的 `QUESTFLOW_AUTH_TOKEN`
7. 同时提取请求的完整 URL，分析出 `QUESTFLOW_BASE_URL` 和 `QUESTFLOW_CHAT_ENDPOINT`

### Bearer Token 方式

如果抓包发现请求头中有 `Authorization: Bearer xxx`，则将 `xxx` 部分填入 `QUESTFLOW_AUTH_TOKEN`，并将 `QUESTFLOW_AUTH_TYPE` 设为 `bearer`。

## 使用示例

配置完成后，你可以像调用 OpenAI API 一样调用本服务：

### cURL

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "tars-default",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="anything"  # 如果设置了 ACCESS_TOKEN，则填 ACCESS_TOKEN
)

response = client.chat.completions.create(
    model="tars-default",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### Node.js

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'anything',
});

const response = await client.chat.completions.create({
  model: 'tars-default',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);
```

## 自定义 Questflow 请求格式

由于 Questflow 的 API 格式可能会变化，你需要根据实际抓包结果修改 `src/routes/chat.ts` 中的 `buildQuestflowBody` 函数：

```typescript
function buildQuestflowBody(request: OpenAIChatRequest): Record<string, unknown> {
  // 根据实际抓包结果调整此处的字段映射
  return {
    messages: convertToQuestflowMessages(request.messages),
    stream: request.stream ?? false,
    // 添加 Questflow 特有的字段...
  };
}
```

同时也可能需要修改 `src/utils/transform.ts` 中的转换函数来适配 Questflow 的响应格式。

## 注意事项

1. **Cookie 会过期**：使用 Cookie 认证时，Questflow 的 Cookie 可能会过期，需要定期更新。
2. **速率限制**：请合理控制请求频率，避免触发 Questflow 的速率限制。
3. **API 格式变化**：Questflow 可能随时更改其内部 API，本项目可能需要相应调整。
4. **仅个人使用**：请勿将本服务公开部署或用于商业用途，避免违反 Questflow 的服务条款。

## 常见问题

**Q: 为什么请求返回 401/403？**  
A: 认证信息可能已过期，请重新登录 Questflow 并抓取最新的 Cookie/Token。

**Q: 为什么返回的内容格式不对？**  
A: Questflow 的 API 格式可能已经变化，请根据最新的抓包结果修改 `buildQuestflowBody` 和转换函数。

**Q: 支持哪些模型？**  
A: 默认预设了 `tars-default`、`tars-gpt-4o`、`tars-gpt-4o-mini` 等。实际可用模型取决于 Questflow 支持哪些，你可以在 `src/utils/transform.ts` 中修改模型列表。

## Termux (Android) 一键部署

在手机上通过 Termux 部署，让你的手机变成一个 API 代理服务器：

```bash
# 在 Termux 中运行
curl -fsSL https://raw.githubusercontent.com/yangeshenshi/Questflow2api/main/deploy-termux.sh | bash
```

或者手动：

```bash
pkg update && pkg upgrade
pkg install nodejs git
git clone https://github.com/yangeshenshi/Questflow2api.git
cd Questflow2api
npm install
cp .env.example .env
nano .env  # 编辑配置
npm start
```

启动后在局域网内任何设备访问：`http://<手机IP>:3000/v1/chat/completions`

## 免责声明

> **⚠️ 重要声明**
> 
> 1. 本项目为**个人学习研究**目的开发，**与 Questflow 官方无关**。
> 2. 本项目**不保证**服务的稳定性、可用性和准确性。
> 3. 使用本项目即表示你同意**自行承担所有风险和责任**。
> 4. 请**遵守 Questflow 的服务条款**和适用法律法规。
> 5. 开发者不对因使用本项目而产生的任何直接或间接损失承担责任，包括但不限于：数据丢失、服务中断、账号封禁、法律纠纷等。
> 6. 如果你不同意以上声明，请立即停止使用本项目。

## 许可证

MIT License

---

> **温馨提示**: 如果你发现 Questflow 的 API 格式有变化，欢迎提交 Issue 或 PR 帮助改进本项目。
