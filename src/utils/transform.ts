import { v4 as uuidv4 } from 'uuid';
import { OpenAIMessage, OpenAIChatResponse, OpenAIStreamResponse, OpenAIChoice, OpenAIStreamChoice, OpenAIModelsResponse, OpenAIModel } from '../types/openai';
import { QuestflowChatResponse, QuestflowStreamChunk } from '../types/questflow';

/**
 * 将 OpenAI 消息格式转换为 Questflow parts-based 消息格式
 * 实测格式: { id, role, content: "", parts: [{ type: "text", text: "..." }] }
 *
 * Questflow API 仅支持 user / assistant 角色，system 角色会被转为 user 角色
 * 并添加 <system> 标签前缀以保留指令语义
 */
export function convertToQuestflowMessages(messages: OpenAIMessage[]): Array<Record<string, unknown>> {
  return messages.map(msg => {
    const role = msg.role === 'system' ? 'user' : msg.role;
    const content = msg.role === 'system'
      ? `<|system|>\n${msg.content}\n</|system|>\n\nNow respond according to the system instructions above.`
      : msg.content;
    return {
      id: uuidv4().replace(/-/g, '').substring(0, 24),
      role,
      content: '',
      parts: [{ type: 'text', text: content }],
    };
  });
}

/**
 * 将 Questflow 的完整响应转换为 OpenAI 格式
 */
export function convertToOpenAIResponse(
  questflowResponse: QuestflowChatResponse,
  model: string,
  requestMessages: OpenAIMessage[]
): OpenAIChatResponse {
  const content = questflowResponse.text || questflowResponse.content || questflowResponse.message?.content || '';
  const promptText = requestMessages.map(m => m.content).join(' ');
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(content);

  return {
    id: questflowResponse.id || `qf-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * 将 Questflow 流式块转换为 OpenAI SSE 格式
 * 实测 Questflow SSE 事件类型:
 *   - start / start-step / finish-step / finish
 *   - text-start / text-delta (含 delta 字段) / text-end
 *   - reasoning-start / reasoning-delta / reasoning-end
 */
export function convertToOpenAIStreamChunk(
  chunk: QuestflowStreamChunk & { type?: string; delta?: string; finishReason?: string; messageId?: string },
  model: string,
  index: number = 0,
  msgId?: string
): OpenAIStreamResponse | null {
  const eventType = chunk.type || '';
  const chunkId = msgId || chunk.messageId || chunk.id || `qf-${Date.now()}`;

  // 文本增量
  if (eventType === 'text-delta') {
    const content = chunk.delta || chunk.text || chunk.content || '';
    if (!content) return null;
    return {
      id: chunkId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index,
        delta: { content },
        finish_reason: null,
        logprobs: null,
      }],
    };
  }

  // 推理增量 (放入 reasoning_details 或忽略)
  if (eventType === 'reasoning-delta') {
    const reasoning = chunk.delta || '';
    if (!reasoning) return null;
    return {
      id: chunkId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index,
        delta: { content: '', reasoning_content: reasoning } as any,
        finish_reason: null,
        logprobs: null,
      }],
    };
  }

  // 结束事件
  if (eventType === 'finish') {
    return {
      id: chunkId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index,
        delta: {},
        finish_reason: chunk.finishReason === 'stop' ? 'stop' : 'stop',
        logprobs: null,
      }],
    };
  }

  // 开始事件 - 用于设置 ID
  if (eventType === 'start' && chunk.messageId) {
    return {
      id: chunk.messageId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index,
        delta: { role: 'assistant' },
        finish_reason: null,
        logprobs: null,
      }],
    };
  }

  // 其他事件 (start-step, finish-step, text-start, text-end, reasoning-start, reasoning-end) 忽略
  return null;
}

/**
 * 生成 OpenAI 格式的 SSE 数据行
 */
export function generateSSELine(data: OpenAIStreamResponse): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * 生成 SSE 结束标记
 */
export function generateSSEDone(): string {
  return 'data: [DONE]\n\n';
}

/**
 * 构建 OpenAI 模型列表
 */
export function buildModelsList(): OpenAIModelsResponse {
  const models: OpenAIModel[] = [
    { id: 'kimi-k2.7-code', object: 'model', created: 1700000000, owned_by: 'questflow' },
    { id: 'tars-default', object: 'model', created: 1700000000, owned_by: 'questflow' },
    { id: 'tars-gpt-4o', object: 'model', created: 1700000000, owned_by: 'questflow' },
    { id: 'tars-gpt-4o-mini', object: 'model', created: 1700000000, owned_by: 'questflow' },
    { id: 'tars-claude-sonnet', object: 'model', created: 1700000000, owned_by: 'questflow' },
  ];

  return {
    object: 'list',
    data: models,
  };
}

/**
 * 简单的 token 估算 (基于字符数)
 */
function estimateTokens(text: string): number {
  // 粗略估算：英文约 4 字符/token，中文约 1 字符/token
  // 取保守估计
  return Math.ceil(text.length / 3.5);
}

/**
 * 生成 OpenAI 兼容错误响应
 */
export function buildErrorResponse(message: string, type: string = 'api_error', code?: string): Record<string, unknown> {
  return {
    error: {
      message,
      type,
      code: code || null,
    },
  };
}
