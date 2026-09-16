---
'aio-proxy': patch
'@aio-proxy/plugin-openai-chatgpt': patch
---

Fix OpenAI ChatGPT model tests and Responses requests failing because the Codex backend rejects max_output_tokens. The ChatGPT plugin now omits this unsupported output limit.
