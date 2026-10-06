const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const LSB_FIRST = process.env.LSB_FIRST === '1';                    // ترتيب البتات معكوس؟
const MAX_REPLY = parseInt(process.env.MAX_REPLY || '32', 10);      // أقصى طول للرد
const IDLE_SEND_MS = parseInt(process.env.IDLE_SEND_MS || '0', 10); // إرسال تلقائي بعد سكوت (0 = معطّل)
// redraw (الافتراضي): مع كل حرف نمسح ونعيد كتابة السؤال كله بالترتيب | append: نضيف الحرف الجديد فقط
const ECHO_MODE = process.env.ECHO_MODE || 'redraw';
// FORCE_LOWER=1: يطبع كل الأحرف صغيرة (بدون SHIFT) - للاختبار
const FORCE_LOWER = process.env.FORCE_LOWER === '1';
const SESSION_TTL_MS = 60 * 60 * 1000;                              // حذف الجلسة الخاملة بعد ساعة
const MAX_SESSIONS = 200;
const ASK_COOLDOWN_MS = 3000;                                       // أقل فاصل بين سؤالين لنفس الجلسة

// =====================================================
//  الجلسات: كل sid له buffer وطابور وشاشة مستقلة
// =====================================================
const sessions = new Map();

function getSession(sid) {
    let s = sessions.get(sid);
    if (!s) {
        if (sessions.size >= MAX_SESSIONS) return null;
        s = {
            sid,
            buffer: '',          // السؤال الجاري كتابته
            lastResponse: '',
            queue: [],           // إطارات تنتظر الطباعة على الشاشة
            screen: 'blank',     // 'blank' | 'typing' | 'reply'
            gap: false,          // فراغ بين كل إطارين
            asking: false,
            lastAskAt: 0,
            idleTimer: null,
            lastLog: 'جلسة جديدة',
            lastSeen: Date.now()
        };
        sessions.set(sid, s);
    }
    s.lastSeen = Date.now();
    return s;
}

setInterval(() => {
    const now = Date.now();
    for (const [sid, s] of sessions) {
        if (now - s.lastSeen > SESSION_TTL_MS) {
            clearTimeout(s.idleTimer);
            sessions.delete(sid);
        }
    }
}, 5 * 60 * 1000).unref();

function log(s, m) { s.lastLog = m; console.log(`[${s.sid}] ${m}`); }

// يحدد الجلسة من: /s/:sid/... أو ?sid= أو هيدر x-sid، وإلا 'default'
function sessionFrom(req, res) {
    const sid = String(req.params.sid || req.query.sid || req.get('x-sid') || 'default');
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(sid)) {
        res.status(400).json({ error: 'sid غير صالح (حروف وأرقام و - _ فقط، حتى 32)' });
        return null;
    }
    const s = getSession(sid);
    if (!s) { res.status(503).json({ error: 'عدد الجلسات ممتلئ' }); return null; }
    return s;
}

// =====================================================
//  تحويل 8 بتات <-> رقم
// =====================================================
function toBits8(n) {
    const str = (n & 255).toString(2).padStart(8, '0');
    return LSB_FIRST ? str.split('').reverse().join('') : str;
}
function fromBits8(str) {
    let x = String(str ?? '').trim();
    if (!/^[01]{8}$/.test(x)) return null;
    if (LSB_FIRST) x = x.split('').reverse().join('');
    return parseInt(x, 2);
}

// =====================================================
//  ترميز الحرف للشاشة
//  الإطار: bit7 = valid | bit6 = SHIFT | bit5..0 = رقم الحرف
//  إطار Reset الخاص: 01000000
// =====================================================
const RESET = '\u0001';
const PAD = '\u0002';
const TABLE0 = (' abcdefghijklmnopqrstuvwxyz1234567890').padEnd(64, PAD); // SHIFT = 0
const TABLE1 = (' ABCDEFGHIJKLMNOPQRSTUVWXYZ').padEnd(64, PAD);           // SHIFT = 1

