import pino from 'pino'
import { config } from './config.js'

export const logger = pino({
  level: config.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password', 'token', '*.token'],
    remove: true,
  },
  ...(config.isProduction
    ? {}
    : { transport: { target: 'pino/file', options: { destination: 1 } } }),
})
