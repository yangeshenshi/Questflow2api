import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { accessAuth, requestLogger, errorHandler } from './middleware/auth';
import chatRoutes from './routes/chat';
import modelsRoutes from './routes/models';
import { logger } from './utils/logger';

// 加载环境变量
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(requestLogger);
app.use(accessAuth);

// 健康检查
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// OpenAI 兼容路由
app.use('/v1/chat', chatRoutes);
app.use('/v1/models', modelsRoutes);

// 根路径提示
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Questflow 2API',
    description: '将 Questflow AI (next.questflow.ai) 反向代理为 OpenAI 兼容 API',
    version: '1.0.0',
    endpoints: {
      'POST /v1/chat/completions': 'OpenAI 兼容聊天补全',
      'GET /v1/models': '获取可用模型列表',
      'GET /health': '健康检查',
    },
    disclaimer: '本项目仅供学习研究使用，请遵守 Questflow 的服务条款。使用本项目造成的任何后果由使用者自行承担。',
  });
});

// 错误处理
app.use(errorHandler);

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`=================================`);
  logger.info(`Questflow 2API 服务已启动`);
  logger.info(`监听地址: http://0.0.0.0:${PORT}`);
  logger.info(`目标上游: ${process.env.QUESTFLOW_BASE_URL || 'https://api.questflow.ai'}`);
  logger.info(`=================================`);
  logger.info('⚠️  免责声明: 本项目仅供学习研究使用，不保证稳定性与可用性。');
  logger.info('   请遵守 Questflow 的服务条款，使用本项目造成的任何后果由使用者自行承担。');
  logger.info('=================================');
});
