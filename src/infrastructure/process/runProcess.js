'use strict';

const os = require('os');
const { spawn, execFileSync } = require('child_process');

const DEFAULT_MAX_CAPTURED_OUTPUT_BYTES = 128 * 1024;

function maxCapturedOutputBytes(options = {}) {
  if (options.captureOutput === false) return 0;
  const configured = Number(options.maxCapturedOutputBytes);
  if (!Number.isFinite(configured)) return DEFAULT_MAX_CAPTURED_OUTPUT_BYTES;
  return Math.max(0, Math.min(4 * 1024 * 1024, Math.floor(configured)));
}

function appendOutputTail(current, chunk, maxBytes) {
  if (!maxBytes) return Buffer.alloc(0);
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
  if (incoming.length >= maxBytes) return Buffer.from(incoming.subarray(incoming.length - maxBytes));
  if (!current || !current.length) return Buffer.from(incoming);
  if (current.length + incoming.length <= maxBytes) return Buffer.concat([current, incoming]);
  const keep = Math.max(0, maxBytes - incoming.length);
  return Buffer.concat([current.subarray(current.length - keep), incoming], maxBytes);
}

function killProcessTree(cp) {
  if (!cp) return;
  try {
    if (process.platform === 'win32') {
      cp.kill('SIGKILL');
      try { execFileSync('taskkill', ['/pid', cp.pid, '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else {
      try { process.kill(-cp.pid, 'SIGKILL'); } catch { cp.kill('SIGKILL'); }
    }
  } catch {}
}

function controlProcessGroup(cp, signal, options = {}) {
  if (!cp || !cp.pid) return false;
  if (typeof options.controlProcessGroup === 'function') {
    return options.controlProcessGroup(cp.pid, signal, cp) !== false;
  }
  if (process.platform === 'win32') return false;
  try {
    process.kill(-cp.pid, signal);
    return true;
  } catch {
    try {
      cp.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

function runProcess(bin, args, timeoutMs, options = {}, prepareEnv) {
  let killFn = null;
  let pauseFn = null;
  let resumeFn = null;
  const promise = new Promise((resolve, reject) => {
    const baseEnv = options.replaceEnv === true
      ? Object.assign({}, options.env || {})
      : Object.assign({}, process.env, options.env || {});
    const childEnv = typeof prepareEnv === 'function' ? prepareEnv(baseEnv, options) : baseEnv;
    const spawnOptions = Object.assign({
      windowsHide: true,
      env: childEnv,
      detached: process.platform !== 'win32',
    }, options, { env: childEnv });
    const cp = spawn(bin, args, spawnOptions);
    const outputLimit = maxCapturedOutputBytes(options);
    let out = Buffer.alloc(0);
    let err = Buffer.alloc(0);
    let done = false;
    let timer = null;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    if (Array.isArray(options.inputLines) && cp.stdin) {
      const lines = options.inputLines.map(value => String(value || ''));
      lines.forEach((line, index) => {
        setTimeout(() => {
          try { cp.stdin.write(line + os.EOL); } catch {}
        }, 350 + index * 350);
      });
      if (options.closeStdin) {
        setTimeout(() => {
          try { cp.stdin.end(); } catch {}
        }, 700 + lines.length * 350);
      }
    } else if (options.closeStdin && cp.stdin) {
      setTimeout(() => {
        try { cp.stdin.end(); } catch {}
      }, 350);
    }

    cp.stdout.on('data', data => {
      const chunk = data.toString();
      out = appendOutputTail(out, data, outputLimit);
      if (typeof options.onStdout === 'function') {
        try { options.onStdout(chunk); } catch {}
      }
    });

    cp.stderr.on('data', data => {
      const chunk = data.toString();
      err = appendOutputTail(err, data, outputLimit);
      if (typeof options.onStderr === 'function') {
        try { options.onStderr(chunk); } catch {}
      }
    });

    cp.on('error', error => finish(reject, error));
    cp.on('close', code => {
      const outText = out.toString('utf8');
      const errText = err.toString('utf8');
      if (code === 0) return finish(resolve, { out: outText, err: errText });
      const rawMessage = [errText, outText].filter(Boolean).join('\n').trim() || `exit ${code}`;
      let message = rawMessage;
      if (typeof options.sanitizeErrorOutput === 'function') {
        try {
          const sanitized = String(options.sanitizeErrorOutput(rawMessage, { out: outText, err: errText, code }) || '').trim();
          if (sanitized) message = sanitized;
        } catch {}
      }
      finish(reject, new Error((message || rawMessage || `exit ${code}`).trim().slice(-1200)));
    });

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        killProcessTree(cp);
        finish(reject, new Error(options.timeoutMessage || `Process timed out: ${bin}`));
      }, timeoutMs);
    }

    killFn = () => {
      killProcessTree(cp);
      finish(reject, new Error(options.cancelMessage || 'Task canceled or paused'));
    };
    pauseFn = () => controlProcessGroup(cp, 'SIGSTOP', options);
    resumeFn = () => controlProcessGroup(cp, 'SIGCONT', options);
  });

  promise.kill = killFn;
  promise.pause = () => (typeof pauseFn === 'function' ? pauseFn() : false);
  promise.resume = () => (typeof resumeFn === 'function' ? resumeFn() : false);
  return promise;
}

module.exports = {
  DEFAULT_MAX_CAPTURED_OUTPUT_BYTES,
  maxCapturedOutputBytes,
  appendOutputTail,
  killProcessTree,
  controlProcessGroup,
  runProcess,
};
