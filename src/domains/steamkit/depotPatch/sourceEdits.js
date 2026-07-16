'use strict';

function replaceSourceOnce(source, needle, replacement, description) {
  const crlfNeedle = needle.replace(/\n/g, '\r\n');
  if (source.includes(crlfNeedle)) return source.replace(crlfNeedle, replacement.replace(/\n/g, '\r\n'));
  if (source.includes(needle)) return source.replace(needle, replacement);
  throw new Error(`${description} source shape changed`);
}

function replaceSourceRegexOnce(source, regex, replacement, description) {
  if (!regex.test(source)) throw new Error(`${description} source shape changed`);
  return source.replace(regex, replacement);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceEol(source) {
  return String(source || '').includes('\r\n') ? '\r\n' : '\n';
}

function ensureCSharpUsing(source, namespaceName, description = 'C# using block') {
  const namespaceValue = String(namespaceName || '').trim();
  if (!namespaceValue) return source;
  const usingLine = `using ${namespaceValue};`;
  const existing = new RegExp(`^(?:\\uFEFF)?using[ \\t]+${escapeRegex(namespaceValue)};[ \\t]*$`, 'm');
  if (existing.test(source)) return source;
  const matches = Array.from(String(source || '').matchAll(/^(?:\uFEFF)?using[ \t]+(?:static[ \t]+)?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*;[ \t]*$/gm));
  if (!matches.length) throw new Error(`${description} source shape changed`);
  const last = matches[matches.length - 1];
  const insertAt = last.index + last[0].length;
  return `${source.slice(0, insertAt)}${sourceEol(source)}${usingLine}${source.slice(insertAt)}`;
}

function ensureCSharpUsings(source, namespaceNames, description = 'C# using block') {
  return (namespaceNames || []).reduce((current, namespaceName) => ensureCSharpUsing(current, namespaceName, description), source);
}

function assertNoBrokenCSharpCharLiterals(source, description = 'C# source') {
  const text = String(source || '');
  const broken = [];
  if (text.includes("'\t'")) broken.push('tab');
  if (text.includes("'\r'")) broken.push('carriage-return');
  if (text.includes("'\n'")) broken.push('newline');
  if (broken.length) throw new Error(`${description} generated invalid C# char literal (${broken.join(', ')})`);
  return source;
}

module.exports = { replaceSourceOnce, replaceSourceRegexOnce, escapeRegex, sourceEol, ensureCSharpUsing, ensureCSharpUsings, assertNoBrokenCSharpCharLiterals };
