'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runProcess } = require('./runProcess');

test('runProcess sanitizes child error output when a sanitizer is provided', async () => {
  await assert.rejects(
    () => runProcess(process.execPath, [
      '-e',
      'console.error("WALLHUB_DEPOT_BOOTSTRAP:main\\nReal failure from child"); process.exit(2);'
    ], 5000, {
      sanitizeErrorOutput: (text) => String(text || '')
        .split(/\r?\n/)
        .filter(line => !/^WALLHUB_/.test(line.trim()))
        .join('\n'),
    }),
    (error) => {
      assert.match(error.message, /Real failure from child/);
      assert.equal(/WALLHUB_/.test(error.message), false);
      return true;
    }
  );
});

test('runProcess preserves a useful stdout failure when stderr only has WallHub diagnostics', async () => {
  await assert.rejects(
    () => runProcess(process.execPath, [
      '-e',
      'console.error("WALLHUB_DEPOT_BOOTSTRAP:main"); console.log("Real DepotDownloader failure"); process.exit(2);'
    ], 5000, {
      sanitizeErrorOutput: (text) => String(text || '')
        .split(/\r?\n/)
        .filter(line => !/^WALLHUB_/.test(line.trim()))
        .join('\n'),
    }),
    (error) => {
      assert.match(error.message, /Real DepotDownloader failure/);
      assert.equal(/WALLHUB_/.test(error.message), false);
      return true;
    }
  );
});

test('runProcess keeps a bounded output tail while preserving live output callbacks', async () => {
  let streamedBytes = 0;
  const result = await runProcess(process.execPath, [
    '-e',
    'process.stdout.write("x".repeat(8192)); process.stdout.write("TAIL-MARKER");'
  ], 5000, {
    maxCapturedOutputBytes: 256,
    onStdout: (chunk) => { streamedBytes += Buffer.byteLength(chunk); },
  });

  assert.ok(streamedBytes >= 8192);
  assert.ok(Buffer.byteLength(result.out) <= 256);
  assert.match(result.out, /TAIL-MARKER$/);
});

test('runProcess exposes live pause and resume controls for child process groups', async () => {
  const signals = [];
  const child = runProcess(process.execPath, [
    '-e',
    'setTimeout(() => {}, 10000);'
  ], 10000, {
    controlProcessGroup: (pid, signal) => {
      assert.equal(typeof pid, 'number');
      signals.push(signal);
      return true;
    },
  });

  assert.equal(typeof child.pause, 'function');
  assert.equal(typeof child.resume, 'function');
  assert.equal(child.pause(), true);
  assert.equal(child.resume(), true);
  child.kill();
  await assert.rejects(() => child);
  assert.deepEqual(signals, ['SIGSTOP', 'SIGCONT']);
});
