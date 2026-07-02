import { Request, Response, Router } from 'express';
import fetch from 'node-fetch';
import http from 'http';
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

// 长时间 Keep-Alive Agent，避免 Termux 上的 Premature close
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 60000, timeout: 60000 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 60000, timeout: 60000 });

const conversationCache = new Map<string, { questflowId: string; companyId: string }>();

function fetchWithRetry(url: string, options: any, retries = 3): Promise<any> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      const opts = { ...options, agent: url.startsWith('https') ? httpsAgent : httpAgent };
      fetch(url, opts)
        .then(resolve)
        .catch((err: any) => {
          const msg = err.message || '';
          const isRetryable =
            err.type === 'system' ||
            msg.includes('Premature close') ||
            msg.includes('ECONNRESET') ||
            msg.includes('ETIMEDOUT') ||
            msg.includes('socket hang up') ||
            msg.includes('network timeout');

          if (n < retries && isRetryable) {
            const delay = 1000 * (n + 1);
            logger.warn(`Fetch retry ${n + 1}/${retries} after ${delay}ms: ${msg}`);
            setTimeout(() => attempt(n + 1), delay);
          } else {
            reject(err);
          }
        });
    };
    attempt(0);
  });
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
    case 'cookie': headers['Cookie'] = token; break;
    case 'bearer': headers['Authorization'] = `Bearer ${token}`; break;
    case 'apikey': headers['X-API-Key'] = token; break;
    case 'custom':
      const h = process.env.QUESTFLOW_CUSTOM_HEADER || 'X-Custom-Auth';
      headers[h] = token;
      break;
  }
  return headers;
}

async function createConversation(cookie: string): Promise<{ questflowId: string; companyId: string }> {
  const baseUrl = process.env.QUESTFLOW_BASE_URL || 'https://next.questflow.ai';
  const res = await fetchWithRetry(`${baseUrl}/api/v6/copilot/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://next.questflow.ai', Referer: 'https://next.questflow.ai/', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ title: 'API Chat' }),
  });
  if (!res.ok) throw new Error(`Cannot create conversation: ${res.status}`);
  const data: any = await res.json();
  const id = data.data?._id || data._id;
  const cid = data.data?.companyId || process.env.QUESTFLOW_COMPANY_ID || '';
  if (!id) throw new Error('No conversation ID');
  return { questflowId: id, companyId: cid };
}

async function getExistingConversation(cookie: string): Promise<{ questflowId: string; companyId: string } | null> {
  try {
    const baseUrl = process.env.QUESTFLOW_BASE_URL || 'https://next.questflow.ai';
    const res = await fetchWithRetry(`${baseUrl}/api/v6/copilot/conversations`, {
      headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' },
    });
    const data: any = await res.json();
    if (data.data?.length > 0) {
      return { questflowId: data.data[0]._id, companyId: data.data[0].companyId || process.env.QUESTFLOW_COMPANY_ID || '' };
    }
  } catch {}
  return null;
}

async function getOrCreateConversation(
  conversationId: string | undefined, cookie: string
): Promise<{ questflowId: string; companyId: string }> {
  if (conversationId && conversationCache.has(conversationId)) {
    return conversationCache.get(conversationId)!;
  }
  try {
    const conv = await createConversation(cookie);
    const key = conversationId || `qf-${uuidv4()}`;
    conversationCache.set(key, conv);
    return conv;
  } catch (err) {
    logger.warn('Create conversation failed, trying existing');
    const existing = await getExistingConversation(cookie);
    if (existing) {
      logger.info('Reusing conversation:', existing.questflowId);
      const key = conversationId || `qf-${uuidv4()}`;
      conversationCache.set(key, existing);
      return existing;
    }
    throw new Error('Cannot create or find conversation. Check cookies.');
  }
}

function buildQuestflowBody(
  request: OpenAIChatRequest, conversationId: string, companyId: string
): Record<string, unknown> {
  return {
    conversationId, companyId, id: conversationId,
    messages: convertToQuestflowMessages(request.messages),
    model: request.model || process.env.QUESTFLOW_DEFAULT_MODEL || 'kimi-k2.7-code',
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
    const conv = await getOrCreateConversation(request.conversation_id, cookie);
    const body = buildQuestflowBody(request, conv.questflowId, conv.companyId);

    logger.debug('Forwarding to Questflow:', { url });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), parseInt(process.env.REQUEST_TIMEOUT || '60000'));

    const response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: controller.signal as any,
      agent: httpsAgent,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Questflow API error:', response.status, errorText);
      if (response.status === 402) {
        let msg = 'Insufficient balance';
        try { const j = JSON.parse(errorText); if (j.message) msg = j.message; } catch {}
        res.status(402).json(buildErrorResponse(msg, 'insufficient_balance'));
        return;
      }
      res.status(response.status).json(buildErrorResponse(`Questflow API error ${response.status}`, 'upstream_error'));
      return;
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const reader = response.body;
      if (!reader) {
        res.status(500).json(buildErrorResponse('No response body', 'upstream_error'));
        return;
      }

      let buffer = '', messageId = '';
      const decoder = new TextDecoder();

      reader.on('data', (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          let ds = trimmed;
          if (ds.startsWith('data: ')) ds = ds.slice(6);
          else if (ds.startsWith('data:')) ds = ds.slice(5);
          else continue;
          if (ds === '[DONE]') { res.write(generateSSEDone()); continue; }
          try {
            const evt: any = JSON.parse(ds);
            if (evt.type === 'start' && evt.messageId) messageId = evt.messageId;
            const chunk = convertToOpenAIStreamChunk(evt, model, 0, messageId);
            if (chunk) res.write(generateSSELine(chunk));
          } catch {}
        }
      });

      reader.on('end', () => { res.write(generateSSEDone()); res.end(); });
      reader.on('error', (err: Error) => { logger.error('Stream error:', err); if (!res.writableEnded) res.end(); });
      return;
    }

    // 非流式
    const reader = response.body;
    if (!reader) {
      res.status(500).json(buildErrorResponse('No response body', 'upstream_error'));
      return;
    }

    let fullText = '', buffer = '';
    const decoder = new TextDecoder();

    await new Promise<void>((resolve, reject) => {
      reader.on('data', (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t || t.startsWith(':') || t === 'data: [DONE]') continue;
          let ds = t;
          if (ds.startsWith('data: ')) ds = ds.slice(6);
          else if (ds.startsWith('data:')) ds = ds.slice(5);
          else continue;
          try { const evt = JSON.parse(ds); if (evt.type === 'text-delta') fullText += evt.delta || ''; } catch {}
        }
      });
      reader.on('end', resolve);
      reader.on('error', reject);
    });

    res.json(convertToOpenAIResponse({ id: `qf-${Date.now()}`, text: fullText } as any, model, request.messages));

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
