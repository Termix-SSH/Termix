# リポジトリ統計

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · 🇯🇵 日本語 · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">2025年9月1日に達成</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# 概要

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termixは、オープンソースで永久無料のセルフホスト型オールインワンサーバー管理プラットフォームです。単一の直感的なインターフェースを通じて、サーバーとインフラストラクチャを管理するマルチプラットフォームソリューションを提供します。Termixは、SSHターミナルアクセス、リモートデスクトップ制御（RDP、VNC、Telnet）、SSHトンネリング機能、リモートSSHファイル管理、およびその他多くのツールを提供します。Termixは、すべてのプラットフォームで利用可能なTermiusの完全無料でセルフホスト可能な代替ソリューションです。

# 機能

- **SSHターミナルアクセス** - ブラウザ風タブシステムによる分割画面対応（最大4パネル）のフル機能ターミナル。一般的なターミナルテーマ、フォント、その他のコンポーネントを含むターミナルカスタマイズに対応しています。
- **リモートデスクトップアクセス** - ブラウザ上でRDP、VNC、Telnetをサポート、完全なカスタマイズと分割画面に対応しています。
- **SSHトンネル管理** - 自動再接続とヘルスモニタリング、ローカル・リモート・ダイナミックSOCKSフォワーディングを備えたサーバー間SSHトンネルの作成・管理が可能です。デスクトップクライアント対サーバーのトンネル設定はデスクトップインストールごとにローカルに保存され、オプションのC2Sプリセットスナップショットをサーバーに保存・名前変更・読み込み・削除してクライアント間でローカルトンネル設定を移動できます。
- **リモートファイルマネージャー** - コード、画像、音声、動画の表示・編集に対応し、リモートサーバー上のファイルを直接管理できます。sudo対応でファイルのアップロード、ダウンロード、名前変更、削除、移動をシームレスに実行できます。
- **Docker管理** - コンテナの起動、停止、一時停止、削除。コンテナの統計情報を表示。docker execターミナルでコンテナを操作。PortainerやDockgeの代替ではなく、コンテナの作成よりも簡易的な管理を目的としています。
- **SSHホストマネージャー** - タグやフォルダでSSH接続を保存、整理、管理し、再利用可能なログイン情報を簡単に保存しながらSSHキーのデプロイを自動化できます。
- **サーバー統計** - ほとんどのLinuxベースのサーバーで、CPU、メモリ、ディスク使用量、ネットワーク、アップタイム、システム情報、ファイアウォール、ポートモニターを表示できます。
- **ダッシュボード** - ダッシュボードでサーバー情報を一目で確認できます。
- **RBAC** - ロールを作成し、ユーザー/ロール間でホストを共有できます。
- **ユーザー認証** - 管理者コントロールとOIDC（アクセス制御付き）および2FA（TOTP）対応による安全なユーザー管理。すべてのプラットフォームでアクティブなユーザーセッションを表示し、権限を取り消し可能。OIDC/ローカルアカウントの連携が可能です。
- **データベース暗号化** - バックエンドは暗号化されたSQLiteデータベースファイルとして保存されます。詳細は[ドキュメント](https://docs.termix.site/security)をご覧ください。
- **APIキー** - 自動化/CI用に有効期限付きのユーザースコープAPIキーを作成できます。
- **データのエクスポート/インポート** - SSHホスト、認証情報、ファイルマネージャーデータのエクスポートとインポートが可能です。
- **自動SSL設定** - HTTPSリダイレクト付きの組み込みSSL証明書生成・管理が可能です。
- **モダンUI** - React、Tailwind CSS、Shadcnで構築された、デスクトップ/モバイル対応のクリーンなインターフェース。ライト、ダーク、Draculaなど、多くの異なるUIテーマから選択可能。URLルートで任意の接続をフルスクリーンで開くことができます。
- **多言語対応** - 約30言語の組み込みサポート（[Crowdin](https://docs.termix.site/translations)で管理されています）。
- **プラットフォーム対応** - Webアプリ、デスクトップアプリケーション（Windows、Linux、macOS。Termixバックエンドなしでスタンドアロン動作可能）、PWA、iOS・Android専用モバイル/タブレットアプリとして利用可能です。
- **SSHツール** - ワンクリックで実行できる再利用可能なコマンドスニペットの作成。複数の開いているターミナルに対して同時にコマンドを実行できます。
- **コマンド履歴** - 過去に実行したSSHコマンドの自動補完と表示が可能です。
- **クイック接続** - 接続データを保存せずにサーバーに接続できます。
- **コマンドパレット** - 左Shiftキーを2回押すことで、キーボードからSSH接続に素早くアクセスできます。
- **SSH機能充実** - ジャンプホスト、Warpgate、TOTPベースの接続、SOCKS5、ホストキー検証、パスワード自動入力、[OPKSSH](https://github.com/openpubkey/opkssh)、tmux、ポート敲き（port knocking）などに対応しています。
- **ネットワークグラフ** - ダッシュボードをカスタマイズして、SSH接続に基づくホームラボのネットワークをステータス表示付きで可視化できます。
- **永続タブ** - ユーザープロフィールで有効にすると、SSHセッションとタブがデバイス/更新をまたいで開いたまま保持されます。

# 予定されている機能

すべての予定機能については[Projects](https://github.com/orgs/Termix-SSH/projects/2)をご覧ください。コントリビュートをご希望の方は[Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md)をご覧ください。

# インストール

対応デバイス：

- Webサイト（Chrome、Safari、Firefoxなど、あらゆるプラットフォームのモダンブラウザ）（PWA対応）
- Windows (x64/ia32)
  - ポータブル版
  - MSIインストーラー
  - Chocolateyパッケージマネージャー
- Linux (x64/ia32)
  - ポータブル版
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32、v12.0以降)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1以降)
  - Apple App Store
  - IPA
- Android (v7.0以降)
  - Google Play Store
  - APK

すべてのプラットフォームへのTermixのインストール方法については、Termixの[ドキュメント](https://docs.termix.site/install)をご覧ください。または、以下のサンプルDocker Composeファイルをご覧ください（リモートデスクトップ機能を使用する予定がない場合は、guacdとネットワークの設定を省略できます）：

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

# スポンサー

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

# サポート

Termixに関するヘルプや機能リクエストが必要な場合は、[Issues](https://github.com/Termix-SSH/Support/issues)ページにアクセスし、ログインして`New Issue`を押してください。Issueはできるだけ詳細に記述し、英語での記述が望ましいです。また、[Discord](https://discord.gg/jVQGdvHDrf)サーバーに参加してサポートチャンネルを利用することもできますが、応答時間が長くなる場合があります。

# スクリーンショット

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

動画や画像の一部は最新ではない場合や、機能を完全に紹介できていない場合があります。

# ライセンス

Apache License Version 2.0のもとで配布されています。詳細はLICENSEをご覧ください。
