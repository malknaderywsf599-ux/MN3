# WebLinux (v86)

Linux حقيقي بيشتغل جوه المتصفح عن طريق محاكي v86.

## الملفات
- `index.html` الصفحة
- `style.css` الشكل
- `js/config.js` روابط وإعدادات (عدّلها هنا)
- `js/keys.js` شريط الأزرار (ESC, TAB, CTRL, أسهم...)
- `js/main.js` تشغيل المحاكي وربطه بالتيرمينال

## لازم تضيف صورة Linux
1. اعمل فولدر `images/` جنب `index.html`.
2. نزّل ملف `buildroot-bzimage.bin` (من موقع copy.sh/v86 الرسمي، قسم الصور/images) وحطه جواه.
3. لو اسمه مختلف، غيّر `bzimage` في `js/config.js`.

بعد كده ارفع كل حاجة على GitHub Pages وافتح الصفحة.
