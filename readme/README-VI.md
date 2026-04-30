# Thống Kê Repo

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · 🇻🇳 Tiếng Việt · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Đạt được vào ngày 1 tháng 9 năm 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# Tổng Quan

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix là nền tảng quản lý máy chủ tất cả trong một, mã nguồn mở, miễn phí vĩnh viễn, tự lưu trữ. Nó cung cấp giải pháp đa nền tảng để quản lý máy chủ và cơ sở hạ tầng của bạn thông qua một giao diện trực quan duy nhất. Termix cung cấp quyền truy cập terminal SSH, điều khiển máy tính từ xa (RDP, VNC, Telnet), khả năng tạo đường hầm SSH, quản lý tệp SSH từ xa và nhiều công cụ khác. Termix là giải pháp thay thế miễn phí và tự lưu trữ hoàn hảo cho Termius, khả dụng trên tất cả các nền tảng.

# Tính Năng

- **Truy Cập Terminal SSH** - Terminal đầy đủ tính năng với hỗ trợ chia màn hình (lên đến 4 bảng) với hệ thống tab kiểu trình duyệt. Bao gồm hỗ trợ tùy chỉnh terminal bao gồm các chủ đề terminal phổ biến, phông chữ và các thành phần khác.
- **Truy Cập Màn Hình Từ Xa** - Hỗ trợ RDP, VNC và Telnet qua trình duyệt với đầy đủ tùy chỉnh và chia màn hình
- **Quản Lý Đường Hầm SSH** - Tạo và quản lý đường hầm SSH giữa các máy chủ với tự động kết nối lại, giám sát sức khỏe và chuyển tiếp cục bộ, từ xa hoặc SOCKS động. Cài đặt đường hầm từ máy khách desktop đến máy chủ được lưu trữ cục bộ cho mỗi bản cài đặt desktop; các snapshot C2S preset tùy chọn có thể được lưu trên máy chủ, đổi tên, tải hoặc xóa để di chuyển cấu hình đường hầm cục bộ giữa các máy khách.
- **Trình Quản Lý Tệp Từ Xa** - Quản lý tệp trực tiếp trên máy chủ từ xa với hỗ trợ xem và chỉnh sửa mã, hình ảnh, âm thanh và video. Tải lên, tải xuống, đổi tên, xóa và di chuyển tệp liền mạch với hỗ trợ sudo.
- **Quản Lý Docker** - Khởi động, dừng, tạm dừng, xóa container. Xem thống kê container. Điều khiển container bằng terminal docker exec. Không được tạo ra để thay thế Portainer hay Dockge mà đơn giản là để quản lý container của bạn thay vì tạo mới chúng.
- **Trình Quản Lý Máy Chủ SSH** - Lưu, sắp xếp và quản lý các kết nối SSH của bạn với thẻ và thư mục, dễ dàng lưu thông tin đăng nhập có thể tái sử dụng đồng thời có thể tự động hóa việc triển khai khóa SSH
- **Thống Kê Máy Chủ** - Xem mức sử dụng CPU, bộ nhớ và ổ đĩa cùng với mạng, thời gian hoạt động, thông tin hệ thống, tường lửa, giám sát cổng trên hầu hết các máy chủ chạy Linux
- **Bảng Điều Khiển** - Xem thông tin máy chủ trong nháy mắt trên bảng điều khiển của bạn
- **RBAC** - Tạo vai trò và chia sẻ máy chủ giữa người dùng/vai trò
- **Xác Thực Người Dùng** - Quản lý người dùng an toàn với quyền quản trị và hỗ trợ OIDC (có kiểm soát truy cập) và 2FA (TOTP). Xem phiên hoạt động của người dùng trên tất cả các nền tảng và thu hồi quyền. Liên kết tài khoản OIDC/Nội bộ của bạn với nhau.
- **Mã Hóa Cơ Sở Dữ Liệu** - Backend được lưu trữ dưới dạng tệp cơ sở dữ liệu SQLite được mã hóa. Xem [tài liệu](https://docs.termix.site/security) để biết thêm.
- **Khóa API** - Tạo khóa API theo phạm vi người dùng với ngày hết hạn để sử dụng cho tự động hóa/CI.
- **Xuất/Nhập Dữ Liệu** - Xuất và nhập máy chủ SSH, thông tin xác thực và dữ liệu trình quản lý tệp
- **Thiết Lập SSL Tự Động** - Tạo và quản lý chứng chỉ SSL tích hợp với chuyển hướng HTTPS
- **Giao Diện Hiện Đại** - Giao diện sạch sẽ, thân thiện với máy tính/di động được xây dựng bằng React, Tailwind CSS và Shadcn. Chọn giữa nhiều chủ đề UI khác nhau bao gồm sáng, tối, Dracula, v.v. Sử dụng đường dẫn URL để mở bất kỳ kết nối nào ở chế độ toàn màn hình.
- **Ngôn Ngữ** - Hỗ trợ tích hợp ~30 ngôn ngữ (được quản lý bởi [Crowdin](https://docs.termix.site/translations))
- **Hỗ Trợ Nền Tảng** - Khả dụng dưới dạng ứng dụng web, ứng dụng máy tính (Windows, Linux và macOS, có thể chạy độc lập mà không cần backend Termix), PWA và ứng dụng di động/máy tính bảng chuyên dụng cho iOS và Android.
- **Công Cụ SSH** - Tạo đoạn lệnh có thể tái sử dụng, thực thi chỉ với một cú nhấp chuột. Chạy một lệnh đồng thời trên nhiều terminal đang mở.
- **Lịch Sử Lệnh** - Tự động hoàn thành và xem các lệnh SSH đã chạy trước đó
- **Kết Nối Nhanh** - Kết nối đến máy chủ mà không cần lưu dữ liệu kết nối
- **Bảng Lệnh** - Nhấn đúp phím shift trái để truy cập nhanh các kết nối SSH bằng bàn phím
- **SSH Giàu Tính Năng** - Hỗ trợ jump host, Warpgate, kết nối dựa trên TOTP, SOCKS5, xác minh khóa máy chủ, tự động điền mật khẩu, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, v.v.
- **Biểu Đồ Mạng** - Tùy chỉnh Bảng Điều Khiển để trực quan hóa homelab của bạn dựa trên các kết nối SSH với hỗ trợ trạng thái
- **Tab Liên Tục** - Các phiên SSH và tab vẫn mở trên các thiết bị/lần làm mới nếu được bật trong hồ sơ người dùng

# Tính Năng Dự Kiến

Xem [Dự Án](https://github.com/orgs/Termix-SSH/projects/2) để biết tất cả các tính năng dự kiến. Nếu bạn muốn đóng góp, xem [Đóng Góp](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Cài Đặt

Thiết Bị Được Hỗ Trợ:

- Trang web (bất kỳ trình duyệt hiện đại nào trên bất kỳ nền tảng nào như Chrome, Safari và Firefox) (bao gồm hỗ trợ PWA)
- Windows (x64/ia32)
  - Portable
  - MSI Installer
  - Chocolatey Package Manager
- Linux (x64/ia32)
  - Portable
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32 trên v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

Truy cập [Tài Liệu](https://docs.termix.site/install) Termix để biết thêm thông tin về cách cài đặt Termix trên tất cả các nền tảng. Ngoài ra, xem tệp Docker Compose mẫu tại đây (bạn có thể bỏ qua guacd và mạng nếu không có ý định sử dụng các tính năng điều khiển máy tính từ xa):

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

# Nhà Tài Trợ

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

# Hỗ Trợ

Nếu bạn cần trợ giúp hoặc muốn yêu cầu tính năng với Termix, hãy truy cập trang [Vấn Đề](https://github.com/Termix-SSH/Support/issues), đăng nhập và nhấn `New Issue`.
Vui lòng mô tả vấn đề càng chi tiết càng tốt, ưu tiên viết bằng tiếng Anh. Bạn cũng có thể tham gia máy chủ [Discord](https://discord.gg/jVQGdvHDrf) và truy cập kênh hỗ trợ, tuy nhiên thời gian phản hồi có thể lâu hơn.

# Ảnh Chụp Màn Hình

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

Một số video và hình ảnh có thể đã lỗi thời hoặc không thể hiện chính xác hoàn toàn các tính năng.

# Giấy Phép

Được phân phối theo Giấy Phép Apache Phiên Bản 2.0. Xem LICENSE để biết thêm thông tin.
