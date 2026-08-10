'use strict';

const fs = require('fs');
const path = require('path');

function hasWorkshopFile(dir, name) {
  try {
    const filePath = path.join(dir, name);
    return !!dir && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function hasWorkshopPreview(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some(name => /^preview\.(gif|jpe?g|png|webp)$/i.test(name));
  } catch {
    return false;
  }
}

function readWorkshopProject(dir) {
  try {
    if (!hasWorkshopFile(dir, 'project.json')) return null;
    const raw = fs.readFileSync(path.join(dir, 'project.json'), 'utf8').replace(/^\uFEFF/, '');
    const project = JSON.parse(raw);
    return project && typeof project === 'object' && !Array.isArray(project) ? project : null;
  } catch {
    return null;
  }
}

function hasWorkshopProjectFile(dir, fileName) {
  try {
    const root = path.resolve(String(dir || ''));
    const rawName = String(fileName || '').trim();
    if (!root || !rawName || path.isAbsolute(rawName)) return false;
    const relativeName = rawName.replace(/[\\/]+/g, path.sep);
    const filePath = path.resolve(root, relativeName);
    const relativePath = path.relative(root, filePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return false;
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isSceneWorkshopDir(dir) {
  return hasWorkshopFile(dir, 'scene.pkg') && hasWorkshopFile(dir, 'project.json') && hasWorkshopPreview(dir);
}

function isVideoWorkshopDir(dir) {
  const project = readWorkshopProject(dir);
  return !!(
    project &&
    String(project.type || '').trim().toLowerCase() === 'video' &&
    hasWorkshopPreview(dir) &&
    hasWorkshopProjectFile(dir, project.file)
  );
}

module.exports = {
  hasWorkshopFile,
  hasWorkshopPreview,
  readWorkshopProject,
  hasWorkshopProjectFile,
  isSceneWorkshopDir,
  isVideoWorkshopDir,
};
