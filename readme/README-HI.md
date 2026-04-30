# रिपॉजिटरी आँकड़े

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · 🇮🇳 हिन्दी · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">1 सितंबर, 2025 को प्राप्त</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# अवलोकन

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix एक ओपन-सोर्स, हमेशा के लिए मुफ़्त, सेल्फ-होस्टेड ऑल-इन-वन सर्वर प्रबंधन प्लेटफ़ॉर्म है। यह एक एकल, सहज इंटरफ़ेस के माध्यम से आपके सर्वर और बुनियादी ढाँचे के प्रबंधन के लिए एक मल्टी-प्लेटफ़ॉर्म समाधान प्रदान करता है। Termix SSH टर्मिनल एक्सेस, रिमोट डेस्कटॉप कंट्रोल (RDP, VNC, Telnet), SSH टनलिंग क्षमताएँ, रिमोट SSH फ़ाइल प्रबंधन, और कई अन्य उपकरण प्रदान करता है। Termix सभी प्लेटफ़ॉर्म पर उपलब्ध Termius का सही मुफ़्त और सेल्फ-होस्टेड विकल्प है।

# विशेषताएँ

- **SSH टर्मिनल एक्सेस** - ब्राउज़र जैसी टैब प्रणाली के साथ स्प्लिट-स्क्रीन सपोर्ट (4 पैनल तक) वाला पूर्ण-विशेषता वाला टर्मिनल। इसमें लोकप्रिय टर्मिनल थीम, फ़ॉन्ट और अन्य कंपोनेंट सहित टर्मिनल को कस्टमाइज़ करने का सपोर्ट शामिल है।
- **रिमोट डेस्कटॉप एक्सेस** - ब्राउज़र पर RDP, VNC और Telnet सपोर्ट, पूर्ण कस्टमाइज़ेशन और स्प्लिट स्क्रीन के साथ।
- **SSH टनल प्रबंधन** - ऑटोमैटिक रीकनेक्शन, हेल्थ मॉनिटरिंग और लोकल, रिमोट या डायनेमिक SOCKS फॉरवर्डिंग के साथ सर्वर-टु-सर्वर SSH टनल बनाएँ और प्रबंधित करें। डेस्कटॉप क्लाइंट-टु-सर्वर टनल सेटिंग्स प्रत्येक डेस्कटॉप इंस्टॉल में स्थानीय रूप से संग्रहीत होती हैं; वैकल्पिक C2S प्रीसेट स्नैपशॉट सर्वर पर सेव, रीनेम, लोड या डिलीट किए जा सकते हैं।
- **रिमोट फ़ाइल मैनेजर** - कोड, इमेज, ऑडियो और वीडियो देखने और संपादित करने के सपोर्ट के साथ रिमोट सर्वर पर सीधे फ़ाइलें प्रबंधित करें। sudo सपोर्ट के साथ फ़ाइलें अपलोड, डाउनलोड, रीनेम, डिलीट और मूव करें।
- **Docker प्रबंधन** - कंटेनर शुरू, बंद, पॉज़, हटाएँ। कंटेनर स्टैट्स देखें। docker exec टर्मिनल का उपयोग करके कंटेनर को नियंत्रित करें। इसे Portainer या Dockge की जगह लेने के लिए नहीं बनाया गया बल्कि कंटेनर बनाने की तुलना में उन्हें सरलता से प्रबंधित करने के लिए बनाया गया है।
- **SSH होस्ट मैनेजर** - टैग और फ़ोल्डर के साथ अपने SSH कनेक्शन सहेजें, व्यवस्थित करें और प्रबंधित करें, और SSH कुंजियों की तैनाती को स्वचालित करने की क्षमता के साथ पुन: उपयोग योग्य लॉगिन जानकारी आसानी से सहेजें।
- **सर्वर आँकड़े** - अधिकांश Linux आधारित सर्वर पर नेटवर्क, अपटाइम, सिस्टम जानकारी, फ़ायरवॉल, पोर्ट मॉनिटर के साथ CPU, मेमोरी और डिस्क उपयोग देखें।
- **डैशबोर्ड** - अपने डैशबोर्ड पर एक नज़र में सर्वर की जानकारी देखें।
- **RBAC** - भूमिकाएँ बनाएँ और उपयोगकर्ताओं/भूमिकाओं में होस्ट साझा करें।
- **उपयोगकर्ता प्रमाणीकरण** - व्यवस्थापक नियंत्रण और OIDC (एक्सेस कंट्रोल के साथ) और 2FA (TOTP) सपोर्ट के साथ सुरक्षित उपयोगकर्ता प्रबंधन। सभी प्लेटफ़ॉर्म पर सक्रिय उपयोगकर्ता सत्र देखें और अनुमतियाँ रद्द करें। अपने OIDC/स्थानीय खातों को एक साथ जोड़ें।
- **डेटाबेस एन्क्रिप्शन** - बैकएंड एन्क्रिप्टेड SQLite डेटाबेस फ़ाइलों के रूप में संग्रहीत। अधिक जानकारी के लिए [डॉक्स](https://docs.termix.site/security) देखें।
- **API कुंजियाँ** - ऑटोमेशन/CI के लिए उपयोग हेतु समाप्ति तिथियों के साथ उपयोगकर्ता-स्कोप्ड API कुंजियाँ बनाएँ।
- **डेटा एक्सपोर्ट/इम्पोर्ट** - SSH होस्ट, क्रेडेंशियल और फ़ाइल मैनेजर डेटा एक्सपोर्ट और इम्पोर्ट करें।
- **स्वचालित SSL सेटअप** - HTTPS रीडायरेक्ट के साथ बिल्ट-इन SSL सर्टिफ़िकेट जनरेशन और प्रबंधन।
- **आधुनिक UI** - React, Tailwind CSS, और Shadcn से बना साफ़ डेस्कटॉप/मोबाइल-फ़्रेंडली इंटरफ़ेस। लाइट, डार्क, ड्रैकुला आदि सहित कई अलग-अलग UI थीम के बीच चुनें। किसी भी कनेक्शन को फ़ुल-स्क्रीन में खोलने के लिए URL रूट का उपयोग करें।
- **भाषाएँ** - लगभग 30 भाषाओं का बिल्ट-इन सपोर्ट ([Crowdin](https://docs.termix.site/translations) द्वारा प्रबंधित)।
- **प्लेटफ़ॉर्म सपोर्ट** - वेब ऐप, डेस्कटॉप एप्लिकेशन (Windows, Linux, और macOS, Termix बैकएंड के बिना स्टैंडअलोन चलाया जा सकता है), PWA, और iOS और Android के लिए समर्पित मोबाइल/टैबलेट ऐप के रूप में उपलब्ध।
- **SSH टूल्स** - एक क्लिक से निष्पादित होने वाले पुन: उपयोग योग्य कमांड स्निपेट बनाएँ। एक साथ कई खुले टर्मिनलों में एक कमांड चलाएँ।
- **कमांड इतिहास** - पहले चलाए गए SSH कमांड का ऑटो-कम्प्लीट और दृश्य।
- **क्विक कनेक्ट** - कनेक्शन डेटा सहेजे बिना सर्वर से कनेक्ट करें।
- **कमांड पैलेट** - अपने कीबोर्ड से SSH कनेक्शन तक त्वरित पहुँच के लिए बाएँ Shift को दो बार टैप करें।
- **SSH सुविधाओं से भरपूर** - जम्प होस्ट, Warpgate, TOTP आधारित कनेक्शन, SOCKS5, होस्ट की वेरिफ़िकेशन, पासवर्ड ऑटोफ़िल, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, पोर्ट नॉकिंग आदि का सपोर्ट।
- **नेटवर्क ग्राफ़** - स्थिति सपोर्ट के साथ अपने SSH कनेक्शन के आधार पर अपने होमलैब को विज़ुअलाइज़ करने के लिए अपना डैशबोर्ड कस्टमाइज़ करें।
- **परसिस्टेंट टैब** - उपयोगकर्ता प्रोफ़ाइल में सक्षम होने पर SSH सेशन और टैब डिवाइस/रीफ्रेश के पार खुले रहते हैं।

# नियोजित विशेषताएँ

सभी नियोजित विशेषताओं के लिए [प्रोजेक्ट्स](https://github.com/orgs/Termix-SSH/projects/2) देखें। यदि आप योगदान देना चाहते हैं, तो [योगदान](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md) देखें।

# इंस्टॉलेशन

समर्थित डिवाइस:

- वेबसाइट (किसी भी प्लेटफ़ॉर्म पर कोई भी आधुनिक ब्राउज़र जैसे Chrome, Safari, और Firefox) (PWA सपोर्ट सहित)
- Windows (x64/ia32)
  - पोर्टेबल
  - MSI इंस्टॉलर
  - Chocolatey पैकेज मैनेजर
- Linux (x64/ia32)
  - पोर्टेबल
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (v12.0+ पर x64/ia32)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

सभी प्लेटफ़ॉर्म पर Termix इंस्टॉल करने के बारे में अधिक जानकारी के लिए Termix [डॉक्स](https://docs.termix.site/install) पर जाएँ। अन्यथा, यहाँ एक नमूना Docker Compose फ़ाइल देखें (यदि आप रिमोट डेस्कटॉप सुविधाओं का उपयोग करने की योजना नहीं बना रहे हैं तो आप guacd और नेटवर्क को हटा सकते हैं):

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

# प्रायोजक

<p align="left">
  <a href="https://www.digitalocean.com/">
    <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" height="50" alt="DigitalOcean">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://crowdin.com/">
    <img src="https://support.crowdin.com/assets/logos/core-logo/svg/crowdin-core-logo-cDark.svg" height="50" alt="Crowdin">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.blacksmith.sh/">
    <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="50" alt="Blacksmith">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.cloudflare.com/">
    <img src="https://sirv.sirv.com/website/screenshots/cloudflare/cloudflare-logo.png?w=300" height="50" alt="Cloudflare">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://tailscale.com/">
    <img src="https://drive.google.com/uc?export=view&id=1lIxkJuX6M23bW-2FElhT0rQieTrzaVSL" height="50" alt="TailScale">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://akamai.com/">
    <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="50" alt="Akamai">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://aws.amazon.com/">
    <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="50" alt="AWS">
  </a>
</p>

# सहायता

यदि आपको सहायता चाहिए या Termix के लिए किसी विशेषता का अनुरोध करना चाहते हैं, तो [इश्यूज़](https://github.com/Termix-SSH/Support/issues) पेज पर जाएँ, लॉग इन करें, और `New Issue` दबाएँ।
कृपया अपने इश्यू में यथासंभव विस्तृत विवरण दें, अधिमानतः अंग्रेज़ी में लिखें। आप [Discord](https://discord.gg/jVQGdvHDrf) सर्वर में भी शामिल हो सकते हैं और सहायता चैनल पर जा सकते हैं, हालाँकि, प्रतिक्रिया समय अधिक हो सकता है।

# स्क्रीनशॉट

[![YouTube](../repo-images/YouTube.jpg)](https://www.youtube.com/@TermixSSH/videos)

<p align="center">
  <img src="../repo-images/Image%201.png" width="400" alt="Termix Demo 1"/>
  <img src="../repo-images/Image%202.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="../repo-images/Image%203.png" width="400" alt="Termix Demo 3"/>
  <img src="../repo-images/Image%204.png" width="400" alt="Termix Demo 4"/>
</p>

<p align="center">
  <img src="../repo-images/Image%205.png" width="400" alt="Termix Demo 5"/>
  <img src="../repo-images/Image%206.png" width="400" alt="Termix Demo 6"/>
</p>

<p align="center">
  <img src="../repo-images/Image%207.png" width="400" alt="Termix Demo 7"/>
  <img src="../repo-images/Image%208.png" width="400" alt="Termix Demo 8"/>
</p>

<p align="center">
  <img src="../repo-images/Image%209.png" width="400" alt="Termix Demo 9"/>
  <img src="../repo-images/Image%2010.png" width="400" alt="Termix Demo 10"/>
</p>

<p align="center">
  <img src="../repo-images/Image%2011.png" width="400" alt="Termix Demo 11"/>
  <img src="../repo-images/Image%2012.png" width="400" alt="Termix Demo 12"/>
</p>

कुछ वीडियो और छवियाँ पुरानी हो सकती हैं या विशेषताओं को पूरी तरह से प्रदर्शित नहीं कर सकती हैं।

# लाइसेंस

Apache License Version 2.0 के तहत वितरित। अधिक जानकारी के लिए LICENSE देखें।
