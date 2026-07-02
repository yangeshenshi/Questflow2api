import { Request, Response, Router } from 'express';
import fetch from 'node-fetch';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { OpenAIChatRequest } from '../types/openai';
import {
  convertToQuestflowMessages,
  convertToOpenAIResponse,
  convertToOpenAIStreamChunk,
  generateSSELine,
  generateSSEDone,
  buildErrorResponse,
} from '../utils/transform';
import { logger } from '../utils/logger';

const router = Router();

// HTTP Agent for connection reuse
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  timeout: 30000,
});

// 会话缓存：OpenAI conversation_id -> Questflow conversationId + companyId
const conversationCache = new Map<string, { questflowId: string; companyId: string }>();

/**
 * fetch 带重试逻辑，处理 Premature close 等网络抖动
 */
async function fetchWithRetry(url: string, options: any, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...options, agent: httpsAgent });
      return res;
    } catch (err: any) {
      if (i === retries) throw err;
      if (err.type === 'system' || err.message?.includes('Premature close')) {
        logger.warn(`Fetch retry ${i + 1}/${retries}: ${url} - ${err.message}`);
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

function getQuestflowHeaders(): Record<string, string> {
  const authType = process.env.QUESTFLOW_AUTH_TYPE || 'cookie';
  const token = process.env.QUESTFLOW_AUTH_TOKEN || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://next.questflow.ai',
    'Referer': 'https://next.questflow.ai/',
  };

  switch (authType) {
    case 'cookie':
      headers['Cookie'] = token;
      break;
    case 'bearer':
      headers['Authorization'] = `Bearer ${token}`;
      break;
    case 'apikey':
      headers['X-API-Key'] = token;
      break;
    case 'custom':
      const customHeader = process.env.QUESTFLOW_CUSTOM_HEADER || 'X-Custom-Auth';
      headers[customHeader] = token;
      break;
  }

  return headers;
}

async function createConversation(cookie: string): Promise<{ questflowId: string; companyId: string }> {
  const baseUrl = process.env.QUESTFLOW_BASE_URL || 'https://next.questflow.ai';
  const res = await fetchWithRetry(`${baseUrl}/api/v6/copilot/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'Origin': 'https://next.questflow.ai',
      'Referer': 'https://next.questflow.ai/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ title: 'API Chat' }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create conversation: ${res.status}`);
  }

  const data: any = await res.json();
  const questflowId = data.data?._id || data._id;
  const companyId = data.data?.companyId || process.env.QUESTFLOW_COMPANY_ID || '';

  if (!companyId) {
    const detailRes = await fetchWithRetry(`${baseUrl}/api/v6/copilot/conversations`, {
      headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' },
    });
    const listData: any = await detailRes.json();
    if (listData.data?.length > 0) {
      return { questflowId, companyId: listData.data[0].companyId || '' };
    }
  }

  return { questflowId, companyId };
}

async function getOrCreateConversation(
  conversationId: string | undefined,
  cookie: string
): Promise<{ questflowId: string; companyId: string }> {
  // 如果客户端传了 conversation_id，从缓存查找
  if (conversationId && conversationCache.has(conversationId)) {
    return conversationCache.get(conversationId)!;
  }

  // 创建新会话
  const conv = await createConversation(cookie);

  // 用 OpenAI 的 conversation_id（或生成一个新的）作为 key
  const key = conversationId || `qf-${uuidv4()}`;
  conversationCache.set(key, conv);

  return conv;
}

function buildQuestflowBody(
  request: OpenAIChatRequest,
  conversationId: string,
  companyId: string
): Record<string, unknown> {
  const model = request.model || process.env.QUESTFLOW_DEFAULT_MODEL || 'kimi-k2.7-code';

  return {
    conversationId,
    companyId,
    id: conversationId,
    messages: convertToQuestflowMessages(request.messages),
    model,
    trigger: 'submit-message',
  };
}

