'use strict';

const { cleanText, decodeHtml } = require('./text');

function extractBalancedDivInnerHtml(source, openingTagPattern) {
  const opening = openingTagPattern.exec(source);
  if (!opening) return '';
  const openingEnd = source.indexOf('>', opening.index);
  if (openingEnd < 0) return '';
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = openingEnd + 1;
  let depth = 1;
  let tag;
  while ((tag = tagRe.exec(source)) !== null) {
    if (/^<\//.test(tag[0])) depth -= 1;
    else if (!/\/\s*>$/.test(tag[0])) depth += 1;
    if (depth === 0) return source.slice(openingEnd + 1, tag.index);
  }
  return source.slice(openingEnd + 1);
}

function descriptionFromHtml(value) {
  const blankParagraph = '\uE000';
  return decodeHtml(String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/<div\b[^>]*>\s*(?:<br\s*\/?>\s*)?<\/div>/gi, `\n${blankParagraph}\n`)
    .replace(/(?:<br\s*\/?>\s*){2,}/gi, `\n${blankParagraph}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(new RegExp(`\\n?${blankParagraph}\\n?`, 'g'), '\n\n')
    .trim();
}

function parseDetailHtml(html) {
  const source = String(html || '');
  const titleM = source.match(/<div class="workshopItemTitle">([^<]+)<\/div>/);
  const imgM = source.match(/id="previewImageMain"[^>]+src="([^"]+)"/) ||
    source.match(/id="previewImage"[^>]+src="([^"]+)"/) ||
    source.match(/class="workshopItemPreviewImageMain[^"]*"[^>]+src="([^"]+)"/);
  const descriptionHtml = extractBalancedDivInnerHtml(source, /<div\b[^>]*\bid=["']highlightContent["'][^>]*>/i) ||
    extractBalancedDivInnerHtml(source, /<div\b[^>]*\bclass=["'][^"']*workshopItemDescription[^"']*["'][^>]*>/i);
  const authBlkM = source.match(/class="workshopItemAuthorName[^"]*"[\s\S]{0,1200}?<\/a>/) ||
    source.match(/class="friendBlock[^"]*"[\s\S]{0,2200}?<\/div>\s*<\/div>/);
  const authM = authBlkM
    ? (authBlkM[0].match(/<a[^>]*>([^<]+)<\/a>/) || authBlkM[0].match(/class="friendBlockContent"[^>]*>\s*([\s\S]*?)<br/i))
    : null;
  const authHrefM = authBlkM
    ? (authBlkM[0].match(/href="[^"]*\/profiles\/(\d{17})\/?[^"]*"/i) || authBlkM[0].match(/friendBlockLinkOverlay"[^>]*href="[^"]*\/profiles\/(\d{17})\/?[^"]*"/i))
    : null;

  let subscriptions = '';
  let favorited = '';
  let views = '';
  let fileSize = '';
  let timeUpdated = '';
  let timeCreated = '';

  for (const [, value, label] of source.matchAll(/<tr>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/g)) {
    const normalizedLabel = label.trim().toLowerCase();
    if (normalizedLabel.includes('visitor') || normalizedLabel.includes('访问')) views = value.trim();
    if (normalizedLabel.includes('subscri') || normalizedLabel.includes('订阅')) subscriptions = value.trim();
    if (normalizedLabel.includes('favorit') || normalizedLabel.includes('收藏')) favorited = value.trim();
  }

  for (const [, label, value] of source.matchAll(/<div class="detailsStatLeft">([^<]+)<\/div>\s*<div class="detailsStatRight">([^<]+)<\/div>/g)) {
    const normalizedLabel = label.trim().toLowerCase();
    const text = value.trim();
    if (normalizedLabel.includes('size')) fileSize = text;
    if (normalizedLabel.includes('updated')) timeUpdated = text;
    if (normalizedLabel.includes('posted')) timeCreated = text;
  }

  const tags = [];
  for (const [, tag] of source.matchAll(/<a[^>]+class="[^"]*workshopTagFilterItem[^"]*"[^>]*>\s*([^<]+)\s*<\/a>/g)) {
    const text = tag.trim();
    if (text && !tags.includes(text)) tags.push(text);
  }
  for (const [, tag] of source.matchAll(/class="workshopTags"[^>]*>[\s\S]*?<a[^>]*>\s*([^<]+)\s*<\/a>/g)) {
    const text = tag.trim();
    if (text && !tags.includes(text)) tags.push(text);
  }

  return {
    title: titleM ? titleM[1].trim() : '',
    preview_url: imgM ? imgM[1] : '',
    description: descriptionFromHtml(descriptionHtml),
    author: authM ? authM[1].trim() : '',
    creator_id: authHrefM ? authHrefM[1] : '',
    subscriptions,
    favorited,
    views,
    file_size: fileSize,
    time_updated: timeUpdated,
    time_created: timeCreated,
    tags,
  };
}

function parseComments(html, limit) {
  if (!html) return [];
  const maxComments = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
  const out = [];
  const attrValue = (raw, name) => {
    const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>]+))`, 'i');
    const match = String(raw || '').match(re);
    return match ? (match[1] || match[2] || match[3] || '') : '';
  };
  const timestampFromNode = (node) => {
    const raw = attrValue(node, 'data-timestamp') || attrValue(node, 'data-time') || attrValue(node, 'timestamp');
    const n = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10) || 0;
    return n > 0 ? n : 0;
  };
  const dateFromNode = (node) => {
    const n = String(node || '');
    return attrValue(n, 'title') ||
      attrValue(n, 'data-tooltip-text') ||
      attrValue(n, 'aria-label') ||
      '';
  };
  const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');
  const cleanComment = (value, keepBreaks) => decodeHtml(String(value || '')
    .replace(/<br\s*\/?>/gi, keepBreaks ? '\n' : ' ')
    .replace(/<[^>]+>/g, keepBreaks ? '' : ' ')
  ).replace(keepBreaks ? /[ \t]+\n/g : /\s+/g, keepBreaks ? '\n' : ' ').trim();

  // Locate each comment block by its id="comment_NNN" anchor. Attribute order
  // between id and class varies across Steam's markup, so match the id anywhere
  // inside the opening div tag rather than requiring id to come first.
  const blockStartRe = /<div\b[^>]*\bid="comment_\d+"[^>]*>/gi;
  const starts = [];
  let sm;
  while ((sm = blockStartRe.exec(html)) !== null) starts.push(sm.index);
  const blocks = [];
  for (let i = 0; i < starts.length; i++) {
    blocks.push(html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : html.length));
  }

  for (const block of blocks) {
    const authorM = block.match(/<a[^>]*class="[^"]*commentthread_author_link[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<span[^>]*class="[^"]*commentthread_author[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
      block.match(/class="friendBlockContent"[^>]*>\s*([\s\S]*?)<br/i);
    const textM = block.match(/<div[^>]*class="[^"]*commentthread_comment_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      block.match(/<div[^>]*class="[^"]*commentthread_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!textM) continue;
    // Timestamp node: an element carrying data-timestamp, or the
    // commentthread_comment_timestamp class. Match opening tag + inner content
    // so we can read both its title attribute and visible text.
    const tsNodeM = block.match(/<(?:span|div|time)\b[^>]*\bdata-timestamp="\d+"[^>]*>[\s\S]*?<\/(?:span|div|time)>/i) ||
      block.match(/<(?:span|div|time)\b[^>]*class="[^"]*commentthread_comment_timestamp[^"]*"[^>]*>[\s\S]*?<\/(?:span|div|time)>/i) ||
      block.match(/<(?:span|div|time)\b[^>]*\bdata-timestamp="\d+"[^>]*>/i) ||
      block.match(/<(?:span|div|time)\b[^>]*class="[^"]*commentthread_comment_timestamp[^"]*"[^>]*>/i);
    const tsNode = tsNodeM ? tsNodeM[0] : '';
    let timestamp = timestampFromNode(tsNode);
    if (!timestamp) timestamp = timestampFromNode(block);
    let date = dateFromNode(tsNode);
    if (!date && tsNode) date = cleanComment(stripTags(tsNode), false);

    const author = cleanComment(authorM ? authorM[1] : '', false) || 'Steam User';
    const text = cleanComment(textM[1], true);
    if (!text) continue;
    out.push({ author, date, timestamp, text });
    if (out.length >= maxComments) return out;
  }
  if (out.length) return out;

  // Fallback: walk author -> timestamp -> text in order for older markup.
  const re = /<a[^>]*class="[^"]*commentthread_author_link[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,3000}?((?:<span|<div)[^>]*class="[^"]*commentthread_comment_timestamp[^"]*"[^>]*>[\s\S]*?(?:<\/span>|<\/div>))[\s\S]{0,5000}?<div[^>]*class="[^"]*commentthread_comment_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(re)) {
    const tsNode = match[2];
    const author = cleanComment(match[1], false) || 'Steam User';
    const text = cleanComment(match[3], true);
    if (!text) continue;
    const timestamp = timestampFromNode(tsNode);
    const date = dateFromNode(tsNode) || cleanComment(stripTags(tsNode), false);
    out.push({ author, date, timestamp, text });
    if (out.length >= maxComments) return out;
  }
  return out;
}

