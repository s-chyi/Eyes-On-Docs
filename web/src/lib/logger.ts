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

// LOG_TO_STDOUT_ONLY gate:
//   =1 (ACA container mode): stdout-only, Log Analytics 直接收 stdout/stderr
//   default (Joey VM pm2 mode): 保留 daily-rotate-file transports + dev console
const stdoutOnly = ['1', 'true', 'True'].includes(
  (process.env.LOG_TO_STDOUT_ONLY || '').trim()
);

function buildLogger(): winston.Logger {
  if (stdoutOnly) {
    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      transports: [new winston.transports.Console({ format: logFormat })],
    });
  }

  // Legacy mode: file rotation for pm2 / VM
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('winston-daily-rotate-file');

  const dailyRotateFileTransport = new (winston.transports as any).DailyRotateFile({
    filename: 'logs/combined-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat,
  });

  const errorRotateFileTransport = new (winston.transports as any).DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    level: 'error',
    format: logFormat,
  });

  const legacyLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [dailyRotateFileTransport, errorRotateFileTransport],
  });

  if (process.env.NODE_ENV !== 'production') {
    legacyLogger.add(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
        ),
      }),
    );
  }

  return legacyLogger;
}

export const logger = buildLogger();
