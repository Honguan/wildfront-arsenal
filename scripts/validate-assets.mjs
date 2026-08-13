import { readdir, stat } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import { CONTENT_MANIFEST } from '../src/data/content-manifest.ts';

const roots = ['public'];
const limits = new Map([
  ['.ktx2', 8 * 1024 * 1024],
  ['.mp3', 5 * 1024 * 1024],
  ['.ogg', 5 * 1024 * 1024],
]);
const forbidden = new Set(['.blend', '.fbx', '.wav']);
const paths = [];

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(path);
    else paths.push(path);
  }
}

for (const root of roots) await walk(root);

const errors = [];
for (const [group, entries] of Object.entries({
  weapons: CONTENT_MANIFEST.weapons,
  maps: CONTENT_MANIFEST.maps,
  bosses: CONTENT_MANIFEST.bosses,
  perks: CONTENT_MANIFEST.perks,
  attachments: CONTENT_MANIFEST.attachments,
  weaponQualities: CONTENT_MANIFEST.weaponQualities,
  audioPacks: CONTENT_MANIFEST.audioPacks,
})) {
  const ids = entries.map(({ id }) => id);
  if (ids.some((id) => typeof id !== 'string' || !id)) errors.push(`invalid manifest id: ${group}`);
  if (new Set(ids).size !== ids.length) errors.push(`duplicate manifest id: ${group}`);
}
for (const weapon of CONTENT_MANIFEST.weapons) {
  if (![weapon.damage, weapon.rate, weapon.magazine, weapon.reload, weapon.falloff].every(Number.isFinite)) errors.push(`invalid weapon manifest: ${weapon.id}`);
}
if (new Set(CONTENT_MANIFEST.effects).size !== CONTENT_MANIFEST.effects.length) errors.push('duplicate manifest id: effects');
const normalized = new Set();
for (const path of paths) {
  const portablePath = relative('.', path).replaceAll('\\', '/');
  const lowercasePath = portablePath.toLowerCase();
  const extension = extname(path).toLowerCase();
  if (normalized.has(lowercasePath)) errors.push(`case-insensitive duplicate: ${portablePath}`);
  normalized.add(lowercasePath);
  if (forbidden.has(extension)) errors.push(`source asset is forbidden in public/: ${portablePath}`);
  const limit = limits.get(extension);
  if (limit && (await stat(path)).size > limit) errors.push(`asset exceeds ${limit} bytes: ${portablePath}`);
  if (extension === '.glb') {
    const glbLimit = /boss/i.test(portablePath) ? 20 * 1024 * 1024 : 8 * 1024 * 1024;
    if ((await stat(path)).size > glbLimit) errors.push(`asset exceeds ${glbLimit} bytes: ${portablePath}`);
  }
}

let initialTransfer = 0;
async function measureBuild(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await measureBuild(path);
    else initialTransfer += (await stat(path)).size;
  }
}
await measureBuild('dist');
if (initialTransfer > 15 * 1024 * 1024) errors.push(`initial route transfer exceeds 15 MB: ${initialTransfer} bytes`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Asset validation passed (${paths.length} files, ${initialTransfer} build bytes).`);
}
