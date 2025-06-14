import winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  defaultMeta: { service: 'pancakeswap-api' },
  transports: [
    // PM2가 콘솔 출력을 캡쳐하도록 콘솔만 사용
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.json() // 프로덕션에서는 JSON 형식
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
    })
  ],
});
