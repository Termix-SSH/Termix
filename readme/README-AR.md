<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>إدارة SSH ذاتية الاستضافة والوصول إلى سطح المكتب البعيد</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  العربية ·
  <a href="README-HI.md">हिन्दी</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-VI.md">Tiếng Việt</a> ·
  <a href="README-IT.md">Italiano</a>
</p>

<p>
  <img src="https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release&color=F39044&labelColor=1a1a1a&v=1" />
  <a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720?color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>تم تحقيقه في 1 سبتمبر 2025</sub>
</p>

</div>

<br />

## نظرة عامة

Termix هي منصة مفتوحة المصدر ومجانية للأبد وذاتية الاستضافة لإدارة الخوادم بشكل شامل. توفر حلاً متعدد المنصات لإدارة خوادمك وبنيتك التحتية من خلال واجهة واحدة وسهلة الاستخدام. يوفر Termix الوصول إلى طرفية SSH، والتحكم في سطح المكتب البعيد (RDP، VNC، Telnet)، وقدرات إنشاء أنفاق SSH، وإدارة ملفات SSH عن بُعد، والعديد من الأدوات الأخرى. يُعد Termix البديل المثالي المجاني وذاتي الاستضافة لـ Termius المتاح لجميع المنصات.

<br />

## الميزات

<table>
<tr>
<td width="50%" valign="top">

**الوصول إلى طرفية SSH:**
طرفية كاملة الميزات مع دعم تقسيم الشاشة (حتى 4 لوحات) مع نظام علامات تبويب شبيه بالمتصفح. يتضمن دعم تخصيص الطرفية بما في ذلك سمات الطرفية الشائعة والخطوط والمكونات الأخرى.

</td>
<td width="50%" valign="top">

**الوصول إلى سطح المكتب البعيد:**
دعم RDP و VNC و Telnet عبر المتصفح مع تخصيص كامل وتقسيم الشاشة.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**إدارة أنفاق SSH:**
إنشاء وإدارة أنفاق SSH بين الخوادم مع إعادة الاتصال التلقائي ومراقبة الحالة وإعادة التوجيه المحلي أو البعيد أو SOCKS الديناميكي. يتم تخزين إعدادات نفق العميل-المكتبي إلى السيرفر محلياً لكل تثبيت مكتبي؛ يمكن حفظ لقطات C2S الاختيارية على الخادم وإعادة تسميتها وتحميلها أو حذفها لنقل تكوين النفق المحلي بين العملاء.

</td>
<td width="50%" valign="top">

**مدير الملفات عن بُعد:**
إدارة الملفات مباشرة على الخوادم البعيدة مع دعم عرض وتحرير الكود والصور والصوت والفيديو. رفع وتنزيل وإعادة تسمية وحذف ونقل الملفات بسلاسة مع دعم sudo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**إدارة Docker:**
تشغيل وإيقاف وتعليق وحذف الحاويات. عرض إحصائيات الحاويات. التحكم في الحاوية باستخدام طرفية docker exec. لم يُصمم ليحل محل Portainer أو Dockge بل لإدارة حاوياتك ببساطة مقارنة بإنشائها.

</td>
<td width="50%" valign="top">

**مدير مضيفات SSH:**
حفظ وتنظيم وإدارة اتصالات SSH الخاصة بك باستخدام العلامات والمجلدات (مع دعم تخصيص المجلدات والمجلدات المتداخلة)، وحفظ بيانات تسجيل الدخول القابلة لإعادة الاستخدام بسهولة مع إمكانية أتمتة نشر مفاتيح SSH.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**مقاييس المضيف:**
عرض استخدام المعالج والذاكرة والقرص والشبكة ووقت التشغيل ومعلومات النظام وجدار الحماية ومراقب المنافذ وعارض السجلات والمستخدمين/الصلاحيات والشهادات وغيرها الكثير، تعمل على معظم الخوادم المبنية على Linux.

</td>
<td width="50%" valign="top">

