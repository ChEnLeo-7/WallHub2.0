'use strict';

const { parseDetailHtml, parseComments } = require('./parse');
const { cleanText, fmtStat, fmtBytes, fmtTime, looksLikeSteamId } = require('./text');
const { createInFlightCoalescer } = require('../../shared/inFlight');

function parsePositiveInt(raw, fallback) {
  const n = parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function withDeadline(promise, ms, fallback) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise)
      .then(value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function createWorkshopDetailService(options = {}) {
  const get = options.get;
  const getFileDetails = options.getFileDetails;
  const fetchCommentsPage = options.fetchCommentsPage;
  const resolvePersonaName = options.resolvePersonaName || (() => '');
  const isAndroidHostLikeEnv = options.isAndroidHostLikeEnv || (() => false);
  const logger = options.logger || console;

  // 详情请求合并，并短暂保留成功结果。
  // 用户退出详情页后 2 分钟内再次进入同一项目，直接复用上次加载结果。
  const inFlight = createInFlightCoalescer({
    label: '[Detail]',
    logger,
    execute: doFetchDetail,
    resultTtlMs: 2 * 60 * 1000,
    resultCacheMaxEntries: 150,
  });

  // 实际执行详情抓取的内部函数
  async function doFetchDetail(id) {
    logger.log(`[Detail] id=${id}`);
    let apiDetail = null;
    try {
      const list = await getFileDetails([id]);
      apiDetail = list[0] && list[0].result === 1 ? list[0] : null;
    } catch (e) {
      logger.warn('[Detail API]', e.message);
    }

    const detailTask = (async () => {
      try {
        const detailHtml = (await get(
          `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
          { 'Accept-Language': 'zh-CN,zh;q=0.9' },
          9000
        )).toString('utf8');
        return { detailHtml, htmlDetail: parseDetailHtml(detailHtml) };
      } catch (e) {
        logger.warn('[Detail HTML]', e.message);
        return { detailHtml: '', htmlDetail: null };
      }
    })();

    const detailResult = await withDeadline(detailTask, 9500, { detailHtml: '', htmlDetail: null });
    const htmlDetail = detailResult.htmlDetail;
    const detailHtml = detailResult.detailHtml;
    const commentOwnerId = (apiDetail && apiDetail.creator)
      ? String(apiDetail.creator)
      : ((htmlDetail && htmlDetail.creator_id) ? String(htmlDetail.creator_id) : '');
    const commentsTask = fetchCommentsPage(id, 0, 10, commentOwnerId);
    const commentsDeadline = Math.max(
      2500,
      parsePositiveInt(process.env.WALLHUB_COMMENTS_INITIAL_DEADLINE || process.env.WALLHUB_COMMENTS_DEADLINE || '', isAndroidHostLikeEnv() ? 7000 : 4500)
    );
    let commentsPage = await withDeadline(commentsTask, commentsDeadline, {
      comments: [],
      start: 0,
      count: 10,
      nextStart: 0,
      total: 0,
      hasMore: true,
      ownerId: commentOwnerId,
    });
    let comments = commentsPage.comments || [];
    if (!comments.length && detailHtml) {
      comments = parseComments(detailHtml, 50);
      commentsPage = {
        comments,
        start: 0,
        count: 10,
        nextStart: Math.max(10, comments.length),
        total: comments.length,
        hasMore: comments.length >= 10,
      };
    }

    const creatorId = commentOwnerId;
    const resolvedPersona = await resolvePersonaName(creatorId);
    const htmlAuthor = cleanText(htmlDetail && htmlDetail.author);
    const finalAuthor = (htmlAuthor && !looksLikeSteamId(htmlAuthor))
      ? htmlAuthor
      : (resolvedPersona || htmlAuthor || creatorId || '');

    const out = {
      publishedfileid: id,
      title: (apiDetail && apiDetail.title) || (htmlDetail && htmlDetail.title) || '',
      preview_url: (apiDetail && apiDetail.preview_url) || (htmlDetail && htmlDetail.preview_url) || '',
      description: (htmlDetail && htmlDetail.description) || (apiDetail && apiDetail.short_description) || '',
      author: finalAuthor,
      creator: creatorId,
      subscriptions: fmtStat((apiDetail && (apiDetail.lifetime_subscriptions || apiDetail.subscriptions)), htmlDetail && htmlDetail.subscriptions),
      favorited: fmtStat((apiDetail && (apiDetail.lifetime_favorited || apiDetail.favorited)), htmlDetail && htmlDetail.favorited),
      views: fmtStat((apiDetail && apiDetail.views), htmlDetail && htmlDetail.views),
      file_size: fmtBytes(apiDetail && apiDetail.file_size) || (htmlDetail && htmlDetail.file_size) || '未知',
      time_updated: fmtTime(apiDetail && apiDetail.time_updated) || cleanText(htmlDetail && htmlDetail.time_updated) || '未知',
      time_created: fmtTime(apiDetail && apiDetail.time_created) || cleanText(htmlDetail && htmlDetail.time_created) || '未知',
      tags: (apiDetail && apiDetail.tags && apiDetail.tags.map(tag => tag.tag || tag)) || (htmlDetail && htmlDetail.tags) || [],
      comments,
      commentsStart: commentsPage.start || 0,
      commentsCount: commentsPage.count || 10,
      commentsNextStart: commentsPage.nextStart || comments.length,
      commentsTotal: commentsPage.total || 0,
      commentsOwnerId: commentsPage.ownerId || creatorId || '',
      commentsHasMore: !!commentsPage.hasMore || (!comments.length && commentsPage.nextStart === 0),
    };

    logger.log(`[Detail] Result: preview=${out.preview_url ? 'YES' : 'NO'}, subs=${out.subscriptions}, cmts=${comments.length}`);
    return out;
  }

  async function fetchDetail(id) {
    const idStr = String(id);
    return inFlight.run(idStr);
  }

  // 设置变更时清除所有 in-flight 并 bump generation
  function clearInFlight() {
    inFlight.clear();
  }

  // 兼容旧接口名
  function clearCaches() {
    inFlight.clearCaches();
  }

  function invalidateCaches() {
    inFlight.invalidateCaches();
  }

  return {
    fetchDetail,
    clearCaches,
    invalidateCaches,
    clearInFlight,
  };
}

module.exports = {
  createWorkshopDetailService,
  withDeadline,
};
