<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Quan ly SSH tu luu tru va truy cap may tinh tu xa</p>

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
  <a href="README-TR.md">Türkçe</a> ·
  Tiếng Việt ·
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
  <sub>Dat duoc vao ngay 1 thang 9 nam 2025</sub>
</p>

</div>

<br />

## Tong Quan

Termix la nen tang quan ly may chu tat ca trong mot, ma nguon mo, mien phi vinh vien, tu luu tru. No cung cap giai phap da nen tang de quan ly may chu va co so ha tang cua ban thong qua mot giao dien truc quan duy nhat. Termix cung cap quyen truy cap terminal SSH, dieu khien may tinh tu xa (RDP, VNC, Telnet), kha nang tao duong ham SSH, quan ly tep SSH tu xa va nhieu cong cu khac. Termix la giai phap thay the mien phi va tu luu tru hoan hao cho Termius, kha dung tren tat ca cac nen tang.

<br />

## Tinh Nang

<table>
<tr>
<td width="50%" valign="top">

**Truy Cap Terminal SSH:**
Terminal day du tinh nang voi ho tro chia man hinh (len den 4 bang) voi he thong tab kieu trinh duyet. Bao gom ho tro tuy chinh terminal bao gom cac chu de terminal pho bien, phong chu va cac thanh phan khac.

</td>
<td width="50%" valign="top">

**Truy Cap Man Hinh Tu Xa:**
Ho tro RDP, VNC va Telnet qua trinh duyet voi day du tuy chinh va chia man hinh.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Quan Ly Duong Ham SSH:**
Tao va quan ly duong ham SSH giua cac may chu voi tu dong ket noi lai, giam sat suc khoe va chuyen tiep cuc bo, tu xa hoac SOCKS dong. Cai dat duong ham tu may khach desktop den may chu duoc luu tru cuc bo cho moi ban cai dat desktop; cac snapshot C2S preset tuy chon co the duoc luu tren may chu, doi ten, tai hoac xoa de di chuyen cau hinh duong ham cuc bo giua cac may khach.

</td>
<td width="50%" valign="top">

**Trinh Quan Ly Tep Tu Xa:**
Quan ly tep truc tiep tren may chu tu xa voi ho tro xem va chinh sua ma, hinh anh, am thanh va video. Tai len, tai xuong, doi ten, xoa va di chuyen tep lien mach voi ho tro sudo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Quan Ly Docker:**
Khoi dong, dung, tam dung, xoa container. Xem thong ke container. Dieu khien container bang terminal docker exec. Khong duoc tao ra de thay the Portainer hay Dockge ma don gian la de quan ly container cua ban thay vi tao moi chung.

</td>
<td width="50%" valign="top">

**Trinh Quan Ly May Chu SSH:**
Luu, sap xep va quan ly cac ket noi SSH cua ban voi the va thu muc, de dang luu thong tin dang nhap co the tai su dung dong thoi co the tu dong hoa viec trien khai khoa SSH.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Thong Ke May Chu:**
Xem muc su dung CPU, bo nho va o dia cung voi mang, thoi gian hoat dong, thong tin he thong, tuong lua, giam sat cong tren hau het cac may chu chay Linux.

</td>
<td width="50%" valign="top">

**Xac Thuc Nguoi Dung:**
Quan ly nguoi dung an toan voi quyen quan tri va ho tro OIDC (co kiem soat truy cap) va 2FA (TOTP). Xem phien hoat dong cua nguoi dung tren tat ca cac nen tang va thu hoi quyen. Lien ket tai khoan OIDC/Noi bo cua ban voi nhau.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
Tao vai tro va chia se may chu giua nguoi dung/vai tro.

</td>
<td width="50%" valign="top">

