# L2 cross-module caching feature

Small CommonJS data-access app: an API client, an instrumented in-memory
store, repositories for three entities, serializers, and a router wired
together by `src/app.js`. There is no cache today: every repository read goes
straight to the store. The tests in `test/` describe a TTL read cache that
must sit in front of store reads.
