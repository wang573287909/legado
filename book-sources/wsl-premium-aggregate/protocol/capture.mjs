/**
 * Author: WSL
 * 从 HAR 中只保留协议形状；所有身份、正文、评论和媒体值都替换为类型标记。
 */

import { readFile, writeFile } from 'node:fs/promises';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
if (!args.input || !args.output) throw new Error('usage: capture.mjs --input INPUT.har --output OUTPUT.json');

const allowedHosts = new Set([
  'v10.czyl.cf', 'v4.czyl.cf', 'v2.czyl.cf', 'api.langge.cf',
  '20.langge.tk', '219.154.201.122',
]);
const secretName = /cookie|authorization|token|password|secret|session|nonce|sign|email/i;
const contentName = /content|html|comment|review|avatar|image|audio|video|url/i;

function marker(value, key = '') {
  if (secretName.test(key)) return '<redacted>';
  if (contentName.test(key)) return '<content-redacted>';
  if (Array.isArray(value)) return value.slice(0, 1).map((item) => marker(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name, marker(value[name], name)]));
  }
  if (typeof value === 'string') return '<string>';
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return null;
}

function parseBody(text, mimeType) {
  if (!text) return { fields: [], shape: null };
  try {
    const value = JSON.parse(text);
    return { fields: Object.keys(value).sort(), shape: marker(value) };
  } catch {}
  if (mimeType.includes('x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    return { fields: [...new Set(params.keys())].sort(), shape: null };
  }
  return { fields: [], shape: '<opaque-body-redacted>' };
}

const har = JSON.parse(await readFile(args.input, 'utf8'));
const entries = [];
for (const entry of har.log?.entries ?? []) {
  const url = new URL(entry.request.url);
  if (!allowedHosts.has(url.hostname)) continue;
  const requestBody = parseBody(entry.request.postData?.text ?? '', entry.request.postData?.mimeType ?? '');
  let responseShape = '<non-json-response-redacted>';
  try { responseShape = marker(JSON.parse(entry.response.content?.text ?? '')); } catch {}
  entries.push({
    host: url.host,
    method: entry.request.method,
    path: url.pathname,
    queryFields: [...new Set(url.searchParams.keys())].sort(),
    requestHeaders: entry.request.headers.map((header) => header.name).filter((name) => !secretName.test(name)).sort(),
    requestBodyFields: requestBody.fields,
    requestBodyShape: requestBody.shape,
    responseStatus: entry.response.status,
    responseShape,
  });
}

await writeFile(args.output, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8');
console.log(`sanitized ${entries.length} entries -> ${args.output}`);