**مصادقة المستخدمين:**
إدارة آمنة للمستخدمين مع ضوابط إدارية ودعم OIDC/LDAP/SSO (مع التحكم في الوصول) و 2FA (TOTP). عرض جلسات المستخدمين النشطة عبر جميع المنصات وإلغاء الصلاحيات. ربط حسابات OIDC/المحلية معاً. عرض سجل تدقيق لجميع إجراءات المستخدمين.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
إنشاء الأدوار ومشاركة المضيفات عبر المستخدمين/الأدوار.

</td>
<td width="50%" valign="top">

**تشفير قاعدة البيانات:**
يُخزَّن الخادم الخلفي كملفات قاعدة بيانات SQLite مشفرة. اطلع على [الوثائق](https://docs.termix.site/security) لمزيد من المعلومات.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**الرسم البياني للشبكة:**
تخصيص لوحة التحكم لتصور مختبرك المنزلي بناءً على اتصالات SSH مع دعم الحالة.

</td>
<td width="50%" valign="top">

**أدوات SSH:**
إنشاء مقتطفات أوامر قابلة لإعادة الاستخدام تُنفَّذ بنقرة واحدة. تشغيل أمر واحد في وقت واحد عبر عدة طرفيات مفتوحة.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**علامات التبويب الدائمة:**
تبقى جلسات SSH وعلامات التبويب مفتوحة عبر الأجهزة/التحديثات إذا تم تفعيلها في ملف تعريف المستخدم.

</td>
<td width="50%" valign="top">

**اللغات:**
دعم مدمج لحوالي 30 لغة (تُدار بواسطة [Crowdin](https://docs.termix.site/translations)).

</td>
</tr>
</table>

<br />

<details>
<summary><b>المزيد من الميزات</b></summary>
<br />

- **لوحة التحكم** - عرض معلومات الخادم بنظرة واحدة على لوحة التحكم
- **مفاتيح API** - إنشاء مفاتيح API محددة النطاق للمستخدم مع تواريخ انتهاء صلاحية للاستخدام في الأتمتة/CI
- **تصدير/استيراد البيانات** - تصدير واستيراد مضيفات SSH وبيانات الاعتماد وبيانات مدير الملفات
- **إعداد SSL تلقائي** - إنشاء وإدارة شهادات SSL مدمجة مع إعادة التوجيه إلى HTTPS
- **واجهة مستخدم حديثة** - واجهة نظيفة متوافقة مع سطح المكتب والهاتف المحمول مبنية بـ React و Tailwind CSS و Shadcn. الاختيار بين العديد من سمات واجهة المستخدم بما في ذلك الفاتح والداكن و Dracula وغيرها. استخدام مسارات URL لفتح أي اتصال في وضع ملء الشاشة.
- **سجل الأوامر** - الإكمال التلقائي وعرض أوامر SSH التي تم تنفيذها سابقاً
- **الاتصال السريع** - الاتصال بخادم دون الحاجة إلى حفظ بيانات الاتصال
- **لوحة الأوامر** - اضغط مرتين على Shift الأيسر للوصول السريع إلى اتصالات SSH باستخدام لوحة المفاتيح
- **تكامل Proxmox** - إضافة المضيفات تلقائياً إلى Termix من نسخة Proxmox الخاصة بك
- **ميزات SSH الغنية** - دعم مضيفات القفز، Warpgate، الاتصالات المبنية على TOTP، SOCKS5، التحقق من مفتاح المضيف، الملء التلقائي لكلمة المرور، [OPKSSH](https://github.com/openpubkey/opkssh)، tmux، port knocking، تسجيل الطرفية، إلخ.

</details>

<br />

## دعم المنصات

<table align="center">
<tr>
<th align="center">المنصة</th>
<th align="center">التوزيع</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>أي متصفح حديث (Chrome، Safari، Firefox) · دعم PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>نسخة محمولة · مثبت MSI · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>نسخة محمولة · AUR · AppImage · Deb · Flatpak</td>
</tr>
<tr>
<td align="center"><b>macOS</b> <sub>x64/ia32, v12.0+</sub></td>
<td>Apple App Store · DMG · Homebrew</td>
</tr>
<tr>
<td align="center"><b>iOS/iPadOS</b> <sub>v15.1+</sub></td>
<td>Apple App Store · IPA</td>
</tr>
<tr>
<td align="center"><b>Android</b> <sub>v7.0+</sub></td>
<td>Google Play Store · APK</td>
</tr>
</table>

<br />

## التثبيت

قم بزيارة [وثائق](https://docs.termix.site/install) Termix للحصول على مزيد من المعلومات حول كيفية تثبيت Termix على جميع المنصات. يمكنك الاطلاع على نموذج ملف Docker Compose هنا (يمكنك حذف guacd والشبكة إذا كنت لا تخطط لاستخدام ميزات سطح المكتب البعيد):

```yaml
services:
  termix:
    image: ghcr.io/lukegus/termix:latest
    container_name: termix
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - termix-data:/app/data
    environment:
      PORT: "8080"
    depends_on:
      - guacd
    networks:
      - termix-net

  guacd:
    image: guacamole/guacd:1.6.0
    container_name: guacd
    restart: unless-stopped
    ports:
      - "4822:4822"
    networks:
      - termix-net

volumes:
  termix-data:
    driver: local

networks:
  termix-net:
    driver: bridge
```

<br />

## لقطات الشاشة

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>شاهد نظرة عامة على التحديثات على YouTube</sub>

<br />
<br />

<table>
<tr>
<td><img src="../repo-images/Image 1.png" alt="Termix Screenshot 1" width="400" /></td>
<td><img src="../repo-images/Image 2.png" alt="Termix Screenshot 2" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 3.png" alt="Termix Screenshot 3" width="400" /></td>
<td><img src="../repo-images/Image 4.png" alt="Termix Screenshot 4" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 5.png" alt="Termix Screenshot 5" width="400" /></td>
<td><img src="../repo-images/Image 6.png" alt="Termix Screenshot 6" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 7.png" alt="Termix Screenshot 7" width="400" /></td>
<td><img src="../repo-images/Image 8.png" alt="Termix Screenshot 8" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 9.png" alt="Termix Screenshot 9" width="400" /></td>
<td><img src="../repo-images/Image 10.png" alt="Termix Screenshot 10" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 11.png" alt="Termix Screenshot 11" width="400" /></td>
<td><img src="../repo-images/Image 12.png" alt="Termix Screenshot 12" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 13.png" alt="Termix Screenshot 13" width="400" /></td>
<td><img src="../repo-images/Image 14.png" alt="Termix Screenshot 14" width="400" /></td>
</tr>
</table>

<sub>قد تكون بعض مقاطع الفيديو والصور قديمة أو قد لا تعرض الميزات بشكل مثالي.</sub>

</div>

<br />

## الميزات المخططة

راجع [المشاريع](https://github.com/orgs/Termix-SSH/projects/2) لعرض جميع الميزات المخططة. إذا كنت تتطلع للمساهمة، راجع [المساهمة](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## الرعاة

<div align="center">

<br />

<a href="https://www.digitalocean.com/">
  <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" height="40" alt="DigitalOcean" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://crowdin.com/">
  <img src="https://support.crowdin.com/assets/logos/core-logo/svg/crowdin-core-logo-cDark.svg" height="40" alt="Crowdin" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.blacksmith.sh/">
  <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://sirv.sirv.com/website/screenshots/cloudflare/cloudflare-logo.png?w=300" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://tailscale.com/">
  <img src="https://drive.google.com/uc?export=view&id=1lIxkJuX6M23bW-2FElhT0rQieTrzaVSL" height="40" alt="Tailscale" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="40" alt="AWS" />
</a>

</div>

<br />

## الدعم

إذا كنت بحاجة إلى مساعدة أو ترغب في طلب ميزة لـ Termix، قم بزيارة صفحة [المشكلات](https://github.com/Termix-SSH/Support/issues)، وسجل الدخول، واضغط على `New Issue`. يرجى أن تكون مفصلاً قدر الإمكان في مشكلتك، ويُفضَّل كتابتها باللغة الإنجليزية. يمكنك أيضاً الانضمام إلى خادم [Discord](https://discord.gg/jVQGdvHDrf) وزيارة قناة الدعم، ومع ذلك قد تكون أوقات الاستجابة أطول.

<br />

## الترخيص

موزع بموجب رخصة Apache License الإصدار 2.0. راجع ملف `LICENSE` لمزيد من المعلومات.
