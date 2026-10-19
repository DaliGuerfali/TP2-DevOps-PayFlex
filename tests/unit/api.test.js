'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { createLogger } = require('../../src/utils/logger');

const silent = createLogger({ level: 'silent' });

describe('PayFlex HTTP API', () => {
  let app;

  beforeEach(() => {
    app = createApp({ logger: silent });
  });

  async function openAccount(body) {
    const res = await request(app).post('/api/accounts').send(body).expect(201);
    return res.body;
  }

  test('GET /health reports UP', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'UP', accounts: 0, transactions: 0 });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('account lifecycle: create, deposit, withdraw, read, list', async () => {
    const account = await openAccount({ owner: 'Alice', initialBalance: 100 });
    expect(account).toMatchObject({ owner: 'Alice', balance: 100, currency: 'EUR' });

    await request(app).post(`/api/accounts/${account.id}/deposits`).send({ amount: 50 }).expect(201);
    const withdrawal = await request(app)
      .post(`/api/accounts/${account.id}/withdrawals`)
      .send({ amount: 30 })
      .expect(201);
    expect(withdrawal.body.account.balance).toBe(120);

    const read = await request(app).get(`/api/accounts/${account.id}`).expect(200);
    expect(read.body.balance).toBe(120);

    const list = await request(app).get(`/api/accounts/${account.id}/transactions`).expect(200);
    expect(list.body.items.map((t) => t.type)).toEqual(['DEPOSIT', 'DEPOSIT', 'WITHDRAWAL']);
  });

  test('POST /api/transfers moves money', async () => {
    const alice = await openAccount({ owner: 'Alice', initialBalance: 500 });
    const bob = await openAccount({ owner: 'Bob' });
    const res = await request(app)
      .post('/api/transfers')
      .send({ fromAccountId: alice.id, toAccountId: bob.id, amount: 150 })
      .expect(201);
    expect(res.body.from.balance).toBe(349);
    expect(res.body.to.balance).toBe(150);
  });

  test('business rule violations return 422', async () => {
    const alice = await openAccount({ owner: 'Alice', initialBalance: 10 });
    const bob = await openAccount({ owner: 'Bob' });
    const res = await request(app)
      .post('/api/transfers')
      .send({ fromAccountId: alice.id, toAccountId: bob.id, amount: 20 })
      .expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  test('validation errors return 400 and unknown accounts 404', async () => {
    const bad = await request(app).post('/api/accounts').send({ owner: '' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    await request(app).post('/api/accounts/acc_x/deposits').send({}).expect(404);
    await request(app).get('/api/accounts/acc_missing').expect(404);
  });

  test('malformed JSON and oversized bodies are rejected cleanly', async () => {
    const malformed = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send('{"owner": ')
      .expect(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');

    const huge = await request(app)
      .post('/api/accounts')
      .send({ owner: 'x'.repeat(20_000) })
      .expect(413);
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('POST /api/payments/cards/validate returns only a masked number', async () => {
    const res = await request(app)
      .post('/api/payments/cards/validate')
      .send({ cardNumber: '4111111111111111' })
      .expect(200);
    expect(res.body).toEqual({ valid: true, brand: 'visa', maskedNumber: '**** **** **** 1111' });
    await request(app).post('/api/payments/cards/validate').send({}).expect(400);
  });

  test('unknown routes return 404 JSON', async () => {
    const res = await request(app).get('/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('unexpected errors return a generic 500 and are logged', async () => {
    const sink = { log: jest.fn(), error: jest.fn() };
    const store = {
      stats: () => {
        throw new Error('disk on fire');
      },
    };
    const broken = createApp({ store, logger: createLogger({ sink }) });
    const res = await request(broken).get('/health').expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'unexpected error' } });
    expect(sink.error).toHaveBeenCalled();
  });

  test('simulated latency delays /api routes only', async () => {
    const slow = createApp({ logger: silent, latencyMs: 60 });
    const start = Date.now();
    await request(slow).post('/api/payments/cards/validate').send({ cardNumber: '4111111111111111' }).expect(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });
});
