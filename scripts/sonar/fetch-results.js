#!/usr/bin/env node
'use strict';

// Waits for the SonarQube background task of the last analysis, then collects the
// quality gate status, the main measures and the blocking issues into one JSON file
// read by `evaluate.js code-quality`.
// Usage: node fetch-results.js <output.json>
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.SONAR_HOST_URL || 'http://localhost:9000';
const TOKEN = process.env.SONAR_TOKEN;
const PROJECT = process.env.SONAR_PROJECT_KEY || 'payflex-api';
const REPORT_TASK = process.env.SONAR_REPORT_TASK || '.scannerwork/report-task.txt';
const BLOCKING = 'BLOCKER,CRITICAL';

async function api(endpoint) {
  const res = await fetch(`${HOST}${endpoint}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${endpoint} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function readTaskId() {
  const content = fs.readFileSync(REPORT_TASK, 'utf8');
  const match = /^ceTaskId=(.+)$/m.exec(content);
  if (!match) throw new Error(`ceTaskId not found in ${REPORT_TASK}`);
  return match[1].trim();
}

async function waitForTask(id) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { task } = await api(`/api/ce/task?id=${id}`);
    if (task.status === 'SUCCESS') return;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`analysis task ${task.status}: ${task.errorMessage ?? ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('timed out waiting for the SonarQube analysis');
}

async function searchIssues(query) {
  const data = await api(`/api/issues/search?componentKeys=${PROJECT}&resolved=false&ps=100&${query}`);
  return data.issues.map((i) => ({
    type: i.type,
    severity: i.severity,
    rule: i.rule,
    component: i.component.replace(`${PROJECT}:`, ''),
    line: i.line,
    message: i.message,
  }));
}

async function main(outFile) {
  if (!TOKEN) throw new Error('SONAR_TOKEN is not set');
  await waitForTask(readTaskId());

  const gate = await api(`/api/qualitygates/project_status?projectKey=${PROJECT}`);
  const keys = 'bugs,vulnerabilities,code_smells,coverage,ncloc,duplicated_lines_density,sqale_index,security_hotspots';
  const { component } = await api(`/api/measures/component?component=${PROJECT}&metricKeys=${keys}`);
  const measures = Object.fromEntries(component.measures.map((m) => [m.metric, Number(m.value)]));

  const blockingIssues = await searchIssues(`types=BUG,VULNERABILITY&severities=${BLOCKING}`);
  const codeSmells = await searchIssues('types=CODE_SMELL');

  const result = {
    qualityGateStatus: gate.projectStatus.status,
    qualityGateConditions: gate.projectStatus.conditions,
    bugs: measures.bugs ?? 0,
    vulnerabilities: measures.vulnerabilities ?? 0,
    codeSmells: measures.code_smells ?? 0,
    coverage: measures.coverage,
    linesOfCode: measures.ncloc,
    duplicatedLinesPct: measures.duplicated_lines_density,
    technicalDebtMinutes: measures.sqale_index,
    securityHotspots: measures.security_hotspots ?? 0,
    blockingIssues,
    codeSmellIssues: codeSmells.slice(0, 20),
    dashboard: `${HOST}/dashboard?id=${PROJECT}`,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, codeSmellIssues: `${codeSmells.length} issue(s)` }, null, 2));
}

main(process.argv[2] || 'reports/sonar.json').catch((err) => {
  console.error(`::error title=SonarQube::${err.message}`);
  process.exitCode = 1;
});
