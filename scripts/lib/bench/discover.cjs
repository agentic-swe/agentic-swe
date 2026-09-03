'use strict';

const fs = require('fs');
const path = require('path');

function discoverTasks(tasksRoot) {
  if (!fs.existsSync(tasksRoot)) return [];
  return fs.readdirSync(tasksRoot)
    .filter((name) => {
      const full = path.join(tasksRoot, name);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'task.json'));
    })
    .sort()
    .map((name) => path.join(tasksRoot, name));
}

module.exports = { discoverTasks };
