/**
 * Author: WSL
 * 把可测试的 ES5 模块和协议登记合并为四个自包含 Legado 书源。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '..', 'wsl-premium-aggregate.json');
const modules = [
  'config.js', 'state.js', 'transport.js', 'search.js', 'detail.js', 'catalog.js',
  'content.js', 'auth.js', 'explore.js', 'review.js', 'bookshelf.js',
];

const template = JSON.parse(await readFile(path.join(root, 'source.template.json'), 'utf8'));
const protocol = JSON.parse(await readFile(path.join(root, 'protocol', 'observed-api.json'), 'utf8'));
if (protocol.version !== 1) throw new Error('observed-api.json 版本无效');
if (!Array.isArray(template.variants) || template.variants.length !== 4) throw new Error('模板必须包含四个媒体变体');

const parts = [
  '/** Author: WSL */\nvar WSLPA = typeof WSLPA === \'object\' && WSLPA ? WSLPA : {};\nWSLPA.protocol = ' + JSON.stringify(protocol) + ';',
];
for (const name of modules) {
  const code = (await readFile(path.join(root, 'runtime', name), 'utf8')).replace(/\r\n/g, '\n').trim();
  if (!/^\/\*\*[\s\S]{0,180}Author:\s*WSL/.test(code)) throw new Error(name + ' 缺少 Author: WSL');
  parts.push(code);
}
// 重要逻辑：固定模块顺序、换行和 JSON 缩进，确保同一输入连续构建得到完全相同的字节。
const jsLib = parts.join('\n\n') + '\n';

const sources = template.variants.map((variant) => ({
  ...JSON.parse(JSON.stringify(template.common)),
  ...variant,
  jsLib,
}));
const keys = new Set(sources.map((item) => item.bookSourceUrl));
if (keys.size !== 4) throw new Error('书源主键必须唯一');
if (JSON.stringify(sources.map((item) => item.bookSourceType)) !== '[0,1,2,4]') throw new Error('媒体类型顺序无效');
if (sources.some((item) => item.enableDangerousApi !== false)) throw new Error('危险 API 必须关闭');

await writeFile(output, `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
console.log(`built ${sources.length} sources -> ${output}`);
