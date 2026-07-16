'use strict';

function requireProjectDependency(name, installHint = 'npm install') {
  try {
    return require(name);
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') {
      console.error(`\n[Dependency] Missing npm package: ${name}`);
      console.error(`[Dependency] Please install project dependencies first: ${installHint}`);
      console.error('[Dependency] On Termux, use npm install or npm ci. Do not run npm audit fix --force.\n');
    }
    throw e;
  }
}

let QRCode_MODULE = null;
let jsQR_MODULE = null;

function getQrCodeModule() {
  if (!QRCode_MODULE) QRCode_MODULE = requireProjectDependency('qrcode');
  return QRCode_MODULE;
}

function getJsQrModule() {
  if (!jsQR_MODULE) jsQR_MODULE = requireProjectDependency('jsqr');
  return jsQR_MODULE;
}

module.exports = {
  requireProjectDependency,
  getQrCodeModule,
  getJsQrModule,
};
