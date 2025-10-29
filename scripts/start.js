const { cpSync, copyFileSync } = require('fs');
const { join } = require('path');
const { spawn } = require('child_process');

function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true, force: true });
}

copyDir(join('.next', 'static'), join('.next', 'standalone', '.next', 'static'));
copyDir('public', join('.next', 'standalone', 'public'));


const server = spawn('node', [join('.next', 'standalone', 'server.js')], {
  stdio: 'inherit',
});

server.on('close', (code) => process.exit(code));
