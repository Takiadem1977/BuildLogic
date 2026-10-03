const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// تمكين قراءة البيانات القادمة من الماب
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// قراءة مفتاح الـ API المفتاح المضاف في Render
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// 1. الصفحة الرئيسية
app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>Build Logic AI Server</title>
        </head>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f4f4f9;">
            <h1 style="color: #2c3e50;">🚀 Roblox Build Logic AI Server is Running!</h1>
            <p style="font-size: 18px; color: #555;">API Endpoint: <code>/api/display</code></p>
        </body>
        </html>
    `);
});

// 2. مسار التعامل مع قطعة الـ HTTP والـ الذكاء الاصطناعي
app.all('/api/display', async (req, res) => {
    try {
        // استخراج القيمة القادمة من الماب
        const rawValue = req.body?.value || req.query?.value || "00000000";

        console.log("البيانات المستلمة من الماب:", rawValue);

        // إذا كانت هناك إشارة قادمة من الماب، نطلب من Gemini إجابة قصيرة
        if (rawValue !== "00000000") {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const prompt = "Say Hello in one binary 8-bit character code style"; 
            
            const result = await model.generateContent(prompt);
            console.log("رد Gemini:", result.response.text());
        }

        // إرجاع الاستجابة بتنسيق JSON المحدد للقطعة
        res.status(200).json({ value: rawValue });
    } catch (error) {
        console.error("حدث خطأ في السيرفر:", error);
        res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});