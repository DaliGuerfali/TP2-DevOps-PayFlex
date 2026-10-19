'use strict';

// Readers turn raw tool reports (Jest, k6, Gitleaks, SonarQube, Newman) into the
// small input objects expected by classify.js. A missing report returns {} so that
// the classifier fails safe (CRITICAL) instead of silently passing.
const fs = require('node:fs');

function readJson(file) {
  if (!file || !fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, 'utf8').trim();
  return text ? JSON.parse(text) : undefined;
}

function coverage([file]) {
  const total = readJson(file)?.total;
  if (!total) return {};
  return {
    lines: total.lines.pct,
    statements: total.statements.pct,
    branches: total.branches.pct,
    functions: total.functions.pct,
  };
}

function performance([file]) {
  const summary = readJson(file);
  const metrics = summary?.metrics;
  if (!metrics?.http_req_duration) return {};
  const thresholdFailed = Object.values(metrics).some((m) =>
    Object.values(m.thresholds ?? {}).some((t) => t.ok === false),
  );
  return {
    p95Ms: metrics.http_req_duration.values['p(95)'],
    avgMs: metrics.http_req_duration.values.avg,
    errorRate: metrics.http_req_failed?.values.rate ?? 0,
    requests: metrics.http_reqs?.values.count ?? 0,
    checksRate: metrics.checks?.values.rate,
    aborted: thresholdFailed,
  };
}

function confidentiality(files, { locations = [] } = {}) {
  let found = false;
  const findings = [];
  for (const file of files) {
    const report = readJson(file);
    if (report === undefined && !fs.existsSync(file)) continue;
    found = true;
    for (const f of report ?? []) {
      findings.push({ rule: f.RuleID, description: f.Description, file: f.File, line: f.StartLine });
    }
  }
  if (!found) return {};
  return { leaks: findings.length, findings, scannedLocations: locations };
}

function codeQuality([file]) {
  return readJson(file) ?? {};
}

function integration([file]) {
  const run = readJson(file)?.run;
  if (!run) return {};
  return {
    requests: run.stats.requests.total,
    assertions: run.stats.assertions.total,
    failedAssertions: run.stats.assertions.failed,
    failures: run.failures.map((f) => ({
      item: f.source?.name ?? 'unknown request',
      test: f.error?.test ?? f.error?.name,
      message: f.error?.message,
    })),
  };
}

module.exports = {
  readJson,
  readers: {
    coverage,
    performance,
    confidentiality,
    'code-quality': codeQuality,
    integration,
  },
};
