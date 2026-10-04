const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiKey = process.env.GEMINI_API_KEY;

// تخزين المحادثات والجلسات في الذاكرة
const sessions = {
    "default": { buffer: "", lastResponse: "" }
};

// 1. واجهة التتبع المباشرة
app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>Build Logic Session Monitor</title>
            <style>
                body { font-family: system-ui, sans-serif; text-align: center; background: #0f172a; color: #f8fafc; padding: 30px; }
                input, button { padding: 10px 15px; font-size: 16px; border-radius: 6px; border: none; margin: 5px; }
                input { width: 220px; text-align: center; }
                button { background: #2563eb; color: white; cursor: pointer; font-weight: bold; }
                button:hover { background: #1d4ed8; }
                .card { background: #1e293b; max-width: 550px; margin: 20px auto; padding: 20px; border-radius: 12px; border: 1px solid #334155; }
                .code-box { background: #020617; padding: 15px; border-radius: 8px; font-family: monospace; color: #38bdf8; word-break: break-all; min-height: 30px; font-size: 18px; margin: 10px 0; }
                .btn-ask { background: #059669; width: 100%; margin-top: 10px; font-size: 18px; }
                .btn-ask:hover { background: #047857; }
                .btn-clear { background: #dc2626; font-size: 12px; }
            </style>
        </head>
        <body>
            <h1>🚀 Build Logic Session Monitor</h1>
            <div class="card">
                <label>معرف الجلسة (Session ID):</label><br/>
                <input type="text" id="sidInput" value="default" />
                <button onclick="checkSession()">متابعة الجلسة</button>
            </div>

            <div class="card" id="sessionData">
                <h3>الجلسة الحالية: <span id="currentSid" style="color:#38bdf8;">default</span></h3>
                <p>النص المتجمع من الماب (Buffer):</p>
                <div class="code-box" id="bufferText">-</div>
                <button onclick="clearBuffer()" class="btn-clear">تفريغ النص (Clear)</button>
                <button onclick="askGemini()" class="btn-ask">🤖 إرسال النص إلى Gemini</button>
                <hr style="border-color: #334155; margin-top: 20px;" />
                <p>رد Gemini الأخير:</p>
                <div class="code-box" id="aiResponseText" style="color: #4ade80;">-</div>
            </div>

            <script>
                let activeSid = 'default';

                async function checkSession() {
                    activeSid = document.getElementById('sidInput').value.trim() || 'default';
                    document.getElementById('currentSid').innerText = activeSid;
                    updateView();
                }

                async function updateView() {
                    try {
                        const res = await fetch('/api/session?sid=' + activeSid);
                        const data = await res.json();
                        document.getElementById('bufferText').innerText = data.buffer || '(فارغ)';
                        document.getElementById('aiResponseText').innerText = data.lastResponse || '(لا يوجد رد بعد)';
                    } catch(e){}
                }

                async function clearBuffer() {
                    await fetch('/api/clear?sid=' + activeSid);
                    updateView();
                }

                async function askGemini() {
                    document.getElementById('aiResponseText').innerText = 'جاري التفكير والتوليد... ⏳';
                    const res = await fetch('/api/ask?sid=' + activeSid);
                    const data = await res.json();
                    document.getElementById('aiResponseText').innerText = data.response;
                    updateView();
                }

                setInterval(updateView, 1000);
            </script>
        </body>
        </html>
    `);
});

// 2. مسارات التحكم بالجلسة
app.get('/api/session', (req, res) => {
    const sid = req.query.sid || 'default';
    res.json(sessions[sid] || { buffer: "", lastResponse: "" });
});

app.get('/api/clear', (req, res) => {
    const sid = req.query.sid || 'default';
    if (!sessions[sid]) sessions[sid] = { buffer: "", lastResponse: "" };
    sessions[sid].buffer = "";
    res.json({ success: true });
});

// 3. مسار إرسال الـ Buffer المجمع إلى Gemini
app.get('/api/ask', async (req, res) => {
    const sid = req.query.sid || 'default';
    const session = sessions[sid];

    if (!session || !session.buffer.trim()) {
        return res.json({ response: "الـ Buffer فارغ! قم بإرسال أحرف من الماب أولاً." });
    }

    if (!apiKey) {
        return res.json({ response: "خطأ: لم يتم ضبط GEMINI_API_KEY في إعدادات Render." });
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        console.log(`[Gemini Request] إرسال النص: "${session.buffer}"`);
        const result = await model.generateContent(session.buffer);
        const reply = result.response.text();

        session.lastResponse = reply;
        res.json({ response: reply });
    } catch (err) {
        console.error("Gemini Error:", err);
        res.json({ response: "خطأ أثناء الاتصال بـ Gemini: " + err.message });
    }
});

// 4. مسار استقبال النبضات من الماب (POST / GET)
app.all('/api/display', (req, res) => {
    const sid = req.query.sid || req.body?.sid || "default";

    if (!sessions[sid]) {
        sessions[sid] = { buffer: "", lastResponse: "" };
    }

    let rawValue = req.body?.value || req.query?.value || req.body?.data || "00000000";
    console.log(`[SID: ${sid}] البيانات الخام المستلمة:`, rawValue);

    let char = "";

    // تحليل البايت واستخراج الحرف
    if (typeof rawValue === 'string' && /^[01]{8}$/.test(rawValue)) {
        const code = parseInt(rawValue, 2);
        if (code > 0) char = String.fromCharCode(code);
    } else if (!isNaN(rawValue) && Number(rawValue) > 0) {
        char = String.fromCharCode(Number(rawValue));
    }

    if (char && char !== "\0") {
        sessions[sid].buffer += char;
        console.log(`[SID: ${sid}] ✅ تم تسجيل الحرف: "${char}" | الـ Buffer الحالي: "${sessions[sid].buffer}"`);
    }

    // إرجاع الرد للماب
    res.status(200).json({ 
        value: rawValue,
        sid: sid,
        receivedChar: char,
        buffer: sessions[sid].buffer,
        lastResponse: sessions[sid].lastResponse
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
