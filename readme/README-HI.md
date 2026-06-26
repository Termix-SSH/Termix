<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>स्व-होस्टेड SSH प्रबंधन और रिमोट डेस्कटॉप एक्सेस</p>

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
</p>

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>1 सितंबर, 2025 को प्राप्त</sub>
</p>

</div>

<br />

## अवलोकन

Termix एक ओपन-सोर्स, हमेशा के लिए मुफ़्त, सेल्फ-होस्टेड ऑल-इन-वन सर्वर प्रबंधन प्लेटफ़ॉर्म है। यह एक एकल, सहज इंटरफ़ेस के माध्यम से आपके सर्वर और बुनियादी ढाँचे के प्रबंधन के लिए एक मल्टी-प्लेटफ़ॉर्म समाधान प्रदान करता है। Termix SSH टर्मिनल एक्सेस, रिमोट डेस्कटॉप कंट्रोल (RDP, VNC, Telnet), SSH टनलिंग क्षमताएँ, रिमोट SSH फ़ाइल प्रबंधन, और कई अन्य उपकरण प्रदान करता है। Termix सभी प्लेटफ़ॉर्म पर उपलब्ध Termius का सही मुफ़्त और सेल्फ-होस्टेड विकल्प है।

<br />

## विशेषताएँ

<table>
<tr>
<td width="50%" valign="top">

**SSH टर्मिनल एक्सेस:**
ब्राउज़र जैसी टैब प्रणाली के साथ स्प्लिट-स्क्रीन सपोर्ट (4 पैनल तक) वाला पूर्ण-विशेषता वाला टर्मिनल। इसमें लोकप्रिय टर्मिनल थीम, फ़ॉन्ट और अन्य कंपोनेंट सहित टर्मिनल को कस्टमाइज़ करने का सपोर्ट शामिल है।

</td>
<td width="50%" valign="top">

**रिमोट डेस्कटॉप एक्सेस:**
ब्राउज़र पर RDP, VNC और Telnet सपोर्ट, पूर्ण कस्टमाइज़ेशन और स्प्लिट स्क्रीन के साथ।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH टनल प्रबंधन:**
ऑटोमैटिक रीकनेक्शन, हेल्थ मॉनिटरिंग और लोकल, रिमोट या डायनेमिक SOCKS फॉरवर्डिंग के साथ सर्वर-टु-सर्वर SSH टनल बनाएँ और प्रबंधित करें। डेस्कटॉप क्लाइंट-टु-सर्वर टनल सेटिंग्स प्रत्येक डेस्कटॉप इंस्टॉल में स्थानीय रूप से संग्रहीत होती हैं; वैकल्पिक C2S प्रीसेट स्नैपशॉट सर्वर पर सेव, रीनेम, लोड या डिलीट किए जा सकते हैं।

</td>
<td width="50%" valign="top">

**रिमोट फ़ाइल मैनेजर:**
कोड, इमेज, ऑडियो और वीडियो देखने और संपादित करने के सपोर्ट के साथ रिमोट सर्वर पर सीधे फ़ाइलें प्रबंधित करें। sudo सपोर्ट के साथ फ़ाइलें अपलोड, डाउनलोड, रीनेम, डिलीट और मूव करें।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker प्रबंधन:**
कंटेनर शुरू, बंद, पॉज़, हटाएँ। कंटेनर स्टैट्स देखें। docker exec टर्मिनल का उपयोग करके कंटेनर को नियंत्रित करें। इसे Portainer या Dockge की जगह लेने के लिए नहीं बनाया गया बल्कि कंटेनर बनाने की तुलना में उन्हें सरलता से प्रबंधित करने के लिए बनाया गया है।

</td>
<td width="50%" valign="top">

**SSH होस्ट मैनेजर:**
टैग और फ़ोल्डर (फ़ोल्डर कस्टमाइज़ेशन और नेस्टेड फ़ोल्डर सपोर्ट के साथ) के साथ अपने SSH कनेक्शन सहेजें, व्यवस्थित करें और प्रबंधित करें, और SSH कुंजियों की तैनाती को स्वचालित करने की क्षमता के साथ पुन: उपयोग योग्य लॉगिन जानकारी आसानी से सहेजें।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**होस्ट मेट्रिक्स:**
अधिकांश Linux आधारित सर्वर पर CPU, मेमोरी, डिस्क उपयोग, नेटवर्क, अपटाइम, सिस्टम जानकारी, फ़ायरवॉल, पोर्ट मॉनिटर, लॉग व्यूअर, उपयोगकर्ता/अनुमतियाँ, सर्टिफ़िकेट और भी बहुत कुछ देखें।

</td>
<td width="50%" valign="top">

**उपयोगकर्ता प्रमाणीकरण:**
व्यवस्थापक नियंत्रण और OIDC/LDAP/SSO (एक्सेस कंट्रोल के साथ) और 2FA (TOTP) सपोर्ट के साथ सुरक्षित उपयोगकर्ता प्रबंधन। सभी प्लेटफ़ॉर्म पर सक्रिय उपयोगकर्ता सत्र देखें और अनुमतियाँ रद्द करें। अपने OIDC/स्थानीय खातों को एक साथ जोड़ें। सभी उपयोगकर्ताओं की कार्रवाइयों का ऑडिट लॉग देखें।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
भूमिकाएँ बनाएँ और उपयोगकर्ताओं/भूमिकाओं में होस्ट साझा करें।

</td>
<td width="50%" valign="top">