**Ma Hoa Co So Du Lieu:**
Backend duoc luu tru duoi dang tep co so du lieu SQLite duoc ma hoa. Xem [tai lieu](https://docs.termix.site/security) de biet them.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Bieu Do Mang:**
Tuy chinh Bang Dieu Khien de truc quan hoa homelab cua ban dua tren cac ket noi SSH voi ho tro trang thai.

</td>
<td width="50%" valign="top">

**Cong Cu SSH:**
Tao doan lenh co the tai su dung, thuc thi chi voi mot cu nhap chuot. Chay mot lenh dong thoi tren nhieu terminal dang mo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tab Lien Tuc:**
Cac phien SSH va tab van mo tren cac thiet bi/lan lam moi neu duoc bat trong ho so nguoi dung.

</td>
<td width="50%" valign="top">

**Ngon Ngu:**
Ho tro tich hop khoang 30 ngon ngu (duoc quan ly boi [Crowdin](https://docs.termix.site/translations)).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Them tinh nang</b></summary>
<br />

- **Bang Dieu Khien** - Xem thong tin may chu trong nháy mat tren bang dieu khien cua ban
- **Khoa API** - Tao khoa API theo pham vi nguoi dung voi ngay het han de su dung cho tu dong hoa/CI
- **Xuat/Nhap Du Lieu** - Xuat va nhap may chu SSH, thong tin xac thuc va du lieu trinh quan ly tep
- **Thiet Lap SSL Tu Dong** - Tao va quan ly chung chi SSL tich hop voi chuyen huong HTTPS
- **Giao Dien Hien Dai** - Giao dien sach se, than thien voi may tinh/di dong duoc xay dung bang React, Tailwind CSS va Shadcn. Chon giua nhieu chu de UI khac nhau bao gom sang, toi, Dracula, v.v. Su dung duong dan URL de mo bat ky ket noi nao o che do toan man hinh.
- **Lich Su Lenh** - Tu dong hoan thanh va xem cac lenh SSH da chay truoc do
- **Ket Noi Nhanh** - Ket noi den may chu ma khong can luu du lieu ket noi
- **Bang Lenh** - Nhan dup phim shift trai de truy cap nhanh cac ket noi SSH bang ban phim
- **SSH Giau Tinh Nang** - Ho tro jump host, Warpgate, ket noi dua tren TOTP, SOCKS5, xac minh khoa may chu, tu dong dien mat khau, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, v.v.

</details>

<br />

## Ho Tro Nen Tang

<table align="center">
<tr>
<th align="center">Nen tang</th>
<th align="center">Phan phoi</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Bat ky trinh duyet hien dai nao (Chrome, Safari, Firefox) · Ho tro PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portable · MSI Installer · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portable · AUR · AppImage · Deb · Flatpak</td>
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

## Cai Dat

Truy cap [Tai Lieu](https://docs.termix.site/install) Termix de biet them thong tin ve cach cai dat Termix tren tat ca cac nen tang. Ngoai ra, xem tep Docker Compose mau tai day (ban co the bo qua guacd va mang neu khong co y dinh su dung cac tinh nang dieu khien may tinh tu xa):

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

## Anh Chup Man Hinh

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Xem tong quan cap nhat tren YouTube</sub>

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

<sub>Mot so video va hinh anh co the da loi thoi hoac khong the hien chinh xac hoan toan cac tinh nang.</sub>

</div>

<br />

## Tinh Nang Du Kien

Xem [Du An](https://github.com/orgs/Termix-SSH/projects/2) de biet tat ca cac tinh nang du kien. Neu ban muon dong gop, xem [Dong Gop](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Nha Tai Tro

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

## Ho Tro

Neu ban can tro giup hoac muon yeu cau tinh nang voi Termix, hay truy cap trang [Van De](https://github.com/Termix-SSH/Support/issues), dang nhap va nhan `New Issue`. Vui long mo ta van de cang chi tiet cang tot, uu tien viet bang tieng Anh. Ban cung co the tham gia may chu [Discord](https://discord.gg/jVQGdvHDrf) va truy cap kenh ho tro, tuy nhien thoi gian phan hoi co the lau hon.

<br />

## Giay Phep

Duoc phan phoi theo Giay Phep Apache Phien Ban 2.0. Xem `LICENSE` de biet them thong tin.
