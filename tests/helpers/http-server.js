#!/usr/bin/env node
// Minimal static file server for the test harness. Replaces the previous
// `python3 -m http.server` dependency so the suite runs anywhere node
// runs (including GitHub Actions images without a pre-installed python).
//
//   node tests/helpers/http-server.js <port>
//
// Serves files from the project root. Stays alive until killed by the
// parent process (matches the python http.server contract).
const http = require('http');
const fs   = require('fs');
const path = require('path');

const port = parseInt(process.argv[2] || '8000', 10);
// Serve the caller's working directory. Tests spawn us with
// cwd = <project-root>; this stays correct regardless of where this
// helper lives in the source tree.
const root = process.cwd();

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt':  'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';

    // Prevent directory traversal — the resolved absolute path must stay
    // under `root`. Anything else is treated as a 403.
    const resolved = path.resolve(root, '.' + rel);
    if (!resolved.startsWith(root)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.stat(resolved, (err, stat) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const target = stat.isDirectory() ? path.join(resolved, 'index.html') : resolved;
        fs.readFile(target, (rerr, data) => {
            if (rerr) { res.writeHead(404); res.end('Not found'); return; }
            const ext = path.extname(target).toLowerCase();
            res.writeHead(200, {
                'Content-Type':  MIME[ext] || 'application/octet-stream',
                'Cache-Control': 'no-store',
            });
            res.end(data);
        });
    });
});

server.listen(port, '127.0.0.1', () => {
    // Silent by default — tests use stdio: 'ignore'. A log here would
    // never be seen but doesn't hurt.
    if (process.env.TEST_SERVER_VERBOSE) {
        console.log('[test-http-server] listening on http://127.0.0.1:' + port + ' (root=' + root + ')');
    }
});

server.on('error', (e) => {
    console.error('[test-http-server] error', e.message);
    process.exit(1);
});
