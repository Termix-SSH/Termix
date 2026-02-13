# リポジトリ統計

<p align="center">
  <a href="README.md"><img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English</a> ·
  <a href="README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a> ·
  <img src="https://flagcdn.com/jp.svg" alt="日本語" width="24" height="16"> 日本語 ·
  <a href="README-KO.md"><img src="https://flagcdn.com/kr.svg" alt="한국어" width="24" height="16"> 한국어</a> ·
  <a href="README-FR.md"><img src="https://flagcdn.com/fr.svg" alt="Français" width="24" height="16"> Français</a> ·
  <a href="README-DE.md"><img src="https://flagcdn.com/de.svg" alt="Deutsch" width="24" height="16"> Deutsch</a> ·
  <a href="README-ES.md"><img src="https://flagcdn.com/es.svg" alt="Español" width="24" height="16"> Español</a> ·
  <a href="README-PT.md"><img src="https://flagcdn.com/br.svg" alt="Português" width="24" height="16"> Português</a> ·
  <a href="README-RU.md"><img src="https://flagcdn.com/ru.svg" alt="Русский" width="24" height="16"> Русский</a> ·
  <a href="README-AR.md"><img src="https://flagcdn.com/sa.svg" alt="العربية" width="24" height="16"> العربية</a> ·
  <a href="README-HI.md"><img src="https://flagcdn.com/in.svg" alt="हिन्दी" width="24" height="16"> हिन्दी</a> ·
  <a href="README-TR.md"><img src="https://flagcdn.com/tr.svg" alt="Türkçe" width="24" height="16"> Türkçe</a> ·
  <a href="README-VI.md"><img src="https://flagcdn.com/vn.svg" alt="Tiếng Việt" width="24" height="16"> Tiếng Việt</a> ·
  <a href="README-IT.md"><img src="https://flagcdn.com/it.svg" alt="Italiano" width="24" height="16"> Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="./repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">2025年9月1日に達成</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

プロジェクトを支援していただける方はこちらからどうぞ！\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# 概要

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termixは、オープンソースで永久無料のセルフホスト型オールインワンサーバー管理プラットフォームです。単一の直感的なインターフェースを通じて、サーバーとインフラストラクチャを管理するマルチプラットフォームソリューションを提供します。Termixは、SSHターミナルアクセス、SSHトンネリング機能、リモートファイル管理、その他多くのツールを提供します。Termixは、すべてのプラットフォームで利用可能なTermiusの完全無料でセルフホスト可能な代替ソリューションです。

# 機能

