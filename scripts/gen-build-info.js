const fs = require('fs');
const ts = new Date().toISOString().replace('T', ' ').substring(0, 16);
fs.writeFileSync('src/buildInfo.ts', `export const BUILD_TIME = '${ts}';\n`);
console.log(`Build info generated: ${ts}`);
