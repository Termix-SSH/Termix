<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Quản lý máy chủ tự lưu trữ, từ SSH và máy tính từ xa cho đến tự động hoá</p>

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
  <a href="https://donate.termix.site/"><img alt="Donate" src="https://img.shields.io/badge/Donate-Support%20Termix-F39044?style=flat&labelColor=1a1a1a" /></a>
</p>

<p>
  <a href="https://donate.termix.site/"><img alt="Donations this month" src="https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=Donations%20this%20month&query=%24.fiatTotal&prefix=%24&url=https%3A%2F%2Ftermix.site%2Fdonation-snapshot.json&color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

Termix miễn phí và mã nguồn mở. Nếu bạn thấy hữu ích, hãy cân nhắc [quyên góp](https://donate.termix.site/) để giúp trang trải chi phí máy chủ và thời gian phát triển.

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Đạt được vào ngày 1 tháng 9 năm 2025</sub>
</p>

</div>

<br />

## Tổng quan

Termix là nền tảng miễn phí, mã nguồn mở, tự lưu trữ để quản lý máy chủ của bạn. Nó gom vào một chỗ terminal SSH, máy tính từ xa (RDP, VNC, Telnet), truyền tệp, tunnel, Docker, số liệu và tự động hoá, trên web, máy tính và điện thoại. Đây là bản thay thế tự lưu trữ cho Termius và sẽ miễn phí mãi mãi.

<br />

## Tính năng

<table>
<tr>
<td width="50%" valign="top">

**Terminal SSH:**
Một terminal đầy đủ với các thẻ giống trình duyệt và chia đôi màn hình, tối đa 6 khung cùng lúc. Bạn tự chọn giao diện, phông chữ và màu sắc. Phía trên mỗi phiên có một thanh công cụ hiện CPU, bộ nhớ và ổ đĩa theo thời gian thực, kèm lối tắt tới tệp, Docker, tunnel và số liệu của máy chủ đó.

</td>
<td width="50%" valign="top">

**Máy tính từ xa:**
RDP, VNC và Telnet ngay trong trình duyệt, dùng thẻ và chia đôi màn hình như mọi phiên khác. Có trình duyệt tệp cho ổ đĩa RDP và tải lên bằng cách kéo thả. Trên máy tính Windows, bạn còn có thể mở máy chủ bằng ứng dụng RDP của hệ điều hành.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tunnel SSH:**
Chuyển tiếp cục bộ, từ xa và SOCKS động, có tự kết nối lại và kiểm tra tình trạng. Tunnel từ máy khách tới máy chủ trong ứng dụng máy tính được lưu ngay trên máy đó, và bạn có thể lưu cấu hình sẵn lên máy chủ để mang sang máy khác.

</td>
<td width="50%" valign="top">

**Trình quản lý tệp:**
Duyệt, sửa, tải lên, tải xuống, đổi tên, di chuyển và xoá tệp qua SFTP, có hỗ trợ sudo. Xem và sửa mã nguồn, hình ảnh, âm thanh và video. Sao chép tệp thẳng từ máy chủ này sang máy chủ khác, hệ thống tự chọn đường nhanh nhất và kiểm tra tính toàn vẹn khi truyền.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker và Podman:**
Khởi động, dừng, tạm dừng và xoá container, xem thông số của chúng và mở một shell bên trong. Chạy được với cả Docker lẫn Podman. Nó không nhằm thay thế Portainer hay Dockge, chỉ để quản lý những container bạn đã có.

</td>
<td width="50%" valign="top">

**Quản lý máy chủ:**
Lưu và sắp xếp máy chủ bằng thẻ và thư mục lồng nhau mà bạn có thể đặt tên và tô màu. Dùng lại thông tin đăng nhập đã lưu cho nhiều máy chủ, tự động triển khai khoá SSH, gom máy chủ dưới một máy chủ cha, sửa và xuất hàng loạt, và dùng kết nối nhanh cho những lần kết nối một lần mà bạn không muốn lưu.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Số liệu máy chủ:**
CPU, bộ nhớ, ổ đĩa, mạng, nhiệt độ, thời gian hoạt động, tiến trình, cổng, lượt đăng nhập và thông tin hệ thống trên hầu hết máy chủ Linux, kèm biểu đồ lịch sử. Các thẻ quản lý cho phép bạn xử lý dịch vụ, tác vụ cron, gói phần mềm, người dùng, luật tường lửa, WireGuard, Tailscale, chứng chỉ SSL, nhật ký và kiểm tra tình trạng mà không cần rời Termix.

</td>
<td width="50%" valign="top">

**Tự động hoá:**
Chọn một điều kiện kích hoạt, rồi nói bạn muốn điều gì xảy ra. Điều kiện gồm một số liệu vượt ngưỡng, một máy chủ sập hoặc sống lại, kiểm tra tình trạng thay đổi, một lịch định sẵn, một sự kiện container, hoặc một webhook gửi đến. Các bước có thể chạy lệnh và đoạn lệnh, điều khiển container và tunnel, đánh thức máy chủ, gọi một địa chỉ, chờ, rẽ nhánh theo điều kiện, chạy một tự động hoá khác, và báo cho bạn qua ntfy, Discord hoặc webhook. Chạy thử giúp bạn kiểm tra an toàn trước.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Nhóm máy chủ:**
Gom máy chủ vào một nhóm bằng cách tự chọn hoặc theo luật thẻ, để máy chủ mới tự vào nhóm. Chạy một lệnh trên mọi máy chủ cùng lúc, đẩy và lấy tệp trên tất cả, cài gói phần mềm, và thu thập danh sách hệ điều hành, nhân, kiến trúc và thời gian hoạt động.

</td>
<td width="50%" valign="top">

**Trợ lý AI:**
Là tuỳ chọn, và tắt cho đến khi bạn tự bật. Kết nối OpenAI, Anthropic, Gemini, Ollama hoặc bất kỳ endpoint tương thích OpenAI nào rồi hỏi về hệ thống của bạn. Nó đọc được máy chủ, nhóm máy chủ, đoạn lệnh và cảnh báo, và đề xuất thay đổi để bạn duyệt chứ không tự làm. Nó không bao giờ chạm được vào thông tin đăng nhập, người dùng hay thiết lập. Quản trị viên có thể tắt hẳn cho cả hệ thống, còn bạn có thể ẩn nó ngay khi cài đặt ban đầu.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Đăng nhập và người dùng:**
Tài khoản cục bộ cùng với đăng nhập qua OIDC, LDAP, GitHub và Google, kèm xác thực hai bước (TOTP), passkey (WebAuthn) và thiết bị tin cậy. Quản trị viên có thể quản lý người dùng, ánh xạ nhóm OIDC sang vai trò, xem mọi phiên đang hoạt động trên mọi nền tảng và thu hồi chúng. Bạn có thể liên kết tài khoản cục bộ với tài khoản OIDC, và xem nhật ký kiểm toán về những gì mọi người đã làm.

</td>
<td width="50%" valign="top">

**Vai trò và chia sẻ:**
Tạo vai trò và chia sẻ máy chủ với người dùng hoặc vai trò theo bốn mức: kết nối, xem, sửa và quản lý. Hoạt động với mọi kiểu xác thực và mọi giao thức, và bạn có thể thay thông tin đăng nhập dùng cho một máy chủ được chia sẻ.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Cảnh báo:**
Đặt luật cho các số liệu máy chủ như CPU, bộ nhớ và ổ đĩa, rồi nhận thông báo qua ntfy, Discord hoặc webhook khi chúng kích hoạt. Xem cảnh báo đang bật và đã hết trong nhật ký, và bỏ qua những cái bạn không quan tâm.

</td>
<td width="50%" valign="top">

**Trang chủ:**
Một lưới tiện ích kéo thả do bạn tự dựng. Có tiện ích cho tình trạng máy chủ, ping, liên kết dịch vụ, dấu trang, tìm kiếm, đồng hồ, lịch, đếm ngược, ghi chú, RSS, thời tiết, hình ảnh, iframe, Docker, tunnel, biểu đồ số liệu, API riêng, và cả một terminal đang chạy.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Đoạn lệnh và công cụ:**
Lưu những lệnh bạn hay dùng và chạy chỉ với một cú nhấp, có biến cho máy chủ và cho phần bạn tự nhập. Chạy một lệnh trên tất cả terminal đang mở, và tìm trong lịch sử lệnh với gợi ý tự động.

</td>
<td width="50%" valign="top">

**Chia sẻ phiên:**
Chia sẻ trực tiếp một phiên terminal, RDP, VNC hoặc Telnet. Gửi một liên kết mà ai cũng vào được không cần tài khoản, hoặc chia sẻ với một người dùng Termix cụ thể, ở chế độ chỉ xem hoặc cho phép thao tác. Chia sẻ có thể tự hết hạn hoặc bị thu hồi bất cứ lúc nào, và có thể tắt toàn bộ hoặc theo từng máy chủ.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Ghi phiên và nhật ký:**
Ghi lại phiên terminal, RDP và VNC rồi xem lại sau. Tải nhật ký dạng văn bản của một phiên, và xem nhật ký kết nối để biết chính xác chuyện gì đã xảy ra trong lúc kết nối.

</td>
<td width="50%" valign="top">

**Kết nối serial:**
Làm việc với thiết bị serial như router, switch và vi điều khiển từ trình duyệt hoặc ứng dụng máy tính. Đặt tốc độ baud, bit dữ liệu, bit dừng và bit chẵn lẻ. Dùng Web Serial API trên các trình duyệt hỗ trợ, hoặc backend gốc trong ứng dụng máy tính.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Lấy thiết bị từ tailnet của bạn để thêm làm máy chủ chỉ với vài cú nhấp, và kết nối bằng Tailscale SSH để ACL của tailnet lo phần quyền truy cập, không cần lưu thông tin đăng nhập. Headscale và endpoint tuỳ chỉnh cũng dùng được.

</td>
<td width="50%" valign="top">

**Proxmox:**
Nhập máy chủ thẳng từ một hệ thống Proxmox, và theo dõi số liệu của node và máy ảo, gồm CPU, bộ nhớ và dung lượng, trong một thẻ riêng.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Không gian làm việc và thẻ:**
Lưu một bộ thẻ cùng cách chia màn hình rồi mở lại toàn bộ chỉ với một cú nhấp. Termix cũng nhớ phiên gần nhất, nên các thẻ của bạn quay lại sau khi tải lại trang và trên thiết bị khác.

</td>
<td width="50%" valign="top">

**Cài đặt có hướng dẫn:**
Một phần cài đặt ngắn sẽ hướng bạn chọn kiểu giao diện, chủ đề, những tính năng bạn muốn và máy chủ đầu tiên. Chế độ đơn giản ẩn bớt những gì bạn không dùng, và bạn có thể chạy lại phần cài đặt hoặc đổi kiểu bất cứ lúc nào.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Ứng dụng máy tính độc lập và đồng bộ:**
Ứng dụng máy tính chạy độc lập với backend và cơ sở dữ liệu riêng, không cần máy chủ. Bạn cũng có thể nối nó với một máy chủ Termix để đồng bộ hai chiều máy chủ, thông tin đăng nhập, đoạn lệnh và nhiều thứ khác, và chọn kết nối xuất phát từ máy của bạn hay đi qua máy chủ.

</td>
<td width="50%" valign="top">

**Dòng lệnh:**
Công cụ `termix` cho shell và các script của bạn. Mở terminal, chạy một lệnh trên một máy chủ hoặc cả một nhóm, chuyển tệp qua SFTP, và quản lý máy chủ, đoạn lệnh và thông tin đăng nhập. Cài bằng `npm install -g @termix-cli/cli` hoặc tải bản chạy độc lập. Xem [tài liệu CLI](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Bảo mật:**
Mật khẩu, khoá và các thông tin bí mật khác được mã hoá theo từng người dùng, và bản thân các tệp cơ sở dữ liệu cũng có thể mã hoá trên ổ đĩa. Xem [tài liệu](https://docs.termix.site/security) để biết cách hoạt động.

</td>
<td width="50%" valign="top">

**Ngôn ngữ:**
Có sẵn khoảng 30 ngôn ngữ, quản lý qua [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Thêm tính năng khác</b></summary>
<br />

- **Bảng điều khiển** - Nhìn nhanh toàn bộ máy chủ, với các thẻ do bạn tự sắp xếp
- **Sơ đồ mạng** - Vẽ homelab của bạn từ danh sách máy chủ, kèm trạng thái theo thời gian thực
- **Theo dõi tmux** - Xem các phiên, cửa sổ và khung tmux, có xem trước và tìm kiếm
- **Khoá API** - Khoá theo từng người dùng có ngày hết hạn, dùng cho script và CI
- **Xuất và nhập** - Chuyển máy chủ, thông tin đăng nhập và dữ liệu trình quản lý tệp ra vào
- **SSL tự động** - Chứng chỉ được tạo và gia hạn giúp bạn, kèm chuyển hướng HTTPS, hoặc dùng chứng chỉ của riêng bạn
- **Cơ sở dữ liệu** - Mặc định là SQLite, đồng thời hỗ trợ PostgreSQL và MySQL
- **Giao diện hiện đại** - Giao diện React gọn gàng chạy tốt trên máy tính và điện thoại, với các chủ đề như sáng, tối và Dracula. Mọi kết nối đều mở toàn màn hình được từ một địa chỉ
- **Bảng lệnh** - Nhấn hai lần phím Shift trái để nhảy tới một máy chủ bằng bàn phím
- **Phím tắt** - Chuyển giữa các thẻ, đóng thẻ và nhiều thao tác khác, đều gán lại được
- **Wake-on-LAN** - Đánh thức một máy từ Termix hoặc từ một bước tự động hoá
- **Xác thực qua proxy tin cậy** - Để reverse proxy lo phần đăng nhập rồi chuyển thông tin người dùng vào
- **SSH nhiều tính năng** - Máy chủ trung gian, Warpgate, hỏi mã TOTP, SOCKS5, kiểm tra khoá máy chủ, tự điền mật khẩu, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, ghi nhật ký terminal, chuyển tiếp agent, SSH agent của Bitwarden, ký SSH bằng HashiCorp Vault và nhiều thứ khác
- **Termix ID** - Bản dựng sẵn theo kiểu sshid.io. Đăng ký một tên, công bố khoá công khai của bạn tại một địa chỉ phân giải, và cấp chứng chỉ SSH từ CA tích hợp

</details>

<br />

## Nền tảng hỗ trợ

<table align="center">
<tr>
<th align="center">Nền tảng</th>
<th align="center">Bản phân phối</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Mọi trình duyệt hiện đại (Chrome, Safari, Firefox) · Hỗ trợ PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Bản chạy ngay · Bộ cài MSI · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Bản chạy ngay · AUR · AppImage · Deb · Flatpak</td>
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

## Cài đặt

Xem [tài liệu Termix](https://docs.termix.site/install) để có hướng dẫn cài đặt đầy đủ trên mọi nền tảng.

Tệp Docker Compose mẫu (bạn có thể bỏ `guacd` và phần mạng nếu không định dùng máy tính từ xa):

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

### Dòng lệnh

Termix cũng có CLI, để bạn quản lý máy chủ từ terminal và dùng Termix trong script của mình.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

Nó mở được terminal, chạy lệnh trên một máy chủ hoặc cả một nhóm, chuyển tệp qua SFTP, và quản lý máy chủ, đoạn lệnh và thông tin đăng nhập. Tài liệu đầy đủ ở [docs.termix.site/cli](https://docs.termix.site/cli).

### Chạy trên cloud

Bạn có thể chạy máy chủ Termix trên VPS thay vì trong mạng của mình. Nếu Termix chạy ngay trong mạng mà nó quản lý, một sự cố sẽ kéo nó sập theo, đúng lúc bạn cần nó để sửa. Chạy ở ngoài thì nó luôn truy cập được, cho bạn một IP cố định và vào được từ bất cứ đâu mà không cần VPN hay mở cổng.

[GINERNET](https://docs.termix.site/install/ginernet) là nhà tài trợ của Termix, và tài liệu có hướng dẫn từng bước để triển khai trên nền tảng VPS của họ.

<br />

## Dữ liệu sử dụng

Termix gửi một tín hiệu nhỏ ẩn danh mỗi ngày một lần, để tôi biết có bao nhiêu bản đang chạy và tính năng nào thực sự được dùng. Nó gồm một mã bản cài ngẫu nhiên, số người dùng và máy chủ bạn có, phiên bản ứng dụng, và những tính năng (terminal, trình quản lý tệp, tunnel, docker, v.v.) đã dùng trong 24 giờ qua. Nó không bao giờ chứa tên người dùng, tên máy chủ, địa chỉ IP, thông tin đăng nhập hay bất cứ thứ gì nhận dạng bạn hoặc máy chủ của bạn.

Mặc định là bật. Bạn tắt nó trong phần Cài đặt quản trị, mục Chung, hoặc đặt `ENABLE_TELEMETRY=false` trước cả khi khởi động Termix.

<br />

## Quyên góp

Termix miễn phí và mã nguồn mở, không có gói thuê bao hay bản trả phí. Nếu bạn thấy hữu ích, hãy cân nhắc quyên góp để giúp trang trải máy chủ, tên miền và thời gian phát triển. Quyên góp cũng giúp có thời gian tìm hiểu những thứ cần thiết cho các tính năng như SAML, Kubernetes và hỗ trợ agent. Theo dõi tiến độ và quyên góp ở bên dưới.

[Quyên góp](https://donate.termix.site/)

<br />

## Nhà tài trợ

Bạn muốn đặt quảng cáo trả phí để ủng hộ việc phát triển? Gửi thư tới [mail@termix.site](mailto:mail@termix.site).

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

## Hỗ trợ

Cần giúp đỡ hoặc muốn đề xuất tính năng? Hãy mở một [issue mới](https://github.com/Termix-SSH/Support/issues) và mô tả càng chi tiết càng tốt, bằng tiếng Anh nếu được. Bạn cũng có thể hỏi trong kênh hỗ trợ trên [Discord](https://discord.gg/jVQGdvHDrf), tuy nhiên ở đó có thể lâu được trả lời hơn.

<br />

## Ảnh chụp màn hình

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Xem giới thiệu các bản cập nhật trên YouTube</sub>

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

<sub>Một số video và hình ảnh có thể đã cũ hoặc chưa thể hiện đầy đủ tính năng.</sub>

</div>

<br />

## Tính năng dự kiến

Toàn bộ tính năng dự kiến nằm ở [Projects](https://github.com/orgs/Termix-SSH/projects/5). Nếu bạn muốn đóng góp, xem [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Giấy phép

Phát hành theo Giấy phép Apache phiên bản 2.0. Xem `LICENSE` để biết thêm chi tiết.
