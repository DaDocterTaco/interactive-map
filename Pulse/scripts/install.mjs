import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Run without --apply to review. Never copies dependencies, keys, caches or test data.
const source = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const target = process.argv[2] && path.resolve(process.argv[2]);
if (!target || target === source || target.startsWith(source + path.sep)) throw Error('Provide the existing campus app directory.');
const apply = process.argv.includes('--apply'), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const optionalRead = async file => { try { return await readFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const indexFile = path.join(target, 'index.html'), serverFile = path.join(target, 'tools/serve_lan.py');
const indexBytes = await readFile(indexFile), originalIndex = indexBytes.toString();
if (!originalIndex.includes('const map = L.map') || !originalIndex.includes('mountLocationServices')) throw Error('Unexpected app entrypoint. Review integration manually.');
const cssBlock = '    <!-- Campus Pulse styles -->\n    <link rel="stylesheet" href="Pulse/client/pulse.css?v=pulse-1">\n';
const scriptBlock = '    <!-- Campus Pulse integration -->\n    <script type="module">\n        import { mountCampusPulse } from \'./Pulse/client/mount.js?v=pulse-1\';\n        mountCampusPulse({ map, L });\n    </script>\n';
let nextIndex = originalIndex;
if (!nextIndex.includes('<!-- Campus Pulse styles -->')) nextIndex = nextIndex.replace('</head>', cssBlock + '</head>');
if (!nextIndex.includes('<!-- Campus Pulse integration -->')) nextIndex = nextIndex.replace('</body>', scriptBlock + '</body>');
const serverBytes = await optionalRead(serverFile);
let nextServer = serverBytes?.toString();
if (nextServer && !nextServer.includes('# Pulse browser assets only')) {
  const anchor = '        if not allowed or not candidate.is_file():';
  if (!nextServer.includes(anchor)) throw Error('Unexpected local server. Review its static-asset allowlist manually.');
  nextServer = nextServer.replace(anchor,
    '        # Pulse browser assets only; backend, tests and configuration stay private.\n' +
    '        allowed = allowed or (\n' +
    '            len(parts) == 3 and parts[0] == "Pulse"\n' +
    '            and parts[1] in {"client", "shared"}\n' +
    '            and candidate.suffix.lower() in {".js", ".css"}\n' +
    '            and not any(part.startswith(".") for part in parts)\n' +
    '        )\n' + anchor);
}
const dest = path.join(target, 'Pulse'), manifestFile = path.join(dest, '.install-manifest.json');
const previous = JSON.parse((await optionalRead(manifestFile))?.toString() || '{}');
const files = [], roots = ['README.md', '.gitignore', 'firebase.json', 'package.json', 'package-lock.json', 'client', 'shared', 'backend', 'docs', 'scripts', 'tests', 'preview'];
async function collect(relative) {
  const file = path.join(source, relative);
  try {
    const entries = await readdir(file, { withFileTypes: true });
    for (const entry of entries) if (!entry.name.startsWith('.') && !entry.isSymbolicLink()) await collect(path.join(relative, entry.name));
  } catch (error) {
    if (error.code !== 'ENOTDIR') throw error;
    if (!/\.(md|js|mjs|json|rules|css|html|png)$/.test(relative) && relative !== '.gitignore') return;
    const content = await readFile(file), output = path.join(dest, relative), existing = await optionalRead(output), key = relative.replaceAll(path.sep, '/');
    if (existing && hash(existing) !== hash(content) && previous[key] !== hash(existing)) throw Error(`Preserving independently edited file: ${output}`);
    files.push({ relative, output, content, digest: hash(content), key });
  }
}
for (const entry of roots) await collect(entry);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'review', target, pulseFiles: files.length,
  entrypointChanged: originalIndex !== nextIndex, localServerChanged: serverBytes && nextServer !== serverBytes.toString(),
  backendDeployment: false, productionDatabaseChanges: false }, null, 2));
if (apply) {
  // Ensure files inspected above have not changed during preparation.
  if (hash(await readFile(indexFile)) !== hash(indexBytes)) throw Error('Entrypoint changed while preparing; rerun.');
  if (serverBytes && hash(await readFile(serverFile)) !== hash(serverBytes)) throw Error('Server changed while preparing; rerun.');
  const backup = path.join(dest, '.integration-backup', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(backup, { recursive: true });
  await writeFile(path.join(backup, 'index.html'), indexBytes);
  if (serverBytes) await writeFile(path.join(backup, 'serve_lan.py'), serverBytes);
  for (const file of files) { await mkdir(path.dirname(file.output), { recursive: true }); await writeFile(file.output, file.content); }
  await writeFile(indexFile, nextIndex);
  if (serverBytes) await writeFile(serverFile, nextServer);
  await writeFile(manifestFile, JSON.stringify(Object.fromEntries(files.map(f => [f.key, f.digest])), null, 2) + '\n');
  console.log('Installed Pulse. Entrypoint backups saved; Firebase was not deployed.');
}
