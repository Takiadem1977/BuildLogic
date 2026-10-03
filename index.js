const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiKey = process.env.GEMINI_API_KEY;

// تخزين محادثات الجلسات بناءً على الـ sid
// Structure: { "session_id": { buffer: "HELLO", lastResponse: "WORLD" } }
const sessions = {};

// 1. واجهة الموقع الرئيسية (تسمح للمستخدم بإدخال sid ومتابعة الاستجابة)
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
                .code-box { background: #020617; padding: 15px; border-radius: 8px; font-family: monospace; color: #38bdf8; word-break: break-all; }
            </style>
        </head>
        <body>
            <h1>🚀 Build Logic Session Monitor</h1>
            <div class="card">
                <h3>أدخل معرف الجلسة (Session ID)</h3>
                <input type="text" id="sidInput" placeholder="مثال: room123" />
                <button onclick="checkSession()">متابعة الجلسة</button>
            </div>

            <div class="card" id="sessionData" style="display:none;">
                <h4>الجلسة الحالية: <span id="currentSid"></span></h4>
                <p>النص المتجمع من الماب (Buffer):</p>
                <div class="code-box" id="bufferText">-</div>
                <p>رد Gemini الأخير:</p>
                <div class="code-box" id="aiResponseText">-</div>
            </div>

            <script>
                async function checkSession() {
                    const sid = document.getElementById('sidInput').value.trim();
                    if(!sid) return alert('يرجى إدخال SID');
                    
                    document.getElementById('currentSid').innerText = sid;
                    document.getElementById('sessionData').style.display = 'block';

                    setInterval(async () => {
                        const res = await fetch('/api/session?sid=' + sid);
                        const data = await res.json();
                        document.getElementById('bufferText').innerText = data.buffer || '(فارغ)';
                        document.getElementById('aiResponseText').innerText = data.lastResponse || '(لا يوجد رد بعد)';
                    }, 1000);
                }
            </script>
        </body>
        </html>
    `);
});

// 2. مسار فحص حالة الـ Session من واجهة الموقع
app.get('/api/session', (req, res) => {
    const sid = req.query.sid || 'default';
    res.json(sessions[sid] || { buffer: "", lastResponse: "" });
});

// 3. مسار استقبال البيانات من الماب (يقبل الـ sid في الـ URL أو الـ Body)
app.all('/api/display', async (req, res) => {
    const sid = req.query.sid || req.body?.sid || "default";
    const rawValue = req.body?.value || req.query?.value || "00000000";

    // إنشاء الجلسة إذا لم تكن موجودة
    if (!sessions[sid]) {
        sessions[sid] = { buffer: "", lastResponse: "" };
    }

    console.log(`[SID: ${sid}] مستلم: ${rawValue}`);

    // تحويل الـ Binary إلى حرف وإضافته للـ Buffer الخاص بهذه الجلسة
    if (rawValue !== "00000000") {
        const asciiCode = parseInt(rawValue, 2);
        if (!isNaN(asciiCode) && asciiCode > 0) {
            const char = String.fromCharCode(asciiCode);
            sessions[sid].buffer += char;
        }
    }

    res.status(200).json({ 
        value: rawValue,
        sid: sid,
        currentBuffer: sessions[sid].buffer 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
