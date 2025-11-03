const { cp } = require('fs');

cp('.next/static', '.next/standalone/.next/static', { recursive: true, force: true });
cp('public', '.next/standalone/public', { recursive: true, force: true });
