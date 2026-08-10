'use strict';

function createDepotStreamRequestLifecycle(options) {
  const {
    getVideoStream,
    normalizeRange,
    planBlocks,
    selectCoverage,
    resolveDepotLogin,
    getVideoMime,
    getMaxDownloads,
    describeCdnRouteStrategy,
    needsOwnedAccount,
    canUseLogin,
    makeLoginRequiredError,
    normalizeError,
    shouldRetryLoginRequiredError,
    refreshLoginForRetry,
    jsonRes,
    send,
    nextDemandEpoch,
    prepareBlock,
    cancelEntryPrefetch,
    scheduleAheadPrefetch,
    createAbortError,
    isAbortError,
    streamCacheSegments,
    endResponse,
  } = options;

  function createRequestAbort(req, res) {
    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    const onRequestClose = () => {
      if (req.aborted || req.complete === false) abort();
    };
    const onResponseClose = () => {
      if (!res.writableFinished) abort();
    };
    req.once('aborted', abort);
    req.once('close', onRequestClose);
    res.once('close', onResponseClose);
    res.once('error', abort);
    if (req.aborted || res.destroyed) abort();
    return {
      signal: controller.signal,
      abort,
      cleanup() {
        req.removeListener('aborted', abort);
        req.removeListener('close', onRequestClose);
        res.removeListener('close', onResponseClose);
        res.removeListener('error', abort);
      },
    };
  }

  async function handleVideoStream(req, res, token) {
    const entry = getVideoStream(token);
    if (!entry) return jsonRes(res, 404, { error: 'Depot video stream expired' });
    const total = parseInt(String(entry.size || '0'), 10);
    if (!Number.isFinite(total) || total <= 0) {
      return jsonRes(res, 500, { error: 'Depot video stream size unavailable' });
    }
    const normalizedRange = normalizeRange(req, total);
    if (!normalizedRange || normalizedRange.error) {
      return send(res, 416, normalizedRange && normalizedRange.error ? normalizedRange.error : 'Invalid Range');
    }
    const rangeHeader = normalizedRange.rangeHeader || String(req.headers.range || '').trim();
    const { start, end } = normalizedRange;
    const statusCode = normalizedRange.statusCode || 206;
    console.log(`[Depot Stream] request ${entry.publishedFileId || entry.id} range="${rangeHeader || 'none'}" -> ${start}-${end}/${total}`);
    console.log(`[Depot Stream] Steam CDN route: ${describeCdnRouteStrategy()} · stream max ${getMaxDownloads()}`);

    const outHeaders = {
      'Content-Type': getVideoMime(entry.fileName || entry.filename || '.mp4') || 'video/mp4',
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (statusCode === 206) outHeaders['Content-Range'] = `bytes ${start}-${end}/${total}`;
    if (req.method === 'HEAD') {
      res.writeHead(statusCode, outHeaders);
      res.end();
      return;
    }

    const depotLogin = resolveDepotLogin(431960);
    const initialCoverage = selectCoverage(entry, start, end);
    if (!initialCoverage.complete && needsOwnedAccount(431960) && !canUseLogin(depotLogin)) {
      return jsonRes(res, 401, {
        error: makeLoginRequiredError().message,
        requiresSteamLogin: true,
        code: 'STEAM_LOGIN_REQUIRED',
      });
    }

    const epoch = nextDemandEpoch(entry);
    const requestAbort = createRequestAbort(req, res);
    const blocks = planBlocks(total, start, end);
    let loginRetryPromise = null;
    const prepareWithLoginRetry = async (block, blockIndex) => {
      const alreadyCached = selectCoverage(entry, block.responseStart, block.responseEnd);
      if (alreadyCached.complete) return alreadyCached.segments;
      try {
        return await prepareBlock(entry, block, depotLogin, {
          priority: 'foreground', epoch, blockIndex, signal: requestAbort.signal,
        });
      } catch (rangeError) {
        const err = normalizeError(rangeError);
        if (!isAbortError(err) && shouldRetryLoginRequiredError &&
            shouldRetryLoginRequiredError(err) && refreshLoginForRetry) {
          if (!loginRetryPromise) {
            console.warn(`[Depot Stream] Range ${entry.publishedFileId || entry.id} ${block.start}-${block.end} reported login required despite cached account; retrying once.`);
            loginRetryPromise = refreshLoginForRetry(`depot-stream-range:${entry.publishedFileId || entry.id}`);
          }
          const refreshed = await loginRetryPromise;
          if (!refreshed) throw err;
          return prepareBlock(entry, block, resolveDepotLogin(431960), {
            priority: 'foreground', epoch, blockIndex, signal: requestAbort.signal,
          });
        }
        throw err;
      }
    };
    const preparations = blocks.map(prepareWithLoginRetry);
    let preparationFailure = null;
    for (const preparation of preparations) {
      preparation.catch((error) => {
        if (!preparationFailure && !requestAbort.signal.aborted &&
            !isAbortError(error) && !res.destroyed) {
          preparationFailure = error;
          requestAbort.abort();
        }
      });
    }
    // Shared ranges are promoted above before unrelated prefetch work is cancelled.
    cancelEntryPrefetch(entry, depotLogin);
    try {
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const segments = await preparations[blockIndex];
        if (requestAbort.signal.aborted) throw createAbortError();
        if (!res.headersSent) {
          console.log(`[Depot Stream] cache ready ${entry.publishedFileId || entry.id} ${start}-${end}`);
          res.writeHead(statusCode, outHeaders);
        }
        await streamCacheSegments(res, segments, requestAbort.signal);
      }
      const completed = await endResponse(res, requestAbort.signal);
      if (completed && (!needsOwnedAccount(431960) || canUseLogin(depotLogin))) {
        scheduleAheadPrefetch(entry, start, end, depotLogin, epoch);
      }
    } catch (error) {
      const failure = preparationFailure || error;
      const requestWasAborted = res.destroyed || (!preparationFailure &&
        (requestAbort.signal.aborted || isAbortError(error)));
      if (requestWasAborted) return;
      if (!requestAbort.signal.aborted) requestAbort.abort();
      const err = normalizeError(failure);
      if (res.headersSent) {
        try { res.destroy(err); } catch {}
        return;
      }
      return jsonRes(res, err.statusCode || 500, {
        error: err.message,
        code: err.code || '',
        requiresSteamLogin: !!err.requiresSteamLogin,
        requiresSteamGuard: !!err.requiresSteamGuard,
      });
    } finally {
      requestAbort.cleanup();
    }
  }

  return { createRequestAbort, handleVideoStream };
}

module.exports = { createDepotStreamRequestLifecycle };
