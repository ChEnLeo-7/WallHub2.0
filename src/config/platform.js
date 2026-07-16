'use strict';

const fs = require('fs');

const isAsciiPath = (value) => /^[\x00-\x7F]*$/.test(String(value || ''));

function isTermuxLikeEnv() {
  const prefix = String(process.env.PREFIX || '');
  return process.platform === 'android' ||
    !!process.env.TERMUX_VERSION ||
    /com\.termux/i.test(prefix);
}

function isAndroidHostLikeEnv() {
  if (isTermuxLikeEnv()) return true;
  if (process.env.ANDROID_ROOT || process.env.ANDROID_DATA) return true;
  try {
    const version = fs.existsSync('/proc/version') ? fs.readFileSync('/proc/version', 'utf8') : '';
    const release = fs.existsSync('/proc/sys/kernel/osrelease') ? fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8') : '';
    return /android/i.test(`${version}\n${release}`);
  } catch {
    return false;
  }
}

function isDockerContainerEnv() {
  return String(process.env.DOCKER_CONTAINER || '').trim() === '1' ||
    fs.existsSync('/.dockerenv');
}

function shouldRejectDepotAppHostForAndroid() {
  return !isDockerContainerEnv() && (isTermuxLikeEnv() || isAndroidHostLikeEnv());
}

module.exports = {
  isAsciiPath,
  isTermuxLikeEnv,
  isAndroidHostLikeEnv,
  isDockerContainerEnv,
  shouldRejectDepotAppHostForAndroid,
};
