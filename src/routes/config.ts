import { Request, Response, Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger';

const router = Router();

const ENV_PATH = resolve(__dirname, '../../.env');
const ENV_EXAMPLE_PATH = resolve(__dirname, '../../.env.example');

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

function stringifyEnv(config: Record<string, string>, template?: string): string {
  const sensitiveKeys = ['QUESTFLOW_AUTH_TOKEN'];
  const lines: string[] = [];

  if (template) {
    const templateLines = template.split('\n');
    for (const line of templateLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        lines.push(line);
        continue;
      }
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        lines.push(line);
        continue;
      }
      const key = trimmed.slice(0, eqIndex).trim();
      if (key && config.hasOwnProperty(key)) {
        lines.push(`${key}=${config[key]}`);
      } else {
        lines.push(line);
      }
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (!lines.some(l => l.startsWith(key + '='))) {
      lines.push(`${key}=${value}`);
    }
  }

  return lines.join('\n');
}

router.get('/', (_req: Request, res: Response) => {
  try {
    if (!existsSync(ENV_PATH)) {
      const example = existsSync(ENV_EXAMPLE_PATH)
        ? parseEnv(readFileSync(ENV_EXAMPLE_PATH, 'utf-8'))
        : {};
      res.json(example);
      return;
    }
    const content = readFileSync(ENV_PATH, 'utf-8');
    const config = parseEnv(content);
    res.json(config);
  } catch (err: any) {
    logger.error('Read config error:', err.message);
    res.status(500).json({ error: '读取配置失败' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const newConfig = req.body as Record<string, string>;
    const template = existsSync(ENV_EXAMPLE_PATH)
      ? readFileSync(ENV_EXAMPLE_PATH, 'utf-8')
      : undefined;

    const content = stringifyEnv(newConfig, template);
    writeFileSync(ENV_PATH, content, 'utf-8');

    logger.info('Config saved successfully');
    res.json({ message: '配置已保存，请重启服务使配置生效' });
  } catch (err: any) {
    logger.error('Save config error:', err.message);
    res.status(500).json({ error: '保存配置失败' });
  }
});

router.post('/restart', (_req: Request, res: Response) => {
  res.json({ message: '重启指令已发送' });

  setTimeout(() => {
    logger.info('Restarting service...');
    process.exit(0);
  }, 500);
});

export default router;
