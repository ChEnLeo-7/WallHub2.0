'use strict';

function wallhubProxyPort(target) {
  return target.port ? parseInt(target.port, 10) : (target.protocol === 'http:' ? 80 : 443);
}

function isExtensionlessBroadcastMediaManifest(text, target) {
  return !!target && /\/broadcast\//i.test(String(target.pathname || '')) &&
    /^\s*(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(String(text || ''));
}

module.exports = {
  wallhubProxyPort,
  isExtensionlessBroadcastMediaManifest,
};