function frameOf(code, shift) { return 0x80 | (shift << 6) | (code & 63); }

function encodeChar(ch) {
    if (FORCE_LOWER) ch = ch.toLowerCase();
    let i = TABLE0.indexOf(ch);
    if (i >= 0) return frameOf(i, 0);
    i = TABLE1.indexOf(ch);
    if (i >= 0) return frameOf(i, 1);
    return frameOf(0, 0);
}

function sanitize(str) {
    return Array.from(str).filter(c => c !== PAD && c !== RESET && (TABLE0.includes(c) || TABLE1.includes(c))).join('');
}

// =====================================================
//  Gemini
// =====================================================
const SYSTEM_PROMPT = `You are the answer module of a tiny 16x16 character screen.
The question was typed by hand with binary switches, so it may contain typos or missing letters: infer the most likely meaning.
Answer the question directly and correctly, giving only the answer, no explanation.
Reply in English using only letters, digits and spaces (no punctuation, no symbols, no emojis).
Maximum ${MAX_REPLY} characters.
Examples: "capital of france" -> "Paris" ; "2 plus 2" -> "4" ; "is the sun a star" -> "Yes".
If the question is really unclear, reply "unclear".`;

async function askGemini(s) {
    clearTimeout(s.idleTimer);
    if (s.asking) return 'BUSY';
    const question = s.buffer.trim();
    if (!question) return 'EMPTY';
    if (Date.now() - s.lastAskAt < ASK_COOLDOWN_MS) {
        log(s, '[ASK] انتظر قليلاً بين الأسئلة');
        return 'WAIT';
    }
    s.buffer = '';
    s.asking = true;
    s.lastAskAt = Date.now();
    log(s, `[ASK] "${question}" ... جاري التفكير`);
    try {
        const model = new GoogleGenerativeAI(API_KEY).getGenerativeModel({
            model: MODEL,
            systemInstruction: SYSTEM_PROMPT,
            generationConfig: { temperature: 0.3 }
        });
        const result = await model.generateContent(`Question: ${question}`);
        const raw = result.response.text().replace(/\s+/g, ' ').trim();
        let clean = sanitize(raw).trim().slice(0, MAX_REPLY);
        if (!clean) clean = 'no answer';
        s.lastResponse = clean;
        s.queue = [RESET, ...clean.split('')];
        s.screen = 'reply';
        log(s, `[Gemini] Q="${question}" A="${clean}"`);
        return clean;
    } catch (err) {
        log(s, 'Gemini Error: ' + err.message);
        return 'ERR';
    } finally {
        s.asking = false;
    }
}

// =====================================================
//  معالجة الضغطة القادمة من الماب (POST)
//    00000000 -> إرسال السؤال | 00001000 -> حذف | غير ذلك: حرف ASCII
// =====================================================
function scheduleIdle(s) {
    clearTimeout(s.idleTimer);
    if (IDLE_SEND_MS > 0 && s.buffer.trim()) {
        s.idleTimer = setTimeout(() => askGemini(s), IDLE_SEND_MS);
    }
}

function handleKey(s, code) {
    if (code === 0 || code === 13 || code === 10) {
        askGemini(s);
    } else if (code === 8 || code === 127) {
        s.buffer = s.buffer.slice(0, -1);
        s.queue = [RESET, ...sanitize(s.buffer).split('')];
        s.screen = 'typing';
        scheduleIdle(s);
    } else if (code >= 32 && code <= 126) {
        const ch = String.fromCharCode(code);
        s.buffer += ch;
        const shown = sanitize(ch);
        if (shown) {
            if (ECHO_MODE === 'append' && s.screen === 'typing') {
                s.queue.push(shown);
            } else {
                // نعيد رسم السؤال كاملاً من أول خانة: نفس مسار رد الـ AI الذي يعمل عندك
                s.queue = [RESET, ...sanitize(s.buffer).split('')];
            }
            s.screen = 'typing';
        }
        scheduleIdle(s);
    }
    log(s, `[KEY] code=${code} buffer="${s.buffer}"`);
}

