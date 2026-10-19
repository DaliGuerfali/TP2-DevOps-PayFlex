'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../../quality-gate.config.json');
const {
  LEVELS,
  confidentialityRate,
  classifyCoverage,
  classifyPerformance,
  classifyConfidentiality,
  classifyCodeQuality,
  classifyIntegration,
} = require('../../scripts/quality-gate/classify');
const { evaluate } = require('../../scripts/quality-gate/evaluate');
const { buildReport } = require('../../scripts/quality-gate/report');

describe('quality gate - coverage', () => {
  test.each([
    [95, LEVELS.OK],
    [80, LEVELS.OK],
    [75, LEVELS.WARNING],
    [70, LEVELS.WARNING],
    [69.9, LEVELS.CRITICAL],
  ])('%p%% -> %s', (lines, level) => {
    expect(classifyCoverage({ lines }, config.coverage).level).toBe(level);
  });

  test('warning message matches the TP wording', () => {
    expect(classifyCoverage({ lines: 75 }, config.coverage).message).toBe(
      'Attention, couverture à 75% (objectif 80%)',
    );
  });

  test('missing report fails safe', () => {
    expect(classifyCoverage({}, config.coverage).level).toBe(LEVELS.CRITICAL);
  });
});

describe('quality gate - performance', () => {
  test.each([
    [{ p95Ms: 12, errorRate: 0 }, LEVELS.OK],
    [{ p95Ms: 200, errorRate: 0.005 }, LEVELS.OK],
    [{ p95Ms: 260, errorRate: 0 }, LEVELS.WARNING],
    [{ p95Ms: 500, errorRate: 0 }, LEVELS.WARNING],
    [{ p95Ms: 50, errorRate: 0.015 }, LEVELS.WARNING],
    [{ p95Ms: 501, errorRate: 0 }, LEVELS.CRITICAL],
    [{ p95Ms: 50, errorRate: 0.021 }, LEVELS.CRITICAL],
    [{}, LEVELS.CRITICAL],
  ])('%p -> %s', (input, level) => {
    expect(classifyPerformance(input, config.performance).level).toBe(level);
  });

  test('critical message names every crossed limit and the abort', () => {
    const { message } = classifyPerformance({ p95Ms: 712.3, errorRate: 0.05, aborted: true }, config.performance);
    expect(message).toContain('latence p95 712.3 ms > 500 ms');
    expect(message).toContain("taux d'erreur 5% > 2%");
    expect(message).toContain('abortOnFail');
  });
});

describe('quality gate - confidentiality', () => {
  test('rate formula with the mandatory tolerance of 0', () => {
    expect(confidentialityRate(0, 0)).toBe(100);
    expect(confidentialityRate(1, 0)).toBe(0);
    expect(confidentialityRate(1, 4)).toBe(75);
    expect(confidentialityRate(9, 4)).toBe(0);
  });

  test('any leak is critical, zero leak is OK', () => {
    expect(classifyConfidentiality({ leaks: 0 }, config.confidentiality)).toMatchObject({
      level: LEVELS.OK,
      value: { leaks: 0, ratePct: 100 },
    });
    const leak = classifyConfidentiality({ leaks: 3, scannedLocations: ['artefact'] }, config.confidentiality);
    expect(leak.level).toBe(LEVELS.CRITICAL);
    expect(leak.message).toContain('taux de confidentialité 0% < 100%');
    expect(classifyConfidentiality({}, config.confidentiality).level).toBe(LEVELS.CRITICAL);
  });
});

describe('quality gate - code quality', () => {
  const clean = { qualityGateStatus: 'OK', bugs: 0, vulnerabilities: 0, codeSmells: 0, blockingIssues: [] };

  test('clean analysis is OK', () => {
    expect(classifyCodeQuality(clean, config.codeQuality).level).toBe(LEVELS.OK);
  });

  test('minor code smells are a warning', () => {
    expect(classifyCodeQuality({ ...clean, codeSmells: 4 }, config.codeQuality).level).toBe(LEVELS.WARNING);
  });

  test('blocking bug or failed gate is critical', () => {
    const blocking = {
      ...clean,
      bugs: 1,
      blockingIssues: [{ type: 'BUG', severity: 'BLOCKER', component: 'src/app.js', line: 3, message: 'null deref' }],
    };
    expect(classifyCodeQuality(blocking, config.codeQuality).message).toContain('BUG BLOCKER src/app.js:3');
    expect(classifyCodeQuality({ ...clean, qualityGateStatus: 'ERROR' }, config.codeQuality).level).toBe(
      LEVELS.CRITICAL,
    );
    expect(classifyCodeQuality(undefined, config.codeQuality).level).toBe(LEVELS.CRITICAL);
  });
});

