'use strict';

const { parseComments } = require('./parse');

function parsePositiveInt(raw, fallback) {
  const n = parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createWorkshopCommentsService(options = {}) {
  const doRequest = options.doRequest;
  const userAgent = options.userAgent || 'WallHub';
  const steamPrefCookie = options.steamPrefCookie || '';
  const logger = options.logger || console;
  const isAndroidHostLikeEnv = options.isAndroidHostLikeEnv || (() => false);

  async function fetchPage(id, start, count, ownerId) {
    const safeId = String(id || '').replace(/[^\d]/g, '');
    const safeOwnerId = String(ownerId || '').replace(/[^\d]/g, '');
    const safeStart = Math.max(0, parseInt(start, 10) || 0);
    const safeCount = Math.max(1, Math.min(50, parseInt(count, 10) || 10));
    const bodyText = `start=${safeStart}&count=${safeCount}&feature2=-1&l=schinese&userreview_offset=-1`;
    const commentsTimeout = Math.max(
      9000,
      parsePositiveInt(process.env.WALLHUB_COMMENTS_TIMEOUT || '', isAndroidHostLikeEnv() ? 16000 : 12000)
    );
    const routes = [];
    if (safeOwnerId) routes.push({ ownerId: safeOwnerId, url: `https://steamcommunity.com/comment/PublishedFile_Public/render/${safeOwnerId}/${safeId}/` });
    routes.push({ ownerId: '', url: `https://steamcommunity.com/comment/PublishedFile_Public/render/${safeId}/-1/` });

    const requestComments = async (method, baseUrl) => {
      const target = new URL(method === 'GET' ? `${baseUrl}?${bodyText}` : baseUrl);
      const headers = {
        'User-Agent': userAgent,
        'Accept': 'application/json,text/javascript,*/*;q=0.01',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://steamcommunity.com',
        'Referer': `https://steamcommunity.com/sharedfiles/filedetails/?id=${safeId}`,
        'Cookie': steamPrefCookie,
      };
      let requestBody = null;
      if (method === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        headers['Content-Length'] = Buffer.byteLength(bodyText);
        requestBody = bodyText;
      }
      return doRequest({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? parseInt(target.port, 10) : undefined,
        path: target.pathname + target.search,
        method,
        headers,
        timeout: commentsTimeout,
      }, requestBody);
    };

    for (const route of routes) {
      for (const method of ['POST', 'GET']) {
        try {
          const buf = await requestComments(method, route.url);
          const data = JSON.parse(buf.toString('utf8'));
          const html = data.comments_html || data.html || data.comments || '';
          const comments = parseComments(html, safeCount);
          const total = parseInt(data.total_count || data.total || data.comment_count || 0, 10) || 0;
          const nextStart = safeStart + Math.max(comments.length, safeCount);
          const hasMore = total > 0 ? nextStart < total : comments.length >= safeCount;
          if (comments.length || data.success !== false) {
            return { comments, start: safeStart, count: safeCount, nextStart, total, hasMore, ownerId: route.ownerId };
          }
          if (data.success === false || data.success === 0) {
            logger.warn(`[Comments] Steam returned success=false via ${method}, id=${safeId}, owner=${route.ownerId || 'legacy'}`);
          }
        } catch (e) {
          logger.warn(`[Comments] ${method} failed for ${safeId}, owner=${route.ownerId || 'legacy'}: ${e.message}`);
        }
      }
    }
    return { comments: [], start: safeStart, count: safeCount, nextStart: safeStart, total: 0, hasMore: safeStart === 0, ownerId: safeOwnerId };
  }

  return { fetchPage };
}

module.exports = {
  createWorkshopCommentsService,
};
