const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// أدخل مفتاح Gemini API الخاص بك هنا
const genAI = new GoogleGenerativeAI('AQ.Ab8RN6LyDk6FsyWOYbD6Y0MDEq5h-86AWVPdzAkWsanlHDh9nw');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// نص مؤقت لتخزينه وعرضه على القطعة
let currentOutput = "HELLO"; 

// تحويل الحروف إلى ASCII Decimal ثم إلى Binary (8-bit) ليفهمها الهاردوير
function textTo8BitBinary(text) {
    if (!text || text.length === 0) return "00000000";
    const charCode = text.charCodeAt(0); // يأخذ أول حرف
    return charCode.toString(2).padStart(8, '0');
}

// الـ Endpoint الذي ستطلبه قطعة الـ HTTP في الماب
app.all('/api/display', async (req, res) => {
    // إذا أرسلت القطعة سؤالاً جديداً عبر الـ Query أو Body
    const prompt = req.query.prompt || req.body.prompt;

    if (prompt) {
        try {
            const result = await model.generateContent(prompt);
            currentOutput = result.response.text().trim();
        } catch (error) {
            console.error("Error:", error);
        }
    }

    // إرجاع النتيجة بالصيغة المطلوب إرسالها للقطعة {"value":"00000000"}
    const binaryValue = textTo8BitBinary(currentOutput);
    res.json({ value: binaryValue });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));