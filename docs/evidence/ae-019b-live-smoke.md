# AE-019b local adapter smoke evidence

Date: 2026-11-06

The conformance and gateway tests use transport spies only and do not make
network requests.

Optional live availability checks:

- Ollama `http://127.0.0.1:11434`: unavailable (`curl` connection refused).
- llama.cpp `http://127.0.0.1:8080`: HTTP server reachable, but no compatible
  `/v1/models` endpoint/model was available for a chat smoke request.

No paid provider, credential, or non-loopback endpoint was used. Live smoke is
therefore recorded as gracefully unavailable; fixture conformance is the
validation evidence for both adapters.
