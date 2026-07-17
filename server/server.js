// SpendSync push server
// Stores one reminder subscription per device and, once a minute, sends a
// real Web Push notification to anyone whose reminder time has passed today
// and who hasn't logged a transaction yet — even if their browser is fully closed.
//
// Storage is a single JSON file for simplicity (fine for personal use / a
// handful of users). Swap loadSubs()/saveSubs() for a real database
// (Postgres, Supabase, etc.) before this needs to serve many people.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:you@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — copy .env.example to .env and fill them in.');
    process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const DB_FILE = path.join(__dirname, 'subscriptions.json');

function loadSubs() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch (e) { return []; }
}
function saveSubs(subs) {
    fs.writeFileSync(DB_FILE, JSON.stringify(subs, null, 2));
}

// Same playful message pool as the client — kept in sync manually since the
// two run in different places (browser vs. server).
const FUNNY_MESSAGES = [
    "Psst… did today's expenses just slip your mind? They won't forgive you that easily. 👀",
    "Your budget is waiting. Awkwardly. By itself. Send help (and receipts). 💸",
    "Breaking news: money left your wallet today and nobody logged it. Scandalous. 📰",
    "We see you scrolling. We also see your unlogged expenses staring back. 👁️",
    "One tap a day keeps the budget surprises away. Log today's spend?",
    "Your wallet just texted us. It says it misses being tracked. 🥺",
    "Plot twist: the hero of this story logs their expenses before bed. Be the hero.",
    "Doesn't matter which currency — every rupee, dollar and euro deserves to be counted. 🧾",
    "This is your friendly reminder, not a guilt trip. (Okay, maybe a little bit of one.) 😅",
    "Somewhere, an unlogged coffee is crying. Save it. 🥲",
    "Your future self will either thank you or side-eye you. Choose wisely.",
    "5 seconds now saves you 5 minutes of 'where did my money go' later.",
    "Bank balance mysteries, solved daily. Starting with today's entry.",
    "Log it before you forget it. Memory is not a budgeting strategy.",
    "Your spending called. It wants to be remembered, not ghosted.",
    "A wise wallet once said: 'Track me before I disappear.' 🪙",
    "Consider this a gentle nudge, not a bill collector. Log today's spends!",
    "The most interesting financial story tonight? Yours — if you log it.",
];
function randomMsg() {
    return FUNNY_MESSAGES[Math.floor(Math.random() * FUNNY_MESSAGES.length)];
}
function todayKey(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Routes ──────────────────────────────────────────────

app.get('/', (req, res) => {
    res.send('SpendSync push server is running.');
});

app.get('/api/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Create/update a device's reminder subscription
app.post('/api/subscribe', (req, res) => {
    const { deviceId, subscription, time, enabled } = req.body || {};
    if (!deviceId || !subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Missing deviceId or subscription' });
    }
    const subs = loadSubs();
    const idx = subs.findIndex(s => s.deviceId === deviceId);
    const record = {
        deviceId,
        subscription,
        time: time || '20:00',
        enabled: enabled !== false,
        lastFired: idx >= 0 ? subs[idx].lastFired : null,
        loggedDate: idx >= 0 ? subs[idx].loggedDate : null,
    };
    if (idx >= 0) subs[idx] = record; else subs.push(record);
    saveSubs(subs);
    res.json({ ok: true });
});

// Called right after the user logs a transaction, so today's reminder is skipped
app.post('/api/mark-logged', (req, res) => {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });
    const subs = loadSubs();
    const idx = subs.findIndex(s => s.deviceId === deviceId);
    if (idx >= 0) {
        subs[idx].loggedDate = todayKey();
        saveSubs(subs);
    }
    res.json({ ok: true });
});

// Turn reminders off / forget this device
app.post('/api/unsubscribe', (req, res) => {
    const { deviceId } = req.body || {};
    const subs = loadSubs().filter(s => s.deviceId !== deviceId);
    saveSubs(subs);
    res.json({ ok: true });
});

// ── The actual scheduler — runs once a minute ──────────
setInterval(async () => {
    const subs = loadSubs();
    if (!subs.length) return;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const tk = todayKey(now);

    const due = subs.filter(s => {
        if (!s.enabled || s.lastFired === tk || s.loggedDate === tk) return false;
        const [hh, mm] = (s.time || '20:00').split(':').map(Number);
        return nowMinutes >= hh * 60 + mm;
    });
    if (!due.length) return;

    const deadDeviceIds = new Set();
    const firedDeviceIds = new Set();

    await Promise.allSettled(due.map(async (s) => {
        const payload = JSON.stringify({ title: 'SpendSync', body: randomMsg() });
        try {
            await webpush.sendNotification(s.subscription, payload);
            firedDeviceIds.add(s.deviceId);
            console.log(`Sent reminder to ${s.deviceId}`);
        } catch (err) {
            console.warn(`Push to ${s.deviceId} failed (${err.statusCode || err.message})`);
            // 404/410 means the subscription is dead (uninstalled, permission revoked, etc.)
            if (err.statusCode === 404 || err.statusCode === 410) deadDeviceIds.add(s.deviceId);
            // any other error is treated as transient — left alone to retry next tick
        }
    }));

    if (!deadDeviceIds.size && !firedDeviceIds.size) return;

    // Re-read from disk in case /api/subscribe wrote in the meantime, then apply results.
    const updated = loadSubs()
        .filter(s => !deadDeviceIds.has(s.deviceId))
        .map(s => firedDeviceIds.has(s.deviceId) ? { ...s, lastFired: tk } : s);
    saveSubs(updated);
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SpendSync push server listening on :${PORT}`));