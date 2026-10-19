// k6 load test for PayFlex API.
// The thresholds below are the CRITICAL limits of the quality gate (p95 > 500 ms or
// more than 2 % errors): crossing them aborts the run immediately (fail fast).
// The WARNING band (p95 between 200 and 500 ms, errors between 1 and 2 %) is
// evaluated afterwards by scripts/quality-gate/evaluate.js from the JSON summary.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SUMMARY_PATH = __ENV.SUMMARY_PATH || 'k6-summary.json';
const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

export const options = {
  scenarios: {
    payflex_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: [{ threshold: 'p(95)<500', abortOnFail: true, delayAbortEval: '10s' }],
    http_req_failed: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '10s' }],
    checks: ['rate>0.98'],
  },
};

export function setup() {
  const open = (owner) =>
    http.post(`${BASE_URL}/api/accounts`, JSON.stringify({ owner, initialBalance: 1000000 }), JSON_HEADERS).json('id');
  return { from: open('Load Sender'), to: open('Load Receiver') };
}

export default function (data) {
  group('read account', () => {
    const res = http.get(`${BASE_URL}/api/accounts/${data.from}`, { tags: { name: 'GET /api/accounts/:id' } });
    check(res, { 'account 200': (r) => r.status === 200 });
  });

  group('transfer', () => {
    const res = http.post(
      `${BASE_URL}/api/transfers`,
      JSON.stringify({ fromAccountId: data.from, toAccountId: data.to, amount: 1 }),
      { ...JSON_HEADERS, tags: { name: 'POST /api/transfers' } },
    );
    check(res, { 'transfer 201': (r) => r.status === 201 });
  });

  group('validate card', () => {
    const res = http.post(
      `${BASE_URL}/api/payments/cards/validate`,
      JSON.stringify({ cardNumber: '4111111111111111' }),
      { ...JSON_HEADERS, tags: { name: 'POST /api/payments/cards/validate' } },
    );
    check(res, { 'card 200 & masked': (r) => r.status === 200 && r.json('maskedNumber') === '**** **** **** 1111' });
  });

  sleep(0.2);
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [SUMMARY_PATH]: JSON.stringify(data, null, 2),
  };
}