router.post('/completions', async (req: Request, res: Response) => {
  try {
    const request = req.body as OpenAIChatRequest & { conversation_id?: string };
    const model = request.model || process.env.QUESTFLOW_DEFAULT_MODEL || 'kimi-k2.7-code';
    const isStream = request.stream ?? false;

    logger.info('Chat request:', { model, stream: isStream, messagesCount: request.messages?.length });

    const baseUrl = process.env.QUESTFLOW_BASE_URL || 'https://next.questflow.ai';
    const endpoint = process.env.QUESTFLOW_CHAT_ENDPOINT || '/api/v6/copilot/stream';
    const url = `${baseUrl}${endpoint}`;

    const headers = getQuestflowHeaders();
    const cookie = headers['Cookie'] || process.env.QUESTFLOW_AUTH_TOKEN || '';

    // 获取或创建 Questflow 会话
    const conv = await getOrCreateConversation(request.conversation_id, cookie);

    const body = buildQuestflowBody(request, conv.questflowId, conv.companyId);

    logger.debug('Forwarding to Questflow:', { url, body: JSON.stringify(body).substring(0, 200) });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), parseInt(process.env.REQUEST_TIMEOUT || '60000'));

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal as any,
      agent: httpsAgent,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Questflow API error:', response.status, errorText);

      if (response.status === 402) {
        let errorMsg = 'Questflow account has insufficient balance.';
        try {
          const errJson = JSON.parse(errorText);
          if (errJson.message) errorMsg = errJson.message;
        } catch { /* ignore */ }
        res.status(402).json(buildErrorResponse(errorMsg, 'insufficient_balance'));
        return;
      }

      res.status(response.status).json(buildErrorResponse(
        `Questflow API returned ${response.status}: ${errorText}`,
        'upstream_error'
      ));
      return;
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const reader = response.body;
      if (!reader) {
        res.status(500).json(buildErrorResponse('No response body from upstream', 'upstream_error'));
        return;
      }

      let buffer = '';
      let messageId = '';
      const decoder = new TextDecoder();

      reader.on('data', (chunk: Buffer) => {
        try {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;

            let dataStr = trimmed;
            if (trimmed.startsWith('data: ')) {
              dataStr = trimmed.slice(6);
            } else if (trimmed.startsWith('data:')) {
              dataStr = trimmed.slice(5);
            }

            if (dataStr === '[DONE]') {
              res.write(generateSSEDone());
              continue;
            }

            try {
              const questflowChunk: any = JSON.parse(dataStr);
              if (questflowChunk.type === 'start' && questflowChunk.messageId) {
                messageId = questflowChunk.messageId;
              }
              const openaiChunk = convertToOpenAIStreamChunk(questflowChunk, model, 0, messageId);
              if (openaiChunk) {
                res.write(generateSSELine(openaiChunk));
              }
            } catch {
              // 非 JSON 行，忽略
            }
          }
        } catch (err) {
          logger.error('Stream processing error:', err);
        }
      });

      reader.on('end', () => {
        res.write(generateSSEDone());
        res.end();
      });

      reader.on('error', (err: Error) => {
        logger.error('Stream error:', err);
        res.end();
      });

      return;
    }

    // 非流式：Questflow 只返回 SSE 流，需要收集后合并
    const reader2 = response.body;
    if (!reader2) {
      res.status(500).json(buildErrorResponse('No response body', 'upstream_error'));
      return;
    }

    let fullText = '';
    let buffer2 = '';
    const decoder2 = new TextDecoder();

    await new Promise<void>((resolve, reject) => {
      reader2.on('data', (chunk: Buffer) => {
        buffer2 += decoder2.decode(chunk, { stream: true });
        const lines = buffer2.split('\n');
        buffer2 = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':') || trimmed === 'data: [DONE]') continue;

          let dataStr = trimmed;
          if (trimmed.startsWith('data: ')) {
            dataStr = trimmed.slice(6);
          } else if (trimmed.startsWith('data:')) {
            dataStr = trimmed.slice(5);
          }

          try {
            const chunk = JSON.parse(dataStr);
            if (chunk.type === 'text-delta') {
              fullText += chunk.delta || '';
            }
          } catch { /* skip */ }
        }
      });

      reader2.on('end', resolve);
      reader2.on('error', reject);
    });

    const openaiResponse = convertToOpenAIResponse(
      { id: `qf-${Date.now()}`, text: fullText } as any,
      model,
      request.messages
    );
    res.json(openaiResponse);

  } catch (err: any) {
    logger.error('Chat completion error:', err.message);

    if (err.name === 'AbortError') {
      res.status(504).json(buildErrorResponse('Request timeout', 'timeout_error'));
      return;
    }

    res.status(500).json(buildErrorResponse(err.message || 'Internal server error'));
  }
});

export default router;
