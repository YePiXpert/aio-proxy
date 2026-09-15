---
'aio-proxy': patch
'@aio-proxy/dashboard': patch
---

Preserve the full upstream URL when creating or editing single-protocol API endpoints in the Dashboard. Gateways such as Command Code now retain their required path prefixes after saving; existing legacy single-protocol configurations retain their original URL behavior.
