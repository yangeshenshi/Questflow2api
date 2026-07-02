/**
 * 日志工具
 */
export const logger = {
  debug: (...args: unknown[]) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[DEBUG] ${new Date().toISOString()}`, ...args);
    }
  },
  info: (...args: unknown[]) => {
    if (['debug', 'info'].includes(process.env.LOG_LEVEL || 'info')) {
      console.log(`[INFO] ${new Date().toISOString()}`, ...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (['debug', 'info', 'warn'].includes(process.env.LOG_LEVEL || 'info')) {
      console.warn(`[WARN] ${new Date().toISOString()}`, ...args);
    }
  },
  error: (...args: unknown[]) => {
    console.error(`[ERROR] ${new Date().toISOString()}`, ...args);
  },
};
