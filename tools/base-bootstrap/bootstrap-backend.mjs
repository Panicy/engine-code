#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../validator/validate-feature.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const coreTables = [
  'sys_user',
  'sys_role',
  'sys_user_role',
  'sys_menu',
  'sys_role_menu',
  'sys_dept',
  'sys_config',
  'sys_dict_type',
  'sys_dict_data',
  'sys_client',
];

function usage() {
  return [
    '用法：node tools/base-bootstrap/bootstrap-backend.mjs \\',
    '  --project-id <projectId> \\',
    '  --base-id <baseId> \\',
    '  --workspace <backend workspace> \\',
    '  --database <mysql database> \\',
    '  --out <bootstrap-state.json>',
    '',
    '可选：',
    '  --template-id backend-starter',
    '  --mysql-command mysql',
    '  --mysql-host 127.0.0.1',
    '  --mysql-port 3306',
    '  --mysql-user root',
    '  --mysql-password-env MYSQL_PWD',
    '  --mysql-password-source local-env',
    '  --redis-command redis-cli',
    '  --redis-url redis://default:***@127.0.0.1:6379',
    '  --allow-import',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--allow-import') {
      args.allowImport = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function requireArg(args, key) {
  if (!args[key]) throw new Error(`缺少必填参数 --${key}`);
  return args[key];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120000,
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    summary: [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(0, 1000),
  };
}

function mysqlArgs(args, sql, database = '') {
  const output = [
    '--protocol=TCP',
    '-h',
    args['mysql-host'] ?? '127.0.0.1',
    '-P',
    String(args['mysql-port'] ?? '3306'),
    '-u',
    args['mysql-user'] ?? 'root',
    '--batch',
    '--skip-column-names',
  ];
  if (database) output.push(database);
  output.push('-e', sql);
  return output;
}

function mysqlEnv(args) {
  const env = { ...process.env };
  const passwordEnv = args['mysql-password-env'];
  if (passwordEnv && process.env[passwordEnv]) env.MYSQL_PWD = process.env[passwordEnv];
  return env;
}

function parseLines(text) {
  return String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function existingTables(args, database) {
  const sql = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database.replaceAll("'", "''")}' AND TABLE_NAME IN (${coreTables.map((table) => `'${table}'`).join(',')}) ORDER BY TABLE_NAME;`;
  const result = run(args['mysql-command'] ?? 'mysql', mysqlArgs(args, sql), { env: mysqlEnv(args) });
  if (!result.ok) throw new Error(`MySQL 核心表检查失败：${result.summary}`);
  return new Set(parseLines(result.stdout));
}

function databaseExists(args, database) {
  const sql = `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${database.replaceAll("'", "''")}';`;
  const result = run(args['mysql-command'] ?? 'mysql', mysqlArgs(args, sql), { env: mysqlEnv(args) });
  if (!result.ok) throw new Error(`MySQL 数据库检查失败：${result.summary}`);
  return parseLines(result.stdout).includes(database);
}

function createDatabase(args, database) {
  const sql = `CREATE DATABASE IF NOT EXISTS \`${database.replaceAll('`', '``')}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`;
  return run(args['mysql-command'] ?? 'mysql', mysqlArgs(args, sql), { env: mysqlEnv(args) });
}

function importBaseline(args, database, sqlPath, workspace) {
  const commandArgs = [
    '--protocol=TCP',
    '-h',
    args['mysql-host'] ?? '127.0.0.1',
    '-P',
    String(args['mysql-port'] ?? '3306'),
    '-u',
    args['mysql-user'] ?? 'root',
    database,
  ];
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const result = spawnSync(args['mysql-command'] ?? 'mysql', commandArgs, {
    cwd: workspace,
    env: mysqlEnv(args),
    input: sql,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    summary: [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(0, 1000),
  };
}

function checkRedis(args) {
  if (!args['redis-url']) {
    return { id: 'redis-ping', type: 'command', status: 'skipped', summary: '未提供 --redis-url，跳过 Redis 检查。' };
  }
  const result = run(args['redis-command'] ?? 'redis-cli', ['-u', args['redis-url'], 'PING']);
  if (result.ok && parseLines(result.stdout).includes('PONG')) {
    return { id: 'redis-ping', type: 'command', status: 'passed', summary: 'Redis PING 成功。' };
  }
  return { id: 'redis-ping', type: 'command', status: 'failed', summary: result.summary || 'Redis PING 失败。' };
}

function classifyTables(found) {
  if (found.size === 0) return 'empty';
  if (coreTables.every((table) => found.has(table))) return 'ready';
  return 'partial';
}

function buildState({ args, workspace, database, databaseExistsValue, foundTables, importedScripts, skippedScripts, checks, issues, state }) {
  return {
    schemaVersion: '0.1.0',
    projectId: args['project-id'],
    baseId: args['base-id'],
    templateId: args['template-id'] ?? 'backend-starter',
    state,
    checkedAt: new Date().toISOString(),
    environment: {
      database: {
        type: 'mysql',
        host: args['mysql-host'] ?? '127.0.0.1',
        port: Number(args['mysql-port'] ?? 3306),
        database,
        username: args['mysql-user'] ?? 'root',
        passwordSource: args['mysql-password-source'] ?? args['mysql-password-env'] ?? 'not-provided',
      },
      redis: {
        host: redisHost(args['redis-url']),
        port: redisPort(args['redis-url']),
        username: redisUsername(args['redis-url']),
        passwordSource: args['redis-url'] ? 'runtime-arg' : 'not-provided',
      },
    },
    baseline: {
      databaseExists: databaseExistsValue,
      importedScripts,
      skippedScripts,
      coreTables: coreTables.map((name) => ({ name, exists: foundTables.has(name) })),
      coreData: [
        { id: 'admin-user', name: '默认管理员用户', exists: foundTables.has('sys_user') },
        { id: 'system-menu', name: '系统管理菜单', exists: foundTables.has('sys_menu') },
        { id: 'common-status-dict', name: '通用状态字典', exists: foundTables.has('sys_dict_type') },
      ],
    },
    checks,
    issues,
    humanConfirmation: {
      required: state === 'needs_human',
      confirmedBy: '',
      confirmedAt: '',
      reason: state === 'needs_human' ? issues.map((item) => item.message).join('；') : '',
    },
  };
}

function redisHost(redisUrl) {
  try {
    return redisUrl ? new URL(redisUrl).hostname : '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

function redisPort(redisUrl) {
  try {
    return Number(new URL(redisUrl).port || 6379);
  } catch {
    return 6379;
  }
}

function redisUsername(redisUrl) {
  try {
    return new URL(redisUrl).username || '';
  } catch {
    return '';
  }
}

function validateBootstrapState(state, file) {
  const schema = JSON.parse(fs.readFileSync(path.resolve(repoRoot, 'schemas/bootstrap-state.schema.json'), 'utf8'));
  return validateSchema(state, schema, { file, rootSchema: schema });
}

function writeState(outPath, state) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function bootstrapBackend(inputArgs) {
  const args = { ...inputArgs };
  requireArg(args, 'project-id');
  requireArg(args, 'base-id');
  const workspace = path.resolve(repoRoot, requireArg(args, 'workspace'));
  const database = requireArg(args, 'database');
  const outPath = path.resolve(repoRoot, requireArg(args, 'out'));
  const baselineSql = path.join(workspace, 'script/sql/ry_vue_5.X.sql');
  const checks = [];
  const issues = [];
  const importedScripts = [];
  const skippedScripts = ['script/sql/ry_job.sql', 'script/sql/ry_workflow.sql'];

  if (!fs.existsSync(baselineSql)) {
    issues.push({ code: 'BASELINE_SQL_MISSING', severity: 'error', message: `基础 SQL 不存在：${baselineSql}` });
  } else {
    checks.push({ id: 'baseline-sql-exists', type: 'command', status: 'passed', summary: '基础 SQL script/sql/ry_vue_5.X.sql 存在。' });
  }

  let databaseExistsValue = false;
  let foundTables = new Set();
  try {
    databaseExistsValue = databaseExists(args, database);
    checks.push({ id: 'mysql-connection', type: 'command', status: 'passed', summary: 'MySQL 连接成功。' });
    if (!databaseExistsValue) {
      const createResult = createDatabase(args, database);
      if (!createResult.ok) throw new Error(`创建数据库失败：${createResult.summary}`);
      databaseExistsValue = true;
    }
    foundTables = existingTables(args, database);
  } catch (error) {
    checks.push({ id: 'mysql-connection', type: 'command', status: 'failed', summary: error.message });
    issues.push({ code: 'MYSQL_CHECK_FAILED', severity: 'error', message: error.message });
  }

  const redisCheck = checkRedis(args);
  checks.push(redisCheck);
  if (redisCheck.status === 'failed') {
    issues.push({ code: 'REDIS_CHECK_FAILED', severity: 'error', message: redisCheck.summary });
  }

  if (issues.length === 0) {
    const classification = classifyTables(foundTables);
    if (classification === 'empty') {
      if (!args.allowImport) {
        issues.push({ code: 'BASELINE_IMPORT_CONFIRMATION_REQUIRED', severity: 'error', message: '目标库为空，需显式传入 --allow-import 后才导入基础 SQL。' });
      } else {
        const importResult = importBaseline(args, database, baselineSql, workspace);
        if (!importResult.ok) {
          issues.push({ code: 'BASELINE_IMPORT_FAILED', severity: 'error', message: `基础 SQL 导入失败：${importResult.summary}` });
        } else {
          importedScripts.push('script/sql/ry_vue_5.X.sql');
          foundTables = existingTables(args, database);
        }
      }
    } else if (classification === 'partial') {
      const missing = coreTables.filter((table) => !foundTables.has(table));
      issues.push({ code: 'BASELINE_PARTIAL', severity: 'error', message: `检测到残缺基座，缺少核心表：${missing.join(', ')}。请人工确认后修复，不自动导入基础 SQL。` });
    }
  }

  const stateValue = issues.length > 0 ? 'needs_human' : 'ready';
  const state = buildState({
    args,
    workspace,
    database,
    databaseExistsValue,
    foundTables,
    importedScripts,
    skippedScripts,
    checks,
    issues,
    state: stateValue,
  });
  const schemaErrors = validateBootstrapState(state, outPath);
  if (schemaErrors.length > 0) {
    throw new Error(`bootstrap-state schema 校验失败：${JSON.stringify(schemaErrors, null, 2)}`);
  }
  writeState(outPath, state);
  return { ok: stateValue === 'ready', state, outputPath: outPath };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    const result = bootstrapBackend(args);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  main();
}

export { bootstrapBackend, classifyTables, coreTables };
