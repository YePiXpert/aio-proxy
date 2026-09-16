---
'@aio-proxy/core': patch
'aio-proxy': patch
---

Image generation and editing requests with an omitted or blank model now default to `gpt-image-2.5-sunburst`. Explicit model selections keep their existing routing. API Providers must expose the new default model, or clients must explicitly request a model their Provider supports.
