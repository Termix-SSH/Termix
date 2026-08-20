<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>SSH와 원격 데스크톱부터 자동화까지, 셀프 호스팅 서버 관리</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  한국어 ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <a href="README-AR.md">العربية</a> ·
  <a href="README-HI.md">हिन्दी</a> ·
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

Termix는 무료이며 오픈 소스입니다. 유용하게 쓰고 계시다면 서버 비용과 개발 시간에 보탬이 되도록 [후원](https://donate.termix.site/)을 고려해 주세요.

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>2025년 9월 1일 달성</sub>
</p>

</div>

<br />

## 개요

Termix는 무료 오픈 소스 셀프 호스팅 서버 관리 플랫폼입니다. SSH 터미널, 원격 데스크톱(RDP, VNC, Telnet), 파일 전송, 터널, Docker, 지표, 자동화를 한곳에 모아 웹과 데스크톱, 모바일에서 쓸 수 있습니다. 계속 무료로 쓸 수 있는 셀프 호스팅 Termius 대안입니다.

<br />

## 기능

<table>
<tr>
<td width="50%" valign="top">

**SSH 터미널:**
브라우저 같은 탭과 분할 화면을 갖춘 제대로 된 터미널로, 한 번에 최대 6개 패널까지 띄울 수 있습니다. 테마와 글꼴, 색을 골라 쓸 수 있습니다. 각 세션 위의 툴바에는 CPU, 메모리, 디스크가 실시간으로 표시되고, 해당 호스트의 파일과 Docker, 터널, 지표로 바로 갈 수 있습니다.

</td>
<td width="50%" valign="top">

**원격 데스크톱:**
브라우저에서 RDP와 VNC, Telnet을 쓸 수 있고 다른 세션과 똑같이 탭과 분할 화면으로 다룰 수 있습니다. RDP 드라이브용 파일 브라우저와 끌어다 놓기 업로드도 있습니다. Windows 데스크톱에서는 호스트를 기본 RDP 클라이언트로 열 수도 있습니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH 터널:**
로컬과 원격, 동적 SOCKS 포워딩을 지원하며 자동 재연결과 상태 확인이 붙어 있습니다. 데스크톱 앱의 클라이언트 대 서버 터널은 그 컴퓨터에 저장되고, 프리셋을 서버에 저장해 두면 다른 컴퓨터로 설정을 옮길 수 있습니다.

</td>
<td width="50%" valign="top">

**파일 관리자:**
SFTP로 파일을 살펴보고 편집하고 올리고 내려받고 이름을 바꾸고 옮기고 지울 수 있으며 sudo도 됩니다. 코드와 이미지, 오디오, 비디오를 보고 편집할 수 있습니다. 서버에서 서버로 파일을 바로 복사할 수 있는데, 가장 빠른 경로가 자동으로 선택되고 전송 무결성도 확인합니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker와 Podman:**
컨테이너를 시작하고 멈추고 일시 정지하고 지울 수 있으며, 상태를 보거나 안에서 셸을 열 수 있습니다. Docker와 Podman 모두에서 동작합니다. Portainer나 Dockge를 대신하려는 것이 아니라, 이미 있는 컨테이너를 다루기 위한 것입니다.

</td>
<td width="50%" valign="top">

**호스트 관리:**
태그와, 이름과 색을 붙일 수 있는 중첩 폴더로 호스트를 정리합니다. 저장한 자격 증명을 여러 호스트에서 다시 쓰고, SSH 키를 자동으로 배포하고, 호스트를 상위 호스트 아래로 묶고, 한꺼번에 편집하거나 내보낼 수 있습니다. 저장하고 싶지 않은 일회성 연결에는 빠른 연결을 쓰면 됩니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**호스트 지표:**
대부분의 리눅스 서버에서 CPU, 메모리, 디스크, 네트워크, 온도, 가동 시간, 프로세스, 포트, 로그인, 시스템 정보를 기록 그래프와 함께 볼 수 있습니다. 관리 카드로 서비스와 cron 작업, 패키지, 사용자, 방화벽 규칙, WireGuard, Tailscale, SSL 인증서, 로그, 상태 확인을 Termix 안에서 처리할 수 있습니다.

</td>
<td width="50%" valign="top">

**자동화:**
먼저 조건을 고르고, 무슨 일이 일어날지 정하면 됩니다. 조건에는 지표가 기준을 넘을 때, 호스트가 올라오거나 내려갈 때, 상태 확인 결과가 바뀔 때, 정해진 일정, 컨테이너 이벤트, 들어오는 웹훅이 있습니다. 각 단계에서 명령과 스니펫을 실행하고, 컨테이너와 터널을 조작하고, 호스트를 깨우고, URL을 호출하고, 기다리고, 조건에 따라 갈라지고, 다른 자동화를 실행하고, ntfy나 Discord, 웹훅으로 알릴 수 있습니다. 테스트 실행으로 먼저 안전하게 시험해 볼 수 있습니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**플릿:**
호스트를 직접 고르거나 태그 규칙으로 플릿에 묶으면 새 호스트는 알아서 들어옵니다. 모든 호스트에서 같은 명령을 한 번에 실행하고, 전부에 파일을 보내고 가져오고, 패키지를 설치하고, OS와 커널, 아키텍처, 가동 시간 목록을 모을 수 있습니다.

</td>
<td width="50%" valign="top">

**AI 어시스턴트:**
선택 기능이며 직접 켜기 전까지는 꺼져 있습니다. OpenAI, Anthropic, Gemini, Ollama 또는 OpenAI 호환 엔드포인트를 연결해 내 환경에 대해 물어볼 수 있습니다. 호스트와 플릿, 스니펫, 알림을 읽을 수 있지만 직접 바꾸지 않고 승인받을 제안으로 내놓습니다. 자격 증명과 사용자, 설정에는 절대 접근할 수 없습니다. 관리자는 인스턴스 전체에서 꺼 둘 수 있고, 초기 설정에서 아예 숨길 수도 있습니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**로그인과 사용자:**
로컬 계정과 함께 OIDC, LDAP, GitHub, Google 로그인을 지원하고 2단계 인증(TOTP), 패스키(WebAuthn), 신뢰할 수 있는 기기도 쓸 수 있습니다. 관리자는 사용자를 관리하고, OIDC 그룹을 역할에 연결하고, 모든 플랫폼의 활성 세션을 보고 해지할 수 있습니다. 로컬 계정과 OIDC 계정을 연결할 수 있고, 누가 무엇을 했는지는 감사 로그에서 확인합니다.

</td>
<td width="50%" valign="top">

**역할과 공유:**
역할을 만들고 연결, 보기, 편집, 관리라는 네 단계로 호스트를 사용자나 역할에 공유할 수 있습니다. 모든 인증 방식과 모든 프로토콜에서 동작하며, 공유한 호스트에 쓸 자격 증명을 따로 지정할 수도 있습니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**알림:**
CPU와 메모리, 디스크 같은 호스트 지표에 규칙을 걸어 두고 조건이 걸리면 ntfy나 Discord, 웹훅으로 알림을 받습니다. 발생 중인 알림과 해제된 알림을 기록에서 보고, 신경 쓰지 않을 것은 지워 둘 수 있습니다.

</td>
<td width="50%" valign="top">

**홈페이지:**
직접 꾸미는 끌어다 놓기 위젯 화면입니다. 호스트 상태, 핑, 서비스 링크, 북마크, 검색, 시계, 달력, 카운트다운, 메모, RSS, 날씨, 이미지, iframe, Docker, 터널, 지표 차트, 사용자 API, 심지어 살아 있는 터미널까지 위젯으로 놓을 수 있습니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**스니펫과 도구:**
자주 쓰는 명령을 저장해 두고 한 번에 실행할 수 있으며, 호스트 값이나 직접 넣는 값을 변수로 쓸 수 있습니다. 열려 있는 모든 터미널에서 같은 명령을 한꺼번에 실행할 수 있고, 명령 기록도 자동 완성으로 찾을 수 있습니다.

</td>
<td width="50%" valign="top">

**세션 공유:**
터미널과 RDP, VNC, Telnet 세션을 실시간으로 공유합니다. 계정 없이 들어올 수 있는 링크를 보내거나 특정 Termix 사용자와 공유할 수 있고, 보기만 할지 조작까지 할지 고를 수 있습니다. 공유는 알아서 만료되게 하거나 언제든 취소할 수 있고, 전체 또는 호스트별로 꺼 둘 수 있습니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**세션 녹화와 로그:**
터미널과 RDP, VNC 세션을 녹화해 두었다가 나중에 다시 볼 수 있습니다. 세션의 텍스트 로그를 내려받을 수 있고, 연결 로그를 보면 연결하는 동안 무슨 일이 있었는지 그대로 알 수 있습니다.

</td>
<td width="50%" valign="top">

**시리얼 연결:**
라우터와 스위치, 마이크로컨트롤러 같은 시리얼 장치에 브라우저나 데스크톱 앱에서 접속할 수 있습니다. 보드레이트와 데이터 비트, 스톱 비트, 패리티를 설정할 수 있습니다. 지원되는 브라우저에서는 Web Serial API를, 데스크톱 앱에서는 네이티브 백엔드를 씁니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
tailnet에서 기기를 가져와 몇 번의 클릭으로 호스트로 추가하고, Tailscale SSH로 접속하면 접근 권한은 tailnet ACL이 처리하므로 자격 증명을 저장할 필요가 없습니다. Headscale과 사용자 지정 엔드포인트도 됩니다.

</td>
<td width="50%" valign="top">

**Proxmox:**
Proxmox 인스턴스에서 호스트를 바로 가져오고, 노드와 게스트의 CPU와 메모리, 스토리지 상태를 전용 탭에서 볼 수 있습니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**워크스페이스와 탭:**
탭과 분할 배치를 통째로 저장해 두고 한 번에 다시 열 수 있습니다. Termix는 마지막 세션도 기억하기 때문에 새로 고침을 하거나 기기를 바꿔도 탭이 그대로 돌아옵니다.

</td>
<td width="50%" valign="top">

**설치 안내:**
짧은 설정 과정이 화면 프리셋과 테마, 쓰고 싶은 기능, 첫 호스트를 고르도록 안내합니다. 간단 모드는 쓰지 않는 것을 숨겨 주고, 설정은 언제든 다시 하거나 프리셋을 바꿀 수 있습니다.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**데스크톱 단독 실행과 동기화:**
데스크톱 앱은 자체 백엔드와 데이터베이스로 서버 없이 혼자 돌아갑니다. Termix 서버에 연결하면 호스트와 자격 증명, 스니펫 등을 양방향으로 동기화할 수 있고, 연결을 로컬에서 시작할지 서버를 거칠지도 고를 수 있습니다.

</td>
<td width="50%" valign="top">

**명령줄 도구:**
셸과 스크립트에서 쓰는 `termix` CLI입니다. 터미널을 열고, 호스트 하나나 플릿 전체에서 명령을 실행하고, SFTP로 파일을 옮기고, 호스트와 스니펫, 자격 증명을 관리할 수 있습니다. `npm install -g @termix-cli/cli`로 설치하거나 단독 실행 파일을 받으면 됩니다. [CLI 문서](https://docs.termix.site/cli)를 참고하세요.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**보안:**
비밀번호와 키를 비롯한 비밀 정보는 사용자별로 암호화되고, 데이터베이스 파일 자체도 디스크에서 암호화할 수 있습니다. 어떻게 동작하는지는 [문서](https://docs.termix.site/security)에서 볼 수 있습니다.

</td>
<td width="50%" valign="top">

**언어:**
약 30개 언어가 기본으로 들어 있으며 [Crowdin](https://docs.termix.site/translations)으로 관리합니다.

</td>
</tr>
</table>

<br />

<details>
<summary><b>더 많은 기능</b></summary>
<br />

- **대시보드** - 직접 배치한 카드로 서버 상태를 한눈에
- **네트워크 그래프** - 호스트를 바탕으로 홈랩을 그려 주고 상태를 실시간 표시
- **tmux 모니터** - tmux 세션과 창, 페인을 미리보기와 검색으로 살펴보기
- **API 키** - 스크립트와 CI용, 만료일이 있는 사용자별 키
- **내보내기와 가져오기** - 호스트와 자격 증명, 파일 관리자 데이터를 옮기기
- **자동 SSL** - 인증서 발급과 갱신, HTTPS 리다이렉트를 알아서. 직접 만든 인증서도 쓸 수 있습니다
- **데이터베이스** - 기본은 SQLite, PostgreSQL과 MySQL도 지원
- **현대적인 UI** - 데스크톱과 모바일에서 모두 쓸 수 있는 깔끔한 React 화면. 라이트와 다크, Dracula 같은 테마 제공. 어떤 연결이든 URL로 전체 화면에서 열 수 있습니다
- **명령 팔레트** - 왼쪽 Shift를 두 번 눌러 키보드로 호스트로 이동
- **키보드 단축키** - 탭 이동과 닫기 등, 모두 다시 지정할 수 있습니다
- **Wake-on-LAN** - Termix에서도, 자동화 단계에서도 컴퓨터를 켜기
- **신뢰할 수 있는 프록시 인증** - 리버스 프록시가 로그인을 처리하고 사용자 정보를 넘겨주기
- **풍부한 SSH 기능** - 점프 호스트, Warpgate, TOTP 입력, SOCKS5, 호스트 키 확인, 비밀번호 자동 입력, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, 포트 노킹, 터미널 로그, 에이전트 포워딩, Bitwarden SSH 에이전트, HashiCorp Vault SSH 서명 등
- **Termix ID** - sshid.io 같은 기능을 내장했습니다. 핸들을 등록하고 리졸버 URL에 공개 키를 올리고 내장 CA에서 SSH 인증서를 발급할 수 있습니다

</details>

<br />

## 플랫폼 지원

<table align="center">
<tr>
<th align="center">플랫폼</th>
<th align="center">배포 형태</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>최신 브라우저 전반(Chrome, Safari, Firefox) · PWA 지원</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>포터블 · MSI 설치 파일 · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>포터블 · AUR · AppImage · Deb · Flatpak</td>
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

## 설치

모든 플랫폼의 자세한 설치 방법은 [Termix 문서](https://docs.termix.site/install)를 참고하세요.

Docker Compose 예시입니다(원격 데스크톱 기능을 쓰지 않는다면 `guacd`와 네트워크 부분은 빼도 됩니다):

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

### 명령줄 도구

Termix에는 CLI도 있어서 터미널에서 서버를 관리하거나 Termix를 자기 스크립트에 넣어 쓸 수 있습니다.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

터미널을 열고, 호스트 하나나 플릿 전체에서 명령을 실행하고, SFTP로 파일을 옮기고, 호스트와 스니펫, 자격 증명을 관리할 수 있습니다. 전체 문서는 [docs.termix.site/cli](https://docs.termix.site/cli)에 있습니다.

### 클라우드 호스팅

Termix 서버는 집 안 네트워크가 아니라 VPS에서 돌릴 수도 있습니다. 관리 대상 네트워크 위에서 돌아가면 장애가 났을 때 Termix도 같이 멈춰서, 정작 고쳐야 할 때 쓸 수 없게 됩니다. 밖에서 돌리면 언제든 접속할 수 있고 고정 IP도 생기며, VPN이나 포트 포워딩 없이 어디서나 들어갈 수 있습니다.

[GINERNET](https://docs.termix.site/install/ginernet)은 Termix를 후원하고 있으며, 문서에 이 회사 VPS에 배포하는 단계별 안내가 있습니다.

<br />

## 텔레메트리

Termix는 하루에 한 번 익명의 작은 데이터를 보냅니다. 인스턴스가 얼마나 돌아가는지, 어떤 기능이 쓰이는지 파악하기 위한 것입니다. 여기에는 무작위 인스턴스 ID, 사용자와 호스트 수, 앱 버전, 최근 24시간 동안 쓴 기능(터미널, 파일 관리자, 터널, Docker 등)만 들어갑니다. 사용자 이름과 호스트 이름, IP 주소, 자격 증명처럼 나나 내 서버를 알아볼 수 있는 것은 전혀 담기지 않습니다.

기본으로 켜져 있습니다. 관리 설정의 일반에서 끄거나, Termix를 시작하기 전에 `ENABLE_TELEMETRY=false`를 지정하면 됩니다.

<br />

## 후원

Termix는 무료 오픈 소스이고 구독이나 유료 요금제가 없습니다. 유용하게 쓰고 계시다면 서버 비용과 도메인, 개발 시간에 보탬이 되도록 후원을 고려해 주세요. 후원은 SAML과 Kubernetes, 에이전트 지원 같은 기능을 만들기 위해 알아보고 배우는 시간에도 쓰입니다. 진행 상황을 보고 후원하시려면 아래를 눌러 주세요.

[후원하기](https://donate.termix.site/)

<br />

## 스폰서

유료 게재로 개발을 지원하고 싶으신가요? [mail@termix.site](mailto:mail@termix.site)로 메일을 보내 주세요.

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

## 지원

도움이 필요하거나 기능을 제안하고 싶으신가요? [새 이슈](https://github.com/Termix-SSH/Support/issues)를 올리면서 되도록 자세히, 가능하면 영어로 적어 주세요. [Discord](https://discord.gg/jVQGdvHDrf) 지원 채널에서 물어봐도 되지만 답변이 늦을 수 있습니다.

<br />

## 스크린샷

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>YouTube에서 업데이트 소개 보기</sub>

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

<sub>일부 영상과 이미지는 오래되었거나 기능을 제대로 보여 주지 못할 수 있습니다.</sub>

</div>

<br />

## 계획된 기능

계획된 기능은 모두 [Projects](https://github.com/orgs/Termix-SSH/projects/5)에 있습니다. 기여하고 싶다면 [기여 안내](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md)를 봐 주세요.

<br />

## 라이선스

Apache License 2.0에 따라 배포합니다. 자세한 내용은 `LICENSE`를 참고하세요.
