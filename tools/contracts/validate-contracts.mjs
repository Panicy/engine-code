#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../validator/validate-feature.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/contracts/validate-contracts.mjs \\',
    '  --backend-api <backend-api.json> \\',
    '  --permissions <permission-manifest.json>',
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
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    if (!['backend-api', 'permissions'].includes(key)) throw new Error(`未知参数：${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  const abs = path.resolve(repoRoot, filePath);
  return {
    path: abs,
    value: JSON.parse(fs.readFileSync(abs, 'utf8')),
  };
}

function readSchema(name) {
  return JSON.parse(fs.readFileSync(path.resolve(repoRoot, 'schemas', `${name}.schema.json`), 'utf8'));
}

function createReport(files = {}) {
  return {
    valid: true,
    files,
    errors: [],
    warnings: [],
    infos: [],
  };
}

function addIssue(report, level, code, file, jsonPath, message, suggestion = '') {
  const item = { level, code, file, path: jsonPath, message, suggestion };
  if (level === 'error') report.errors.push(item);
  else if (level === 'warning') report.warnings.push(item);
  else report.infos.push(item);
  report.valid = report.errors.length === 0;
}

function addSchemaErrors(report, schemaErrors) {
  for (const error of schemaErrors) {
    addIssue(report, error.level, error.code, error.file, error.path, error.message, error.suggestion);
  }
}

function uniqueBy(items, getKey) {
  const seen = new Map();
  const duplicates = [];
  for (const [index, item] of items.entries()) {
    const key = getKey(item);
    if (key && seen.has(key)) duplicates.push({ key, firstIndex: seen.get(key), index });
    if (key && !seen.has(key)) seen.set(key, index);
  }
  return { seen, duplicates };
}

function validateContractConsistency(report, backendApi, permissions, files) {
  const endpointIds = uniqueBy(backendApi.endpoints ?? [], (endpoint) => endpoint.id);
  for (const duplicate of endpointIds.duplicates) {
    addIssue(report, 'error', 'API_OPERATION_DUPLICATED', files.backendApi, `$.endpoints[${duplicate.index}].id`, `API operation/id 重复：${duplicate.key}。`);
  }

  const routes = uniqueBy(backendApi.endpoints ?? [], (endpoint) => `${endpoint.method} ${endpoint.path}`);
  for (const duplicate of routes.duplicates) {
    addIssue(report, 'error', 'API_ROUTE_DUPLICATED', files.backendApi, `$.endpoints[${duplicate.index}]`, `API method+path 重复：${duplicate.key}。`);
  }

  const permissionCodes = uniqueBy(permissions.permissions ?? [], (permission) => permission.code);
  for (const duplicate of permissionCodes.duplicates) {
    addIssue(report, 'error', 'PERMISSION_CODE_DUPLICATED', files.permissions, `$.permissions[${duplicate.index}].code`, `permission code 重复：${duplicate.key}。`);
  }

  const permissionCodeSet = new Set((permissions.permissions ?? []).map((permission) => permission.code));
  for (const [index, endpoint] of (backendApi.endpoints ?? []).entries()) {
    if (!endpoint.permissionCode) continue;
    if (!permissionCodeSet.has(endpoint.permissionCode)) {
      addIssue(report, 'error', 'API_PERMISSION_NOT_FOUND', files.backendApi, `$.endpoints[${index}].permissionCode`, `API ${endpoint.id} 引用的权限码不存在于 permission manifest：${endpoint.permissionCode}。`);
    }
  }

  const endpointById = new Map((backendApi.endpoints ?? []).map((endpoint) => [endpoint.id, endpoint]));
  for (const [permissionIndex, permission] of (permissions.permissions ?? []).entries()) {
    for (const [targetIndex, targetEndpointId] of (permission.targetEndpointIds ?? []).entries()) {
      const endpoint = endpointById.get(targetEndpointId);
      const jsonPath = `$.permissions[${permissionIndex}].targetEndpointIds[${targetIndex}]`;
      if (!endpoint) {
        addIssue(report, 'error', 'PERMISSION_TARGET_ENDPOINT_NOT_FOUND', files.permissions, jsonPath, `permission ${permission.code} 指向的 API 不存在：${targetEndpointId}。`);
        continue;
      }
      if (endpoint.permissionCode && endpoint.permissionCode !== permission.code) {
        addIssue(report, 'error', 'PERMISSION_TARGET_CODE_MISMATCH', files.permissions, jsonPath, `permission ${permission.code} 指向的 API ${targetEndpointId} 使用了不同权限码：${endpoint.permissionCode}。`);
      }
    }
  }
}

function validateContracts(input) {
  const backendApiFile = input['backend-api'];
  const permissionsFile = input.permissions;
  if (!backendApiFile) throw new Error('缺少必填参数 --backend-api');
  if (!permissionsFile) throw new Error('缺少必填参数 --permissions');

  const backendApi = readJson(backendApiFile);
  const permissions = readJson(permissionsFile);
  const files = {
    backendApi: backendApi.path,
    permissions: permissions.path,
  };
  const report = createReport(files);

  const backendApiSchema = readSchema('backend-api');
  const permissionSchema = readSchema('permission-manifest');
  addSchemaErrors(report, validateSchema(backendApi.value, backendApiSchema, { file: files.backendApi, rootSchema: backendApiSchema }));
  addSchemaErrors(report, validateSchema(permissions.value, permissionSchema, { file: files.permissions, rootSchema: permissionSchema }));

  if (report.errors.length === 0) {
    validateContractConsistency(report, backendApi.value, permissions.value, files);
  }

  report.valid = report.errors.length === 0;
  return report;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
  } catch (error) {
    console.log(JSON.stringify({
      valid: false,
      errors: [{ level: 'error', code: 'ARGS_INVALID', file: '', path: '$', message: error.message, suggestion: usage() }],
      warnings: [],
      infos: [],
    }, null, 2));
    process.exit(2);
  }

  try {
    const report = validateContracts(args);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.valid ? 0 : 1);
  } catch (error) {
    console.log(JSON.stringify({
      valid: false,
      errors: [{ level: 'error', code: 'CONTRACTS_READ_FAILED', file: '', path: '$', message: error.message }],
      warnings: [],
      infos: [],
    }, null, 2));
    process.exit(2);
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  main();
}

export { validateContracts };
