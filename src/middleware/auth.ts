import { Request, Response, NextFunction } from 'express';

/**
 * 访问认证中间件
 * 如果设置了 ACCESS_TOKEN，则要求请求携带正确的 Bearer Token
 */
export function accessAuth(req: Request, res: Response, next: NextFunction): void {
  const accessToken = process.env.ACCESS_TOKEN;

  if (!accessToken) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
        type: 'authentication_error',
        code: 'missing_auth',
      },
    });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== accessToken) {
    res.status(401).json({
      error: {
        message: 'Invalid access token',
        type: 'authentication_error',
        code: 'invalid_auth',
      },
    });
    return;
  }

  next();
}

/**
 * 请求日志中间件
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
}

/**
 * 错误处理中间件
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'server_error',
      code: 'internal_error',
    },
  });
}
