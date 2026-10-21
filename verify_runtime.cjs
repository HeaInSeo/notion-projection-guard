'use strict';
// Offline and read-only: never import the broker, take its lock or open its journal.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const runtimeNames = ['broker.cjs', 'runner.js', 'policy.json'];
const entryPaths = Object.freeze({
  'HeaInSeo/infra-lab': 'ops/notion-projection-guard/complete_projection.js',
  'HeaInSeo/notion-projection-guard': 'complete_projection.js'
});
const gatePaths = Object.freeze({
  'HeaInSeo/infra-lab': 'ops/notion-projection-guard/supervision_gate.js',
  'HeaInSeo/notion-projection-guard': 'supervision_gate.js'
});
// Only these checked-in historical releases predate a declared hosted gate.
// A new source cannot obtain partial verification by dropping its descriptor.
const legacyGateSources = Object.freeze({
  'HeaInSeo/infra-lab': new Set(['01b8a7897bc8709450f536744577313c805c66ca']),
  'HeaInSeo/notion-projection-guard': new Set([
    'c75750a92dc505b9f605bd63542789fe52717f79',
    'ff30a259f22f471b77b68d7d7c34b80ccce72648',
    'e57f6c5f563533de39338d14f0b2c18d49833598'
  ])
});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function requireThat(ok, code) {
  if (!ok) throw Object.assign(new Error(code), { code });
}
function read(file) {
  requireThat(fs.lstatSync(file).isFile(), 'REGULAR_FILE_REQUIRED');
  return fs.readFileSync(file);
}
function verifyRuntime({ release, runtimeDir, receiptPath, sourceDir }) {
  requireThat(release?.version === 1 && Object.hasOwn(entryPaths, release.repository)
    && /^[a-f0-9]{40}$/.test(release.sourceCommit), 'RELEASE_SCHEMA');
  requireThat(Object.keys(release.runtimeSha256 ?? {}).sort().join(',') === 'broker.cjs,runner.js'
    && Object.values(release.runtimeSha256).every(h => /^[a-f0-9]{64}$/.test(h))
    && /^[a-f0-9]{64}$/.test(release.policySha256), 'RELEASE_SCHEMA');
  const declaredGate=Object.hasOwn(release,'hostedSupervisionGate');
  if(declaredGate)requireThat(release.hostedSupervisionGate?.path===gatePaths[release.repository]
    && /^[a-f0-9]{64}$/.test(release.hostedSupervisionGate.sha256),'RELEASE_SCHEMA');
  else requireThat(legacyGateSources[release.repository].has(release.sourceCommit),'HOSTED_GATE_REQUIRED');
  requireThat(path.isAbsolute(runtimeDir) && path.isAbsolute(receiptPath)
    && (sourceDir === undefined || path.isAbsolute(sourceDir)), 'ABSOLUTE_PATH_REQUIRED');
  requireThat(!declaredGate||sourceDir!==undefined,'SOURCE_REQUIRED');
  const expected = { ...release.runtimeSha256, 'policy.json': release.policySha256 };
  const files = [...runtimeNames, 'approved.sha256'].map(n => path.join(runtimeDir, n));
  files.push(receiptPath);
  const before = files.map(read);
  const lines = before[3].toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  requireThat(lines.length === 3, 'APPROVED_MANIFEST');
  const manifest = {};
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (broker\.cjs|runner\.js|policy\.json)$/.exec(line);
    requireThat(match && !Object.hasOwn(manifest, match[2]), 'APPROVED_MANIFEST');
    manifest[match[2]] = match[1];
  }
  const observed = {};
  for (let i = 0; i < runtimeNames.length; i++) {
    const name = runtimeNames[i];
    observed[name] = sha256(before[i]);
    requireThat(observed[name] === expected[name], 'RUNTIME_HASH_MISMATCH');
    requireThat(manifest[name] === expected[name], 'APPROVED_MANIFEST');
  }
  const receipt = JSON.parse(before[4].toString('utf8'));
  requireThat(receipt.sourceCommit === release.sourceCommit
    && typeof receipt.at === 'string' && Number.isFinite(Date.parse(receipt.at))
    && runtimeNames.every(n => receipt.after?.[n] === expected[n]), 'INSTALL_RECEIPT_MISMATCH');
  const sourceChecks=[];
  function sourceRead(name){
    const file=path.join(sourceDir,name),bytes=read(file);sourceChecks.push({file,bytes});return bytes;
  }
  if (sourceDir !== undefined) {
    for (const name of ['broker.cjs', 'runner.js']) {
      requireThat(sha256(sourceRead(name)) === expected[name], 'SOURCE_HASH_MISMATCH');
    }
    requireThat(release.hostedEntryPoint?.path === entryPaths[release.repository]
      && /^[a-f0-9]{64}$/.test(release.hostedEntryPoint.sha256), 'RELEASE_SCHEMA');
    requireThat(sha256(sourceRead('complete_projection.js'))
      === release.hostedEntryPoint.sha256, 'SOURCE_HASH_MISMATCH');
    if(declaredGate)requireThat(sha256(sourceRead('supervision_gate.js'))
      === release.hostedSupervisionGate.sha256,'SOURCE_HASH_MISMATCH');
  }
  requireThat(files.every((file, i) => read(file).equals(before[i]))
    && sourceChecks.every(({file,bytes})=>read(file).equals(bytes)), 'CHANGED_DURING_READ');
  return { status: 'MATCH', observedAt: new Date().toISOString(),
    sourceCommit: release.sourceCommit, installedAt: receipt.at, sha256: observed,
    sourceFilesChecked: sourceDir !== undefined,hostedSupervisionGateChecked:declaredGate,
    legacyManifest:!declaredGate };
}
module.exports = { verifyRuntime };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    const names = { '--release': 'releasePath', '--runtime': 'runtimeDir',
      '--receipt': 'receiptPath', '--source': 'sourceDir' };
    for (let i = 0; i < args.length; i += 2) {
      const key = names[args[i]];
      requireThat(key && !Object.hasOwn(options, key) && args[i + 1]
        && !args[i + 1].startsWith('--'), 'ARGUMENTS');
      options[key] = args[i + 1];
    }
    requireThat(options.releasePath && options.runtimeDir && options.receiptPath, 'ARGUMENTS');
    const release = JSON.parse(read(options.releasePath).toString('utf8'));
    console.log(JSON.stringify(verifyRuntime({ ...options, release })));
  } catch (error) {
    console.log(JSON.stringify({ status: 'MISMATCH', code: error.code ?? 'INVALID_INPUT' }));
    process.exitCode = 1;
  }
}
