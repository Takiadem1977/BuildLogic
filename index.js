const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiKey = process.env.GEMINI_API_KEY;

const session = { buffer: "", lastResponse: "", outputQueue: [] };

// دالة حساب البتات الـ 6 بالضبط لقيم الحروف (a=1, b=2, c=3, d=4, g=7...)
function getCharacterData(char) {
    let code = char.charCodeAt(0);
    let shift = 0;

    // تفعيل الـ SHIFT للحروف الكبيرة
    if (char >= 'A' && char <= 'Z') {
        shift = 1;
        code = char.toLowerCase().charCodeAt(0);
    }

    let val = 0;
    if (code >= 97 && code <= 122) { // a-z -> 1 إلى 26
        val = code - 96;
    } else if (code >= 48 && code <= 57) { // 0-9 -> 27 إلى 36
        val = code - 48 + 27;
    } else if (char === ' ') {
        val = 0;
    }

    // بناء سلسلة ثنائية من 6 بتات فقط (Bit0 أقصى اليمين -> Bit5 أقصى اليسار)
    // Bit 0 = a (1)
    // Bit 1 = b (2)
    // Bit 2 = d (4)
    // Bit 3 = h (8)
    // Bit 4 = p (16)
    // Bit 5 = 32
    let b0 = (val & 1) ? "1" : "0";
    let b1 = (val & 2) ? "1" : "0";
    let b2 = (val & 4) ? "1" : "0";
    let b3 = (val & 8) ? "1" : "0";
    let b4 = (val & 16) ? "1" : "0";
    let b5 = (val & 32) ? "1" : "0";

    // تجميع البتات الـ 6 فقط (6-bit string)
    const bits6 = b5 + b4 + b3 + b2 + b1 + b0;

    return { bits: bits6, shift: shift, rawVal: val };
}

app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>Build Logic 6-Bit Terminal</title>
            <style>
                body { font-family: system-ui, sans-serif; text-align: center; background: #0f172a; color: #f8fafc; padding: 30px; }
                button { padding: 12px 20px; font-size: 16px; border-radius: 6px; border: none; background: #059669; color: white; cursor: pointer; font-weight: bold; margin-top: 10px; }
                button:hover { background: #047857; }
                .card { background: #1e293b; max-width: 520px; margin: 20px auto; padding: 20px; border-radius: 12px; border: 1px solid #334155; }
                .code-box { background: #020617; padding: 15px; border-radius: 8px; font-family: monospace; color: #38bdf8; min-height: 30px; font-size: 18px; margin: 10px 0; word-break: break-all; }
                .log-box { background: #020617; padding: 10px; border-radius: 6px; font-family: monospace; color: #facc15; font-size: 13px; max-height: 150px; overflow-y: auto; text-align: left; }
            </style>
        </head>
        <body>
            <h1>🚀 Build Logic 6-Bit Terminal</h1>
            <div class="card">
                <p>النص المرسل من الماب (Buffer):</p>
                <div class="code-box" id="bufferText">-</div>
                <button onclick="askGemini()">🤖 إرسال إلى Gemini وطباعة الرد</button>
                <hr style="border-color: #334155; margin-top: 20px;" />
                <p>رد Gemini الجاري طباعته:</p>
                <div class="code-box" id="aiResponseText" style="color: #4ade80;">-</div>
                <p>الحروف المتبقية للطباعة: <b id="remainingChars">0</b></p>
                <hr style="border-color: #334155; margin-top: 20px;" />
                <p>سجل البيانات المباشر (Server Logs):</p>
                <div class="log-box" id="logs">-</div>
            </div>

            <script>
                async function updateView() {
                    try {
                        const res = await fetch('/api/session');
                        const data = await res.json();
                        document.getElementById('bufferText').innerText = data.buffer || '(فارغ)';
                        document.getElementById('aiResponseText').innerText = data.lastResponse || '(لا يوجد)';
                        document.getElementById('remainingChars').innerText = data.remaining || '0';
                        if(data.lastLog) {
                            document.getElementById('logs').innerText = data.lastLog;
                        }
                    } catch(e){}
                }

                async function askGemini() {
                    document.getElementById('aiResponseText').innerText = 'جاري التفكير والتوليد... ⏳';
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

let lastLogMessage = "السيرفر يعمّل وجاهز لتقديم البيانات.";

app.get('/api/session', (req, res) => {
    res.json({ 
        buffer: session.buffer, 
        lastResponse: session.lastResponse, 
        remaining: session.outputQueue.length,
        lastLog: lastLogMessage
    });
});

app.get('/api/ask', async (req, res) => {
    if (!session.buffer.trim()) {
        return res.json({ response: "الـ Buffer فارغ! قم بالكتابة من الكيبورد في الماب أولاً." });
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const prompt = `Answer in short simple English (max 10 characters, letters/numbers only): ${session.buffer}`;
        const result = await model.generateContent(prompt);
        const reply = result.response.text().trim().replace(/[^a-zA-Z0-9 ]/g, '');

        session.lastResponse = reply;
        session.outputQueue = reply.split('');
        
        lastLogMessage = `[Gemini Reply Received]: "${reply}" | QLen: ${session.outputQueue.length}`;
        console.log(lastLogMessage);

        res.json({ response: reply });
    } catch (err) {
        lastLogMessage = "Gemini Error: " + err.message;
        console.error(lastLogMessage);
        res.json({ response: "خطأ: " + err.message });
    }
});

app.all('/api/display', (req, res) => {
    // 1. استقبال الحرف المكتوب من الكيبورد في الماب
    let rawValue = req.body?.value || req.query?.value || req.body?.data || "0";
    let char = "";
    
    if (!isNaN(rawValue) && Number(rawValue) > 0) {
        char = String.fromCharCode(Number(rawValue));
    }

    if (char && char !== "\0") {
        session.buffer += char;
    }

    // 2. إرجاع الـ 6 أصفار والـ shift
    let sendBits = "000000"; // 6 أصفار بالضبط
    let shiftVal = 0;
    let currentChar = "";

    if (session.outputQueue && session.outputQueue.length > 0) {
        currentChar = session.outputQueue.shift();
        const data = getCharacterData(currentChar);
        sendBits = data.bits;
        shiftVal = data.shift;

        lastLogMessage = `[PRINTING]: Char '${currentChar}' | 6-Bits: [${sendBits}] | Shift: ${shiftVal} | Rem: ${session.outputQueue.length}`;
        console.log(lastLogMessage);
    }

    // إرجاع JSON بـ 6 بتات فقط
    res.status(200).json({ 
        value: sendBits,
        shift: shiftVal,
        remaining: session.outputQueue.length
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
