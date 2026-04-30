# 리포지토리 통계

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · 🇰🇷 한국어 · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">2025년 9월 1일 달성</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# 개요

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix는 오픈 소스이며 영구 무료인 셀프 호스팅 올인원 서버 관리 플랫폼입니다. 단일 직관적인 인터페이스를 통해 서버와 인프라를 관리할 수 있는 멀티 플랫폼 솔루션을 제공합니다. Termix는 SSH 터미널 접속, 원격 데스크톱 제어(RDP, VNC, Telnet), SSH 터널링 기능, 원격 SSH 파일 관리 및 기타 다양한 도구를 제공합니다. Termix는 모든 플랫폼에서 사용 가능한 Termius의 완벽한 무료 셀프 호스팅 대안입니다.

# 기능

- **SSH 터미널 접속** - 브라우저 스타일 탭 시스템과 분할 화면 지원(최대 4개 패널)을 갖춘 완전한 기능의 터미널. 일반 터미널 테마, 글꼴 및 기타 구성 요소를 포함한 터미널 사용자 정의 지원.
- **원격 데스크톱 접속** - 완전한 사용자 정의와 분할 화면을 지원하는 브라우저 기반 RDP, VNC, Telnet 지원.
- **SSH 터널 관리** - 자동 재연결, 상태 모니터링, 로컬·원격·동적 SOCKS 포워딩을 지원하는 서버 간 SSH 터널 생성 및 관리. 데스크톱 클라이언트-서버 터널 설정은 데스크톱 설치별로 로컬에 저장되며, 선택적 C2S 사전 설정 스냅샷을 서버에 저장·이름 변경·불러오기·삭제하여 클라이언트 간 로컬 터널 구성을 이동할 수 있습니다.
- **원격 파일 관리자** - 코드, 이미지, 오디오, 비디오의 보기 및 편집을 지원하여 원격 서버에서 파일을 직접 관리. sudo 지원으로 파일 업로드, 다운로드, 이름 변경, 삭제, 이동을 원활하게 수행.
- **Docker 관리** - 컨테이너 시작, 중지, 일시 정지, 제거. 컨테이너 통계 보기. docker exec 터미널로 컨테이너 제어. Portainer나 Dockge를 대체하기 위한 것이 아니라 컨테이너 생성보다는 간편한 관리를 목적으로 합니다.
- **SSH 호스트 관리자** - 태그와 폴더로 SSH 연결을 저장, 정리, 관리하고, 재사용 가능한 로그인 정보를 쉽게 저장하면서 SSH 키 배포를 자동화.
- **서버 통계** - 대부분의 Linux 기반 서버에서 CPU, 메모리, 디스크 사용량과 함께 네트워크, 업타임, 시스템 정보, 방화벽, 포트 모니터를 표시.
- **대시보드** - 대시보드에서 서버 정보를 한눈에 확인.
- **RBAC** - 역할을 생성하고 사용자/역할 간에 호스트 공유.
- **사용자 인증** - 관리자 제어와 OIDC(액세스 제어 포함) 및 2FA(TOTP) 지원을 통한 안전한 사용자 관리. 모든 플랫폼에서 활성 사용자 세션을 보고 권한을 취소 가능. OIDC/로컬 계정 연동.
- **데이터베이스 암호화** - 백엔드가 암호화된 SQLite 데이터베이스 파일로 저장됨. 자세한 내용은 [문서](https://docs.termix.site/security)를 참조하세요.
- **API 키** - 자동화/CI에 사용할 만료일이 있는 사용자 범위 API 키 생성.
- **데이터 내보내기/가져오기** - SSH 호스트, 자격 증명, 파일 관리자 데이터의 내보내기 및 가져오기.
- **자동 SSL 설정** - HTTPS 리디렉션을 포함한 내장 SSL 인증서 생성 및 관리.
- **모던 UI** - React, Tailwind CSS, Shadcn으로 구축된 깔끔한 데스크톱/모바일 친화적 인터페이스. 라이트, 다크, 드라큘라 등 다양한 UI 테마 선택 가능. URL 라우트를 사용하여 모든 연결을 전체 화면으로 열기 가능.
- **다국어 지원** - 약 30개 언어 내장 지원([Crowdin](https://docs.termix.site/translations)으로 관리).
- **플랫폼 지원** - 웹 앱, 데스크톱 애플리케이션(Windows, Linux, macOS, Termix 백엔드 없이 독립 실행 가능), PWA, iOS 및 Android 전용 모바일/태블릿 앱으로 제공.
- **SSH 도구** - 한 번의 클릭으로 실행 가능한 재사용 가능 명령어 스니펫 생성. 여러 열린 터미널에서 동시에 하나의 명령어 실행.
- **명령어 기록** - 이전에 실행한 SSH 명령어의 자동 완성 및 조회.
- **빠른 연결** - 연결 데이터를 저장하지 않고 서버에 접속.
- **명령어 팔레트** - 왼쪽 Shift 키를 두 번 눌러 키보드로 SSH 연결에 빠르게 접근.
- **풍부한 SSH 기능** - 점프 호스트, Warpgate, TOTP 기반 연결, SOCKS5, 호스트 키 검증, 비밀번호 자동 입력, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, 포트 노킹 등 지원.
- **네트워크 그래프** - 대시보드를 사용자 정의하여 SSH 연결 기반의 홈랩 네트워크를 상태 표시와 함께 시각화.
- **지속 탭** - 사용자 프로필에서 활성화된 경우 SSH 세션 및 탭이 기기/새로 고침 간에 열린 상태 유지.

# 계획된 기능

모든 계획된 기능은 [Projects](https://github.com/orgs/Termix-SSH/projects/2)를 참조하세요. 기여를 원하시면 [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md)을 참조하세요.

# 설치

지원 기기:

- 웹사이트 (Chrome, Safari, Firefox 등 모든 플랫폼의 최신 브라우저) (PWA 지원 포함)
- Windows (x64/ia32)
  - 포터블
  - MSI 설치 프로그램
  - Chocolatey 패키지 관리자
- Linux (x64/ia32)
  - 포터블
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32, v12.0 이상)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1 이상)
  - Apple App Store
  - IPA
- Android (v7.0 이상)
  - Google Play Store
  - APK

모든 플랫폼에 Termix를 설치하는 방법에 대한 자세한 내용은 Termix [문서](https://docs.termix.site/install)를 방문하세요. 다음은 Docker Compose 파일 예시입니다(원격 데스크톱 기능을 사용할 계획이 없다면 guacd와 네트워크를 생략할 수 있습니다):

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

# 스폰서

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

# 지원

Termix에 대한 도움이 필요하거나 기능을 요청하려면 [Issues](https://github.com/Termix-SSH/Support/issues) 페이지를 방문하여 로그인하고 `New Issue`를 누르세요. 이슈는 가능한 한 상세하게 작성하고, 영어로 작성하는 것이 좋습니다. [Discord](https://discord.gg/jVQGdvHDrf) 서버에 참여하여 지원 채널을 이용할 수도 있지만, 응답 시간이 더 길 수 있습니다.

# 스크린샷

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

일부 비디오 및 이미지는 최신이 아니거나 기능을 완벽하게 보여주지 않을 수 있습니다.

# 라이선스

Apache License Version 2.0에 따라 배포됩니다. 자세한 내용은 LICENSE를 참조하세요.
