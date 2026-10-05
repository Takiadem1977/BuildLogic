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
const RESET = '\u0001'; // علامة خاصة تتحول إلى إطار Reset (01000000)
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
//                    bit5..0 = رقم الحرف (0..63)
// الجدولان أدناه: رقم الحرف = موضعه في النص (الفهرس).
// عدّلهما بعد ما تشغّل /api/scan وتشوف ترتيب الحروف الفعلي على الشاشة.
// استعمل \u0002 لأي خانة لا تعرف ما هو الحرف فيها.
const PAD = '\u0002';
const TABLE0 = (' abcdefghijklmnopqrstuvwxyz1234567890').padEnd(64, PAD); // SHIFT = 0
const TABLE1 = (' ABCDEFGHIJKLMNOPQRSTUVWXYZ').padEnd(64, PAD);           // SHIFT = 1

function frameOf(code, shift) { return 0x80 | (shift << 6) | (code & 63); }

function encodeChar(ch) {
    let i = TABLE0.indexOf(ch);
    if (i >= 0) return frameOf(i, 0);
    i = TABLE1.indexOf(ch);
    if (i >= 0) return frameOf(i, 1);
    return frameOf(0, 0); // حرف غير معروف -> مسافة
}

// يبقي فقط الحروف الموجودة في الجدولين
function sanitize(str) {
    return Array.from(str).filter(c => c !== PAD && (TABLE0.includes(c) || TABLE1.includes(c))).join('');
}

// ---------- Gemini ----------
const MAX_REPLY = parseInt(process.env.MAX_REPLY || '32', 10);     // أقصى طول للرد
const IDLE_SEND_MS = parseInt(process.env.IDLE_SEND_MS || '0', 10); // إرسال تلقائي بعد سكوت (0 = معطّل)
let asking = false;
let idleTimer = null;

const SYSTEM_PROMPT = `You are the answer module of a tiny 16x16 character screen.
The question was typed by hand with binary switches, so it may contain typos or missing letters: infer the most likely meaning.
Answer the question directly and correctly, giving only the answer, no explanation.
Reply in English using only letters, digits and spaces (no punctuation, no symbols, no emojis).
Maximum ${MAX_REPLY} characters.
Examples: "capital of france" -> "Paris" ; "2 plus 2" -> "4" ; "is the sun a star" -> "Yes".
If the question is really unclear, reply "unclear".`;

async function askGemini() {
    clearTimeout(idleTimer);
    if (asking) return 'BUSY';
    const question = session.buffer.trim();
    session.buffer = '';
    if (!question) return 'EMPTY';
    asking = true;
    log(`[ASK] "${question}" ... جاري التفكير`);
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
        session.lastResponse = clean;
        session.queue = [RESET, ...clean.split('')];
        log(`[Gemini] Q="${question}" A="${clean}"`);
        return clean;
    } catch (err) {
        log('Gemini Error: ' + err.message);
        return 'ERR';
    } finally {
        asking = false;
    }
}

// ---------- معالجة الضغطة القادمة من الماب ----------
// كل ضغطة على زر Enter (POST) ترسل حرفاً واحداً بقيمة الـ 8 مفاتيح:
//   00000000 (صفر)  -> إرسال السؤال إلى Gemini
//   00001000 (8)    -> حذف آخر حرف
//   غير ذلك (ASCII) -> يُضاف الحرف للسؤال
function scheduleIdle() {
    clearTimeout(idleTimer);
    if (IDLE_SEND_MS > 0 && session.buffer.trim()) {
        idleTimer = setTimeout(askGemini, IDLE_SEND_MS);
    }
}

function handleKey(code) {
    if (code === 0 || code === 13 || code === 10) {
        askGemini();
    } else if (code === 8 || code === 127) {
        session.buffer = session.buffer.slice(0, -1);
        scheduleIdle();
    } else if (code >= 32 && code <= 126) {
        session.buffer += String.fromCharCode(code);
        scheduleIdle();
    }
    log(`[KEY] code=${code} buffer="${session.buffer}"`);
}

// ---------- مسارات الماب ----------
// POST: الكيبورد يرسل الحرف (فقط يستقبل، لا يسحب من الطابور)
app.post('/api/display', (req, res) => {
    const code = fromBits8(req.body?.value ?? req.query?.value);
    if (code !== null) handleKey(code);
    res.json({ value: '00000000' });
});

// GET: القطعة تسأل كل 0.1 ثانية، نعطيها حرفاً واحداً في كل مرة
let gap = false; // فراغ بين كل حرفين حتى ينزل البت 7 ويطلع من جديد
app.get('/api/display', (req, res) => {
    if (gap) { gap = false; return res.json({ value: '00000000' }); }
    const ch = session.queue.shift();
    if (ch === undefined) return res.json({ value: '00000000' });
    gap = true;
    if (ch === RESET) {
        log('[RESET] مسح الشاشة');
        return res.json({ value: '01000000' }); // bit7=0 و bit6=1 => Reset
    }
    const isRaw = typeof ch === 'object';
    const bits = toBits8(isRaw ? frameOf(ch.code, ch.shift) : encodeChar(ch));
    log(`[PRINT] '${isRaw ? '#' + ch.code + ' shift=' + ch.shift : ch}' -> ${bits} | باقي ${session.queue.length}`);
    res.json({ value: bits });
});

// ---------- أدوات اختبار ----------
// افتح: /api/say?text=Hello  لتجرب الشاشة بدون Gemini
app.get('/api/say', (req, res) => {
    session.queue = [RESET, ...sanitize(String(req.query.text || '')).split('')];
    res.json({ queued: session.queue.length });
});

// افتح: /api/scan?shift=0  (ثم shift=1) لطباعة كل الأكواد 0..63 بالترتيب
// بعدها اقرأ الشاشة: الخانة رقم i تعرض الحرف الذي رقمه i
app.get('/api/scan', (req, res) => {
    const shift = req.query.shift === '1' ? 1 : 0;
    session.queue = [RESET, ...Array.from({ length: 64 }, (_, i) => ({ code: i, shift }))];
    res.json({ queued: session.queue.length, shift });
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
