# Boliye — Urdu & English voice agent

A React + Vite prototype using Gemini Live native audio. Speak in Urdu, English, or both. The browser streams microphone audio directly to Gemini; a small Node server issues short-lived tokens and keeps the permanent API key off the client.

## Run locally

Requires Node.js 22.14+ and a Gemini API key with access to the configured Live model.

```sh
npm ci
cp .env.example .env.local
# Set GEMINI_API_KEY in .env.local
npm run dev
```

Open **http://localhost:3000**, click **Start conversation**, and allow the microphone. Use headphones while checking interruptions. The agent waits for you to speak first. Expand **Conversation transcript** to inspect input/output recognition; transcripts remain in browser memory and reset on a new session.

The API listens on loopback port 3001. Vite proxies `/api` to it. Use the exact origin in `APP_ORIGIN`; `localhost` and `127.0.0.1` are different origins. Restart the server after editing `.env.local`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Required | Server-only Gemini credential; never use a `VITE_` prefix |
| `GEMINI_MODEL` | `gemini-3.8-live` | Live model with native audio |
| `GEMINI_VOICE` | `Kore` | Supported Gemini prebuilt voice name |
| `API_PORT` | `3001` | Backend port |
| `APP_ORIGIN` | `http://localhost:3000` in development | Exact allowed browser origin, without a trailing slash |

The model default follows Google's [current Live model guidance](https://ai.google.dev/gemini-api/docs/live-api/capabilities). Model/voice access depends on your account. The SDK and model must be upgraded together when API behavior changes.

## Build and check

```sh
npm test
npm run build
APP_ORIGIN=http://localhost:3001 npm start
```

The built app is served at **http://localhost:3001** by the same Node server. `build` runs strict TypeScript checking before Vite. `npm start` uses `tsx`, so install development dependencies as well for this prototype. Dependencies are locked in `package-lock.json`.

## Implementation

- `App.tsx`, `components/`: interface and playback visualizer.
- `hooks/useVoiceSession.ts`: React subscription and unmount cleanup.
- `voice/session.ts`: session controller, cancellation guards, bounded resumption, transcript state, errors.
- `voice/audio.ts`, `public/pcm-capture.worklet.js`: ~20 ms microphone chunks and cancellable PCM playback. Input is tagged with the device's actual sample rate; Gemini resamples it. PCM output is normally 24 kHz.
- `server/`: token endpoint and production static server.
- `shared/live.ts`: bilingual prompt and native audio/VAD/transcription configuration.

The token has one new-session use, a one-minute start window, and a 30-minute lifetime. Model and session settings are constrained server-side. Reconnection reuses the same token and the latest resumable handle, with up to three retries per conversation. No microphone chunks are queued while disconnected. Without a resumable handle, the UI asks you to restart instead of silently discarding conversation context. A session ends when its token expires.

Stopping cancels pending setup, closes late session results, clears queued audio, stops microphone tracks, and closes the audio context. Server interruption messages clear playback immediately. The speaking state tracks speaker playback rather than model generation completion.

## Scope and access

This is a **local prototype**. The token endpoint checks the origin and has in-memory limits of six attempts per client address and thirty globally per ten minutes. These reset on restart and are not user authentication. Both servers bind to loopback. Before sharing through a public host or tunnel, add authenticated access and deployment-appropriate rate limiting. Use HTTPS outside localhost for microphone access.

Audio is sent to Google while connected; this application does not save audio or transcripts on the server. Provider data handling still applies. No permanent credentials should appear in `dist/`.

## Listening and browser acceptance checks

Automated tests cover PCM boundaries, device cleanup, cancellation, stale callbacks, playback interruption, retries, expiry, and token endpoint behavior. Run these manual checks with a real key on desktop Chrome and Safari, then a mobile browser:

1. Urdu: “السلام علیکم، آج آپ کیسے ہیں؟” and a short open-ended question. Assess natural vocabulary and pronunciation.
2. English: “Explain why the sky is blue in two sentences.” Check concision and natural speech.
3. Mixed: “Mujhe kal ki meeting ke liye ek short introduction chahiye.” Check natural code-switching.
4. Explicit preference: ask it to reply only in English, then explicitly switch to Urdu.
5. Pause mid-sentence, speak quietly, and interrupt a longer response. Check that speech stops promptly without old audio returning.
6. Stop while the permission prompt is open; then grant permission. The session must remain stopped and the microphone indicator must clear.
7. Deny microphone permission, simulate a disconnect, and repeat Start/Stop ten times. Check error recovery and resource release.
8. Compare `Kore` with another supported voice using the same prompts. Record pronunciation, language adherence, and delay from end of user speech to first audible response.

Voice quality and latency need listening tests; unit tests cannot establish Urdu fluency. The SDK currently contains an older `v1alpha` warning for ephemeral tokens, while the linked current Google guide specifies `v1beta`; this implementation follows the current guide. Verify the live handshake with your account before treating the integration as validated.

References: [ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens), [session management](https://ai.google.dev/gemini-api/docs/live-api/session-management), [Live best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices).
