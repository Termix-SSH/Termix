<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Kendi sunucunuzda çalışan sunucu yönetimi, SSH ve uzak masaüstünden otomasyonlara kadar</p>

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
  <a href="https://donate.termix.site/"><img alt="Donate" src="https://img.shields.io/badge/Donate-Support%20Termix-F39044?style=flat&labelColor=1a1a1a" /></a>
</p>

<p>
  <a href="https://donate.termix.site/"><img alt="Donations this month" src="https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=Donations%20this%20month&query=%24.fiatTotal&prefix=%24&url=https%3A%2F%2Ftermix.site%2Fdonation-snapshot.json&color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

Termix ücretsiz ve açık kaynaklıdır. İşinize yarıyorsa, sunucu masraflarına ve geliştirme süresine katkı için [bağış yapmayı](https://donate.termix.site/) düşünün.

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>1 Eylül 2025 tarihinde kazanıldı</sub>
</p>

</div>

<br />

## Genel bakış

Termix, sunucularınızı yönetmek için ücretsiz, açık kaynaklı ve kendi sunucunuzda çalışan bir platformdur. SSH terminallerini, uzak masaüstlerini (RDP, VNC, Telnet), dosya aktarımlarını, tünelleri, Docker'ı, ölçümleri ve otomasyonları tek yerde toplar; web, masaüstü ve mobilde çalışır. Sonsuza dek ücretsiz kalan, kendi sunucunuzda çalışan bir Termius alternatifidir.

<br />

## Özellikler

<table>
<tr>
<td width="50%" valign="top">

**SSH terminali:**
Tarayıcı gibi sekmeleri ve bölünmüş ekranı olan tam donanımlı bir terminal, aynı anda 6 panele kadar. Temanızı, yazı tipinizi ve renklerinizi seçin. Her oturumun üstünde anlık CPU, bellek ve disk bilgisi gösteren bir araç çubuğu ile o sunucunun dosyalarına, Docker'ına, tünellerine ve ölçümlerine giden kısayollar bulunur.

</td>
<td width="50%" valign="top">

**Uzak masaüstü:**
Tarayıcıda RDP, VNC ve Telnet; diğer oturumlar gibi sekmelerde ve bölünmüş ekranda. RDP sürücüleri için dosya tarayıcısı ve sürükle bırak yükleme içerir. Windows masaüstünde bir sunucuyu yerel RDP istemcisinde de açabilirsiniz.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH tünelleri:**
Yerel, uzak ve dinamik SOCKS yönlendirmesi; otomatik yeniden bağlanma ve durum kontrolleriyle. Masaüstü uygulamasındaki istemciden sunucuya tüneller o makinede saklanır, ayarları sunucuya kaydederek bir kurulumu başka bir makineye taşıyabilirsiniz.

</td>
<td width="50%" valign="top">

**Dosya yöneticisi:**
SFTP üzerinden dosyalara göz atın, düzenleyin, yükleyin, indirin, yeniden adlandırın, taşıyın ve silin; sudo da kullanılabilir. Kod, görsel, ses ve videoyu görüntüleyip düzenleyin. Dosyaları doğrudan bir sunucudan diğerine kopyalayın; en hızlı yol sizin için seçilir ve aktarımların bütünlüğü doğrulanır.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker ve Podman:**
Kapsayıcıları başlatın, durdurun, duraklatın ve silin, durumlarını izleyin ve içlerinde bir kabuk açın. Hem Docker hem Podman ile çalışır. Portainer ya da Dockge'nin yerini almak için değil, hâlihazırdaki kapsayıcılarınızı yönetmek için tasarlandı.

</td>
<td width="50%" valign="top">

**Sunucu yöneticisi:**
Sunucularınızı etiketlerle ve isim ve renk verebileceğiniz iç içe klasörlerle düzenleyin. Kayıtlı kimlik bilgilerini birden çok sunucuda kullanın, SSH anahtarlarını otomatik dağıtın, sunucuları bir üst sunucunun altında toplayın, toplu düzenleyip dışa aktarın ve kaydetmek istemediğiniz tek seferlik bağlantılar için hızlı bağlantıyı kullanın.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Sunucu ölçümleri:**
Çoğu Linux sunucusunda CPU, bellek, disk, ağ, sıcaklık, çalışma süresi, süreçler, portlar, oturum açmalar ve sistem bilgisi; geçmiş grafikleriyle birlikte. Yönetim kartları sayesinde servisleri, cron görevlerini, paketleri, kullanıcıları, güvenlik duvarı kurallarını, WireGuard'ı, Tailscale'i, SSL sertifikalarını, günlükleri ve sağlık kontrollerini Termix'ten çıkmadan yönetirsiniz.

</td>
<td width="50%" valign="top">

**Otomasyonlar:**
Bir tetikleyici seçin, sonra ne olacağını söyleyin. Tetikleyiciler arasında bir ölçümün eşiği aşması, bir sunucunun düşmesi veya geri gelmesi, sağlık kontrolünün değişmesi, bir zamanlama, bir kapsayıcı olayı ya da gelen bir webhook var. Adımlar komut ve parçacık çalıştırabilir, kapsayıcı ve tünelleri yönetebilir, bir makineyi uyandırabilir, bir adrese istek atabilir, bekleyebilir, koşula göre dallanabilir, başka bir otomasyonu çalıştırabilir ve ntfy, Discord ya da webhook ile size haber verebilir. Deneme çalıştırmaları ile önce güvenle test edersiniz.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Filolar:**
Sunucuları tek tek seçerek ya da etiket kurallarıyla bir filoda toplayın; yeni sunucular kendiliğinden katılsın. Tek bir komutu tüm sunucularda aynı anda çalıştırın, hepsine dosya gönderip hepsinden dosya alın, paket kurun ve işletim sistemi, çekirdek, mimari ve çalışma süresi dökümünü toplayın.

</td>
<td width="50%" valign="top">

**Yapay zekâ asistanı:**
İsteğe bağlıdır ve siz açana kadar kapalıdır. OpenAI, Anthropic, Gemini, Ollama ya da OpenAI uyumlu herhangi bir uç noktayı bağlayın ve kurulumunuz hakkında sorular sorun. Sunucuları, filoları, parçacıkları ve uyarıları okuyabilir; değişiklikleri kendisi yapmak yerine onayınıza sunar. Kimlik bilgilerine, kullanıcılara ve ayarlara asla erişemez. Yöneticiler tüm kurulum için kapalı bırakabilir, siz de kurulum sırasında gizleyebilirsiniz.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Giriş ve kullanıcılar:**
Yerel hesapların yanında OIDC, LDAP, GitHub ve Google ile giriş; iki adımlı doğrulama (TOTP), geçiş anahtarları (WebAuthn) ve güvenilir cihazlar. Yöneticiler kullanıcıları yönetebilir, OIDC gruplarını rollerle eşleştirebilir, tüm platformlardaki etkin oturumları görüp sonlandırabilir. Yerel ve OIDC hesaplarınızı birbirine bağlayın ve herkesin ne yaptığını denetim günlüğünden okuyun.

</td>
<td width="50%" valign="top">

**Roller ve paylaşım:**
Roller oluşturun ve sunucuları kullanıcılar veya rollerle dört düzeyde paylaşın: bağlanma, görüntüleme, düzenleme ve yönetme. Tüm kimlik doğrulama türleri ve tüm protokollerle çalışır, paylaşılan bir sunucuda kullanılan kimlik bilgilerini değiştirebilirsiniz.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Uyarılar:**
CPU, bellek ve disk gibi sunucu ölçümlerine kurallar koyun ve tetiklendiklerinde ntfy, Discord veya webhook ile haberdar olun. Devam eden ve çözülen uyarıları geçmişte görün, ilgilenmediklerinizi kapatın.

</td>
<td width="50%" valign="top">

**Ana sayfa:**
Kendi kurduğunuz, sürükle bırak çalışan bir bileşen ızgarası. Sunucu durumu, ping, servis bağlantıları, yer imleri, arama, saatler, takvimler, geri sayımlar, notlar, RSS, hava durumu, görseller, gömülü sayfalar, Docker, tüneller, ölçüm grafikleri, kendi API'leriniz ve hatta canlı bir terminal için bileşenler var.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Parçacıklar ve araçlar:**
Sık kullandığınız komutları kaydedin ve tek tıkla çalıştırın; sunucu için ve kendi girdileriniz için değişkenler kullanabilirsiniz. Aynı komutu açık olan tüm terminallerde çalıştırın, komut geçmişinizde tamamlamayla arama yapın.

</td>
<td width="50%" valign="top">

**Oturum paylaşımı:**
Canlı bir terminal, RDP, VNC veya Telnet oturumunu paylaşın. Hesap gerekmeden katılınabilen bir bağlantı gönderin ya da belirli bir Termix kullanıcısıyla, salt okunur veya yazma yetkili olarak paylaşın. Paylaşımlar kendiliğinden sona erebilir veya istediğiniz an iptal edilebilir; tümüyle ya da sunucu bazında kapatılabilir.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Oturum kaydı ve günlükler:**
Terminal, RDP ve VNC oturumlarını kaydedin ve sonra izleyin. Bir oturumun düz metin günlüğünü indirin, bağlantı günlüğüne bakarak bağlantı sırasında tam olarak ne olduğunu görün.

</td>
<td width="50%" valign="top">

**Seri bağlantılar:**
Yönlendirici, anahtar ve mikrodenetleyici gibi seri cihazlarla tarayıcıdan veya masaüstü uygulamasından konuşun. Baud hızını, veri bitlerini, dur bitlerini ve pariteyi ayarlayın. Destekleyen tarayıcılarda Web Serial API'yi, masaüstü uygulamasında yerel bir arka ucu kullanır.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Tailnet'inizdeki cihazları çekip birkaç tıkla sunucu olarak ekleyin ve Tailscale SSH ile bağlanın; erişimi tailnet kurallarınız yönetsin, kimlik bilgisi saklamanız gerekmesin. Headscale ve özel uç noktalar da çalışır.

</td>
<td width="50%" valign="top">

**Proxmox:**
Sunucuları doğrudan bir Proxmox kurulumundan içe aktarın; düğüm ve misafir makinelerin CPU, bellek ve depolama dahil durumlarını kendi sekmesinde izleyin.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Çalışma alanları ve sekmeler:**
Bir sekme grubunu bölünmüş düzeniyle birlikte kaydedin ve hepsini tek tıkla yeniden açın. Termix son oturumunuzu da hatırlar, böylece sayfayı yenileseniz de başka cihaza geçseniz de sekmeleriniz geri gelir.

</td>
<td width="50%" valign="top">

**Rehberli kurulum:**
Kısa bir kurulum, arayüz ön ayarını, temanızı, istediğiniz özellikleri ve ilk sunucunuzu seçmenizde size yol gösterir. Basit kip kullanmadığınız şeyleri gizler; kurulumu istediğiniz zaman yeniden çalıştırabilir veya ön ayarı değiştirebilirsiniz.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Bağımsız masaüstü ve eşitleme:**
Masaüstü uygulaması kendi arka ucu ve veritabanıyla tek başına, sunucusuz çalışır. İsterseniz bir Termix sunucusuna bağlayıp sunucuları, kimlik bilgilerini, parçacıkları ve fazlasını iki yönlü eşitleyebilir, bağlantıların kendi makinenizden mi yoksa sunucu üzerinden mi kurulacağını seçebilirsiniz.

</td>
<td width="50%" valign="top">

**Komut satırı:**
Kabuğunuz ve betikleriniz için bir `termix` CLI'ı. Terminal açın, tek bir sunucuda veya tüm filoda komut çalıştırın, SFTP ile dosya taşıyın ve sunucuları, parçacıkları ve kimlik bilgilerini yönetin. `npm install -g @termix-cli/cli` ile kurun ya da bağımsız bir çalıştırılabilir dosya edinin. [CLI belgelerine](https://docs.termix.site/cli) bakın.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Güvenlik:**
Parolalar, anahtarlar ve diğer gizli bilgiler kullanıcı bazında şifrelenir, veritabanı dosyalarının kendisi de diskte şifrelenebilir. Nasıl çalıştığı için [belgelere](https://docs.termix.site/security) bakın.

</td>
<td width="50%" valign="top">

**Diller:**
Yaklaşık 30 dil yerleşik olarak gelir, [Crowdin](https://docs.termix.site/translations) üzerinden yönetilir.

</td>
</tr>
</table>

<br />

<details>
<summary><b>Daha fazla özellik</b></summary>
<br />

- **Kontrol paneli** - Kendi dizdiğiniz kartlarla sunucularınıza tek bakışta göz atın
- **Ağ grafiği** - Ev laboratuvarınız sunucularınızdan çizilir, durum anlık gösterilir
- **Tmux izleyici** - tmux oturumlarına, pencerelerine ve panellerine önizleme ve aramayla göz atın
- **API anahtarları** - Betikler ve CI için, son kullanma tarihli kullanıcıya özel anahtarlar
- **Dışa ve içe aktarma** - Sunucuları, kimlik bilgilerini ve dosya yöneticisi verilerini taşıyın
- **Otomatik SSL** - Sertifikalar sizin için oluşturulur ve yenilenir, HTTPS yönlendirmesiyle birlikte; ya da kendi sertifikanızı kullanın
- **Veritabanları** - Varsayılan SQLite, ayrıca PostgreSQL ve MySQL desteklenir
- **Modern arayüz** - Masaüstü ve mobilde çalışan sade bir React arayüzü; açık, koyu ve Dracula gibi temalarla. Her bağlantı bir adresten tam ekran açılabilir
- **Komut paleti** - Sol Shift'e iki kez basarak klavyeden bir sunucuya atlayın
- **Klavye kısayolları** - Sekmeler arasında geçiş, sekme kapatma ve dahası, hepsi yeniden atanabilir
- **Wake-on-LAN** - Bir makineyi Termix'ten ya da bir otomasyon adımından uyandırın
- **Güvenilir vekil doğrulaması** - Girişi ters vekil sunucu halletsin ve kullanıcıyı aktarsın
- **Zengin SSH desteği** - Atlama sunucuları, Warpgate, TOTP istekleri, SOCKS5, sunucu anahtarı doğrulama, parola otomatik doldurma, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, terminal günlüğü, aracı yönlendirme, Bitwarden SSH aracısı, HashiCorp Vault ile SSH imzalama ve dahası
- **Termix ID** - sshid.io'nun yerleşik hali. Bir kullanıcı adı alın, açık anahtarlarınızı bir çözümleyici adresinde yayımlayın ve yerleşik CA ile SSH sertifikaları çıkarın

</details>

<br />

## Platform desteği

<table align="center">
<tr>
<th align="center">Platform</th>
<th align="center">Dağıtım</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Güncel her tarayıcı (Chrome, Safari, Firefox) · PWA desteği</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Taşınabilir · MSI kurulumu · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Taşınabilir · AUR · AppImage · Deb · Flatpak</td>
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

Tüm platformlar için ayrıntılı kurulum yönergelerini [Termix belgelerinde](https://docs.termix.site/install) bulabilirsiniz.

Örnek Docker Compose dosyası (uzak masaüstünü kullanmayacaksanız `guacd` ve ağ kısmını çıkarabilirsiniz):

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

### Komut satırı

Termix'in bir CLI'ı da var; sunucularınızı terminalden yönetebilir ve Termix'i kendi betiklerinizde kullanabilirsiniz.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

Terminal açabilir, tek bir sunucuda veya tüm filoda komut çalıştırabilir, SFTP ile dosya taşıyabilir ve sunucuları, parçacıkları ve kimlik bilgilerini yönetebilir. Belgelerin tamamı [docs.termix.site/cli](https://docs.termix.site/cli) adresinde.

### Bulutta barındırma

Termix sunucusunu kendi ağınız yerine bir VPS üzerinde de çalıştırabilirsiniz. Termix yönettiği ağın içinde çalışıyorsa, bir kesinti onu da beraberinde götürür; hem de tam onu tamir için kullanmanız gereken anda. Dışarıda çalıştırmak erişilebilir kalmasını sağlar, sabit bir IP verir ve VPN ya da port yönlendirme olmadan her yerden girmenize izin verir.

[GINERNET](https://docs.termix.site/install/ginernet) Termix'e sponsor oluyor ve belgelerde onların VPS platformuna kurulum için adım adım bir rehber var.

<br />

## Telemetri

Termix günde bir kez küçük ve anonim bir sinyal gönderir; böylece kaç kurulumun çalıştığını ve hangi özelliklerin kullanıldığını görebiliyorum. İçinde rastgele bir kurulum kimliği, kaç kullanıcı ve sunucunuz olduğu, uygulama sürümü ve son 24 saatte hangi özelliklerin (terminal, dosya yöneticisi, tüneller, docker vb.) kullanıldığı yer alır. İçinde asla kullanıcı adları, sunucu adları, IP adresleri, kimlik bilgileri ya da sizi veya sunucularınızı tanımlayan başka bir şey bulunmaz.

Varsayılan olarak açıktır. Yönetici ayarlarında Genel bölümünden kapatabilir ya da Termix'i hiç başlatmadan önce `ENABLE_TELEMETRY=false` tanımlayabilirsiniz.

<br />

## Bağış

Termix ücretsiz ve açık kaynaklıdır; abonelik ya da ücretli plan yoktur. İşinize yarıyorsa, sunucu, alan adı ve geliştirme süresi masraflarına katkı için bağış yapmayı düşünün. Bağışlar ayrıca SAML, Kubernetes ve aracı desteği gibi özellikler için gereken araştırma ve öğrenme süresini karşılar. İlerlemeyi aşağıdan izleyip bağış yapabilirsiniz.

[Bağış yap](https://donate.termix.site/)

<br />

## Sponsorlar

Geliştirmeyi desteklemek için ücretli bir yerleşim ilginizi çeker mi? [mail@termix.site](mailto:mail@termix.site) adresine yazın.

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

## Destek

Yardıma mı ihtiyacınız var ya da bir özellik mi istiyorsunuz? [Yeni bir konu](https://github.com/Termix-SSH/Support/issues) açın ve olabildiğince ayrıntı ekleyin, mümkünse İngilizce yazın. [Discord](https://discord.gg/jVQGdvHDrf) üzerindeki destek kanalında da sorabilirsiniz, ancak oradaki yanıtlar daha uzun sürebilir.

<br />

## Ekran görüntüleri

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Güncelleme tanıtımlarını YouTube'da izleyin</sub>

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

<sub>Bazı videolar ve görseller güncelliğini yitirmiş ya da özellikleri tam olarak göstermiyor olabilir.</sub>

</div>

<br />

## Planlanan özellikler

Planlanan tüm özellikler [Projects](https://github.com/orgs/Termix-SSH/projects/5) sayfasında. Katkıda bulunmak isterseniz [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md) dosyasına bakın.

<br />

## Lisans

Apache Lisansı Sürüm 2.0 ile dağıtılır. Ayrıntılar için `LICENSE` dosyasına bakın.