- **SSHターミナルアクセス** - ブラウザ風タブシステムによる分割画面対応（最大4パネル）のフル機能ターミナル。一般的なターミナルテーマ、フォント、その他のコンポーネントを含むターミナルカスタマイズに対応
- **SSHトンネル管理** - 自動再接続とヘルスモニタリング機能を備えたSSHトンネルの作成・管理、-l または -r 接続に対応
- **リモートファイルマネージャー** - コード、画像、音声、動画の表示・編集に対応し、リモートサーバー上のファイルを直接管理。sudo対応でファイルのアップロード、ダウンロード、名前変更、削除、移動をシームレスに実行
- **Docker管理** - コンテナの起動、停止、一時停止、削除。コンテナの統計情報を表示。docker execターミナルでコンテナを操作。PortainerやDockgeの代替ではなく、コンテナの作成よりも簡易管理を目的としています
- **SSHホストマネージャー** - タグやフォルダでSSH接続を保存、整理、管理し、再利用可能なログイン情報を簡単に保存しながらSSHキーのデプロイを自動化
- **サーバー統計** - ほとんどのLinuxベースのサーバーで、CPU、メモリ、ディスク使用量、ネットワーク、アップタイム、システム情報、ファイアウォール、ポートモニターを表示
- **ダッシュボード** - ダッシュボードでサーバー情報を一目で確認
- **RBAC** - ロールを作成し、ユーザー/ロール間でホストを共有
- **ユーザー認証** - 管理者コントロールとOIDCおよび2FA（TOTP）対応による安全なユーザー管理。すべてのプラットフォームでアクティブなユーザーセッションを表示し、権限を取り消し可能。OIDC/ローカルアカウントの連携
- **データベース暗号化** - バックエンドは暗号化されたSQLiteデータベースファイルとして保存。詳細は[ドキュメント](https://docs.termix.site/security)をご覧ください
- **データのエクスポート/インポート** - SSHホスト、認証情報、ファイルマネージャーデータのエクスポートとインポート
- **自動SSL設定** - HTTPSリダイレクト付きの組み込みSSL証明書生成・管理
- **モダンUI** - React、Tailwind CSS、Shadcnで構築された、デスクトップ/モバイル対応のクリーンなインターフェース。ダーク/ライトモードの切り替え対応。URLルートで任意の接続をフルスクリーンで開くことが可能
- **多言語対応** - 約30言語の組み込みサポート（[Crowdin](https://docs.termix.site/translations)で管理）
- **プラットフォーム対応** - Webアプリ、デスクトップアプリケーション（Windows、Linux、macOS）、PWA、iOS・Android専用モバイル/タブレットアプリとして利用可能
- **SSHツール** - ワンクリックで実行できる再利用可能なコマンドスニペットの作成。複数の開いているターミナルに対して同時にコマンドを実行
- **コマンド履歴** - 過去に実行したSSHコマンドの自動補完と表示
- **クイック接続** - 接続データを保存せずにサーバーに接続
- **コマンドパレット** - 左Shiftキーを2回押すことで、キーボードからSSH接続に素早くアクセス
- **SSH機能充実** - ジャンプホスト、Warpgate、TOTPベースの接続、SOCKS5、ホストキー検証、パスワード自動入力、[OPKSSH](https://github.com/openpubkey/opkssh)などに対応
- **ネットワークグラフ** - ダッシュボードをカスタマイズして、SSH接続に基づくホームラボのネットワークをステータス表示付きで可視化

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
  - ISO
- Android (v7.0以降)
  - Google Play Store
  - APK

すべてのプラットフォームへのTermixのインストール方法については、Termixの[ドキュメント](https://docs.termix.site/install)をご覧ください。以下はDocker Composeファイルのサンプルです：

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

volumes:
  termix-data:
    driver: local
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
    <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="50" alt="Crowdin">
  </a>
</p>

# サポート

Termixに関するヘルプや機能リクエストが必要な場合は、[Issues](https://github.com/Termix-SSH/Support/issues)ページにアクセスし、ログインして`New Issue`を押してください。Issueはできるだけ詳細に記述し、英語での記述が望ましいです。また、[Discord](https://discord.gg/jVQGdvHDrf)サーバーに参加してサポートチャンネルを利用することもできますが、応答時間が長くなる場合があります。

# スクリーンショット

[![YouTube](./repo-images/YouTube.png)](https://youtu.be/8OYCPwS7ciA)

<p align="center">
  <img src="./repo-images/Image 1.png" width="400" alt="Termix Demo 1"/>
  <img src="./repo-images/Image 2.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="./repo-images/Image 3.png" width="400" alt="Termix Demo 3"/>
  <img src="./repo-images/Image 4.png" width="400" alt="Termix Demo 4"/>
</p>

<p align="center">
  <img src="./repo-images/Image 5.png" width="400" alt="Termix Demo 5"/>
  <img src="./repo-images/Image 6.png" width="400" alt="Termix Demo 6"/>
</p>

<p align="center">
  <img src="./repo-images/Image 7.png" width="400" alt="Termix Demo 7"/>
  <img src="./repo-images/Image 8.png" width="400" alt="Termix Demo 8"/>
</p>

<p align="center">
  <img src="./repo-images/Image 9.png" width="400" alt="Termix Demo 9"/>
  <img src="./repo-images/Image 10.png" width="400" alt="Termix Demo 10"/>
</p>

<p align="center">
  <img src="./repo-images/Image 11.png" width="400" alt="Termix Demo 11"/>
  <img src="./repo-images/Image 12.png" width="400" alt="Termix Demo 12"/>
</p>

一部の動画や画像は古い場合や、機能を完全に紹介していない場合があります。

# ライセンス

Apache License Version 2.0のもとで配布されています。詳細はLICENSEをご覧ください。
