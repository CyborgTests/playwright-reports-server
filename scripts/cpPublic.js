const { cpSync } = require('fs');

cpSync('.next/static', '.next/standalone/.next/static', { recursive: true, force: true });
cpSync('public', '.next/standalone/public', { recursive: true, force: true });
