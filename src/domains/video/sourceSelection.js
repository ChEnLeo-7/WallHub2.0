'use strict';

function createVideoSourceSelector(deps = {}) {
  const { detectVideoTag, isVideoExt, extFromUrl, extFromPath } = deps;

  function itemLooksVideo(detail) {
    return detectVideoTag(detail) || isVideoExt(extFromUrl(detail && detail.file_url, ''));
  }

  function resolve(detail) {
    const id = String(detail && detail.publishedfileid || '');
    const fileUrl = String(detail && detail.file_url || '').trim();
    const filename = String(detail && detail.filename || '').trim();
    const hcontent = String(detail && (detail.hcontent_file || detail.hcontent_file_id || '') || '').trim();
    const ext = extFromUrl(fileUrl || filename, '');
    if (fileUrl && (!ext || isVideoExt(ext) || itemLooksVideo(detail))) {
      return { kind: 'file_url', id, url: fileUrl, filename, ext: ext || extFromPath(filename, '.mp4') };
    }
    if (hcontent || detail && detail.consumer_appid) {
      return { kind: 'chunk', id, hcontent, filename, ext };
    }
    return { kind: 'unknown', id, filename, ext };
  }

  return { resolve };
}

module.exports = {
  createVideoSourceSelector,
};
