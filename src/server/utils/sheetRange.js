function colToLetter(index) {
  let current = index + 1;
  let out = '';
  while (current > 0) {
    const rem = (current - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    current = Math.floor((current - 1) / 26);
  }
  return out;
}

function quoteSheetName(tabName) {
  return `'${String(tabName || '').replace(/'/g, "''")}'`;
}

function normalizeHeaderName(name) {
  return String(name || '').trim().toLowerCase().replace(/[\s_]+/g, '');
}

module.exports = {
  colToLetter,
  quoteSheetName,
  normalizeHeaderName,
};
