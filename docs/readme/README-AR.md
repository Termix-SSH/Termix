<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>إدارة خوادم ذاتية الاستضافة، من SSH وسطح المكتب البعيد إلى الأتمتة</p>

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
  <a href="https://donate.termix.site/"><img alt="Donate" src="https://img.shields.io/badge/Donate-Support%20Termix-F39044?style=flat&labelColor=1a1a1a" /></a>
</p>

<p>
  <a href="https://donate.termix.site/"><img alt="Donations this month" src="https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=Donations%20this%20month&query=%24.fiatTotal&prefix=%24&url=https%3A%2F%2Ftermix.site%2Fdonation-snapshot.json&color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

Termix مجاني ومفتوح المصدر. إذا كان مفيدًا لك، فكّر في [التبرع](https://donate.termix.site/) للمساعدة في تغطية تكاليف الخوادم ووقت التطوير.

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

Termix منصة مجانية ومفتوحة المصدر وذاتية الاستضافة لإدارة خوادمك. تجمع في مكان واحد طرفيات SSH وأسطح المكتب البعيدة (RDP وVNC وTelnet) ونقل الملفات والأنفاق وDocker والمقاييس والأتمتة، على الويب وسطح المكتب والهاتف. إنه بديل ذاتي الاستضافة لـ Termius ويبقى مجانيًا إلى الأبد.

<br />

## الميزات

<table>
<tr>
<td width="50%" valign="top">

**طرفية SSH:**
طرفية كاملة بعلامات تبويب مثل المتصفح وتقسيم للشاشة، حتى 6 لوحات في وقت واحد. اختر السمة والخط والألوان. يوجد فوق كل جلسة شريط يعرض المعالج والذاكرة والقرص لحظيًا، مع روابط سريعة إلى ملفات ذلك المضيف وDocker والأنفاق والمقاييس.

</td>
<td width="50%" valign="top">

**سطح المكتب البعيد:**
RDP وVNC وTelnet داخل المتصفح، في علامات تبويب وشاشة مقسّمة مثل أي جلسة أخرى. يتضمن متصفح ملفات لأقراص RDP ورفعًا بالسحب والإفلات. على سطح مكتب Windows يمكنك أيضًا فتح المضيف في عميل RDP الأصلي.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**أنفاق SSH:**
إعادة توجيه محلية وبعيدة وSOCKS ديناميكية، مع إعادة اتصال تلقائية وفحوص للحالة. تُحفظ أنفاق العميل إلى الخادم في تطبيق سطح المكتب على ذلك الجهاز، ويمكنك حفظ إعدادات جاهزة على الخادم لنقل التهيئة إلى جهاز آخر.

</td>
<td width="50%" valign="top">

**مدير الملفات:**
تصفح الملفات وحرّرها وارفعها ونزّلها وأعد تسميتها وانقلها واحذفها عبر SFTP، مع دعم sudo. اعرض وحرّر الشيفرة والصور والصوت والفيديو. انسخ الملفات مباشرة من خادم إلى آخر، مع اختيار أسرع مسار تلقائيًا والتحقق من سلامة النقل.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker وPodman:**
شغّل الحاويات وأوقفها وعلّقها واحذفها، وتابع إحصاءاتها، وافتح طرفية داخل إحداها. يعمل مع Docker وPodman معًا. ليس بديلاً عن Portainer أو Dockge، بل وسيلة لإدارة الحاويات الموجودة لديك.

</td>
<td width="50%" valign="top">

**مدير المضيفات:**
احفظ مضيفاتك ونظّمها بالوسوم ومجلدات متداخلة يمكنك تسميتها وتلوينها. أعد استخدام بيانات الدخول المحفوظة عبر عدة مضيفات، وانشر مفاتيح SSH تلقائيًا، واجمع المضيفات تحت مضيف رئيسي، وحرّر وصدّر دفعة واحدة، واستخدم الاتصال السريع للاتصالات العابرة التي لا تريد حفظها.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**مقاييس المضيف:**
المعالج والذاكرة والقرص والشبكة والحرارة ومدة التشغيل والعمليات والمنافذ وتسجيلات الدخول ومعلومات النظام على معظم خوادم Linux، مع رسوم بيانية للسجل. تتيح لك بطاقات الإدارة التعامل مع الخدمات ومهام cron والحزم والمستخدمين وقواعد الجدار الناري وWireGuard وTailscale وشهادات SSL والسجلات وفحوص السلامة دون مغادرة Termix.

</td>
<td width="50%" valign="top">

**الأتمتة:**
اختر مُشغِّلًا ثم حدّد ما ينبغي أن يحدث. تشمل المشغّلات تجاوز مقياس لحد معين، أو مضيفًا يسقط أو يعود، أو تغيّر فحص السلامة، أو جدولًا زمنيًا، أو حدث حاوية، أو webhook واردًا. يمكن للخطوات تشغيل أوامر ومقتطفات، والتحكم في الحاويات والأنفاق، وإيقاظ مضيف، واستدعاء رابط، والانتظار، والتفرع حسب شرط، وتشغيل أتمتة أخرى، وإشعارك عبر ntfy أو Discord أو webhook. تتيح لك عمليات التشغيل التجريبي التجربة بأمان أولًا.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**الأساطيل:**
اجمع المضيفات في أسطول باختيارها يدويًا أو بقواعد الوسوم، لتنضم المضيفات الجديدة تلقائيًا. شغّل أمرًا واحدًا على كل المضيفات دفعة واحدة، وادفع الملفات واسحبها من جميعها، وثبّت الحزم، واجمع جردًا بنظام التشغيل والنواة والمعمارية ومدة التشغيل.

</td>
<td width="50%" valign="top">

**مساعد الذكاء الاصطناعي:**
ميزة اختيارية ومعطلة حتى تفعّلها بنفسك. اربط OpenAI أو Anthropic أو Gemini أو Ollama أو أي نقطة وصول متوافقة مع OpenAI واسأل عن إعداداتك. يمكنه قراءة المضيفات والأساطيل والمقتطفات والتنبيهات، ويقترح التغييرات لتوافق عليها بدلًا من تنفيذها بنفسه. لا يمكنه أبدًا الوصول إلى بيانات الدخول أو المستخدمين أو الإعدادات. يستطيع المسؤولون تعطيله للنظام بالكامل، ويمكنك إخفاؤه أثناء الإعداد.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**تسجيل الدخول والمستخدمون:**
حسابات محلية إضافة إلى تسجيل الدخول عبر OIDC وLDAP وGitHub وGoogle، مع التحقق بخطوتين (TOTP) ومفاتيح المرور (WebAuthn) والأجهزة الموثوقة. يستطيع المسؤولون إدارة المستخدمين وربط مجموعات OIDC بالأدوار ورؤية كل الجلسات النشطة على جميع المنصات وإلغاؤها. اربط حسابك المحلي بحساب OIDC، واطّلع على سجل التدقيق لما فعله الجميع.

</td>
<td width="50%" valign="top">

**الأدوار والمشاركة:**
أنشئ أدوارًا وشارك المضيفات مع المستخدمين أو الأدوار على أربعة مستويات: الاتصال والعرض والتحرير والإدارة. يعمل مع جميع أنواع المصادقة وجميع البروتوكولات، ويمكنك تجاوز بيانات الدخول المستخدمة لمضيف مشترك.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**التنبيهات:**
ضع قواعد على مقاييس المضيف مثل المعالج والذاكرة والقرص، وتلقَّ إشعارًا عبر ntfy أو Discord أو webhook عند تفعيلها. اطّلع على التنبيهات النشطة والمنتهية في سجل، وتجاهل ما لا يهمك منها.

</td>
<td width="50%" valign="top">

**الصفحة الرئيسية:**
شبكة عناصر تبنيها بنفسك بالسحب والإفلات. هناك عناصر لحالة المضيفات وnping وروابط الخدمات والإشارات المرجعية والبحث والساعات والتقويمات والعد التنازلي والملاحظات وRSS والطقس والصور والإطارات المضمّنة وDocker والأنفاق ورسوم المقاييس وواجهات API الخاصة بك، وحتى طرفية حية.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**المقتطفات والأدوات:**
احفظ الأوامر التي تستخدمها كثيرًا وشغّلها بنقرة واحدة، مع متغيرات للمضيف ولمدخلاتك الخاصة. شغّل أمرًا واحدًا على كل الطرفيات المفتوحة، وابحث في سجل أوامرك مع الإكمال التلقائي.

</td>
<td width="50%" valign="top">

**مشاركة الجلسة:**
شارك جلسة طرفية أو RDP أو VNC أو Telnet مباشرة. أرسل رابطًا يمكن لأي شخص الانضمام إليه دون حساب، أو شارك مع مستخدم Termix محدد، للقراءة فقط أو مع صلاحية الكتابة. يمكن أن تنتهي المشاركات تلقائيًا أو تُلغى في أي وقت، ويمكن إيقافها كليًا أو لكل مضيف على حدة.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**تسجيل الجلسات والسجلات:**
سجّل جلسات الطرفية وRDP وVNC وشاهدها لاحقًا. نزّل سجلات نصية للجلسة، واطّلع على سجل الاتصال لترى بالضبط ما جرى أثناء الاتصال.

</td>
<td width="50%" valign="top">

**الاتصالات التسلسلية:**
تواصل مع الأجهزة التسلسلية مثل الموجّهات والمبدّلات والمتحكمات الدقيقة من المتصفح أو تطبيق سطح المكتب. اضبط معدل الباود وبتات البيانات وبتات التوقف والتماثل. يستخدم واجهة Web Serial في المتصفحات المدعومة، أو خلفية أصلية في تطبيق سطح المكتب.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
اسحب الأجهزة من شبكة tailnet لإضافتها كمضيفات ببضع نقرات، واتصل عبر Tailscale SSH لتتولى قوائم صلاحيات tailnet أمر الوصول دون تخزين بيانات دخول. يعمل أيضًا مع Headscale ونقاط الوصول المخصصة.

</td>
<td width="50%" valign="top">

**Proxmox:**
استورد المضيفات مباشرة من نسخة Proxmox، وتابع إحصاءات العقد والأنظمة الضيفة، بما فيها المعالج والذاكرة والتخزين، في تبويب خاص بها.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**مساحات العمل وعلامات التبويب:**
احفظ مجموعة من علامات التبويب بتقسيمها، وأعد فتحها كلها بنقرة واحدة. يتذكر Termix أيضًا جلستك الأخيرة، فتعود علامات التبويب بعد التحديث وعلى الأجهزة الأخرى.

</td>
<td width="50%" valign="top">

**إعداد موجَّه:**
إعداد قصير يرشدك إلى اختيار نمط الواجهة والسمة والميزات التي تريدها وأول مضيف لك. يخفي الوضع البسيط ما لا تستخدمه، ويمكنك إعادة الإعداد أو تغيير النمط في أي وقت.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**تطبيق سطح المكتب المستقل والمزامنة:**
يعمل تطبيق سطح المكتب بمفرده بخلفية وقاعدة بيانات محلية، دون حاجة إلى خادم. يمكنك أيضًا ربطه بخادم Termix لمزامنة المضيفات وبيانات الدخول والمقتطفات وغيرها في الاتجاهين، واختيار ما إذا كانت الاتصالات تبدأ من جهازك أم عبر الخادم.

</td>
<td width="50%" valign="top">

**سطر الأوامر:**
أداة `termix` لسطر الأوامر تعمل في الطرفية وفي سكربتاتك. افتح الطرفيات، ونفّذ أمرًا على مضيف واحد أو على أسطول كامل، وانقل الملفات عبر SFTP، وأدر المضيفات والمقتطفات وبيانات الدخول. ثبّتها عبر `npm install -g @termix-cli/cli` أو استخدم ملفًا تنفيذيًا مستقلًا. راجع [وثائق سطر الأوامر](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**الأمان:**
تُشفَّر كلمات المرور والمفاتيح والأسرار الأخرى لكل مستخدم على حدة، ويمكن تشفير ملفات قاعدة البيانات نفسها على القرص. راجع [الوثائق](https://docs.termix.site/security) لمعرفة آلية العمل.

</td>
<td width="50%" valign="top">

**اللغات:**
نحو 30 لغة مدمجة، تُدار عبر [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details dir="rtl">
<summary><b>ميزات أخرى</b></summary>
<br />

- **لوحة المعلومات** - خوادمك في لمحة واحدة، ببطاقات ترتّبها بنفسك
- **رسم الشبكة** - مختبرك المنزلي مرسومًا انطلاقًا من مضيفاتك، مع الحالة لحظيًا
- **مراقب tmux** - تصفح جلسات tmux ونوافذه ولوحاته، مع معاينة وبحث
- **مفاتيح API** - مفاتيح خاصة بكل مستخدم لها تاريخ انتهاء، للسكربتات وأنظمة CI
- **التصدير والاستيراد** - انقل المضيفات وبيانات الدخول وبيانات مدير الملفات إلى الداخل والخارج
- **SSL تلقائي** - تُنشأ الشهادات وتُجدَّد نيابة عنك، مع إعادة التوجيه إلى HTTPS، أو استخدم شهاداتك الخاصة
- **قواعد البيانات** - SQLite افتراضيًا، مع دعم PostgreSQL وMySQL أيضًا
- **واجهة حديثة** - واجهة React أنيقة تعمل على سطح المكتب والهاتف، بسمات مثل الفاتح والداكن وDracula. يمكن فتح أي اتصال بملء الشاشة من رابط
- **لوحة الأوامر** - اضغط مفتاح Shift الأيسر مرتين للانتقال إلى مضيف من لوحة المفاتيح
- **اختصارات لوحة المفاتيح** - التنقل بين علامات التبويب وإغلاقها وغير ذلك، وكلها قابلة لإعادة التعيين
- **Wake-on-LAN** - أيقظ جهازًا من Termix أو من خطوة في الأتمتة
- **مصادقة الوكيل الموثوق** - دع وكيلًا عكسيًا يتولى تسجيل الدخول ويمرّر المستخدم
- **SSH بإمكانات واسعة** - مضيفات وسيطة وWarpgate وطلبات TOTP وSOCKS5 والتحقق من مفاتيح المضيف والتعبئة التلقائية لكلمات المرور و[OPKSSH](https://github.com/openpubkey/opkssh) وtmux وport knocking وسجلات الطرفية وتمرير الوكيل ووكيل SSH من Bitwarden وتوقيع SSH عبر HashiCorp Vault وغيرها
- **Termix ID** - نسخة مدمجة على غرار sshid.io. احجز معرّفًا، وانشر مفاتيحك العامة على رابط محلِّل، وأصدر شهادات SSH من سلطة التصديق المدمجة

</details>

<br />

## المنصات المدعومة

<table align="center">
<tr>
<th align="center">المنصة</th>
<th align="center">طريقة التوزيع</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>أي متصفح حديث (Chrome وSafari وFirefox) · يدعم PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>نسخة محمولة · مثبّت MSI · Chocolatey</td>
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

راجع [وثائق Termix](https://docs.termix.site/install) للاطلاع على تعليمات التثبيت الكاملة لجميع المنصات.

مثال على ملف Docker Compose (يمكنك حذف `guacd` والشبكة إذا كنت لا تنوي استخدام سطح المكتب البعيد):

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

### سطر الأوامر

يوفر Termix أيضًا أداة سطر أوامر، لتدير خوادمك من الطرفية وتستخدم Termix داخل سكربتاتك.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

تستطيع فتح الطرفيات، وتنفيذ أمر على مضيف واحد أو على أسطول كامل، ونقل الملفات عبر SFTP، وإدارة المضيفات والمقتطفات وبيانات الدخول. الوثائق الكاملة على [docs.termix.site/cli](https://docs.termix.site/cli).

### الاستضافة السحابية

يمكنك تشغيل خادم Termix على VPS بدلًا من داخل شبكتك. إذا كان Termix يعمل داخل الشبكة التي يديرها، فأي عطل سيأخذه معه، تحديدًا حين تحتاج إليه لإصلاح الأمور. تشغيله في الخارج يبقيه متاحًا، ويمنحك عنوان IP ثابتًا، ويتيح لك الدخول من أي مكان دون VPN أو فتح منافذ.

ترعى [GINERNET](https://docs.termix.site/install/ginernet) مشروع Termix، وتتضمن الوثائق دليلًا خطوة بخطوة للنشر على منصة الخوادم الافتراضية الخاصة بهم.

<br />

## بيانات الاستخدام

يرسل Termix إشارة صغيرة مجهولة مرة واحدة يوميًا، لأعرف عدد النسخ العاملة والميزات المستخدمة فعلًا. تحتوي على معرّف عشوائي للنسخة، وعدد المستخدمين والمضيفات لديك، وإصدار التطبيق، والميزات التي استُخدمت خلال آخر 24 ساعة (الطرفية ومدير الملفات والأنفاق وdocker وغيرها). ولا تحتوي أبدًا على أسماء مستخدمين أو أسماء مضيفات أو عناوين IP أو بيانات دخول أو أي شيء يعرّف بك أو بخوادمك.

وهي مفعّلة افتراضيًا. يمكنك إيقافها من إعدادات المسؤول ضمن قسم عام، أو ضبط `ENABLE_TELEMETRY=false` قبل تشغيل Termix أصلًا.

<br />

## التبرع

Termix مجاني ومفتوح المصدر، بلا اشتراكات ولا خطط مدفوعة. إذا كان مفيدًا لك، فكّر في التبرع للمساعدة في تغطية الخوادم والنطاقات ووقت التطوير. تموّل التبرعات أيضًا وقت البحث والتعلّم اللازم لبناء ميزات مثل SAML وKubernetes ودعم الوكلاء. تابع التقدم وتبرع من الرابط أدناه.

[تبرّع](https://donate.termix.site/)

<br />

## الرعاة

هل تهتم بمساحة إعلانية مدفوعة لدعم التطوير؟ راسلنا على [mail@termix.site](mailto:mail@termix.site).

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
<a href="https://akamai.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="40" alt="AWS" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://rackgenius.com/">
  <img src="https://rackgenius.com/rackgenius-logo.png" height="40" alt="Rack Genius" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://ginernet.com/">
  <img src="https://ginernet.com/img/logo-web.png" height="40" alt="Ginernet" />
</a>
</div>

<br />

## الدعم

تحتاج مساعدة أو تريد طلب ميزة؟ افتح [مشكلة جديدة](https://github.com/Termix-SSH/Support/issues) واذكر أكبر قدر ممكن من التفاصيل، بالإنجليزية إن أمكن. يمكنك أيضًا السؤال في قناة الدعم على [Discord](https://discord.gg/jVQGdvHDrf)، وإن كانت الردود هناك قد تتأخر.

<br />

## لقطات الشاشة

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>شاهد عروض التحديثات على YouTube</sub>

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
<tr>
<td><img src="../repo-images/Image 15.png" alt="Termix Screenshot 15" width="400" /></td>
<td><img src="../repo-images/Image 16.png" alt="Termix Screenshot 16" width="400" /></td>
</tr>
</table>

<sub>قد تكون بعض المقاطع والصور قديمة أو لا تعرض الميزات على أفضل وجه.</sub>

</div>

<br />

## الميزات المخططة

جميع الميزات المخططة موجودة في [Projects](https://github.com/orgs/Termix-SSH/projects/5). إذا أردت المساهمة، راجع [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## الترخيص

يوزَّع بموجب ترخيص Apache الإصدار 2.0. راجع ملف `LICENSE` لمزيد من المعلومات.
