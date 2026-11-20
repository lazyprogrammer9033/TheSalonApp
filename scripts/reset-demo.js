'use strict';
// Wipes the demo salon so the next start builds a fresh one (new sample
// customers, visits and sales up to today). Run it before each sales visit:
//   npm run demo:reset
// Stop the app first. Backups in data/backups are kept.
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
let removed = 0;
for (const f of ['salon.db', 'salon.db-wal', 'salon.db-shm']) {
  const p = path.join(dataDir, f);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    removed++;
  }
}
console.log(removed ? 'Demo data cleared. Start the app again for a fresh demo salon.' : `No demo data found in ${dataDir}.`);
