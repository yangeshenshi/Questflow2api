import { Request, Response, Router } from 'express';
import { buildModelsList } from '../utils/transform';

const router = Router();

/**
 * GET /v1/models
 * 返回 OpenAI 兼容的模型列表
 */
router.get('/', (_req: Request, res: Response) => {
  const models = buildModelsList();
  res.json(models);
});

export default router;
