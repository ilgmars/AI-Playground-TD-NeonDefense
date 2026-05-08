// Utility to spawn and manage HTTP server for a specific port.
const { spawn } = require('child_process');

function startServer(port) {
    return new Promise((resolve, reject) => {
        const server = spawn('python3', ['-m', 'http.server', String(port)], {
            cwd: '/home/claude/AI-Playground-TD-NeonDefense-TEST',
            stdio: 'ignore'
        });

        server.on('error', reject);

        // Give server time to start listening
        setTimeout(() => resolve(server), 400);
    });
}

function stopServer(server) {
    if (server) server.kill('SIGTERM');
}

module.exports = { startServer, stopServer };