**डेटाबेस एन्क्रिप्शन:**
बैकएंड एन्क्रिप्टेड SQLite डेटाबेस फ़ाइलों के रूप में संग्रहीत। अधिक जानकारी के लिए [डॉक्स](https://docs.termix.site/security) देखें।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**नेटवर्क ग्राफ़:**
स्थिति सपोर्ट के साथ अपने SSH कनेक्शन के आधार पर अपने होमलैब को विज़ुअलाइज़ करने के लिए अपना डैशबोर्ड कस्टमाइज़ करें।

</td>
<td width="50%" valign="top">

**SSH टूल्स:**
एक क्लिक से निष्पादित होने वाले पुन: उपयोग योग्य कमांड स्निपेट बनाएँ। एक साथ कई खुले टर्मिनलों में एक कमांड चलाएँ।

</td>
</tr>
<tr>
<td width="50%" valign="top">

**परसिस्टेंट टैब:**
उपयोगकर्ता प्रोफ़ाइल में सक्षम होने पर SSH सेशन और टैब डिवाइस/रीफ्रेश के पार खुले रहते हैं।

</td>
<td width="50%" valign="top">

**भाषाएँ:**
लगभग 30 भाषाओं का बिल्ट-इन सपोर्ट ([Crowdin](https://docs.termix.site/translations) द्वारा प्रबंधित)।

</td>
</tr>
</table>

<br />

<details>
<summary><b>अधिक विशेषताएँ</b></summary>
<br />

- **डैशबोर्ड** - अपने डैशबोर्ड पर एक नज़र में सर्वर की जानकारी देखें
- **API कुंजियाँ** - ऑटोमेशन/CI के लिए उपयोग हेतु समाप्ति तिथियों के साथ उपयोगकर्ता-स्कोप्ड API कुंजियाँ बनाएँ
- **डेटा एक्सपोर्ट/इम्पोर्ट** - SSH होस्ट, क्रेडेंशियल और फ़ाइल मैनेजर डेटा एक्सपोर्ट और इम्पोर्ट करें
- **स्वचालित SSL सेटअप** - HTTPS रीडायरेक्ट के साथ बिल्ट-इन SSL सर्टिफ़िकेट जनरेशन और प्रबंधन
- **आधुनिक UI** - React, Tailwind CSS, और Shadcn से बना साफ़ डेस्कटॉप/मोबाइल-फ़्रेंडली इंटरफ़ेस। लाइट, डार्क, ड्रैकुला आदि सहित कई अलग-अलग UI थीम के बीच चुनें। किसी भी कनेक्शन को फ़ुल-स्क्रीन में खोलने के लिए URL रूट का उपयोग करें।
- **कमांड इतिहास** - पहले चलाए गए SSH कमांड का ऑटो-कम्प्लीट और दृश्य
- **क्विक कनेक्ट** - कनेक्शन डेटा सहेजे बिना सर्वर से कनेक्ट करें
- **कमांड पैलेट** - अपने कीबोर्ड से SSH कनेक्शन तक त्वरित पहुँच के लिए बाएँ Shift को दो बार टैप करें
- **Proxmox एकीकरण** - अपने Proxmox इंस्टेंस से Termix में होस्ट स्वचालित रूप से जोड़ें
- **SSH सुविधाओं से भरपूर** - जम्प होस्ट, Warpgate, TOTP आधारित कनेक्शन, SOCKS5, होस्ट की वेरिफ़िकेशन, पासवर्ड ऑटोफ़िल, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, पोर्ट नॉकिंग, टर्मिनल लॉगिंग आदि का सपोर्ट

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

सभी प्लेटफ़ॉर्म पर Termix इंस्टॉल करने के बारे में अधिक जानकारी के लिए Termix [डॉक्स](https://docs.termix.site/install) पर जाएँ। यहाँ एक नमूना Docker Compose फ़ाइल देखें (यदि आप रिमोट डेस्कटॉप सुविधाओं का उपयोग करने की योजना नहीं बना रहे हैं तो आप guacd और नेटवर्क को हटा सकते हैं):

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

## दान करें

Termix मुफ़्त और ओपन सोर्स है, इसमें कोई सदस्यता या भुगतान योजना नहीं है। यदि आपको यह उपयोगी लगता है, तो सर्वर लागत, डोमेन और विकास समय को कवर करने में मदद के लिए दान करने पर विचार करें।

[दान करें](https://donate.termix.site/)

<br />

## स्क्रीनशॉट

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>YouTube पर अपडेट की समीक्षाएँ देखें</sub>

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

<sub>कुछ वीडियो और छवियाँ पुरानी हो सकती हैं या विशेषताओं को पूरी तरह से प्रदर्शित नहीं कर सकती हैं।</sub>

</div>

<br />

## नियोजित विशेषताएँ

सभी नियोजित विशेषताओं के लिए [प्रोजेक्ट्स](https://github.com/orgs/Termix-SSH/projects/2) देखें। यदि आप योगदान देना चाहते हैं, तो [योगदान](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md) देखें।

<br />

## प्रायोजक

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

## सहायता

यदि आपको सहायता चाहिए या Termix के लिए किसी विशेषता का अनुरोध करना चाहते हैं, तो [इश्यूज़](https://github.com/Termix-SSH/Support/issues) पेज पर जाएँ, लॉग इन करें, और `New Issue` दबाएँ। कृपया अपने इश्यू में यथासंभव विस्तृत विवरण दें, अधिमानतः अंग्रेज़ी में लिखें। आप [Discord](https://discord.gg/jVQGdvHDrf) सर्वर में भी शामिल हो सकते हैं और सहायता चैनल पर जा सकते हैं, हालाँकि, प्रतिक्रिया समय अधिक हो सकता है।

<br />

## लाइसेंस

Apache License Version 2.0 के तहत वितरित। अधिक जानकारी के लिए `LICENSE` देखें।
