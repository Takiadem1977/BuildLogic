const express = require('express');
const app = express();

// تمكين قراءة البيانات القادمة بصيغة JSON أو URL-Encoded من روبلوكس
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. الصفحة الرئيسية (تأكيد عمل السيرفر)
app.get('/', (req, res) => {
    res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Build Logic AI Server</title></head>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
            <h1>🚀 Roblox Build Logic AI Server is Running!</h1>
            <p>API Endpoint: <code>/api/display</code></p>
        </body>
        </html>
    `);
});

// 2. مسار التعامل مع قطعة HTTP في الماب (GET & POST)
app.all('/api/display', async (req, res) => {
    try {
        // استخراج القيمة سواء كانت قادمة من POST body أو GET query
        const rawValue = req.body?.value || req.query?.value || "00000000";

        console.log("البيانات المستلمة من الماب:", rawValue);

        // إرجاع الاستجابة بتنسيق JSON المناسب لقطعة الـ HTTP
        res.status(200).json({ value: rawValue });
    } catch (error) {
        console.error("حدث خطأ في السيرفر:", error);
        res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
});

// تشغيل السيرفر على المنفذ المحدد من Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});