// =====================================================
//  مسارات الماب
//  الرابط في قطعة HTTP:  https://موقعك/s/اسم-الجلسة/display
// =====================================================
app.post(['/api/display', '/s/:sid/display'], (req, res) => {
    const s = sessionFrom(req, res);
    if (!s) return;
    const code = fromBits8(req.body?.value ?? req.query?.value);
    if (code !== null) handleKey(s, code);
    res.json({ value: '00000000' });
});

app.get(['/api/display', '/s/:sid/display'], (req, res) => {
    const s = sessionFrom(req, res);
    if (!s) return;
    if (s.gap) { s.gap = false; return res.json({ value: '00000000' }); }
    const ch = s.queue.shift();
    if (ch === undefined) return res.json({ value: '00000000' });
    s.gap = true;
    if (ch === RESET) {
        log(s, '[RESET] مسح الشاشة');
        return res.json({ value: '01000000' });
    }
    const isRaw = typeof ch === 'object';
    const bits = toBits8(isRaw ? frameOf(ch.code, ch.shift) : encodeChar(ch));
    log(s, `[PRINT] '${isRaw ? '#' + ch.code + ' shift=' + ch.shift : ch}' -> ${bits} | باقي ${s.queue.length}`);
    res.json({ value: bits });
});

// ---------- أدوات اختبار (أضف ?sid=اسمك) ----------
app.get('/api/say', (req, res) => {
    const s = sessionFrom(req, res); if (!s) return;
    s.queue = [RESET, ...sanitize(String(req.query.text || '')).split('')];
    s.screen = 'reply';
    res.json({ sid: s.sid, queued: s.queue.length });
});

app.get('/api/scan', (req, res) => {
    const s = sessionFrom(req, res); if (!s) return;
    const shift = req.query.shift === '1' ? 1 : 0;
    s.queue = [RESET, ...Array.from({ length: 64 }, (_, i) => ({ code: i, shift }))];
    res.json({ sid: s.sid, queued: s.queue.length, shift });
});

app.get('/api/ask', async (req, res) => {
    const s = sessionFrom(req, res); if (!s) return;
    res.json({ sid: s.sid, response: await askGemini(s) });
});

app.get('/api/session', (req, res) => {
    const s = sessionFrom(req, res); if (!s) return;
    res.json({
        sid: s.sid, buffer: s.buffer, lastResponse: s.lastResponse,
        remaining: s.queue.length, lastLog: s.lastLog, activeSessions: sessions.size
    });
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8">
<title>Build Logic Terminal</title>
<style>body{font-family:system-ui;background:#0f172a;color:#f8fafc;text-align:center;padding:30px}
.b{background:#020617;padding:12px;margin:8px auto;max-width:520px;border-radius:8px;font-family:monospace;color:#38bdf8;word-break:break-all}</style>
</head><body><h2>Build Logic Terminal</h2>
<p>الجلسة: <b id="sid">-</b> &nbsp;|&nbsp; الجلسات النشطة: <b id="act">-</b></p>
<p>Buffer</p><div class="b" id="buf">-</div>
<p>رد Gemini</p><div class="b" id="ans" style="color:#4ade80">-</div>
<p>المتبقي: <b id="rem">0</b></p><div class="b" id="log" style="color:#facc15;font-size:13px">-</div>
<script>
const sidQ = new URLSearchParams(location.search).get('sid') || 'default';
setInterval(async()=>{try{const d=await (await fetch('/api/session?sid='+encodeURIComponent(sidQ))).json();
sid.innerText=d.sid;act.innerText=d.activeSessions;buf.innerText=d.buffer||'(فارغ)';
ans.innerText=d.lastResponse||'-';rem.innerText=d.remaining;log.innerText=d.lastLog}catch(e){}},1000);
</script></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
