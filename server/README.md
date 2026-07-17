# SpendSync Push Server

A minimal backend that sends real Web Push notifications for SpendSync's
daily reminder — these arrive even when the browser is fully closed, unlike
the in-tab-only reminders the app falls back to without this server.

## 1. Run it locally first

```bash
cd server
cp .env.example .env
npm install
npm start
```

You should see `SpendSync push server listening on :3000`.

## 2. Point the app at it

Open `spendsync.html`, find this near the top of the `<script>` block:

```js
const BACKEND_URL = ''; // e.g. 'https://your-app.onrender.com'
```

Set it to wherever this server is reachable — for local testing:

```js
const BACKEND_URL = 'http://localhost:3000';
```

Reload the app, open **🔔 Daily Reminder**, turn it on, hit **Save**. The
status line under the time picker will say "Real push active" once it's
subscribed. From then on, reminders are sent by this server, not the
browser tab.

## 3. Deploy it somewhere it can run all the time

The server needs to actually be running at your reminder time — a laptop
that's asleep won't send anything. Cheapest reliable options:

**Render.com (free tier, easiest)**
1. Push this `server/` folder to a GitHub repo.
2. On [render.com](https://render.com) → New → Web Service → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Add the three env vars from `.env.example` under Environment.
5. Deploy — you'll get a URL like `https://spendsync-push.onrender.com`.
6. Put that URL into `BACKEND_URL` in `spendsync.html` and re-host the app.

**Heads up about free tiers:** Render's free web services spin down after
~15 minutes of no incoming requests, and take ~30–60s to wake back up on
the next one. Since our scheduler only runs while the process is alive,
a sleeping server won't fire your reminder on time. Two ways around it:
- Add a free uptime pinger (e.g. [UptimeRobot](https://uptimerobot.com)) hitting
  your server's `/` route every 5–10 minutes to keep it awake.
- Or upgrade to Render's cheapest paid tier (~$7/mo) for an always-on instance.

**Alternative: Railway.app or Fly.io** — similar free-tier tradeoffs, same
deploy steps (`npm install` / `npm start`).

## 4. Regenerating your own VAPID keys (optional)

The `.env.example` keys work fine as-is. If you'd rather generate your own:

```bash
node -e "
const crypto = require('crypto');
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const pub = ecdh.getPublicKey(null, 'uncompressed');
let priv = ecdh.getPrivateKey();
if (priv.length < 32) { const p = Buffer.alloc(32); priv.copy(p, 32 - priv.length); priv = p; }
const b64url = b => b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
console.log('VAPID_PUBLIC_KEY=' + b64url(pub));
console.log('VAPID_PRIVATE_KEY=' + b64url(priv));
"
```

Paste the output into `.env` (server) **and** update `VAPID_PUBLIC_KEY` in
`spendsync.html` to match the new public key — both sides must use the same
key pair.

## How it works, briefly

- The client subscribes to push via `PushManager.subscribe()` and sends that
  subscription + your reminder time to `POST /api/subscribe`.
- Every minute, this server checks all subscriptions: if it's on/after
  someone's reminder time, they haven't logged anything today, and they
  haven't already been reminded today, it sends a push via the `web-push`
  library.
- The browser's own push service (Chrome/FCM, etc.) delivers it to the
  device — this is what wakes the browser even when it's closed.
- Data lives in `subscriptions.json` (created automatically). Fine for
  personal use; swap it for a real database if this ever needs to serve a
  meaningful number of people.