#!/usr/bin/env node
'use strict';

// Usage: node evaluate.js <indicator> --stage <name> --out <metrics.json> [--location <label>]... <report files...>
// Evaluates one indicator, writes the metric file consumed by report.js, emits a
// GitHub annotation and exits 1 on a CRITICAL result so the job fails immediately.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { CLASSIFIERS, LEVELS } = require('./classify');
const { readers } = require('./readers');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'quality-gate.config.json');
const ICONS = { OK: '✅', WARNING: '⚠️', CRITICAL: '🛑' };

function evaluate(indicator, files, { stage, locations = [], config }) {
  const definition = CLASSIFIERS[indicator];
  if (!definition) throw new Error(`unknown indicator "${indicator}"`);
  const input = readers[indicator](files, { locations });
  const result = definition.classify(input, config[definition.configKey]);
  return {
    indicator,
    label: definition.label,
    stage,
    ...result,
    details: input,
    evaluatedAt: new Date().toISOString(),
  };
}

function annotate(metric) {
  const title = `${metric.label} [${metric.stage}]`;
  if (metric.level === LEVELS.CRITICAL) console.log(`::error title=${title} – ERREUR CRITIQUE::${metric.message}`);
  else if (metric.level === LEVELS.WARNING) console.log(`::warning title=${title} – non-critique::${metric.message}`);
  else console.log(`::notice title=${title}::${metric.message}`);
}

function writeSummary(metric) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = [
    `### ${ICONS[metric.level]} ${metric.label} — ${metric.stage}`,
    '',
    `**Niveau : ${metric.level}** — ${metric.message}`,
    '',
  ];
  if (metric.details?.findings?.length) {
    lines.push('| Règle | Fichier | Ligne |', '|---|---|---|');
    for (const f of metric.details.findings) lines.push(`| ${f.rule} | \`${f.file}\` | ${f.line} |`);
    lines.push('');
  }
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      stage: { type: 'string', default: 'default' },
      out: { type: 'string' },
      location: { type: 'string', multiple: true, default: [] },
    },
  });
  const [indicator, ...files] = positionals;
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const metric = evaluate(indicator, files, { stage: values.stage, locations: values.location, config });

  if (values.out) {
    fs.mkdirSync(path.dirname(values.out), { recursive: true });
    fs.writeFileSync(values.out, JSON.stringify(metric, null, 2));
  }
  annotate(metric);
  writeSummary(metric);
  console.log(`${ICONS[metric.level]} [${metric.level}] ${metric.label} (${metric.stage}) : ${metric.message}`);
  return metric.level === LEVELS.CRITICAL ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { evaluate, main };
