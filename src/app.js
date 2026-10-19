'use strict';

const express = require('express');
const { version } = require('../package.json');
const { createStore } = require('./services/store');
const { createAccountService } = require('./services/accounts');
const { createLogger } = require('./utils/logger');
const { simulatedLatency, requestLogger, notFound, errorHandler } = require('./middleware');
const { healthRouter, accountsRouter, transfersRouter, paymentsRouter } = require('./routes');

function createApp({ store = createStore(), logger = createLogger(), latencyMs = 0 } = {}) {
  const app = express();
  const accounts = createAccountService(store);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(requestLogger(logger));

  app.use('/health', healthRouter({ version, startedAt: Date.now(), store }));
  app.use('/api', simulatedLatency(latencyMs));
  app.use('/api/accounts', accountsRouter(accounts));
  app.use('/api/transfers', transfersRouter(accounts));
  app.use('/api/payments', paymentsRouter());

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
