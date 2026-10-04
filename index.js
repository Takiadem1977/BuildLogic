const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
// إذا تبيّن أن ترتيب البتات معكوس في الماب، ضع LSB_FIRST=1 في متغيرات البيئة
const LSB_FIRST = process.env.LSB_FIRST === '1';

const session = { buffer: '', lastResponse: '', queue: [] };
let lastLog = 'السيرفر جاهز.';
const log = (m) => { lastLog = m; console.log(m); };

// ---------- تحويل 8 بتات <-> رقم ----------
function toBits8(n) {
    let s = (n & 255).toString(2).padStart(8, '0');
    return LSB_FIRST ? s.split('').reverse().join('') : s;
}
function fromBits8(str) {
    let s = String(str ?? '').trim();
    if (!/^[01]{8}$/.test(s)) return null;
    if (LSB_FIRST) s = s.split('').reverse().join('');
    return parseInt(s, 2);
}

// ---------- ترميز الحرف للشاشة ----------
// الإطار (8 بتات):  bit7 = valid (يسمح بالـ Clock)
//                    bit6 = SHIFT
//                    bit5..0 = الحرف (a=1 ... z=26, 0-9 = 27..36, مسافة = 0)
function encodeChar(ch) {
    let shift = 0;
    let c = ch;
    if (/[A-Z]/.test(c)) { shift = 1; c = c.toLowerCase(); }
    let val = 0;
    if (/[a-z]/.test(c)) val = c.charCodeAt(0) - 96;
    else if (/[0-9]/.test(c)) val = c.charCodeAt(0) - 48 + 27;
    return 0x80 | (shift << 6) | (val & 63);
}

// ---------- Gemini ----------
async function askGemini() {
    const question = session.buffer.trim();
    session.buffer = '';
    if (!question) return 'EMPTY';
    try {
        const model = new GoogleGenerativeAI(API_KEY).getGenerativeModel({ model: MODEL });
        const result = await model.generateContent(
            `Answer in short simple English (max 10 characters, letters/numbers only): ${question}`
        );
        const reply = result.response.text().trim().replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 16);
        session.lastResponse = reply;
        session.queue = reply.split('');
        log(`[Gemini] Q="${question}" A="${reply}"`);
        return reply;
    } catch (err) {
        log('Gemini Error: ' + err.message);
        return 'ERR';
    }
}

// ---------- معالجة ضغطة مفتاح قادمة من الماب ----------
function handleKey(code) {
    if (code === 13 || code === 10) {          // Enter -> أرسل لـ Gemini
        askGemini();
    } else if (code === 8) {                   // Backspace
        session.buffer = session.buffer.slice(0, -1);
    } else if (code >= 32 && code <= 126) {    // حرف عادي
        session.buffer += String.fromCharCode(code);
    }
    log(`[KEY] code=${code} buffer="${session.buffer}"`);
}

// ---------- مسارات الماب ----------
// POST: الكيبورد يرسل الحرف (فقط يستقبل، لا يسحب من الطابور)
app.post('/api/display', (req, res) => {
    const code = fromBits8(req.body?.value ?? req.query?.value);
    if (code !== null && code !== 0) handleKey(code);
    res.json({ value: '00000000' });
});

// GET: القطعة تسأل كل 0.1 ثانية، نعطيها حرفاً واحداً في كل مرة
let gap = false; // فراغ بين كل حرفين حتى ينزل البت 7 ويطلع من جديد
app.get('/api/display', (req, res) => {
    if (gap) { gap = false; return res.json({ value: '00000000' }); }
    const ch = session.queue.shift();
    if (ch === undefined) return res.json({ value: '00000000' });
    gap = true;
    const bits = toBits8(encodeChar(ch));
    log(`[PRINT] '${ch}' -> ${bits} | باقي ${session.queue.length}`);
    res.json({ value: bits });
});

// ---------- أدوات اختبار ----------
// افتح: /api/say?text=Hello  لتجرب الشاشة بدون Gemini
app.get('/api/say', (req, res) => {
    session.queue = String(req.query.text || '').replace(/[^a-zA-Z0-9 ]/g, '').split('');
    res.json({ queued: session.queue.length });
});

app.get('/api/session', (req, res) => {
    res.json({
        buffer: session.buffer,
        lastResponse: session.lastResponse,
        remaining: session.queue.length,
        lastLog
    });
});

app.get('/api/ask', async (req, res) => {
    const reply = await askGemini();
    res.json({ response: reply });
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8">
<title>Build Logic Terminal</title>
<style>body{font-family:system-ui;background:#0f172a;color:#f8fafc;text-align:center;padding:30px}
.b{background:#020617;padding:12px;margin:8px auto;max-width:520px;border-radius:8px;font-family:monospace;color:#38bdf8;word-break:break-all}</style>
</head><body><h2>Build Logic Terminal</h2>
<p>Buffer</p><div class="b" id="buf">-</div>
<p>رد Gemini</p><div class="b" id="ans" style="color:#4ade80">-</div>
<p>المتبقي: <b id="rem">0</b></p><div class="b" id="log" style="color:#facc15;font-size:13px">-</div>
<script>
setInterval(async()=>{try{const d=await (await fetch('/api/session')).json();
buf.innerText=d.buffer||'(فارغ)';ans.innerText=d.lastResponse||'-';rem.innerText=d.remaining;log.innerText=d.lastLog}catch(e){}},1000);
</script></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
