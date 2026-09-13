---
'aio-proxy': patch
'@aio-proxy/server': patch
---

Record TTFT for OpenAI Responses streams that deliver the first text or reasoning in `response.output_item.done` instead of incremental `*.delta` events. A completed item is only a fallback when no `*.delta` was seen, so normal done-after-delta streams do not invent a content gap. Reasoning items count generated `content` as well as `summary`. Tool-only and empty items still omit TTFT.
