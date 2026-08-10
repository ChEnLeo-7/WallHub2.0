import {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  STEAM_ACCESS_DOH_ENDPOINTS,
} from '@/components/settings/constants';
import type { CacheSettings, StartupNetworkSettings } from '@/lib/api';
import {
  normalizeSteamAccessEndpointList,
  normalizeSteamAccessHostsUrl,
  normalizeSteamAccessMode,
  normalizeSteamAccessResolverProtocol,
  validateSteamAccessEndpoint,
} from '@/lib/normalizers';

export const DEFAULT_STARTUP_NETWORK_SETTINGS: StartupNetworkSettings = {
  wallhubSteamAccessMode: 'resolver',
  wallhubSteamAccessHosts: '',
  wallhubSteamAccessHostsUrl: '',
  wallhubSteamAccessHostsAutoUpdateEnabled: false,
  wallhubSteamAccessHostsUpdateIntervalHours: 24,
  wallhubSteamAccessResolverProtocol: 'doh',
  wallhubSteamAccessSelectedDohEndpoints: STEAM_ACCESS_DOH_ENDPOINTS.slice(0, 3),
  wallhubSteamAccessCustomDohEndpoints: [],
  wallhubSteamAccessSelectedDotEndpoints: ['dot.pub:853', 'dns.umbrella.com:853', '1.1.1.1:853'],
  wallhubSteamAccessCustomDotEndpoints: [],
  wallhubSteamAccessDohEndpoint: DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  wallhubSteamAccessDohMode: 'fastest',
  wallhubSteamAccessDotEndpoint: DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  wallhubSteamAccessDotMode: 'fastest',
};

export function startupNetworkSettings(value?: CacheSettings): StartupNetworkSettings {
  const protocol = normalizeSteamAccessResolverProtocol(value?.wallhubSteamAccessResolverProtocol);
  const selectedDoh = normalizeSteamAccessEndpointList(value?.wallhubSteamAccessSelectedDohEndpoints, 'doh', 64);
  const selectedDot = normalizeSteamAccessEndpointList(value?.wallhubSteamAccessSelectedDotEndpoints, 'dot', 64);
  const customDoh = normalizeSteamAccessEndpointList(value?.wallhubSteamAccessCustomDohEndpoints, 'doh', 32);
  const customDot = normalizeSteamAccessEndpointList(value?.wallhubSteamAccessCustomDotEndpoints, 'dot', 32);
  const dohEndpoints = selectedDoh.length ? selectedDoh : DEFAULT_STARTUP_NETWORK_SETTINGS.wallhubSteamAccessSelectedDohEndpoints;
  const dotEndpoints = selectedDot.length ? selectedDot : DEFAULT_STARTUP_NETWORK_SETTINGS.wallhubSteamAccessSelectedDotEndpoints;
  const currentDoh = validateSteamAccessEndpoint(value?.wallhubSteamAccessDohEndpoint, 'doh');
  const currentDot = validateSteamAccessEndpoint(value?.wallhubSteamAccessDotEndpoint, 'dot');
  return {
    wallhubSteamAccessMode: normalizeSteamAccessMode(value?.wallhubSteamAccessMode),
    wallhubSteamAccessHosts: String(value?.wallhubSteamAccessHosts || ''),
    wallhubSteamAccessHostsUrl: normalizeSteamAccessHostsUrl(value?.wallhubSteamAccessHostsUrl),
    wallhubSteamAccessHostsAutoUpdateEnabled: !!value?.wallhubSteamAccessHostsAutoUpdateEnabled,
    wallhubSteamAccessHostsUpdateIntervalHours: Math.max(0.5, Math.min(168, Number(value?.wallhubSteamAccessHostsUpdateIntervalHours || 24))),
    wallhubSteamAccessResolverProtocol: protocol,
    wallhubSteamAccessSelectedDohEndpoints: dohEndpoints,
    wallhubSteamAccessCustomDohEndpoints: customDoh,
    wallhubSteamAccessSelectedDotEndpoints: dotEndpoints,
    wallhubSteamAccessCustomDotEndpoints: customDot,
    wallhubSteamAccessDohEndpoint: currentDoh && dohEndpoints.includes(currentDoh) ? currentDoh : dohEndpoints[0],
    wallhubSteamAccessDohMode: value?.wallhubSteamAccessDohMode === 'fixed' ? 'fixed' : 'fastest',
    wallhubSteamAccessDotEndpoint: currentDot && dotEndpoints.includes(currentDot) ? currentDot : dotEndpoints[0],
    wallhubSteamAccessDotMode: value?.wallhubSteamAccessDotMode === 'fixed' ? 'fixed' : 'fastest',
  };
}

export function hasValidHostsMapping(value: string) {
  return String(value || '').split(/\r?\n/).some(rawLine => {
    const parts = rawLine.trim().split(/\s+/);
    if (parts.length < 2 || parts[0].startsWith('#') || parts[0].startsWith(';')) return false;
    const ipv4 = parts[0].split('.');
    const validIp = (ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) || (/^[0-9a-f:]+$/i.test(parts[0]) && parts[0].includes(':'));
    return validIp && parts.slice(1).some(host => !!host && !host.includes('/') && !host.includes('://'));
  });
}
