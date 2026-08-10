'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runProcess } = require('./runProcess');
const { controlWindowsProcessTree, processControlScript } = require('./windowsProcessControl');

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

test('runProcess preserves stderr metadata when a noisy stdout determines the display tail', async () => {
  await assert.rejects(
    () => runProcess(process.execPath, [
      '-e',
      'console.error("CM failed: NoConnection"); process.stdout.write("x".repeat(4096)); process.exit(2);',
    ], 5000, { maxCapturedOutputBytes: 8192 }),
    (error) => {
      assert.match(error.stderr, /NoConnection/);
      assert.match(error.stdout, /^x+$/);
      assert.equal(error.exitCode, 2);
      return true;
    }
  );
});

test('runProcess marks timeouts and retains output captured before termination', async () => {
  await assert.rejects(
    () => runProcess(process.execPath, [
      '-e',
      'console.error("Steam CM still connecting"); setTimeout(() => {}, 10000);',
    ], 500, {}),
    (error) => {
      assert.equal(error.timedOut, true);
      assert.match(error.stderr, /Steam CM still connecting/);
      return true;
    }
  );
});

test('runProcess controls become inert after the child exits', async () => {
  let controls = 0;
  const child = runProcess(process.execPath, ['-e', 'process.exit(0);'], 5000, {
    controlProcessGroup: () => { controls += 1; return true; },
  });

  await child;
  assert.equal(child.pause(), false);
  assert.equal(child.resume(), false);
  assert.equal(child.kill(), false);
  assert.equal(controls, 0);
});

test('Windows process control invokes PowerShell with an encoded suspend or resume tree script', () => {
  const calls = [];
  const execFileSync = (bin, args, options) => calls.push({ bin, args, options });

  assert.equal(controlWindowsProcessTree(1234, 'suspend', { execFileSync }), true);
  assert.equal(controlWindowsProcessTree(1234, 'resume', { execFileSync }), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bin, 'powershell.exe');
  const suspendScript = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le');
  const resumeScript = Buffer.from(calls[1].args.at(-1), 'base64').toString('utf16le');
  assert.match(suspendScript, /NtSuspendProcess/);
  assert.match(suspendScript, /\$rootPid = 1234/);
  assert.ok(suspendScript.indexOf('Get-CimInstance Win32_Process') < suspendScript.indexOf("Invoke-ProcessControl $rootPid 'Suspend'"));
  assert.match(suspendScript, /@\(\$descendants\.ToArray\(\)\)/);
  assert.match(resumeScript, /NtResumeProcess/);
  assert.match(resumeScript, /@\(\$descendants\.ToArray\(\)[^\n]*\) \+ @\(\$rootPid\)/);
  assert.equal(calls[0].options.timeout, 15000);
});

test('Windows process control rejects invalid input and reports PowerShell failure', () => {
  assert.equal(controlWindowsProcessTree(0, 'suspend'), false);
  assert.equal(controlWindowsProcessTree(1234, 'stop'), false);
  assert.equal(controlWindowsProcessTree(1234, 'suspend', { execFileSync() { throw new Error('failed'); } }), false);
  assert.match(processControlScript(1234, 'suspend'), /Resume/);
});
