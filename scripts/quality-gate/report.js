#!/usr/bin/env node
'use strict';

// Usage: node report.js --mode <gate|incident> --metrics <dir> --out <dir>
// Aggregates every metrics/*.json produced by evaluate.js into the analysis report:
// critical errors (deployment blocked) vs non-critical warnings (technical debt).
//   gate     -> final quality gate before deployment, exits 1 if anything is CRITICAL
//   incident -> runs when the pipeline failed: explains the exact cause of the block
// NEEDS_JSON (the GitHub `needs` context) adds the status of every job.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { LEVELS } = require('./classify');

const ICONS = { OK: '✅', WARNING: '⚠️', CRITICAL: '🛑' };
const EXPECTED = [
  { key: 'confidentiality:source', label: 'Confidentialité', stage: 'source' },
  { key: 'coverage:unit-tests', label: 'Couverture de code', stage: 'unit-tests' },
  { key: 'code-quality:sonarqube', label: 'Bugs / Smells (SonarQube)', stage: 'sonarqube' },
  { key: 'confidentiality:artifact', label: 'Confidentialité', stage: 'artifact' },
  { key: 'integration:integration-tests', label: "Tests d'intégration (Newman)", stage: 'integration-tests' },
  { key: 'confidentiality:logs', label: 'Confidentialité', stage: 'logs' },
  { key: 'performance:performance-tests', label: 'Performance (k6)', stage: 'performance-tests' },
];
const JOB_LABELS = {
  'secrets-scan': '🔐 Scan des secrets (source, config, historique)',
  'unit-tests': '🧪 Tests unitaires + couverture',
  sonarqube: '🔎 Analyse statique SonarQube',
  build: '📦 Build + scan de l’artefact',
  'integration-tests': '🔗 Tests d’intégration (Docker + Newman)',
  'performance-tests': '⚡ Tests de performance (k6)',
  'quality-gate': '🚦 Quality Gate',
};
const JOB_ICONS = { success: '✅', failure: '🛑', cancelled: '⏹️', skipped: '⏭️' };

function loadMetrics(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

function buildReport({ metrics, needs = {}, mode, context = {} }) {
  const byKey = new Map(metrics.map((m) => [`${m.indicator}:${m.stage}`, m]));
  const rows = EXPECTED.map((e) => byKey.get(e.key) ?? { ...e, level: 'NOT_RUN', message: 'Étape non exécutée' });
  for (const m of metrics) if (!EXPECTED.some((e) => e.key === `${m.indicator}:${m.stage}`)) rows.push(m);

  const critical = rows.filter((r) => r.level === LEVELS.CRITICAL);
  const warnings = rows.filter((r) => r.level === LEVELS.WARNING);
  const failedJobs = Object.entries(needs).filter(([, j]) => j.result === 'failure').map(([name]) => name);
  const blocked = critical.length > 0 || failedJobs.length > 0;

  let status;
  if (blocked) status = '🛑 **DÉPLOIEMENT BLOQUÉ** — erreur critique détectée (fail fast)';
  else if (warnings.length) status = `⚠️ **DÉPLOIEMENT AUTORISÉ AVEC ${warnings.length} AVERTISSEMENT(S)**`;
  else status = '✅ **DÉPLOIEMENT AUTORISÉ** — tous les critères sont au vert';

  const title = mode === 'incident' ? "🚨 Rapport d'incident — pipeline interrompu" : '🚦 Rapport du Quality Gate PayFlex';
  const lines = [`## ${title}`, ''];
  if (context.scenario) lines.push(`Scénario : \`${context.scenario}\` · Commit : \`${context.sha ?? '?'}\``, '');
  lines.push(status, '');

  if (mode === 'incident' || blocked) {
    lines.push('### Cause exacte du blocage', '');
    if (critical.length) {
      for (const c of critical) lines.push(`- 🛑 **${c.label}** (étape \`${c.stage}\`) : ${c.message}`);
    } else if (failedJobs.length) {
      for (const job of failedJobs) lines.push(`- 🛑 Job \`${job}\` en échec (erreur d'exécution, voir ses logs)`);
    }
    const notRun = Object.entries(needs).filter(([, j]) => j.result === 'skipped').map(([n]) => `\`${n}\``);
    if (notRun.length) lines.push('', `Étapes annulées suite au blocage : ${notRun.join(', ')} → **aucun déploiement**.`);
    lines.push('');
  }

  lines.push('### Indicateurs', '', '| Indicateur | Étape | Valeur | Niveau | Détail |', '|---|---|---|---|---|');
  for (const r of rows) {
    const icon = ICONS[r.level] ?? '⏭️';
    lines.push(`| ${r.label} | ${r.stage} | ${formatValue(r.value)} | ${icon} ${r.level} | ${r.message} |`);
  }
  lines.push('');

  lines.push('### Classification des erreurs', '');
  lines.push(`**Critiques (bloquantes) : ${critical.length}**`);
  for (const c of critical) lines.push(`- ${c.label} [${c.stage}] — ${c.message}`);
  lines.push('', `**Non-critiques (avertissements / dette technique) : ${warnings.length}**`);
  for (const w of warnings) lines.push(`- ${w.label} [${w.stage}] — ${w.message}`);
  lines.push('');

  if (Object.keys(needs).length) {
    lines.push('### Statut des jobs', '', '| Job | Résultat |', '|---|---|');
    for (const [name, job] of Object.entries(needs)) {
      lines.push(`| ${JOB_LABELS[name] ?? name} | ${JOB_ICONS[job.result] ?? ''} ${job.result} |`);
    }
    lines.push('');
  }

  return {
    markdown: lines.join('\n'),
    summary: { blocked, critical: critical.length, warnings: warnings.length, failedJobs, rows },
  };
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: 'string', default: 'gate' },
      metrics: { type: 'string', default: 'metrics' },
      out: { type: 'string', default: 'reports' },
    },
  });
  const needs = process.env.NEEDS_JSON ? JSON.parse(process.env.NEEDS_JSON) : {};
  const context = { scenario: process.env.SCENARIO, sha: process.env.GITHUB_SHA?.slice(0, 7) };
  const { markdown, summary } = buildReport({ metrics: loadMetrics(values.metrics), needs, mode: values.mode, context });

  const base = values.mode === 'incident' ? 'incident-report' : 'quality-gate-report';
  fs.mkdirSync(values.out, { recursive: true });
  fs.writeFileSync(path.join(values.out, `${base}.md`), markdown);
  fs.writeFileSync(path.join(values.out, `${base}.json`), JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(markdown);

  for (const w of summary.rows.filter((r) => r.level === LEVELS.WARNING)) {
    console.log(`::warning title=Quality Gate – non-critique::${w.label} [${w.stage}] : ${w.message}`);
  }
  if (values.mode === 'incident') {
    const cause = summary.rows.find((r) => r.level === LEVELS.CRITICAL);
    const text = cause ? `${cause.label} [${cause.stage}] : ${cause.message}` : `jobs en échec : ${summary.failedJobs.join(', ')}`;
    console.log(`::error title=Pipeline interrompu – déploiement annulé::${text}`);
    return 0;
  }
  return summary.blocked ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { buildReport, main };
