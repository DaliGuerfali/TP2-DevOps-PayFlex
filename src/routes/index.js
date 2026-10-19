'use strict';

const express = require('express');
const { validateCard } = require('../services/cards');

function healthRouter({ version, startedAt, store }) {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.json({
      status: 'UP',
      version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      ...store.stats(),
    });
  });
  return router;
}

function accountsRouter(accounts) {
  const router = express.Router();
  router.post('/', (req, res) => res.status(201).json(accounts.createAccount(req.body)));
  router.get('/:id', (req, res) => res.json(accounts.getAccount(req.params.id)));
  router.post('/:id/deposits', (req, res) => res.status(201).json(accounts.deposit(req.params.id, req.body?.amount)));
  router.post('/:id/withdrawals', (req, res) =>
    res.status(201).json(accounts.withdraw(req.params.id, req.body?.amount)),
  );
  router.get('/:id/transactions', (req, res) => res.json({ items: accounts.listTransactions(req.params.id) }));
  return router;
}

function transfersRouter(accounts) {
  const router = express.Router();
  router.post('/', (req, res) => res.status(201).json(accounts.transfer(req.body)));
  return router;
}

function paymentsRouter() {
  const router = express.Router();
  router.post('/cards/validate', (req, res) => res.json(validateCard(req.body?.cardNumber)));
  return router;
}

module.exports = { healthRouter, accountsRouter, transfersRouter, paymentsRouter };
