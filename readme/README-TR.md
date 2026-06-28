<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Kendi sunucunuzda barindirilan SSH yonetimi ve uzak masaustu erisimi</p>

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
  <a href="README-HI.md">हिन्दी</a> ·
  Türkçe ·
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
  <sub>1 Eylül 2025'te kazanildi</sub>
</p>

</div>

<br />

## Genel Bakis

Termix, acik kaynakli, sonsuza kadar ucretsiz, kendi sunucunuzda barindirabileceginez hepsi bir arada sunucu yonetim platformudur. Sunucularinizi ve altyapinizi tek bir sezgisel arayuz uzerinden yonetmek icin cok platformlu bir cozum sunar. Termix, SSH terminal erisimi, uzak masaustu kontrolu (RDP, VNC, Telnet), SSH tunelleme yetenekleri, uzak SSH dosya yonetimi ve daha bircok arac saglar. Termix, tum platformlarda kullanilabilen Termius'un mukemmel ucretsiz ve kendi barindirmali alternatifidir.

<br />

## Ozellikler

<table>
<tr>
<td width="50%" valign="top">

**SSH Terminal Erisimi:**
Tarayici benzeri sekme sistemiyle bolunmus ekran destegine sahip (4 panele kadar) tam ozellikli terminal. Yaygin terminal temalari, yazi tipleri ve diger bilesenleri iceren terminal ozellestirme destegi.

</td>
<td width="50%" valign="top">

**Uzak Masaustu Erisimi:**
Tam ozellestirme ve bolunmus ekran ile tarayici uzerinden RDP, VNC ve Telnet destegi.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH Tunel Yonetimi:**
Otomatik yeniden baglantiya, saglik izleme ve yerel, uzak veya dinamik SOCKS yonlendirme destegi ile sunucular arasi SSH tunelleri olusturun ve yonetin. Masaustu istemci-sunucu tunel ayarlari her masaustu kurulumu icin yerel olarak depolanir; istege bagli C2S hazir ayar anlik goruntuleri sunucuya kaydedilebilir, yeniden adlandirilabilir, yuklenebilir veya silinebilir.

</td>
<td width="50%" valign="top">

**Uzak Dosya Yoneticisi:**
Uzak sunuculardaki dosyalari dogrudan yonetin; kod, goruntu, ses ve video goruntuleme ve duzenleme destegi ile. Sudo destegi ile dosyalari sorunsuzca yukleyin, indirin, yeniden adlandirin, silin ve tasiyin.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker Yonetimi:**
Konteynerleri baslatın, durdurun, duraklatın, kaldirin. Konteyner istatistiklerini goruntuleyin. Docker exec terminali kullanarak konteyneri kontrol edin. Portainer veya Dockge'nin yerini almak icin degil, konteynerlerinizi olusturmak yerine basitce yonetmek icin tasarlanmistir.

</td>
<td width="50%" valign="top">

**SSH Ana Bilgisayar Yoneticisi:**
SSH baglantilarinizi etiketler ve klasorlerle (klasor ozellestirme ve ic ice klasor destegi ile) kaydedin, duzenleyin ve yonetin; yeniden kullanilabilir giris bilgilerini kolayca kaydedin ve SSH anahtarlarinin dagitimini otomatiklestirin.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Ana Bilgisayar Metrikleri:**
Cogu Linux tabanli sunucularda CPU, bellek, disk kullanimi, ag, calisma suresi, sistem bilgisi, guvenlik duvari, port izleme, gunluk goruntuleyici, kullanicilar/izinler, sertifikalar ve daha fazlasini goruntuleyin.

</td>
<td width="50%" valign="top">

**Kullanici Kimlik Dogrulama:**
Yonetici kontrolleri, OIDC/LDAP/SSO (erisim kontrollu) ve 2FA (TOTP) destegi ile guvenli kullanici yonetimi. Tum platformlardaki aktif kullanici oturumlarini goruntuleyin ve izinleri iptal edin. OIDC/Yerel hesaplarinizi birbirine baglayin. Tum kullanicilarin islemlerinin denetim gunlugunu goruntuleyin.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
Roller olusturun ve ana bilgisayarlari kullanicilar/roller arasinda paylasin.

</td>
<td width="50%" valign="top">