function parseWorkshopBrowseHtml(html) {
  const source = String(html || '');
  let totalCount = 0;
  let totalPages = 0;

  const showingM = source.match(/[Ss]howing\s+[\d,]+-[\d,]+\s+of\s+([\d,]+)/) ||
    source.match(/(?:正在)?显示(?:第)?\s*[\d,]+\s*-\s*[\d,]+\s*项?\s*[,，]?\s*共\s*([\d,]+)\s*项?/);
  if (showingM) totalCount = parseInt(showingM[1].replace(/,/g, ''));

  if (!totalCount) {
    const pagingM = source.match(/workshopBrowsePagingInfo[^>]*>([\s\S]*?)<\/div>/);
    if (pagingM) {
      const numM = pagingM[1].match(/[Oo]f\s+([\d,]+)/) ||
        pagingM[1].match(/([\d,]+)\s*(?:entries|results|items)/i) ||
        pagingM[1].match(/(\d[\d,]{3,})/);
      if (numM) totalCount = parseInt(numM[1].replace(/,/g, ''));
    }
  }

  if (!totalCount) {
    const pageCtrl = source.match(/paging_controls[\s\S]{0,500}?([\d,]+)\s*(?:results|entries|items)/i);
    if (pageCtrl) totalCount = parseInt(pageCtrl[1].replace(/,/g, ''));
  }

  if (!totalCount) {
    const pageSec = source.match(/workshop(?:BrowsePaging|Paging)[^]*?(\d[\d,]{3,})/);
    if (pageSec) totalCount = parseInt(pageSec[1].replace(/,/g, ''));
  }

  const pagingBlocks = [];
  for (const match of source.matchAll(/<div\b[^>]*(?:\bid=["']workshopBrowsePaging|\bclass=["'][^"']*workshopBrowsePaging|\bid=["']paging_controls|\bclass=["'][^"']*paging_controls)[^>]*>[\s\S]{0,6000}?<\/div>/gi)) {
    pagingBlocks.push(match[0]);
  }
  const pagingSource = pagingBlocks.join('\n');
  for (const match of pagingSource.matchAll(/[?&](?:p|page)=(\d{1,6})(?:\D|$)/gi)) {
    totalPages = Math.max(totalPages, parseInt(match[1], 10) || 0);
  }
  for (const match of pagingSource.matchAll(/(?:data-page|data-p|pageToLoad)=["']?(\d{1,6})["']?/gi)) {
    totalPages = Math.max(totalPages, parseInt(match[1], 10) || 0);
  }
  if (!totalPages) {
    const pageText = pagingSource.replace(/<[^>]+>/g, ' ');
    for (const match of pageText.matchAll(/\b(\d{1,6})\b/g)) {
      totalPages = Math.max(totalPages, parseInt(match[1], 10) || 0);
    }
  }

  const seen = new Set();
  const ids = [];
  const hints = {};
  const addWorkshopId = (id, idx, itemBlock) => {
    id = String(id || '').trim();
    if (!/^\d+$/.test(id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
    if (typeof idx === 'number' && idx >= 0) {
      const block = itemBlock || source.substring(Math.max(0, idx - 280), idx + 3400);
      const titleM = block.match(/class="workshopItemTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const altM = block.match(/<img[^>]+alt="([^"]+)"/i);
      const imgM = block.match(/class="workshopItemPreviewImage[^"]*"[^>]+src="([^"]+)"/i) ||
        block.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
      const authorM = block.match(/class="workshopItemAuthorName[^"]*"[\s\S]{0,1200}?<a[^>]*>([\s\S]*?)<\/a>/i);
      const creatorM = block.match(/workshop_author_link[^"]*"[^>]+href="[^"]*\/profiles\/(\d{17})\/?/i);
      hints[id] = {
        title: cleanText(titleM ? titleM[1] : (altM ? altM[1] : '')),
        preview_url: imgM ? cleanText(imgM[1]) : '',
        author: cleanText(authorM ? authorM[1] : ''),
        creator: creatorM ? creatorM[1] : '',
      };
    }
  };

  const browseStart = source.search(/<div\b[^>]*\bid=["']workshopBrowseItems["'][^>]*>/i);
  const browseEnd = browseStart >= 0
    ? source.slice(browseStart + 1).search(/<div\b[^>]*(?:\bid=["']workshopBrowsePaging|\bclass=["'][^"']*workshopBrowsePaging)/i)
    : -1;
  const browseOffset = browseStart >= 0 ? browseStart : 0;
  const browseSource = browseStart >= 0
    ? source.slice(browseStart, browseEnd >= 0 ? browseStart + 1 + browseEnd : source.length)
    : source;

  const itemStartRe = /<div\b[^>]*\bclass=["'][^"']*\bworkshopItem\b[^"']*["'][^>]*>/gi;
  const starts = [];
  let startMatch;
  while ((startMatch = itemStartRe.exec(browseSource)) !== null) starts.push(startMatch.index);
  for (let i = 0; i < starts.length; i += 1) {
    const block = browseSource.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : browseSource.length);
    const idM = block.match(/data-publishedfileid=["'](\d+)["']/i) ||
      block.match(/sharedfiles\/filedetails\/\?id=(\d+)/i) ||
      block.match(/sharedfiles\\\/filedetails\\\/\?id=(\d+)/i);
    if (idM) addWorkshopId(idM[1], browseOffset + starts[i], block);
  }

  for (const m of ids.length ? [] : browseSource.matchAll(/data-publishedfileid=["'](\d+)["']/g)) {
    addWorkshopId(m[1], browseOffset + m.index);
  }
  if (!ids.length) {
    for (const m of browseSource.matchAll(/sharedfiles\/filedetails\/\?id=(\d+)/g)) {
      addWorkshopId(m[1], browseOffset + m.index);
    }
  }
  if (!ids.length) {
    for (const m of browseSource.matchAll(/sharedfiles\\\/filedetails\\\/\?id=(\d+)/g)) {
      addWorkshopId(m[1], browseOffset + m.index);
    }
  }

  const firstIdxData = source.indexOf('data-publishedfileid');
  const firstIdxHref = source.indexOf('sharedfiles/filedetails');
  const firstIdx = firstIdxData >= 0 ? firstIdxData : firstIdxHref;
  let debugImages = [];
  if (firstIdx !== -1) {
    const block = source.substring(Math.max(0, firstIdx - 300), firstIdx + 2500);
    debugImages = (block.match(/<img[^>]+>/g) || []).slice(0, 3);
  }

  return {
    ids,
    totalCount,
    totalPages,
    hints,
    debugImages,
    foundFirstItem: firstIdx !== -1,
    htmlLength: source.length,
  };
}

module.exports = {
  parseDetailHtml,
  parseComments,
  parseWorkshopBrowseHtml,
};
