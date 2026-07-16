#!/usr/bin/env node
/**
 * Lighthouse Performance Runner
 * -----------------------------
 * Dedicated entrypoint for performance metric tests.
 *
 * Usage: node ai_lighthouse_runner.js tests/example.test.yml
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import llmConfig from './config/llm.config.js';
import { PerformanceReportGenerator } from './performance-report-generator.js';
import { runLighthouseAudit } from './src/perf/lighthouse-runner.js';
import { buildPerfSuggestionsSystemPrompt, buildPerfSuggestionsUserMessage } from './src/prompts/perf-ai-suggestions.prompt.js';
import { findChromiumPath } from './src/utils/browser-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  llm: {
    provider: llmConfig.provider,
    apiKey: llmConfig.apiKey,
    model: llmConfig.model,
    temperature: 1
  },
  reporting: {
    outputDir: 'test-reports'
  }
};

const log = {
  info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg, err) => console.error(`❌ ${msg}`, err || ''),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  llm: (msg) => console.log(`🤖 LLM: ${msg}`)
};

function isPerformanceTest(testText) {
  const trimmed = testText.trimStart().toLowerCase();
  return trimmed.startsWith('schemaversion:') || /^\s*performance\s*:/m.test(testText);
}

function parsePerformanceConfig(testText) {
  const testName = (testText.match(/^performance:\s*(.+)$/m)?.[1] || 'performance-test').trim();

  const validCategories = new Set(['performance', 'accessibility', 'best-practices', 'seo']);
  let categories = ['performance'];

  const blockMatch = testText.match(/^\s*categories\s*:\s*\n((?:[ \t]*-[ \t]+\S+[ \t]*\n?)+)/m);
  if (blockMatch) {
    const parsed = [...blockMatch[1].matchAll(/[ \t]*-[ \t]+(\S+)/g)]
      .map(match => match[1].toLowerCase())
      .filter(category => validCategories.has(category));
    if (parsed.length > 0) categories = parsed;
  } else {
    const inlineMatch = testText.match(/^\s*categories\s*:\s*([^\n]+)$/m);
    if (inlineMatch) {
      const parsed = inlineMatch[1].split(',')
        .map(category => category.trim().toLowerCase())
        .filter(category => validCategories.has(category));
      if (parsed.length > 0) categories = parsed;
    }
  }

  let urls = [];
  const targetsBlock = testText.match(/^\s*targets\s*:\s*\n((?:[ \t]*-[ \t]+\S+[ \t]*\n?)+)/m);
  if (targetsBlock) {
    urls = [...targetsBlock[1].matchAll(/[ \t]*-[ \t]+(\S+)/g)]
      .map(match => match[1].trim())
      .filter(url => /^https?:\/\/.+/.test(url));
  }

  if (urls.length === 0) {
    const singleUrl = (testText.match(/^\s*url:\s*(.+)$/m)?.[1] || '').trim()
      || (testText.match(/https?:\/\/[^\s"'<>]+/i)?.[0] || '');
    if (singleUrl) urls = [singleUrl];
  }

  return { testName, urls, categories };
}

class LighthouseRunner {
  constructor() {
    process.env.OPENAI_API_KEY = config.llm.apiKey;
    
    this.agent = new Agent({
      name: 'LighthouseFixer',
      instructions: buildPerfSuggestionsSystemPrompt(),
      model: config.llm.model,
      outputType: z.object({
        performance: z.array(z.string()).optional(),
        accessibility: z.array(z.string()).optional(),
        'best-practices': z.array(z.string()).optional(),
        seo: z.array(z.string()).optional(),
      })
    });
  }

  async generateAISuggestions(mobileMetrics, desktopMetrics, categories) {
    const validCategories = ['performance', 'accessibility', 'best-practices', 'seo'];
    const negativeAudits = {};

    for (const category of categories.filter(item => validCategories.includes(item))) {
      const mobileAudits = (mobileMetrics.categoryAudits?.[category] || [])
        .filter(audit => audit.score !== null && audit.score < 0.9);
      const desktopAudits = (desktopMetrics.categoryAudits?.[category] || [])
        .filter(audit => audit.score !== null && audit.score < 0.9);

      const auditMap = new Map();
      [...mobileAudits, ...desktopAudits].forEach(audit => auditMap.set(audit.id, audit));
      const uniqueAudits = Array.from(auditMap.values());

      if (uniqueAudits.length > 0) {
        negativeAudits[category] = uniqueAudits.slice(0, 8);
      }
    }

    if (Object.keys(negativeAudits).length === 0) return {};

    try {
      log.info('🤖 Generating AI fix suggestions...');
      const prompt = buildPerfSuggestionsUserMessage(negativeAudits);
      
      const response = await run(this.agent, prompt);
      const suggestions = response.finalOutput || {};

      log.success('AI suggestions ready');
      return suggestions;
    } catch (err) {
      log.warn(`AI suggestions skipped (non-fatal): ${err.message}`);
      return {};
    }
  }

  async runTest(testText, testName) {
    if (!isPerformanceTest(testText)) {
      throw new Error('ai_lighthouse_runner only supports performance tests.');
    }

    const perfConfig = parsePerformanceConfig(testText);
    const logicalName = perfConfig.testName || testName;

    if (perfConfig.urls.length === 0) {
      throw new Error('Performance test YAML is missing target URL(s).');
    }

    console.log('__PERF_TEST__');

    log.info(`🚀 Performance suite: ${logicalName}`);
    log.info(`🔗 URLs (${perfConfig.urls.length}): ${perfConfig.urls.join(', ')}`);
    log.info(`📊 Categories: ${perfConfig.categories.join(', ')}`);

    const chromiumPath = findChromiumPath();
    log.info(`Using Chromium at: ${chromiumPath}`);

    const perfReportGen = new PerformanceReportGenerator({ outputDir: config.reporting.outputDir });
    const perfDir = path.resolve('files/perf');
    fs.mkdirSync(perfDir, { recursive: true });

    const reports = [];

    for (const targetUrl of perfConfig.urls) {
      log.info(`\n--- Auditing: ${targetUrl} ---`);

      log.info('📱 Running Mobile Lighthouse...');
      const { metrics: mobileMetrics } = await runLighthouseAudit(
        targetUrl,
        chromiumPath,
        'mobile',
        perfConfig.categories
      );
      log.success(`Mobile done — Performance: ${mobileMetrics.performanceScore}`);

      log.info('💻 Running Desktop Lighthouse...');
      const { metrics: desktopMetrics } = await runLighthouseAudit(
        targetUrl,
        chromiumPath,
        'desktop',
        perfConfig.categories
      );
      log.success(`Desktop done — Performance: ${desktopMetrics.performanceScore}`);

      const aiSuggestions = await this.generateAISuggestions(
        mobileMetrics,
        desktopMetrics,
        perfConfig.categories
      );

      const { htmlReport } = perfReportGen.generateReport({
        testName: logicalName,
        targetUrl,
        generatedAt: Date.now(),
        categories: perfConfig.categories,
        mobileMetrics,
        desktopMetrics,
        aiSuggestions,
      });

      reports.push(htmlReport);
      log.success(`📊 Report saved: ${htmlReport}`);
      console.log(`__REPORT_FILE__${path.basename(htmlReport)}`);
    }

    return reports;
  }
}

function getTestFiles(dirPath) {
  const testFiles = [];

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Path does not exist: ${dirPath}`);
  }

  const stats = fs.statSync(dirPath);

  if (stats.isFile()) {
    if (dirPath.endsWith('.yml') || dirPath.endsWith('.yaml')) {
      return [path.resolve(dirPath)];
    }
    throw new Error(`File must be a .yml or .yaml file: ${dirPath}`);
  }

  if (stats.isDirectory()) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const fileStats = fs.statSync(fullPath);
      if (fileStats.isFile() && (file.endsWith('.yml') || file.endsWith('.yaml'))) {
        testFiles.push(path.resolve(fullPath));
      }
    }
    return testFiles.sort();
  }

  return testFiles;
}

async function main() {
  const testPath = process.argv[2];

  if (!testPath) {
    console.error('Usage: node ai_lighthouse_runner.js <test.yml | tests-folder>');
    console.error('Examples:');
    console.error('  node ai_lighthouse_runner.js tests/perf.test.yml');
    console.error('  node ai_lighthouse_runner.js tests/');
    process.exit(1);
  }

  let testFiles;
  try {
    testFiles = getTestFiles(testPath);
  } catch (err) {
    log.error('Failed to load test files', err.message);
    process.exit(1);
  }

  if (testFiles.length === 0) {
    log.error('No test files found in the specified path');
    process.exit(1);
  }

  log.info(`Found ${testFiles.length} performance test file(s) to execute`);

  const allResults = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (let index = 0; index < testFiles.length; index++) {
    const testFile = testFiles[index];
    const testName = path.basename(testFile);
    const testText = fs.readFileSync(testFile, 'utf8');
    const runner = new LighthouseRunner();

    log.info(`\n${'='.repeat(60)}`);
    log.info(`Executing performance test ${index + 1}/${testFiles.length}: ${testName}`);
    log.info(`${'='.repeat(60)}\n`);

    try {
      const reports = await runner.runTest(testText, testName);
      allResults.push({ testName, status: 'PASSED', reports });
      totalPassed++;
      log.success(`✅ Test PASSED: ${testName}\n`);
    } catch (err) {
      allResults.push({ testName, status: 'FAILED', error: err.message });
      totalFailed++;
      log.error(`❌ Test FAILED: ${testName}`, err.message + '\n');
    }
  }

  log.info(`\n${'='.repeat(60)}`);
  log.info('TEST SUITE SUMMARY');
  log.info(`${'='.repeat(60)}`);
  log.info(`Total Tests: ${testFiles.length}`);
  log.success(`Passed: ${totalPassed}`);
  if (totalFailed > 0) {
    log.error(`Failed: ${totalFailed}`, '');
  }
  log.info(`${'='.repeat(60)}\n`);

  allResults.forEach((result, idx) => {
    const status = result.status === 'PASSED' ? '✅' : '❌';
    console.log(`${status} ${idx + 1}. ${result.testName} - ${result.status}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  if (totalFailed > 0) {
    process.exit(1);
  }

  log.success('\n🎉 ALL TESTS PASSED');
}

export { LighthouseRunner, log, config };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log.error('Fatal error', err);
    process.exit(1);
  });
}
