// Questflow 原始 API 类型定义
// 注意：以下类型基于对 next.questflow.ai 的逆向分析，实际结构可能有所不同
// 用户需要根据实际抓包结果调整这些类型

export interface QuestflowMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface QuestflowChatRequest {
  // 实际字段需要根据抓包结果填写
  messages: QuestflowMessage[];
  model?: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  // 其他 Questflow 特有参数...
  session_id?: string;
  conversation_id?: string;
}

export interface QuestflowChatResponse {
  // 实际字段需要根据抓包结果填写
  id?: string;
  text?: string;
  content?: string;
  message?: QuestflowMessage;
  choices?: Array<{
    message?: QuestflowMessage;
    delta?: { content?: string };
    finish_reason?: string;
  }>;
  // 其他 Questflow 返回字段...
  error?: {
    message: string;
    code?: string;
  };
}

export interface QuestflowStreamChunk {
  // SSE 流式响应的每个数据块结构
  id?: string;
  event?: string;
  data?: string;
  // 解析后的内容...
  delta?: { content?: string };
  text?: string;
  content?: string;
  finish_reason?: string;
}

// Questflow 可用的模型信息 (根据实际 API 返回填写)
export interface QuestflowModel {
  id: string;
  name: string;
  description?: string;
}
