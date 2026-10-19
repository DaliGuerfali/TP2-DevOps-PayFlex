'use strict';

// Pure classification rules of the PayFlex quality gate.
// Every indicator is turned into { level, value, message } where level is:
//   OK        -> nothing to report
//   WARNING   -> non-critical: the pipeline continues but raises an alert
//   CRITICAL  -> the pipeline stops immediately (fail fast), no deployment

const LEVELS = Object.freeze({ OK: 'OK', WARNING: 'WARNING', CRITICAL: 'CRITICAL' });

const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

function classifyCoverage(input, cfg) {
  const pct = input[cfg.metric];
  if (typeof pct !== 'number') {
    return { level: LEVELS.CRITICAL, value: null, message: 'Rapport de couverture absent ou illisible' };
  }
  if (pct < cfg.criticalBelowPct) {
    return {
      level: LEVELS.CRITICAL,
      value: pct,
      message: `Couverture à ${pct}% (< ${cfg.criticalBelowPct}%) : régression de tests, déploiement bloqué`,
    };
  }
  if (pct < cfg.warningBelowPct) {
    return {
      level: LEVELS.WARNING,
      value: pct,
      message: `Attention, couverture à ${pct}% (objectif ${cfg.warningBelowPct}%)`,
    };
  }
  return { level: LEVELS.OK, value: pct, message: `Couverture à ${pct}% (≥ ${cfg.warningBelowPct}%)` };
}

function classifyPerformance({ p95Ms, errorRate, aborted }, cfg) {
  if (typeof p95Ms !== 'number' || typeof errorRate !== 'number') {
    return { level: LEVELS.CRITICAL, value: null, message: 'Résumé k6 absent : le tir de charge n’a pas pu s’exécuter' };
  }
  const value = { p95Ms: round(p95Ms), errorRatePct: round(errorRate * 100, 3) };
  const reasons = [];
  if (p95Ms > cfg.p95CriticalMs) reasons.push(`latence p95 ${value.p95Ms} ms > ${cfg.p95CriticalMs} ms`);
  if (errorRate > cfg.errorRateCritical) {
    reasons.push(`taux d'erreur ${value.errorRatePct}% > ${cfg.errorRateCritical * 100}%`);
  }
  if (reasons.length) {
    const suffix = aborted ? ' (tir k6 interrompu par abortOnFail)' : '';
    return { level: LEVELS.CRITICAL, value, message: `Chute de performance : ${reasons.join(' et ')}${suffix}` };
  }
  const warnings = [];
  if (p95Ms > cfg.p95TargetMs) warnings.push(`latence p95 à ${value.p95Ms} ms (objectif < ${cfg.p95TargetMs} ms)`);
  if (errorRate >= cfg.errorRateTarget) {
    warnings.push(`taux d'erreur à ${value.errorRatePct}% (objectif < ${cfg.errorRateTarget * 100}%)`);
  }
  if (warnings.length) return { level: LEVELS.WARNING, value, message: `Attention, ${warnings.join(' et ')}` };
  return {
    level: LEVELS.OK,
    value,
    message: `p95 ${value.p95Ms} ms (< ${cfg.p95TargetMs} ms), erreurs ${value.errorRatePct}% (< ${cfg.errorRateTarget * 100}%)`,
  };
}

// TP formula: rate = (1 - leaks / maxTolerated) x 100.
// With the mandatory tolerance of 0 the ratio is undefined, so the denominator is
// max(maxTolerated, 1): 0 leak -> 100 %, any leak -> below 100 % (0 % with tolerance 0).
function confidentialityRate(leaks, maxTolerated) {
  const denominator = Math.max(maxTolerated, 1);
  return round(Math.max(0, (1 - leaks / denominator) * 100));
}

