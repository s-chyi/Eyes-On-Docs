import winston from 'winston';

// 自定义日志格式（JSON single-line，讓 Log Analytics 好 parse）
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...metadata }: {
    timestamp: string;
    level: string;
    message: string;
    [key: string]: any;
  }) => {
    return JSON.stringify({
      level,
      timestamp,
      message,
      ...metadata
    });
  })
);

// ACA container stdout/stderr 會自動被 Log Analytics 收走，容器內不再寫檔案
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: logFormat
    })
  ]
});
