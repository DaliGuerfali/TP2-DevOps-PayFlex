'use strict';

const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { createLogger } = require('./utils/logger');

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const app = createApp({ logger, latencyMs: config.latencyMs });

const server = app.listen(config.port, () => {
  logger.info('PayFlex API started', { port: config.port, simulatedLatencyMs: config.latencyMs });
});

function shutdown(signal) {
  logger.info('shutting down', { signal });
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