function classifyConfidentiality({ leaks, scannedLocations }, cfg) {
  if (typeof leaks !== 'number') {
    return { level: LEVELS.CRITICAL, value: null, message: 'Rapport Gitleaks absent : confidentialité non vérifiable' };
  }
  const rate = confidentialityRate(leaks, cfg.maxToleratedLeaks);
  const where = scannedLocations?.length ? ` [${scannedLocations.join(', ')}]` : '';
  if (rate < cfg.requiredRatePct) {
    return {
      level: LEVELS.CRITICAL,
      value: { leaks, ratePct: rate },
      message: `Fuite de données confidentielles : ${leaks} secret(s)/PII détecté(s), taux de confidentialité ${rate}% < ${cfg.requiredRatePct}%${where}`,
    };
  }
  return {
    level: LEVELS.OK,
    value: { leaks, ratePct: rate },
    message: `Taux de confidentialité ${rate}% : aucune fuite détectée${where}`,
  };
}

function classifyCodeQuality(input, cfg) {
  if (!input || typeof input.qualityGateStatus !== 'string') {
    return { level: LEVELS.CRITICAL, value: null, message: 'Résultat SonarQube absent : analyse statique non vérifiable' };
  }
  const value = {
    qualityGate: input.qualityGateStatus,
    bugs: input.bugs ?? 0,
    vulnerabilities: input.vulnerabilities ?? 0,
    codeSmells: input.codeSmells ?? 0,
    blockingIssues: input.blockingIssues?.length ?? 0,
  };
  const severities = cfg.criticalSeverities.join('/');
  if (value.blockingIssues > 0) {
    const sample = input.blockingIssues
      .slice(0, 3)
      .map((i) => `${i.type} ${i.severity} ${i.component}:${i.line ?? '?'} « ${i.message} »`)
      .join(' ; ');
    return {
      level: LEVELS.CRITICAL,
      value,
      message: `${value.blockingIssues} bug(s)/vulnérabilité(s) ${severities} : ${sample}`,
    };
  }
  if (value.qualityGate === 'ERROR') {
    return { level: LEVELS.CRITICAL, value, message: 'Quality Gate SonarQube en échec (ERROR)' };
  }
  if (value.codeSmells > 0 || value.bugs > 0 || value.vulnerabilities > 0) {
    return {
      level: LEVELS.WARNING,
      value,
      message: `Dette technique : ${value.codeSmells} code smell(s), ${value.bugs} bug(s) mineur(s), ${value.vulnerabilities} vulnérabilité(s) mineure(s)`,
    };
  }
  return { level: LEVELS.OK, value, message: 'Quality Gate SonarQube OK, aucun bug ni code smell' };
}

function classifyIntegration({ assertions, failedAssertions, failures = [] }, cfg) {
  if (typeof assertions !== 'number' || assertions === 0) {
    return { level: LEVELS.CRITICAL, value: null, message: 'Aucune assertion Newman exécutée : scénario API non validé' };
  }
  const value = { assertions, failedAssertions };
  if (failedAssertions > cfg.maxFailedAssertions) {
    const sample = failures
      .slice(0, 3)
      .map((f) => `${f.item} → ${f.test}`)
      .join(' ; ');
    return {
      level: LEVELS.CRITICAL,
      value,
      message: `Régression API : ${failedAssertions}/${assertions} assertion(s) en échec (${sample})`,
    };
  }
  return { level: LEVELS.OK, value, message: `${assertions} assertions Newman au vert` };
}

const CLASSIFIERS = {
  coverage: { label: 'Couverture de code', configKey: 'coverage', classify: classifyCoverage },
  performance: { label: 'Performance (k6)', configKey: 'performance', classify: classifyPerformance },
  confidentiality: { label: 'Confidentialité', configKey: 'confidentiality', classify: classifyConfidentiality },
  'code-quality': { label: 'Bugs / Smells (SonarQube)', configKey: 'codeQuality', classify: classifyCodeQuality },
  integration: { label: "Tests d'intégration (Newman)", configKey: 'integration', classify: classifyIntegration },
};

module.exports = {
  LEVELS,
  CLASSIFIERS,
  confidentialityRate,
  classifyCoverage,
  classifyPerformance,
  classifyConfidentiality,
  classifyCodeQuality,
  classifyIntegration,
};
