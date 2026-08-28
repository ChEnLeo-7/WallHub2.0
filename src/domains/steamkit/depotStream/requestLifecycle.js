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
    getDemandEpoch,
    prepareBlock,
    cancelEntryBlockingPrefetch,
    scheduleAheadPrefetch,
    createAbortError,
    isAbortError,
    streamCacheSegments,
    streamRangeTask,
    prepareStreamingBlock,
    readThroughEnabled,
    pinCacheFiles,
    endResponse,
    beginRequestMetric,
    logger = console,
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
      if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Range', `bytes */${total}`);
        res.setHeader('Accept-Ranges', 'bytes');
      }
      return send(res, 416, normalizedRange && normalizedRange.error ? normalizedRange.error : 'Invalid Range');
    }
    const rangeHeader = normalizedRange.rangeHeader || String(req.headers.range || '').trim();
    const { start, end } = normalizedRange;
    const statusCode = normalizedRange.statusCode || 206;
    if (statusCode === 206) {
      entry.depotPlaybackRangeAnchor = {
        start,
        end,
        servedUntil: start,
        requestedAt: Date.now(),
        epoch: getDemandEpoch(entry),
      };
    }
    const requestMetric = beginRequestMetric?.(entry, {
      method: req.method,
      rangeStart: start,
      rangeEnd: end,
      statusCode,
      cacheComplete: selectCoverage(entry, start, end).complete,
    });
    logger.traceLog?.(`[Depot Stream] request ${entry.publishedFileId || entry.id} range="${rangeHeader || 'none'}" -> ${start}-${end}/${total}`);

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
      requestMetric?.mark('http_head_complete');
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

    const epoch = getDemandEpoch(entry);
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
            logger.warn(`[Depot Stream] Range ${entry.publishedFileId || entry.id} ${block.start}-${block.end} reported login required despite cached account; retrying once.`);
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
    const prepareCompleteBlock = async (block, blockIndex) => {
      const segments = await prepareWithLoginRetry(block, blockIndex);
      return {
        type: 'cache',
        segments,
        release: pinCacheFiles(segments.map(segment => segment.file)),
      };
    };
    const prepareResponseBlock = async (block, blockIndex) => {
      if (!readThroughEnabled) return prepareCompleteBlock(block, blockIndex);
      try {
        const prepared = await prepareStreamingBlock(entry, block, depotLogin, {
          priority: 'foreground', epoch, blockIndex, signal: requestAbort.signal,
        });
        return Object.assign({ type: 'streaming' }, prepared);
      } catch (rangeError) {
        const err = normalizeError(rangeError);
        if (isAbortError(err) || !shouldRetryLoginRequiredError ||
            !shouldRetryLoginRequiredError(err) || !refreshLoginForRetry) throw err;
        if (!loginRetryPromise) {
          loginRetryPromise = refreshLoginForRetry(`depot-stream-range:${entry.publishedFileId || entry.id}`);
        }
        const refreshed = await loginRetryPromise;
        if (!refreshed) throw err;
        const prepared = await prepareStreamingBlock(entry, block, resolveDepotLogin(431960), {
          priority: 'foreground', epoch, blockIndex, signal: requestAbort.signal,
        });
        return Object.assign({ type: 'streaming' }, prepared);
      }
    };
    const preparations = readThroughEnabled || statusCode === 200
      ? []
      : blocks.map((block, blockIndex) => prepareResponseBlock(block, blockIndex));
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
    // A matching prefetch was promoted by prepareBlock above. Only an unrelated
    // active prefetch can still block this foreground response; keep future
    // aligned prefetch blocks queued so the playback buffer can accumulate.
    cancelEntryBlockingPrefetch(entry, depotLogin);
    try {
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const prepared = readThroughEnabled || statusCode === 200
          ? await prepareResponseBlock(blocks[blockIndex], blockIndex)
          : await preparations[blockIndex];
        if (requestAbort.signal.aborted) throw createAbortError();
        if (!res.headersSent) {
          logger.traceLog?.(`[Depot Stream] cache ready ${entry.publishedFileId || entry.id} ${start}-${end}`);
          res.writeHead(statusCode, outHeaders);
          requestMetric?.mark('http_headers_sent');
        }
        try {
          if (prepared.type === 'streaming') {
            for (const piece of prepared.pieces) {
              if (piece.type === 'cache') {
                await streamCacheSegments(res, [piece.segment], requestAbort.signal);
              } else {
                await streamRangeTask(res, piece.task, piece.start, piece.end, requestAbort.signal, {
                  entry,
                  requestedAt: entry.depotPlaybackRangeAnchor && entry.depotPlaybackRangeAnchor.requestedAt,
                });
              }
            }
            prepared.retain();
          } else {
            await streamCacheSegments(res, prepared.segments, requestAbort.signal);
          }
        } finally {
          prepared.release();
        }
      }
      const completed = await endResponse(res, requestAbort.signal);
      requestMetric?.mark(completed ? 'http_response_complete' : 'http_response_incomplete', {
        bytes: end - start + 1,
      });
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
      requestMetric?.mark('http_response_error', { code: err.code || '', name: err.name || 'Error' });
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
      for (const preparation of preparations) {
        preparation.then(prepared => prepared.release(), () => {});
      }
      requestAbort.cleanup();
    }
  }

  return { createRequestAbort, handleVideoStream };
}

module.exports = { createDepotStreamRequestLifecycle };
