const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiKey = process.env.GEMINI_API_KEY;

// تخزين محادثات الجلسات بناءً على الـ sid
const sessions = {};

// 1. واجهة التتبع المباشرة
app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>Build Logic Session Monitor</title>
            <style>
                body { font-family: sans-serif; text-align: center; background: #0f172a; color: #f8fafc; padding: 40px; }
                input, button { padding: 10px; font-size: 16px; border-radius: 6px; border: none; margin: 5px; }
                input { width: 250px; }
                button { background: #2563eb; color: white; cursor: pointer; }
                .card { background: #1e293b; max-width: 500px; margin: 20px auto; padding: 20px; border-radius: 12px; border: 1px solid #334155; }
                .code-box { background: #020617; padding: 15px; border-radius: 8px; font-family: monospace; color: #38bdf8; word-break: break-all; min-height: 20px; }
            </style>
        </head>
        <body>
            <h1>🚀 Build Logic Session Monitor</h1>
            <div class="card">
                <h3>أدخل معرف الجلسة (Session ID)</h3>
                <input type="text" id="sidInput" placeholder="مثال: room123" value="default" />
                <button onclick="checkSession()">متابعة الجلسة</button>
            </div>

            <div class="card" id="sessionData" style="display:none;">
                <h4>الجلسة الحالية: <span id="currentSid"></span></h4>
                <p>النص المتجمع من الماب (Buffer):</p>
                <div class="code-box" id="bufferText">-</div>
                <button onclick="clearBuffer()" style="background:#dc2626; font-size:12px;">تفريغ النص (Clear)</button>
                <p>رد Gemini الأخير:</p>
                <div class="code-box" id="aiResponseText">-</div>
            </div>

            <script>
                let activeSid = '';
                async function checkSession() {
                    activeSid = document.getElementById('sidInput').value.trim() || 'default';
                    document.getElementById('currentSid').innerText = activeSid;
                    document.getElementById('sessionData').style.display = 'block';
                    updateView();
                }

                async function updateView() {
                    if(!activeSid) return;
                    try {
                        const res = await fetch('/api/session?sid=' + activeSid);
                        const data = await res.json();
                        document.getElementById('bufferText').innerText = data.buffer || '(فارغ)';
                        document.getElementById('aiResponseText').innerText = data.lastResponse || '(لا يوجد رد بعد)';
                    } catch(e){}
                }

                async function clearBuffer() {
                    if(!activeSid) return;
                    await fetch('/api/clear?sid=' + activeSid);
                    updateView();
                }

                setInterval(updateView, 1000);
            </script>
        </body>
        </html>
    `);
});

// 2. مسارات إدارة الجلسة من الصفحة
app.get('/api/session', (req, res) => {
    const sid = req.query.sid || 'default';
    res.json(sessions[sid] || { buffer: "", lastResponse: "" });
});

app.get('/api/clear', (req, res) => {
    const sid = req.query.sid || 'default';
    if(sessions[sid]) sessions[sid].buffer = "";
    res.json({ success: true });
});

// 3. مسار استقبال البيانات من الماب (POST / GET)
app.all('/api/display', async (req, res) => {
    const sid = req.query.sid || req.body?.sid || "default";
    
    // استخراج القيمة من أي خانة محتملة
    let rawValue = req.body?.value || req.query?.value || req.body?.data || "00000000";

    if (!sessions[sid]) {
        sessions[sid] = { buffer: "", lastResponse: "" };
    }

    console.log(`[SID: ${sid}] البيانات الخام:`, rawValue);

    let char = "";

    // إذا كانت القيمة كود باينري مثل "01000001"
    if (typeof rawValue === 'string' && /^[01]{8}$/.test(rawValue)) {
        const code = parseInt(rawValue, 2);
        if (code > 0) char = String.fromCharCode(code);
    } 
    // إذا كانت القيمة قد أرسلت كسلسلة عادية أو رقم
    else if (!isNaN(rawValue) && Number(rawValue) > 0) {
        char = String.fromCharCode(Number(rawValue));
    }
    else if (typeof rawValue === 'string' && rawValue !== "00000000") {
        char = rawValue;
    }

    // إضافة الحرف للـ Buffer إذا كان صالحاً
    if (char && char !== "\0") {
        sessions[sid].buffer += char;
        console.log(`[SID: ${sid}] تم تجميع الحرف: "${char}" | النص الحالي: "${sessions[sid].buffer}"`);
    }

    // إرجاع استجابة JSON ناجحة دائماً
    res.status(200).json({ 
        value: rawValue,
        sid: sid,
        receivedChar: char,
        currentBuffer: sessions[sid].buffer 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
