const fs = require('fs');
const path = require('path');

function readJsonFileSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Failed to read JSON file ${filePath}: ${error?.message || String(error)}`);
    }
    return fallback;
  }
}

function writeJsonFileSafe(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

module.exports = {
  readJsonFileSafe,
  writeJsonFileSafe,
};
