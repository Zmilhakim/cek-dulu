# Cek Dulu

**"Check first."** Paste a suspicious message or a screenshot of one, and an AI model inside your browser tells
you whether it looks like a scam, which parts of it are the warning signs, and what to do next.

**Try it:** https://cek-dulu-26f35.web.app (Chrome on a desktop or laptop)

Built for the #BuildHybridAI hackathon with the Firebase AI Logic hybrid inference SDK.

## Why it exists

Scam messages work because they are private and urgent: a parcel that cannot be delivered, a bank account that
is "locked", a wedding invitation that is really an `.apk` file. The moment someone wonders "is this real?" is
the moment a second opinion helps most.

But the message itself is personal. It may contain a name, a phone number, an account number or a one-time code.
Asking people to paste that into a cloud service is asking them to take a second risk in order to check the first.

Cek Dulu removes that trade-off. The message is read by Gemini Nano inside Chrome. Nothing is uploaded, and the
check itself needs no network once the page and the model are loaded.

## What it does

- **Verdict:** Scam, Suspicious or No warning signs, with the kind of scam named.
- **Evidence:** the warning signs are underlined in the message itself and numbered, each with a one-line reason.
  Quotes are matched against the real text, so a fragment the model made up is never shown as a quote.
- **Next steps:** two to four concrete actions, and a reply that gives nothing away when replying makes sense.
- **Screenshots:** paste or attach an image of the message instead of typing it out.
- **Any language in, English out.** The examples include an Indonesian parcel scam.

## How hybrid inference is used

The app uses three of the SDK's inference modes, each for a reason.

| Situation | Mode | Why |
| --- | --- | --- |
| Checking a message | `ONLY_ON_DEVICE` | A private message must not leave the device because of a silent fallback. |
| Checking with consent | `ONLY_IN_CLOUD` | Used only after the person has seen the exact text that will be sent and agreed. |
| "How does this kind of scam work?" | `PREFER_ON_DEVICE` | A general explainer contains nothing from the message, so automatic fallback is fine. |

**Where a private message is read is the person's decision, not the SDK's.** `PREFER_ON_DEVICE` would have been
one line of code for the main check, and it would have sent the message to the cloud whenever the local model
was missing. Instead, `decideRoute` in `src/core/route.ts` picks one of four outcomes: check on the device, offer
the one-time model download, wait for a download in progress, or ask about the cloud.

**The cloud path is a consent screen, not a fallback.** When there is no on-device model, when the message is too
long for it, or when the on-device model answers "Suspicious" and a second opinion could help, the app shows
exactly what would be sent. Before that preview is built, phone numbers, email addresses, long numbers (account
numbers, ID numbers, one-time codes) and the query strings of links are removed on the device
(`src/core/redact.ts`). The person sees the cleaned text with the removed parts highlighted, then chooses "Send
this and check" or "Cancel, send nothing".

**Every result says where it ran.** The label comes from `response.inferenceSource`, which Firebase AI Logic
reports, not from what the app intended: "ON DEVICE · nothing left this browser" or "CLOUD · cleaned copy sent".

**Both models return the same structure.** On the device the answer is constrained with a JSON Schema
(`responseConstraint`); in the cloud with `responseSchema`. One parser validates both, so the two paths cannot
drift apart.

## Firebase products

- **Firebase AI Logic** (Gemini Developer API): all inference, on the device and in the cloud. See `src/engine.ts`.
- **App Check** with reCAPTCHA Enterprise: only this app can call the cloud model.
- **Remote Config:** `trend_hints` adds newly reported scam patterns to the model's instructions without a
  release; `cloud_model` and `max_device_chars` tune the routing. The app falls back to built-in defaults when
  Remote Config cannot be reached, so the on-device path still works offline.
- **Hosting:** serves the app.

## Run it

Requires Node.js 20.19 or later and a recent Chrome on a desktop or laptop (tested on Chrome 158, macOS).

```sh
npm install
npm run dev
```

Open the address it prints in Chrome.

- **On-device checks** work straight away. The first check offers a one-time download of Chrome's built-in
  model. It is several gigabytes, so use Wi-Fi.
- **Cloud checks on localhost** need an App Check debug token. Open the browser console, copy the line "Firebase
  App Check debug token: …", and register it in the Firebase console under App Check, Apps, Manage debug tokens.
  The hosted app does not need this.

To use your own Firebase project: replace the config in `src/firebase.ts`, set
`VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` in `.env`, enable Firebase AI Logic with the Gemini Developer API, register
the web app in App Check, then:

```sh
npm run deploy     # builds, then deploys Hosting and the Remote Config template
```

Other commands:

```sh
npm test           # unit tests for redaction, routing and result parsing
npm run typecheck
```

## Code map

```
src/core/redact.ts    removes personal details before anything may leave the device
src/core/route.ts     decides where a check may run
src/core/verdict.ts   model instructions, result schema, strict parsing, quote matching
src/core/samples.ts   made-up example messages
src/engine.ts         Firebase AI Logic calls: on-device, in-cloud and automatic
src/firebase.ts       app setup, App Check, Remote Config
src/main.ts           the page
```

## Limits

- The verdict is an opinion from a language model, not a guarantee. The page says so.
- The on-device model needs a recent desktop Chrome and a machine that meets Chrome's requirements. On other
  browsers the app offers only the consent-based cloud check.
- A screenshot cannot be cleaned automatically. The consent screen says so before an image is sent.
- Redaction is pattern-based. It removes phone numbers, emails, long numbers and link query strings; it does not
  recognise names or addresses, which is why the preview is always shown.

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
