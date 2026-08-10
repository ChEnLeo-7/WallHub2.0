'use strict';

function createLoginErrorNormalizer(normalizeDepotError) {
  return function normalizeSteamKitLoginError(error) {
    const err = normalizeDepotError(error);
    if (err && ['STEAM_NETWORK_UNREACHABLE', 'STEAM_LOGIN_TIMEOUT'].includes(err.code)) {
      const hint = 'Wallhub 内置连接增强只作用于 Wallhub 网页代理和服务端 HTTP 请求；SteamKit 登录/扫码仍需要本机网络或 HTTP(S) 代理能直连 Steam 登录服务。';
      if (!String(err.message || '').includes('Wallhub 内置连接增强')) {
        err.message = `${err.message || 'Steam 登录网络请求失败'}（${hint}）`;
      }
    }
    return err;
  };
}

module.exports = {
  createLoginErrorNormalizer,
};
