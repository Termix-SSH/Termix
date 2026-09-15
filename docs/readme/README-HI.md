<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>सेल्फ-होस्टेड सर्वर प्रबंधन, SSH और रिमोट डेस्कटॉप से लेकर ऑटोमेशन तक</p>

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
  <a href="README-AR.md">العربية</a> ·
  हिन्दी ·
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

Termix मुफ़्त और ओपन सोर्स है। अगर यह आपके काम आता है, तो सर्वर की लागत और विकास के समय में मदद के लिए [दान](https://donate.termix.site/) करने पर विचार करें।

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>1 सितंबर 2025 को हासिल किया गया</sub>
</p>

</div>

<br />

## अवलोकन

Termix आपके सर्वर संभालने के लिए एक मुफ़्त, ओपन सोर्स, सेल्फ-होस्टेड प्लेटफ़ॉर्म है। यह SSH टर्मिनल, रिमोट डेस्कटॉप (RDP, VNC, Telnet), फ़ाइल ट्रांसफ़र, टनल, Docker, मेट्रिक्स और ऑटोमेशन को एक ही जगह लाता है, वेब, डेस्कटॉप और मोबाइल पर। यह Termius का सेल्फ-होस्टेड विकल्प है जो हमेशा मुफ़्त रहेगा।

<br />

## विशेषताएँ

<table>
<tr>
<td width="50%" valign="top">

**SSH टर्मिनल:**
ब्राउज़र जैसे टैब और स्प्लिट स्क्रीन वाला पूरा टर्मिनल, एक साथ 6 पैनल तक। थीम, फ़ॉन्ट और रंग आप खुद चुनें। हर सत्र के ऊपर एक टूलबार रहता है जिसमें CPU, मेमोरी और डिस्क लाइव दिखते हैं, साथ ही उस होस्ट की फ़ाइलों, Docker, टनल और मेट्रिक्स तक जाने के शॉर्टकट भी।

</td>
<td width="50%" valign="top">

**रिमोट डेस्कटॉप:**
ब्राउज़र में RDP, VNC और Telnet, बाकी सत्रों की तरह टैब और स्प्लिट स्क्रीन में। इसमें RDP ड्राइव के लिए फ़ाइल ब्राउज़र और खींचकर छोड़ने वाला अपलोड भी है। Windows डेस्कटॉप पर आप होस्ट को सिस्टम के अपने RDP क्लाइंट में भी खोल सकते हैं।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH टनल:**
लोकल, रिमोट और डायनामिक SOCKS फ़ॉरवर्डिंग, अपने आप दोबारा जुड़ने और स्थिति जाँच के साथ। डेस्कटॉप ऐप के क्लाइंट से सर्वर वाले टनल उसी मशीन पर रहते हैं, और आप सेटिंग सर्वर पर सहेजकर उसे दूसरी मशीन पर ले जा सकते हैं।

</td>
<td width="50%" valign="top">

**फ़ाइल मैनेजर:**
SFTP से फ़ाइलें देखें, संपादित करें, अपलोड और डाउनलोड करें, नाम बदलें, हटाएँ और खिसकाएँ, sudo के साथ भी। कोड, तस्वीरें, ऑडियो और वीडियो देखें और बदलें। फ़ाइलें सीधे एक सर्वर से दूसरे पर कॉपी करें, सबसे तेज़ रास्ता अपने आप चुना जाता है और ट्रांसफ़र की जाँच भी होती है।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker और Podman:**
कंटेनर चालू करें, रोकें, थामें और हटाएँ, उनके आँकड़े देखें, और किसी एक के अंदर शेल खोलें। Docker और Podman दोनों के साथ चलता है। यह Portainer या Dockge की जगह लेने के लिए नहीं है, सिर्फ़ आपके पहले से मौजूद कंटेनर संभालने के लिए है।

</td>
<td width="50%" valign="top">

**होस्ट मैनेजर:**
टैग और नाम व रंग वाले नेस्टेड फ़ोल्डर से होस्ट सहेजें और व्यवस्थित करें। सहेजे गए क्रेडेंशियल कई होस्ट पर दोबारा इस्तेमाल करें, SSH कुंजियाँ अपने आप भेजें, होस्ट को किसी मुख्य होस्ट के नीचे रखें, एक साथ कई में बदलाव करें और निर्यात करें, और जिन कनेक्शनों को सहेजना नहीं चाहते उनके लिए क्विक कनेक्ट इस्तेमाल करें।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**होस्ट मेट्रिक्स:**
ज़्यादातर Linux सर्वर पर CPU, मेमोरी, डिस्क, नेटवर्क, तापमान, अपटाइम, प्रोसेस, पोर्ट, लॉगिन और सिस्टम जानकारी, पुराने आँकड़ों के ग्राफ़ के साथ। मैनेजर कार्ड से आप सर्विस, cron कार्य, पैकेज, उपयोगकर्ता, फ़ायरवॉल नियम, WireGuard, Tailscale, SSL प्रमाणपत्र, लॉग और हेल्थ चेक Termix छोड़े बिना संभाल सकते हैं।

</td>
<td width="50%" valign="top">

**ऑटोमेशन:**
पहले एक ट्रिगर चुनें, फिर बताएँ कि क्या होना चाहिए। ट्रिगर में किसी मेट्रिक का तय सीमा पार करना, होस्ट का बंद होना या वापस आना, हेल्थ चेक का बदलना, कोई तय समय, कंटेनर की कोई घटना, या आने वाला webhook शामिल है। कदमों में कमांड और स्निपेट चलाना, कंटेनर और टनल संभालना, मशीन जगाना, कोई URL बुलाना, इंतज़ार करना, शर्त के हिसाब से रास्ता बदलना, दूसरा ऑटोमेशन चलाना, और ntfy, Discord या webhook से आपको बताना शामिल है। टेस्ट रन से आप पहले सुरक्षित तरीके से आज़मा सकते हैं।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**फ़्लीट:**
होस्ट चुनकर या टैग नियमों से एक फ़्लीट बनाएँ, ताकि नए होस्ट अपने आप जुड़ जाएँ। एक ही कमांड सभी होस्ट पर एक साथ चलाएँ, सब पर फ़ाइलें भेजें और उनसे लाएँ, पैकेज इंस्टॉल करें, और OS, कर्नेल, आर्किटेक्चर और अपटाइम की सूची इकट्ठा करें।

</td>
<td width="50%" valign="top">

**AI सहायक:**
यह वैकल्पिक है और जब तक आप खुद चालू न करें, बंद रहता है। OpenAI, Anthropic, Gemini, Ollama या OpenAI के अनुरूप कोई भी एंडपॉइंट जोड़ें और अपने सेटअप के बारे में पूछें। यह होस्ट, फ़्लीट, स्निपेट और अलर्ट पढ़ सकता है, और बदलाव खुद करने के बजाय आपकी मंज़ूरी के लिए सुझाता है। यह क्रेडेंशियल, उपयोगकर्ताओं या सेटिंग्स तक कभी नहीं पहुँच सकता। एडमिन इसे पूरे इंस्टेंस के लिए बंद रख सकते हैं, और आप इसे शुरुआती सेटअप में ही छिपा सकते हैं।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**लॉगिन और उपयोगकर्ता:**
लोकल खातों के साथ OIDC, LDAP, GitHub और Google से लॉगिन, और दो चरणों वाला सत्यापन (TOTP), पासकी (WebAuthn) तथा भरोसेमंद डिवाइस। एडमिन उपयोगकर्ताओं को संभाल सकते हैं, OIDC समूहों को भूमिकाओं से जोड़ सकते हैं, हर प्लेटफ़ॉर्म पर चालू सत्र देख और रद्द कर सकते हैं। अपने लोकल और OIDC खाते आपस में जोड़ें, और ऑडिट लॉग में देखें कि किसने क्या किया।

</td>
<td width="50%" valign="top">

**भूमिकाएँ और साझाकरण:**
भूमिकाएँ बनाएँ और होस्ट को उपयोगकर्ताओं या भूमिकाओं के साथ चार स्तरों पर साझा करें: कनेक्ट, देखना, बदलना और प्रबंधन। यह हर तरह के प्रमाणीकरण और हर प्रोटोकॉल के साथ चलता है, और साझा होस्ट के लिए इस्तेमाल होने वाले क्रेडेंशियल आप बदल भी सकते हैं।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**अलर्ट:**
CPU, मेमोरी और डिस्क जैसी होस्ट मेट्रिक्स पर नियम लगाएँ, और उनके चलने पर ntfy, Discord या webhook से सूचना पाएँ। चल रहे और ठीक हो चुके अलर्ट इतिहास में देखें, और जो आपके काम के नहीं उन्हें हटा दें।

</td>
<td width="50%" valign="top">

**होमपेज:**
खींचकर छोड़ने वाला विजेट ग्रिड जिसे आप खुद बनाते हैं। होस्ट की स्थिति, पिंग, सर्विस लिंक, बुकमार्क, खोज, घड़ियाँ, कैलेंडर, उलटी गिनती, नोट्स, RSS, मौसम, तस्वीरें, iframe, Docker, टनल, मेट्रिक्स के ग्राफ़, अपने API और यहाँ तक कि चालू टर्मिनल तक के विजेट मौजूद हैं।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**स्निपेट और उपकरण:**
जो कमांड आप बार-बार चलाते हैं उन्हें सहेजें और एक क्लिक में चलाएँ, होस्ट और अपने इनपुट के लिए वेरिएबल के साथ। एक ही कमांड सभी खुले टर्मिनलों पर चलाएँ, और अपने कमांड इतिहास में ऑटो-कंप्लीट के साथ खोजें।

</td>
<td width="50%" valign="top">

**सत्र साझा करना:**
चालू टर्मिनल, RDP, VNC या Telnet सत्र लाइव साझा करें। ऐसा लिंक भेजें जिससे कोई भी बिना खाते के जुड़ सके, या किसी खास Termix उपयोगकर्ता के साथ साझा करें, सिर्फ़ देखने या लिखने की अनुमति के साथ। साझाकरण अपने आप खत्म हो सकता है या कभी भी रद्द किया जा सकता है, और इसे पूरी तरह या हर होस्ट के लिए अलग से बंद किया जा सकता है।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**सत्र रिकॉर्डिंग और लॉग:**
टर्मिनल, RDP और VNC सत्र रिकॉर्ड करें और बाद में देखें। सत्र के सादे टेक्स्ट लॉग डाउनलोड करें, और कनेक्शन लॉग देखकर जानें कि जुड़ते समय असल में क्या हुआ।

</td>
<td width="50%" valign="top">

**सीरियल कनेक्शन:**
राउटर, स्विच और माइक्रोकंट्रोलर जैसे सीरियल उपकरणों से ब्राउज़र या डेस्कटॉप ऐप से बात करें। बॉड रेट, डेटा बिट, स्टॉप बिट और पैरिटी सेट करें। सहयोगी ब्राउज़रों में Web Serial API और डेस्कटॉप ऐप में मूल बैकएंड इस्तेमाल होता है।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
अपने tailnet से डिवाइस लाकर कुछ ही क्लिक में होस्ट के रूप में जोड़ें, और Tailscale SSH से जुड़ें ताकि पहुँच का काम आपके tailnet के ACL संभालें और कोई क्रेडेंशियल सहेजना न पड़े। Headscale और अपने एंडपॉइंट भी चलते हैं।

</td>
<td width="50%" valign="top">

**Proxmox:**
होस्ट सीधे किसी Proxmox इंस्टेंस से लाएँ, और नोड तथा गेस्ट के आँकड़े, जिनमें CPU, मेमोरी और स्टोरेज शामिल हैं, अलग टैब में देखें।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**वर्कस्पेस और टैब:**
टैब का एक सेट उनके स्प्लिट लेआउट के साथ सहेजें और पूरा का पूरा एक क्लिक में फिर खोलें। Termix आपका पिछला सत्र भी याद रखता है, इसलिए पेज रीफ़्रेश करने पर और दूसरे डिवाइस पर भी आपके टैब लौट आते हैं।

</td>
<td width="50%" valign="top">

**निर्देशित सेटअप:**
एक छोटा सा सेटअप आपको इंटरफ़ेस प्रीसेट, थीम, मनचाही सुविधाएँ और पहला होस्ट चुनने में मदद करता है। सरल मोड वह सब छिपा देता है जो आप इस्तेमाल नहीं करते, और आप सेटअप दोबारा चला सकते हैं या प्रीसेट कभी भी बदल सकते हैं।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**स्वतंत्र डेस्कटॉप ऐप और सिंक:**
डेस्कटॉप ऐप अपने लोकल बैकएंड और डेटाबेस के साथ बिना किसी सर्वर के अकेले चलता है। आप इसे किसी Termix सर्वर से जोड़कर होस्ट, क्रेडेंशियल, स्निपेट वगैरह दोनों तरफ़ सिंक कर सकते हैं, और चुन सकते हैं कि कनेक्शन आपकी मशीन से शुरू हों या सर्वर के रास्ते।

</td>
<td width="50%" valign="top">

**कमांड लाइन:**
आपके शेल और स्क्रिप्ट के लिए `termix` CLI। टर्मिनल खोलें, किसी एक होस्ट या पूरे फ़्लीट पर कमांड चलाएँ, SFTP से फ़ाइलें भेजें, और होस्ट, स्निपेट व क्रेडेंशियल संभालें। `npm install -g @termix-cli/cli` से इंस्टॉल करें या अलग बाइनरी लें। [CLI दस्तावेज़](https://docs.termix.site/cli) देखें।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**सुरक्षा:**
पासवर्ड, कुंजियाँ और बाकी गोपनीय जानकारी हर उपयोगकर्ता के लिए अलग से एन्क्रिप्ट होती है, और डेटाबेस फ़ाइलें भी डिस्क पर एन्क्रिप्ट की जा सकती हैं। यह कैसे काम करता है, यह [दस्तावेज़](https://docs.termix.site/security) में देखें।

</td>
<td width="50%" valign="top">

**भाषाएँ:**
लगभग 30 भाषाएँ पहले से मौजूद हैं, जिन्हें [Crowdin](https://docs.termix.site/translations) से संभाला जाता है।

</td>
</tr>
</table>

<br />

<details>
<summary><b>और भी विशेषताएँ</b></summary>
<br />

- **डैशबोर्ड** - आपके सर्वर एक नज़र में, ऐसे कार्ड के साथ जिन्हें आप खुद जमाते हैं
- **नेटवर्क ग्राफ़** - आपके होस्ट से बना आपका होमलैब का नक्शा, लाइव स्थिति के साथ
- **tmux मॉनिटर** - tmux के सत्र, विंडो और पैन देखें, झलक और खोज के साथ
- **API कुंजियाँ** - स्क्रिप्ट और CI के लिए, समाप्ति तिथि वाली उपयोगकर्ता-विशिष्ट कुंजियाँ
- **निर्यात और आयात** - होस्ट, क्रेडेंशियल और फ़ाइल मैनेजर का डेटा अंदर-बाहर ले जाएँ
- **अपने आप SSL** - प्रमाणपत्र आपके लिए बनते और नवीनीकृत होते हैं, HTTPS रीडायरेक्ट के साथ, या अपने खुद के लगाएँ
- **डेटाबेस** - डिफ़ॉल्ट रूप से SQLite, साथ में PostgreSQL और MySQL भी
- **आधुनिक इंटरफ़ेस** - साफ़ सुथरा React इंटरफ़ेस जो डेस्कटॉप और मोबाइल दोनों पर चलता है, लाइट, डार्क और Dracula जैसी थीम के साथ। कोई भी कनेक्शन URL से पूरी स्क्रीन में खुल सकता है
- **कमांड पैलेट** - बाईं Shift दो बार दबाकर कीबोर्ड से सीधे किसी होस्ट पर जाएँ
- **कीबोर्ड शॉर्टकट** - टैब बदलना, बंद करना और बहुत कुछ, सब दोबारा तय किए जा सकते हैं
- **Wake-on-LAN** - किसी मशीन को Termix से या ऑटोमेशन के किसी कदम से जगाएँ
- **भरोसेमंद प्रॉक्सी से लॉगिन** - रिवर्स प्रॉक्सी को लॉगिन संभालने दें और उपयोगकर्ता की जानकारी आगे भेजने दें
- **भरपूर SSH सुविधाएँ** - जंप होस्ट, Warpgate, TOTP पूछना, SOCKS5, होस्ट कुंजी की जाँच, पासवर्ड अपने आप भरना, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, पोर्ट नॉकिंग, टर्मिनल लॉग, एजेंट फ़ॉरवर्डिंग, Bitwarden SSH एजेंट, HashiCorp Vault से SSH हस्ताक्षर और भी बहुत कुछ
- **Termix ID** - sshid.io जैसा अपना बना हुआ इंतज़ाम। एक नाम लें, अपनी सार्वजनिक कुंजियाँ एक रिज़ॉल्वर URL पर रखें, और अंदर मौजूद CA से SSH प्रमाणपत्र जारी करें

</details>

<br />

## प्लेटफ़ॉर्म सपोर्ट

<table align="center">
<tr>
<th align="center">प्लेटफ़ॉर्म</th>
<th align="center">वितरण</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>कोई भी आधुनिक ब्राउज़र (Chrome, Safari, Firefox) · PWA सपोर्ट</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>पोर्टेबल · MSI इंस्टॉलर · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>पोर्टेबल · AUR · AppImage · Deb · Flatpak</td>
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

## इंस्टॉलेशन

सभी प्लेटफ़ॉर्म पर पूरी इंस्टॉलेशन जानकारी के लिए [Termix दस्तावेज़](https://docs.termix.site/install) देखें।

Docker Compose फ़ाइल का नमूना (अगर आप रिमोट डेस्कटॉप इस्तेमाल नहीं करने वाले तो `guacd` और नेटवर्क वाला हिस्सा हटा सकते हैं):

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

### कमांड लाइन

Termix में CLI भी है, ताकि आप टर्मिनल से अपने सर्वर संभाल सकें और Termix को अपनी स्क्रिप्ट में इस्तेमाल कर सकें।

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

यह टर्मिनल खोल सकता है, एक होस्ट या पूरे फ़्लीट पर कमांड चला सकता है, SFTP से फ़ाइलें ले जा सकता है, और होस्ट, स्निपेट व क्रेडेंशियल संभाल सकता है। पूरा दस्तावेज़ [docs.termix.site/cli](https://docs.termix.site/cli) पर है।

### क्लाउड होस्टिंग

आप Termix सर्वर को अपने नेटवर्क के बजाय किसी VPS पर भी चला सकते हैं। अगर Termix उसी नेटवर्क पर चल रहा है जिसे वह संभालता है, तो गड़बड़ी होने पर वह भी साथ ही बंद हो जाएगा, ठीक उसी वक्त जब आपको उसे ठीक करने के लिए चाहिए। बाहर चलाने पर वह हमेशा पहुँच में रहता है, एक स्थिर IP देता है, और बिना VPN या पोर्ट फ़ॉरवर्ड के कहीं से भी पहुँच मिलती है।

[GINERNET](https://docs.termix.site/install/ginernet) Termix को प्रायोजित करता है, और दस्तावेज़ में उनके VPS प्लेटफ़ॉर्म पर तैनाती की कदम-दर-कदम गाइड मौजूद है।

<br />

## टेलीमेट्री

Termix दिन में एक बार एक छोटा सा गुमनाम संकेत भेजता है, ताकि मुझे पता चले कि कितने इंस्टेंस चल रहे हैं और कौन सी सुविधाएँ सच में इस्तेमाल होती हैं। इसमें एक बेतरतीब इंस्टेंस आईडी, आपके पास कितने उपयोगकर्ता और होस्ट हैं, ऐप का संस्करण, और पिछले 24 घंटे में इस्तेमाल हुई सुविधाएँ (टर्मिनल, फ़ाइल मैनेजर, टनल, docker आदि) होती हैं। इसमें कभी भी उपयोगकर्ता नाम, होस्ट नाम, IP पते, क्रेडेंशियल या ऐसी कोई चीज़ नहीं होती जो आपकी या आपके सर्वर की पहचान बताए।

यह डिफ़ॉल्ट रूप से चालू रहता है। इसे एडमिन सेटिंग्स में सामान्य के अंतर्गत बंद करें, या Termix शुरू करने से पहले ही `ENABLE_TELEMETRY=false` सेट कर दें।

<br />

## दान करें

Termix मुफ़्त और ओपन सोर्स है, न कोई सदस्यता है न कोई पेड प्लान। अगर यह आपके काम आता है, तो सर्वर, डोमेन और विकास के समय में मदद के लिए दान करने पर विचार करें। दान से SAML, Kubernetes और एजेंट सपोर्ट जैसी सुविधाएँ बनाने के लिए ज़रूरी शोध और सीखने का समय भी मिलता है। नीचे प्रगति देखें और दान करें।

[दान करें](https://donate.termix.site/)

<br />

## प्रायोजक

विकास में सहयोग के लिए पेड प्लेसमेंट में रुचि है? [mail@termix.site](mailto:mail@termix.site) पर ईमेल करें।

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

## सहायता

मदद चाहिए या कोई सुविधा माँगनी है? एक [नया issue](https://github.com/Termix-SSH/Support/issues) खोलें और जितना हो सके विस्तार से लिखें, हो सके तो अंग्रेज़ी में। आप [Discord](https://discord.gg/jVQGdvHDrf) के सपोर्ट चैनल में भी पूछ सकते हैं, हालाँकि वहाँ जवाब आने में ज़्यादा समय लग सकता है।

<br />

## स्क्रीनशॉट

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>YouTube पर अपडेट की जानकारी देखें</sub>

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

<sub>कुछ वीडियो और तस्वीरें पुरानी हो सकती हैं या सुविधाओं को पूरी तरह नहीं दिखा पातीं।</sub>

</div>

<br />

## नियोजित विशेषताएँ

सभी नियोजित सुविधाएँ [Projects](https://github.com/orgs/Termix-SSH/projects/5) में हैं। अगर आप योगदान देना चाहते हैं, तो [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md) देखें।

<br />

## लाइसेंस

Apache License संस्करण 2.0 के तहत वितरित। अधिक जानकारी के लिए `LICENSE` देखें।
