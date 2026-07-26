'use strict';

const WALLHUB_STEAM_USER_FILES_MARKER = 'WALLHUB_STEAM_USER_FILES:';
const PERSONAL_WORKSHOP_APP_ID = 431960;
const PERSONAL_LIST_TYPES = new Set(['mysubscriptions', 'myfavorites']);

function personalWorkshopError(message, code = 'STEAMKIT_USER_FILES_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  error.requiresSteamLogin = true;
  return error;
}

function normalizePersonalListType(value) {
  const type = String(value || '').trim().toLowerCase();
  return PERSONAL_LIST_TYPES.has(type) ? type : '';
}

function normalizePositiveInt(value, fallback, maximum) {
  const parsed = parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function parseSteamKitUserFilesOutput(output) {
  const source = String(output || '');
  const markerIndex = source.lastIndexOf(WALLHUB_STEAM_USER_FILES_MARKER);
  if (markerIndex < 0) throw personalWorkshopError('SteamKit did not return a personal Workshop list');

  const line = source.slice(markerIndex + WALLHUB_STEAM_USER_FILES_MARKER.length).split(/\r?\n/)[0].trim();
  if (!line) throw personalWorkshopError('SteamKit returned an empty personal Workshop list response');

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw personalWorkshopError('SteamKit returned an invalid personal Workshop list response');
  }

  const ids = [];
  const seen = new Set();
  const details = [];
  const returnedDetails = Array.isArray(parsed && parsed.publishedfiledetails) ? parsed.publishedfiledetails : [];
  for (const detail of returnedDetails) {
    const id = String(detail && detail.publishedfileid || '').replace(/[^\d]/g, '');
    if (!/^\d{6,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    details.push(Object.assign({}, detail, { publishedfileid: id }));
  }
  for (const value of Array.isArray(parsed && parsed.ids) ? parsed.ids : []) {
    const id = String(value || '').replace(/[^\d]/g, '');
    if (!/^\d{6,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const totalCount = Math.max(ids.length, parseInt(parsed && parsed.total, 10) || 0);
  return { ids, totalCount, steamId: String(parsed && parsed.steamid || '').replace(/[^\d]/g, ''), details };
}

function createSteamKitPersonalWorkshopService(options = {}) {
  const ensureDepotDownloaderReady = options.ensureDepotDownloaderReady;
  const depotCommandFor = options.depotCommandFor;
  const runProcess = options.runProcess;
  const buildDepotDotnetEnv = options.buildDepotDotnetEnv;
  const makeDepotLoginId = options.makeDepotLoginId;
  const ensureDir = options.ensureDir;
  const configDir = options.configDir;
  const queryBridge = options.queryBridge || null;
  const logger = options.logger || console;

  function canUsePersistentBridge(operation) {
    return !!(queryBridge && typeof queryBridge[operation] === 'function');
  }

  function canUseOneShotBridge() {
    return typeof ensureDepotDownloaderReady === 'function' && typeof depotCommandFor === 'function' && typeof runProcess === 'function';
  }

  function outputFromBridge(marker, response) {
    return `${marker}${JSON.stringify(response || {})}`;
  }

  async function getUserFiles(listType, queryOptions = {}) {
    const type = normalizePersonalListType(listType);
    if (!type) throw personalWorkshopError('Unsupported personal Workshop list type', 'INVALID_PERSONAL_WORKSHOP_LIST');
    const username = String(queryOptions.username || '').trim();
    if (!username) throw personalWorkshopError('SteamKit remembered account is unavailable');
    if (!canUsePersistentBridge('getUserFiles') && !canUseOneShotBridge()) {
      throw personalWorkshopError('SteamKit personal Workshop bridge is unavailable');
    }

    const appId = normalizePositiveInt(queryOptions.appId, PERSONAL_WORKSHOP_APP_ID, 0xffffffff);
    const page = normalizePositiveInt(queryOptions.page, 1, 1000000);
    const numperpage = normalizePositiveInt(queryOptions.numperpage, 30, 100);
    const timeoutMs = Math.max(15000, normalizePositiveInt(queryOptions.timeoutMs || process.env.WALLHUB_STEAMKIT_USER_FILES_TIMEOUT_MS, 45000, 120000));
    if (canUsePersistentBridge('getUserFiles')) {
      try {
        const bridgeOptions = {
          username,
          appId,
          page,
          numperpage,
          timeoutMs,
        };
        if (queryOptions.signal) bridgeOptions.signal = queryOptions.signal;
        if (queryOptions.priority) bridgeOptions.priority = queryOptions.priority;
        const response = await queryBridge.getUserFiles(type, bridgeOptions);
        return parseSteamKitUserFilesOutput(outputFromBridge(WALLHUB_STEAM_USER_FILES_MARKER, response));
      } catch (error) {
        if (error && error.code === 'ABORT_ERR') throw error;
        if (!canUseOneShotBridge()) throw error;
        logger.warn(`[SteamKit Bridge] Personal Workshop query failed; falling back to one-shot SteamKit: ${error.message}`);
      }
    }
    const executable = await ensureDepotDownloaderReady();
    if (typeof ensureDir === 'function' && configDir) ensureDir(configDir);
    const { command, argsPrefix = [] } = depotCommandFor(executable);
    const args = [
      ...argsPrefix,
      '-wallhub-user-files', type,
      '-app', String(appId),
      '-wallhub-user-files-page', String(page),
      '-wallhub-user-files-count', String(numperpage),
      '-username', username,
      '-remember-password',
      '-max-downloads', '1',
      '-loginid', makeDepotLoginId(`user-files:${username}:${type}`),
    ];

    logger.log(`[SteamKit UserFiles] Querying ${type} for remembered account: ${username}`);
    let result;
    try {
      result = await runProcess(command, args, timeoutMs, {
        cwd: configDir,
        closeStdin: true,
        env: typeof buildDepotDotnetEnv === 'function' ? buildDepotDotnetEnv() : {},
        steamAuth: true,
      });
    } catch (error) {
      const wrapped = personalWorkshopError(`SteamKit personal Workshop query failed: ${error && error.message ? error.message : 'unknown error'}`);
      wrapped.cause = error;
      throw wrapped;
    }

    return parseSteamKitUserFilesOutput(`${result && result.out || ''}\n${result && result.err || ''}`);
  }

  return { getUserFiles };
}

module.exports = {
  WALLHUB_STEAM_USER_FILES_MARKER,
  PERSONAL_WORKSHOP_APP_ID,
  normalizePersonalListType,
  parseSteamKitUserFilesOutput,
  createSteamKitPersonalWorkshopService,
};
