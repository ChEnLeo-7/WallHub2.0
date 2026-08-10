'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const githubRoutes = require('./githubRoutes');
const steamkitGithubSource = require('../../domains/steamkit/githubSource');

test('GitHub proxy candidates classify GitHub URLs and preserve direct fallback order', () => {
  const url = 'https://github.com/example/project/archive/main.zip';
  const candidates = githubRoutes.githubProxyCandidates(url, {
    env: {
      WALLHUB_GITHUB_PROXY_URLS: 'https://proxy.example/, direct, https://proxy.example/',
    },
  });

  assert.deepEqual(candidates, [
    { name: 'https://proxy.example/', url: `https://proxy.example/${url}` },
    { name: 'direct', url },
  ]);
  assert.deepEqual(githubRoutes.githubProxyCandidates('https://example.com/file.zip'), [
    { name: 'direct', url: 'https://example.com/file.zip' },
  ]);
});

test('SteamKit GitHub source facade preserves the shared route API', () => {
  const url = 'https://github.com/example/project/archive/main.zip';
  const options = { env: {}, defaultProxyUrls: ['https://proxy.example/'] };

  assert.deepEqual(steamkitGithubSource.githubProxyCandidates(url, options), githubRoutes.githubProxyCandidates(url, options));
  assert.equal(steamkitGithubSource.buildGithubProxyUrl('https://proxy.example/', url), `https://proxy.example/${url}`);
  assert.equal(steamkitGithubSource.isGithubDownloadUrl(url), true);
  assert.deepEqual(steamkitGithubSource.parseCsvEnv({ ROUTES: 'one, two' }, 'ROUTES'), ['one', 'two']);
});
