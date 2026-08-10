'use strict';

function createActiveTaskRegistry() {
  const activeTasks = new Map();

  function get(key) {
    return activeTasks.get(key);
  }

  async function run(key, operation) {
    const promise = (async () => operation())();
    activeTasks.set(key, promise);
    try {
      return await promise;
    } finally {
      if (activeTasks.get(key) === promise) activeTasks.delete(key);
    }
  }

  return { get, run };
}

module.exports = { createActiveTaskRegistry };
