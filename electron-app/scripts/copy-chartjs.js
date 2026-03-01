const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
const dest = path.join(__dirname, '..', 'lib', 'chart.umd.js');

if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('Copied chart.umd.js to lib/');
} else {
  console.warn('chart.umd.js not found at', src);
}
