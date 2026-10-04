const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiKey = process.env.GEMINI_API_KEY;

const session = { buffer: "", lastResponse: "", outputQueue: [] };

// حساب الرقم المباشر للمنافذ (1, 2, 4, 8, 16, 32)
function getCharacterValue(char) {
    let code = char.charCodeAt(0);
    let shift = 0;

    if (char >= 'A' && char <= 'Z') {
        shift = 1;
        code = char.toLowerCase().charCodeAt(0);
    }

    let val = 0;
    if (code >= 97 && code <= 122) { // a-z -> 1-26
        val = code - 96;
    } else if (code >= 48 && code <= 57) { // 0-9
        val = code - 48 + 27;
    }

    return { value: val, shift: shift };
}

app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>Build Logic Simple Monitor</title>
            <style>
                body { font-family: system-ui, sans-serif; text-align: center; background: #0f172a; color: #f8fafc; padding: 30px; }
                button { padding: 12px 20px; font-size: 16px; border-radius: 6px; border: none; background: #059669; color: white; cursor: pointer; font-weight: bold; }
                .card { background: #1e293b; max-width: 500px; margin: 20px auto; padding: 20px; border-radius: 12px; border: 1px solid #334155; }
                .code-box { background: #020617; padding: 15px; border-radius: 8px; font-family: monospace; color: #38bdf8; min-height: 30px; font-size: 18px; margin: 10px 0; }
            </style>
        </head>
        <body>
            <h1>🚀 Build Logic Simple Monitor</h1>
            <div class="card">
                <p>النص المرسل من الماب:</p>
                <div class="code-box" id="bufferText">-</div>
                <button onclick="askGemini()">🤖 إرسال إلى Gemini وطباعة الرد</button>
                <hr style="border-color: #334155; margin-top: 20px;" />
                <p>رد Gemini الجاري طباعته:</p>
                <div class="code-box" id="aiResponseText" style="color: #4ade80;">-</div>
                <p>الحروف المتبقية: <b id="remainingChars">0</b></p>
            </div>

            <script>
                async function updateView() {
                    try {
                        const res = await fetch('/api/session');
                        const data = await res.json();
                        document.getElementById('bufferText').innerText = data.buffer || '(فارغ)';
                        document.getElementById('aiResponseText').innerText = data.lastResponse || '(لا يوجد)';
                        document.getElementById('remainingChars').innerText = data.remaining || '0';
                    } catch(e){}
                }

                async function askGemini() {
                    document.getElementById('aiResponseText').innerText = 'جاري التفكير... ⏳';
                    const res = await fetch('/api/ask');
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

app.get('/api/session', (req, res) => {
    res.json({ buffer: session.buffer, lastResponse: session.lastResponse, remaining: session.outputQueue.length });
});

app.get('/api/ask', async (req, res) => {
    if (!session.buffer.trim()) {
        return res.json({ response: "الـ Buffer فارغ! اكتب نصاً في الماب أولاً." });
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const prompt = `Answer in short English text (max 12 letters, no symbols): ${session.buffer}`;
        const result = await model.generateContent(prompt);
        const reply = result.response.text().trim().replace(/[^a-zA-Z0-9 ]/g, '');

        session.lastResponse = reply;
        session.outputQueue = reply.split('');
        
        res.json({ response: reply });
    } catch (err) {
        res.json({ response: "خطأ: " + err.message });
    }
});

app.all('/api/display', (req, res) => {
    let rawValue = req.body?.value || req.query?.value || req.body?.data || "0";
    let char = "";
    
    if (!isNaN(rawValue) && Number(rawValue) > 0) {
        char = String.fromCharCode(Number(rawValue));
    }

    if (char && char !== "\0") {
        session.buffer += char;
    }

    let charVal = 0;
    let shiftVal = 0;

    if (session.outputQueue && session.outputQueue.length > 0) {
        const nextChar = session.outputQueue.shift();
        const data = getCharacterValue(nextChar);
        charVal = data.value;
        shiftVal = data.shift;
    }

    // إرجاع قيمة رقمية صريحة
    res.status(200).json({ 
        value: charVal,
        shift: shiftVal,
        remaining: session.outputQueue.length
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