describe('quality gate - integration', () => {
  test('all green, failures, and no assertions', () => {
    expect(classifyIntegration({ assertions: 30, failedAssertions: 0 }, config.integration).level).toBe(LEVELS.OK);
    const failed = classifyIntegration(
      { assertions: 30, failedAssertions: 1, failures: [{ item: '05 - Transfer', test: 'status 201' }] },
      config.integration,
    );
    expect(failed.level).toBe(LEVELS.CRITICAL);
    expect(failed.message).toContain('05 - Transfer → status 201');
    expect(classifyIntegration({}, config.integration).level).toBe(LEVELS.CRITICAL);
  });
});

describe('quality gate - evaluate from real report formats', () => {
  let dir;
  const write = (name, data) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(data));
    return file;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('jest json-summary', () => {
    const file = write('cov.json', {
      total: { lines: { pct: 76 }, statements: { pct: 77 }, branches: { pct: 60 }, functions: { pct: 90 } },
    });
    expect(evaluate('coverage', [file], { stage: 'unit-tests', config })).toMatchObject({
      level: LEVELS.WARNING,
      value: 76,
    });
  });

  test('k6 summary export', () => {
    const file = write('k6.json', {
      metrics: {
        http_req_duration: { values: { 'p(95)': 705.2, avg: 701 }, thresholds: { 'p(95)<500': { ok: false } } },
        http_req_failed: { values: { rate: 0 } },
        http_reqs: { values: { count: 120 } },
      },
    });
    const metric = evaluate('performance', [file], { stage: 'performance-tests', config });
    expect(metric.level).toBe(LEVELS.CRITICAL);
    expect(metric.details.aborted).toBe(true);
  });

  test('gitleaks reports, empty and with findings', () => {
    const empty = write('a.json', []);
    const leaky = write('b.json', [{ RuleID: 'aws-access-token', Description: 'AWS', File: 'app/x.js', StartLine: 3 }]);
    expect(evaluate('confidentiality', [empty], { stage: 'source', config }).level).toBe(LEVELS.OK);
    const metric = evaluate('confidentiality', [empty, leaky], { stage: 'artifact', config });
    expect(metric).toMatchObject({ level: LEVELS.CRITICAL, value: { leaks: 1, ratePct: 0 } });
    expect(evaluate('confidentiality', [path.join(dir, 'missing.json')], { stage: 'x', config }).level).toBe(
      LEVELS.CRITICAL,
    );
  });

  test('newman json report', () => {
    const file = write('newman.json', {
      run: {
        stats: { requests: { total: 11 }, assertions: { total: 40, failed: 0 } },
        failures: [],
      },
    });
    expect(evaluate('integration', [file], { stage: 'integration-tests', config }).level).toBe(LEVELS.OK);
  });

  test('unknown indicator is rejected', () => {
    expect(() => evaluate('nope', [], { stage: 'x', config })).toThrow('unknown indicator');
  });
});

describe('quality gate - report', () => {
  const metric = (indicator, stage, level, message = level) => ({ indicator, stage, label: indicator, level, message });

  test('warnings only -> deployment allowed with warnings', () => {
    const { summary, markdown } = buildReport({
      metrics: [metric('coverage', 'unit-tests', 'WARNING', 'Attention, couverture à 75%')],
      mode: 'gate',
    });
    expect(summary).toMatchObject({ blocked: false, critical: 0, warnings: 1 });
    expect(markdown).toContain('DÉPLOIEMENT AUTORISÉ AVEC 1 AVERTISSEMENT');
  });

  test('critical metric -> incident report with exact cause and skipped stages', () => {
    const { summary, markdown } = buildReport({
      metrics: [metric('performance', 'performance-tests', 'CRITICAL', 'latence p95 700 ms > 500 ms')],
      needs: { 'performance-tests': { result: 'failure' }, 'quality-gate': { result: 'skipped' } },
      mode: 'incident',
      context: { scenario: 'perf-critical', sha: 'abc1234' },
    });
    expect(summary.blocked).toBe(true);
    expect(markdown).toContain('Cause exacte du blocage');
    expect(markdown).toContain('latence p95 700 ms > 500 ms');
    expect(markdown).toContain('`quality-gate` → **aucun déploiement**');
    expect(markdown).toContain('NOT_RUN');
  });

  test('failed job without metric is still reported as the cause', () => {
    const { markdown } = buildReport({ metrics: [], needs: { sonarqube: { result: 'failure' } }, mode: 'incident' });
    expect(markdown).toContain('Job `sonarqube` en échec');
  });
});
