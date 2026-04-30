# Repo İstatistikleri

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · 🇹🇷 Türkçe · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">1 Eylül 2025'te kazanıldı</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# Genel Bakış

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix, açık kaynaklı, sonsuza kadar ücretsiz, kendi sunucunuzda barındırabileceğiniz hepsi bir arada sunucu yönetim platformudur. Sunucularınızı ve altyapınızı tek bir sezgisel arayüz üzerinden yönetmek için çok platformlu bir çözüm sunar. Termix, SSH terminal erişimi, uzak masaüstü kontrolü (RDP, VNC, Telnet), SSH tünelleme yetenekleri, uzak SSH dosya yönetimi ve daha birçok araç sağlar. Termix, tüm platformlarda kullanılabilen Termius'un mükemmel ücretsiz ve kendi barındırmalı alternatifidir.

# Özellikler

- **SSH Terminal Erişimi** - Tarayıcı benzeri sekme sistemiyle bölünmüş ekran desteğine sahip (4 panele kadar) tam özellikli terminal. Yaygın terminal temaları, yazı tipleri ve diğer bileşenler dahil olmak üzere terminal özelleştirme desteği içerir.
- **Uzak Masaüstü Erişimi** - Tam özelleştirme ve bölünmüş ekran ile tarayıcı üzerinden RDP, VNC ve Telnet desteği
- **SSH Tünel Yönetimi** - Otomatik yeniden bağlanma, sağlık izleme ve yerel, uzak veya dinamik SOCKS yönlendirme desteğiyle sunucular arası SSH tünelleri oluşturun ve yönetin. Masaüstü istemci-sunucu tünel ayarları her masaüstü kurulumu için yerel olarak depolanır; isteğe bağlı C2S hazır ayar anlık görüntüleri sunucuya kaydedilebilir, yeniden adlandırılabilir, yüklenebilir veya silinebilir.
- **Uzak Dosya Yöneticisi** - Uzak sunuculardaki dosyaları doğrudan yönetin; kod, görüntü, ses ve video görüntüleme ve düzenleme desteğiyle. Sudo desteğiyle dosyaları sorunsuzca yükleyin, indirin, yeniden adlandırın, silin ve taşıyın.
- **Docker Yönetimi** - Konteynerleri başlatın, durdurun, duraklatın, kaldırın. Konteyner istatistiklerini görüntüleyin. Docker exec terminali kullanarak konteyneri kontrol edin. Portainer veya Dockge'nin yerini almak için değil, konteynerlerinizi oluşturmak yerine basitçe yönetmek için tasarlanmıştır.
- **SSH Ana Bilgisayar Yöneticisi** - SSH bağlantılarınızı etiketler ve klasörlerle kaydedin, düzenleyin ve yönetin; yeniden kullanılabilir giriş bilgilerini kolayca kaydedin ve SSH anahtarlarının dağıtımını otomatikleştirin
- **Sunucu İstatistikleri** - Çoğu Linux tabanlı sunucularda CPU, bellek ve disk kullanımını ağ, çalışma süresi, sistem bilgisi, güvenlik duvarı, port izleme ile birlikte görüntüleyin
- **Kontrol Paneli** - Kontrol panelinizde sunucu bilgilerini bir bakışta görüntüleyin
- **RBAC** - Roller oluşturun ve ana bilgisayarları kullanıcılar/roller arasında paylaşın
- **Kullanıcı Kimlik Doğrulama** - Yönetici kontrolleri, OIDC (erişim kontrollü) ve 2FA (TOTP) desteğiyle güvenli kullanıcı yönetimi. Tüm platformlardaki aktif kullanıcı oturumlarını görüntüleyin ve izinleri iptal edin. OIDC/Yerel hesaplarınızı birbirine bağlayın.
- **Veritabanı Şifreleme** - Arka uç, şifrelenmiş SQLite veritabanı dosyaları olarak depolanır. Daha fazla bilgi için [belgelere](https://docs.termix.site/security) bakın.
- **API Anahtarları** - Otomasyon/CI için kullanılmak üzere son kullanma tarihleriyle kullanıcı kapsamlı API anahtarları oluşturun.
- **Veri Dışa/İçe Aktarma** - SSH ana bilgisayarlarını, kimlik bilgilerini ve dosya yöneticisi verilerini dışa ve içe aktarın
- **Otomatik SSL Kurulumu** - HTTPS yönlendirmeleriyle yerleşik SSL sertifika oluşturma ve yönetimi
- **Modern Arayüz** - React, Tailwind CSS ve Shadcn ile oluşturulmuş temiz masaüstü/mobil uyumlu arayüz. Işık, karanlık, Dracula vb. dahil olmak üzere birçok farklı UI teması arasından seçim yapın. Herhangi bir bağlantıyı tam ekranda açmak için URL yollarını kullanın.
- **Diller** - ~30 dil için yerleşik destek ([Crowdin](https://docs.termix.site/translations) tarafından yönetilir)
- **Platform Desteği** - Web uygulaması, masaüstü uygulaması (Windows, Linux ve macOS, Termix arka ucu olmadan tek başına çalıştırılabilir), PWA ve iOS ile Android için özel mobil/tablet uygulaması olarak kullanılabilir.
- **SSH Araçları** - Tek tıklamayla çalıştırılan yeniden kullanılabilir komut parçacıkları oluşturun. Birden fazla açık terminalde aynı anda tek bir komut çalıştırın.
- **Komut Geçmişi** - Daha önce çalıştırılan SSH komutlarını otomatik tamamlayın ve görüntüleyin
- **Hızlı Bağlantı** - Bağlantı verilerini kaydetmeden bir sunucuya bağlanın
- **Komut Paleti** - Sol shift tuşuna iki kez basarak SSH bağlantılarına klavyenizle hızlıca erişin
- **SSH Zengin Özellikler** - Atlama ana bilgisayarları, Warpgate, TOTP tabanlı bağlantılar, SOCKS5, ana bilgisayar anahtar doğrulama, otomatik şifre doldurma, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking vb. destekler.
- **Ağ Grafiği** - Kontrol panelinizi, SSH bağlantılarınıza dayalı olarak ev laboratuvarınızı durum desteğiyle görselleştirmek için özelleştirin
- **Kalıcı Sekmeler** - Kullanıcı profilinde etkinleştirilmişse SSH oturumları ve sekmeler cihazlar/yenilemeler arasında açık kalır

# Planlanan Özellikler

Tüm planlanan özellikler için [Projeler](https://github.com/orgs/Termix-SSH/projects/2) sayfasına bakın. Katkıda bulunmak istiyorsanız, [Katkıda Bulunma](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md) sayfasına bakın.

# Kurulum

Desteklenen Cihazlar:

- Web sitesi (Chrome, Safari ve Firefox gibi herhangi bir platformda herhangi bir modern tarayıcı) (PWA desteği dahil)
- Windows (x64/ia32)
  - Taşınabilir
  - MSI Yükleyici
  - Chocolatey Paket Yöneticisi
- Linux (x64/ia32)
  - Taşınabilir
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (v12.0+ üzerinde x64/ia32)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

Termix'i tüm platformlara nasıl kuracağınız hakkında daha fazla bilgi için Termix [Belgelerine](https://docs.termix.site/install) bakın. Aksi takdirde, örnek bir Docker Compose dosyasını burada görüntüleyin (uzak masaüstü özelliklerini kullanmayı planlamıyorsanız guacd'yi ve ağı çıkarabilirsiniz):

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

# Sponsorlar

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

# Destek

Termix ile ilgili yardıma ihtiyacınız varsa veya bir özellik talep etmek istiyorsanız, [Sorunlar](https://github.com/Termix-SSH/Support/issues) sayfasını ziyaret edin, giriş yapın ve `New Issue` butonuna basın.
Lütfen sorununuzu mümkün olduğunca ayrıntılı yazın, tercihen İngilizce olarak. Ayrıca [Discord](https://discord.gg/jVQGdvHDrf) sunucusuna katılabilir ve destek kanalını ziyaret edebilirsiniz, ancak yanıt süreleri daha uzun olabilir.

# Ekran Görüntüleri

[![YouTube](../repo-images/YouTube.jpg)](https://www.youtube.com/@TermixSSH/videos)

<p align="center">
  <img src="../repo-images/Image%201.png" width="400" alt="Termix Demo 1"/>
  <img src="../repo-images/Image 2.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="../repo-images/Image 3.png" width="400" alt="Termix Demo 3"/>
  <img src="../repo-images/Image 4.png" width="400" alt="Termix Demo 4"/>
</p>

<p align="center">
  <img src="../repo-images/Image 5.png" width="400" alt="Termix Demo 5"/>
  <img src="../repo-images/Image 6.png" width="400" alt="Termix Demo 6"/>
</p>

<p align="center">
  <img src="../repo-images/Image 7.png" width="400" alt="Termix Demo 7"/>
  <img src="../repo-images/Image 8.png" width="400" alt="Termix Demo 8"/>
</p>

<p align="center">
  <img src="../repo-images/Image 9.png" width="400" alt="Termix Demo 9"/>
  <img src="../repo-images/Image%2010.png" width="400" alt="Termix Demo 10"/>
</p>

<p align="center">
  <img src="../repo-images/Image%2011.png" width="400" alt="Termix Demo 11"/>
  <img src="../repo-images/Image%2012.png" width="400" alt="Termix Demo 12"/>
</p>

Bazı videolar ve görseller güncel olmayabilir veya özellikleri tam olarak yansıtmayabilir.

# Lisans

Apache Lisansı Sürüm 2.0 altında dağıtılmaktadır. Daha fazla bilgi için LICENSE dosyasına bakın.
