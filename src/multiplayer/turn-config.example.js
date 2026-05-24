// turn-config.example.js — shape reference for the auto-generated
// turn-config.js. The real file is gitignored and rebuilt from
// .credentials (local dev) or the NEON_TURN_CONFIG GitHub Secret
// (CI deploy) via tools/install-turn-config.sh.
//
// Copy this file to .credentials with real values (NOT as
// turn-config.js — that's auto-generated).
//
// Format of .credentials:
//   {
//     "metered": {
//       "apiKey": "...",
//       "appName": "...",
//       "credentialsEndpoint": "https://YOUR_APP.metered.live/api/v1/turn/credentials",
//       "staticIceServers": [
//         { "urls": "stun:stun.relay.metered.ca:80" },
//         { "urls": "turn:europe.relay.metered.ca:80",
//           "username": "...", "credential": "..." },
//         ...
//       ]
//     }
//   }
//
// What the generator emits looks like this stub:
(function () {
    if (typeof window === 'undefined') return;
    window.__neonTurnConfig = {
        iceServers: [
            // Public STUN — no auth, free, but only helps with
            // non-symmetric NATs.
            { urls: 'stun:stun.l.google.com:19302' },
            // TURN relay — required for symmetric-NAT peers. Real
            // username/credential pairs live in .credentials and
            // get injected per-deploy.
        ],
        generated: 'example',
    };
})();
