'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDetailHtml } = require('./parse');

test('detail description keeps content after blank paragraphs and nested divs', () => {
  const html = `
    <div id="highlightContent">
      <div>第一段内容</div>
      <div><br></div>
      <div>第二段内容<br>第二段第二行</div>
      <div><span>第三段内容</span></div>
    </div>
  `;

  assert.equal(
    parseDetailHtml(html).description,
    '第一段内容\n\n第二段内容\n第二段第二行\n第三段内容',
  );
});
