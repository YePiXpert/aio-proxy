---
'@aio-proxy/types': minor
'@aio-proxy/dashboard': minor
'@aio-proxy/server': minor
'aio-proxy': minor
---

Add `server.requireApiKey` to turn caller key enforcement off without deleting the configured keys, with a matching switch in Settings; when it is off on a non-loopback bind the proxy logs a warning. Settings now shows the configured caller keys as they are authored — including `{{env.NAME}}` templates — instead of `****`, so a key can be read back, edited, and copied rather than only replaced.
