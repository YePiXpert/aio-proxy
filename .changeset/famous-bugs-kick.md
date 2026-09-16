---
'aio-proxy': patch
'@aio-proxy/server': patch
---

Fix the OAuth Provider model test for image models such as GPT Image 2.5 Sunburst. Image-only models now use an image generation request with a longer timeout instead of an unsupported chat request, and only pass when image output is returned.