**Veritabani Sifreleme:**
Arka uc, sifrelenmis SQLite veritabani dosyalari olarak depolanir. Daha fazla bilgi icin [belgelere](https://docs.termix.site/security) bakin.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Ag Grafigi:**
Kontrol panelinizi, SSH baglantilariniza dayali olarak ev laboratuvarinizi durum destegi ile gorselletirmek icin ozellestirin.

</td>
<td width="50%" valign="top">

**SSH Araclari:**
Tek tiklamayla calistirilan yeniden kullanilabilir komut parcaciklari olusturun. Birden fazla acik terminalde ayni anda tek bir komut calistirin.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Kalici Sekmeler:**
Kullanici profilinde etkinlestirilmisse SSH oturumlari ve sekmeler cihazlar/yenilemeler arasinda acik kalir.

</td>
<td width="50%" valign="top">

**Diller:**
Yaklasik 30 dil icin yerlesik destek ([Crowdin](https://docs.termix.site/translations) tarafindan yonetilir).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Daha fazla ozellik</b></summary>
<br />

- **Kontrol Paneli** - Kontrol panelinizde sunucu bilgilerini bir bakista goruntuleyin
- **API Anahtarlari** - Otomasyon/CI icin kullanilmak uzere son kullanma tarihleriyle kullanici kapsamli API anahtarlari olusturun
- **Veri Disa/Ice Aktarma** - SSH ana bilgisayarlarini, kimlik bilgilerini ve dosya yoneticisi verilerini disa ve ice aktarin
- **Otomatik SSL Kurulumu** - HTTPS yonlendirmeleriyle yerlesik SSL sertifika olusturma ve yonetimi
- **Modern Arayuz** - React, Tailwind CSS ve Shadcn ile olusturulmus temiz masaustu/mobil uyumlu arayuz. Isik, karanlik, Dracula vb. dahil olmak uzere bircok farkli UI temasi arasından secim yapin. Herhangi bir baglantıyı tam ekranda acmak icin URL yollarini kullanin.
- **Komut Gecmisi** - Daha once calistirilan SSH komutlarini otomatik tamamlayin ve goruntuleyin
- **Hizli Baglanti** - Baglanti verilerini kaydetmeden bir sunucuya baglanin
- **Komut Paleti** - Sol shift tusuna iki kez basarak SSH baglantilariniza klavyenizle hizlica erisin
- **Proxmox Entegrasyonu** - Proxmox ornekinizden Termix'e otomatik olarak ana bilgisayar ekleyin
- **SSH Zengin Ozellikler** - Atlama ana bilgisayarlari, Warpgate, TOTP tabanli baglantilar, SOCKS5, ana bilgisayar anahtar dogrulama, otomatik sifre doldurma, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, terminal gunlukleme vb. destekler.

</details>

<br />

## Platform Destegi

<table align="center">
<tr>
<th align="center">Platform</th>
<th align="center">Dagitim</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Herhangi bir modern tarayici (Chrome, Safari, Firefox) · PWA destegi</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Tasınabilir · MSI Yukleyici · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Tasınabilir · AUR · AppImage · Deb · Flatpak</td>
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

## Kurulum

Termix'i tum platformlara nasil kuracaginiz hakkinda daha fazla bilgi icin Termix [Belgelerine](https://docs.termix.site/install) bakin. Ornek bir Docker Compose dosyasini asagida inceleyebilirsiniz (uzak masaustu ozelliklerini kullanmayi planlamiyorsaniz guacd'yi ve agi cikarabilirsiniz):

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

## Bağış Yapın

Termix, abonelik veya ücretli plan olmayan ücretsiz ve açık kaynaklı bir projedir. Faydalı buluyorsanız, sunucu maliyetleri, alan adları ve geliştirme süresini karşılamaya yardımcı olmak için bağış yapmayı düşünebilirsiniz.

[Bağış Yap](https://donate.termix.site/)

<br />

## Ekran Goruntuleri

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>YouTube'da guncelleme ozetlerini izleyin</sub>

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

<sub>Bazi videolar ve gorseller guncel olmayabilir veya ozellikleri tam olarak yansitmayabilir.</sub>

</div>

<br />

## Planlanan Ozellikler

Tum planlanan ozellikler icin [Projeler](https://github.com/orgs/Termix-SSH/projects/2) sayfasina bakin. Katkida bulunmak istiyorsaniz, [Katkida Bulunma](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md) sayfasina bakin.

<br />

## Sponsorlar

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

## Destek

Termix ile ilgili yardima ihtiyaciniz varsa veya bir ozellik talep etmek istiyorsaniz, [Sorunlar](https://github.com/Termix-SSH/Support/issues) sayfasini ziyaret edin, giris yapin ve `New Issue` butonuna basin. Lutfen sorununuzu mumkun oldugunca ayrintili yazin, tercihen Ingilizce olarak. Ayrica [Discord](https://discord.gg/jVQGdvHDrf) sunucusuna katilabilir ve destek kanalini ziyaret edebilirsiniz, ancak yanit sureleri daha uzun olabilir.

<br />

## Lisans

Apache Lisansi Surumu 2.0 altinda dagitilmaktadir. Daha fazla bilgi icin `LICENSE` dosyasina bakin.
