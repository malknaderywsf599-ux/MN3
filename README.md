# AI محلي بدون API

مشروع ويب بيشغّل نماذج ذكاء اصطناعي مفتوحة المصدر جوه المتصفح نفسه (wllama / llama.cpp)، وفيه راوتر بيختار النموذج المناسب تلقائيًا ويبدّل بينهم.

## الرفع على GitHub Pages (من تليفونك)
1. افتح github.com من المتصفح واعمل Repository جديد (Public).
2. ارفع الملفات: `index.html` و `app.js` و `README.md` (Add file > Upload files).
3. Settings > Pages > Source: `Deploy from a branch` > Branch: `main` / root > Save.
4. بعد دقيقة افتح الرابط: `https://USERNAME.github.io/REPO/`

## ملاحظات
- أول مرة كل نموذج بينزل من Hugging Face (300MB–1.1GB) وبعدها بيتخزن في المتصفح. استخدم واي فاي.
- نموذج واحد بس بيشتغل في المرة عشان الذاكرة (4GB RAM).
- لو ظهر خطأ في التحميل، غيّر رقم نسخة wllama في أول `app.js`.
- التصنيف في دالة `classify`، والنماذج وترتيب البدائل في `MODELS` و `CHAINS`، تقدر تعدلهم بسهولة.
