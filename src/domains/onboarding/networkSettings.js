'use strict';

const { applyCacheSettingsPatch } = require('../settings/schema');
const { createSteamAccessGateway } = require('../steamAccess/gateway');
const { parseHostsText } = require('../steamAccess/hostsCompat');

const ONBOARDING_NETWORK_INPUT_KEYS = [
  'wallhubSteamAccessMode',
  'wallhubSteamAccessHosts',
  'wallhubSteamAccessHostsUrl',
  'wallhubSteamAccessHostsAutoUpdateEnabled',
  'wallhubSteamAccessHostsUpdateIntervalHours',
  'wallhubSteamAccessResolverProtocol',
  'wallhubSteamAccessSelectedDohEndpoints',
  'wallhubSteamAccessCustomDohEndpoints',
  'wallhubSteamAccessSelectedDotEndpoints',
  'wallhubSteamAccessCustomDotEndpoints',
  'wallhubSteamAccessDohEndpoint',
  'wallhubSteamAccessDohMode',
  'wallhubSteamAccessDotEndpoint',
  'wallhubSteamAccessDotMode',
];
const ONBOARDING_NETWORK_SETTING_KEYS = ONBOARDING_NETWORK_INPUT_KEYS.concat([
  'wallhubSteamAccessHostsLastUpdatedAt',
  'wallhubSteamAccessHostsLastError',
]);

function cloneSettings(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function pickNetworkSettings(value, keys = ONBOARDING_NETWORK_SETTING_KEYS) {
  const picked = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value || {}, key)) picked[key] = value[key];
  }
  return picked;
}

function normalizeOnboardingNetworkSettings(currentSettings, input, options = {}) {
  const patch = pickNetworkSettings(input, ONBOARDING_NETWORK_INPUT_KEYS);
  const normalized = applyCacheSettingsPatch(cloneSettings(currentSettings), patch, {
    logger: options.logger || console,
  }).settings;
  const result = pickNetworkSettings(normalized);
  if (result.wallhubSteamAccessMode === 'hosts' && parseHostsText(result.wallhubSteamAccessHosts).size === 0) {
    const error = new Error('Hosts 模式至少需要一条有效的 IP 与域名映射');
    error.code = 'ONBOARDING_HOSTS_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function createOnboardingSteamAccessGateway(settings, options = {}) {
  return createSteamAccessGateway({
    userAgent: options.userAgent || 'WallHub-Onboarding',
    logger: options.logger || console,
    configDir: options.configDir,
    persistentState: false,
    enabled: () => true,
    directWebApi: () => false,
    isGatewayHost: options.isGatewayHost,
    isStaticCdnHost: options.isStaticCdnHost,
    reuseConnectionForHost: () => false,
    warmupHosts: ['steamcommunity.com'],
    getAccessMode: () => settings.wallhubSteamAccessMode,
    getHostsText: () => settings.wallhubSteamAccessHosts,
    getResolverProtocol: () => settings.wallhubSteamAccessResolverProtocol,
    getDohEndpoint: () => settings.wallhubSteamAccessDohEndpoint,
    getDohMode: () => settings.wallhubSteamAccessDohMode,
    getDotEndpoint: () => settings.wallhubSteamAccessDotEndpoint,
    getDotMode: () => settings.wallhubSteamAccessDotMode,
    getSelectedDohEndpoints: () => settings.wallhubSteamAccessSelectedDohEndpoints,
    getCustomDohEndpoints: () => settings.wallhubSteamAccessCustomDohEndpoints,
    getSelectedDotEndpoints: () => settings.wallhubSteamAccessSelectedDotEndpoints,
    getCustomDotEndpoints: () => settings.wallhubSteamAccessCustomDotEndpoints,
    getExperimental: () => options.experimental || {},
  });
}

module.exports = {
  ONBOARDING_NETWORK_SETTING_KEYS,
  normalizeOnboardingNetworkSettings,
  createOnboardingSteamAccessGateway,
};
