'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { isSceneWorkshopDir, isVideoWorkshopDir } = require('./projectInspection');

test('MPKG project inspection recognizes scene and contained video sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-mpkg-inspection-'));
  try {
    const sceneDir = path.join(root, 'scene');
    const videoDir = path.join(root, 'video');
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.mkdirSync(path.join(videoDir, 'clips'), { recursive: true });
    fs.writeFileSync(path.join(sceneDir, 'scene.pkg'), 'pkg');
    fs.writeFileSync(path.join(sceneDir, 'project.json'), '{}');
    fs.writeFileSync(path.join(sceneDir, 'preview.jpg'), 'preview');
    fs.writeFileSync(path.join(videoDir, 'project.json'), JSON.stringify({ type: 'video', file: 'clips/demo.mp4' }));
    fs.writeFileSync(path.join(videoDir, 'preview.png'), 'preview');
    fs.writeFileSync(path.join(videoDir, 'clips', 'demo.mp4'), 'video');

    assert.equal(isSceneWorkshopDir(sceneDir), true);
    assert.equal(isVideoWorkshopDir(sceneDir), false);
    assert.equal(isVideoWorkshopDir(videoDir), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MPKG project inspection rejects video sources outside the project directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-mpkg-inspection-'));
  try {
    const itemDir = path.join(root, 'item');
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'outside.mp4'), 'video');
    fs.writeFileSync(path.join(itemDir, 'preview.jpg'), 'preview');
    fs.writeFileSync(path.join(itemDir, 'project.json'), JSON.stringify({ type: 'video', file: '../outside.mp4' }));

    assert.equal(isVideoWorkshopDir(itemDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
