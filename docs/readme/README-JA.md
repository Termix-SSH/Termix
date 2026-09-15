<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>SSH やリモートデスクトップから自動化まで、セルフホストのサーバー管理</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  日本語 ·
  <a href="README-KO.md">한국어</a> ·
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

Termix は無料でオープンソースです。役に立ったと感じたら、サーバー費用と開発時間を支えるために[寄付](https://donate.termix.site/)をご検討ください。

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>2025年9月1日 達成</sub>
</p>

</div>

<br />

## 概要

Termix は無料でオープンソースの、セルフホスト型サーバー管理プラットフォームです。SSH ターミナル、リモートデスクトップ（RDP、VNC、Telnet）、ファイル転送、トンネル、Docker、メトリクス、自動化をひとつにまとめ、ウェブ、デスクトップ、モバイルで使えます。ずっと無料で使える、セルフホスト版の Termius 代替です。

<br />

## 機能

<table>
<tr>
<td width="50%" valign="top">

**SSH ターミナル:**
ブラウザのようなタブと分割画面を備えた本格的なターミナルで、最大 6 分割まで同時に表示できます。テーマ、フォント、配色は自由に選べます。各セッションの上のツールバーには CPU、メモリ、ディスクの状況がリアルタイムで表示され、そのホストのファイル、Docker、トンネル、メトリクスへすぐ移動できます。

</td>
<td width="50%" valign="top">

**リモートデスクトップ:**
RDP、VNC、Telnet をブラウザから利用でき、他のセッションと同じようにタブや分割画面で扱えます。RDP ドライブ用のファイルブラウザとドラッグ＆ドロップのアップロードも使えます。Windows のデスクトップ版では、ホストをネイティブの RDP クライアントで開くこともできます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH トンネル:**
ローカル、リモート、ダイナミック SOCKS の転送に対応し、自動再接続とヘルスチェックが付いています。デスクトップ版のクライアント間トンネルはその端末に保存され、プリセットをサーバーに保存しておけば別の端末に設定を移せます。

</td>
<td width="50%" valign="top">

**ファイルマネージャー:**
SFTP でファイルの閲覧、編集、アップロード、ダウンロード、名前変更、移動、削除ができ、sudo にも対応しています。コード、画像、音声、動画を表示・編集できます。サーバー間で直接ファイルをコピーでき、最速の経路が自動で選ばれ、転送の整合性も検証されます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker と Podman:**
コンテナの起動、停止、一時停止、削除ができ、状態を確認したり、中でシェルを開いたりできます。Docker と Podman のどちらでも動きます。Portainer や Dockge を置き換えるためのものではなく、すでにあるコンテナを扱うためのものです。

</td>
<td width="50%" valign="top">

**ホスト管理:**
タグと、名前や色を付けられる入れ子のフォルダでホストを整理できます。保存した認証情報を複数のホストで使い回し、SSH 鍵を自動で配布し、ホストを親ホストの下にまとめ、一括編集やエクスポートができます。保存したくない一度きりの接続にはクイック接続が使えます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**ホストメトリクス:**
たいていの Linux サーバーで CPU、メモリ、ディスク、ネットワーク、温度、稼働時間、プロセス、ポート、ログイン、システム情報を履歴グラフ付きで確認できます。マネージャーカードを使えば、サービス、cron、パッケージ、ユーザー、ファイアウォール、WireGuard、Tailscale、SSL 証明書、ログ、ヘルスチェックを Termix から離れずに扱えます。

</td>
<td width="50%" valign="top">

**自動化:**
きっかけを選んで、何をするかを決めるだけです。きっかけには、メトリクスがしきい値を超えたとき、ホストが上がったり落ちたりしたとき、ヘルスチェックの状態が変わったとき、スケジュール、コンテナのイベント、外部からの Webhook があります。ステップではコマンドやスニペットの実行、コンテナやトンネルの操作、ホストの起動、URL の呼び出し、待機、条件分岐、別の自動化の実行ができ、ntfy、Discord、Webhook で通知できます。テスト実行で安全に試せます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**フリート:**
ホストを選ぶか、タグのルールを決めてフリートにまとめると、新しいホストは自動で入ります。すべてのホストで同じコマンドを一度に実行し、全台にファイルを配ったり集めたり、パッケージを入れたり、OS、カーネル、アーキテクチャ、稼働時間の一覧を集められます。

</td>
<td width="50%" valign="top">

**AI アシスタント:**
任意の機能で、自分で有効にするまでは動きません。OpenAI、Anthropic、Gemini、Ollama、または OpenAI 互換のエンドポイントにつないで、自分の環境について質問できます。ホスト、フリート、スニペット、アラートを読み取れますが、変更は自分で行わず、承認してもらうための提案として出します。認証情報、ユーザー、設定には決して触れられません。管理者はインスタンス全体で無効にでき、初期設定で非表示にすることもできます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**ログインとユーザー:**
ローカルアカウントに加えて OIDC、LDAP、GitHub、Google でのサインインに対応し、2 要素認証（TOTP）、パスキー（WebAuthn）、信頼済みデバイスも使えます。管理者はユーザーの管理、OIDC グループとロールの対応付け、全プラットフォームのアクティブなセッションの確認と失効ができます。ローカルと OIDC のアカウントを連携でき、誰が何をしたかは監査ログで確認できます。

</td>
<td width="50%" valign="top">

**ロールと共有:**
ロールを作り、接続、閲覧、編集、管理という 4 段階でホストをユーザーやロールに共有できます。すべての認証方式とすべてのプロトコルで使え、共有したホストで使う認証情報を上書きすることもできます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**アラート:**
CPU、メモリ、ディスクなどのホストメトリクスにルールを設定し、発報したら ntfy、Discord、Webhook で通知を受け取れます。発報中と解消済みのアラートは履歴で確認でき、気にしないものは消しておけます。

</td>
<td width="50%" valign="top">

**ホームページ:**
自分で組み立てるドラッグ＆ドロップのウィジェット画面です。ホストの状態、Ping、サービスリンク、ブックマーク、検索、時計、カレンダー、カウントダウン、メモ、RSS、天気、画像、iframe、Docker、トンネル、メトリクスのグラフ、独自 API、さらにはライブのターミナルまでウィジェットとして置けます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**スニペットとツール:**
よく使うコマンドを保存して、ワンクリックで実行できます。ホストの値や自分で入力する値を変数として使えます。開いているすべてのターミナルで同じコマンドをまとめて実行でき、コマンド履歴も補完付きで検索できます。

</td>
<td width="50%" valign="top">

**セッション共有:**
ターミナル、RDP、VNC、Telnet のセッションをリアルタイムで共有できます。アカウントなしで参加できるリンクを送るか、特定の Termix ユーザーと共有し、閲覧のみか操作可能かを選べます。共有は自動で期限切れにも、いつでも取り消しにもでき、全体またはホストごとにオフにできます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**セッション録画とログ:**
ターミナル、RDP、VNC のセッションを録画して、あとから再生できます。セッションのテキストログをダウンロードでき、接続ログを見れば接続中に何が起きたかがそのまま分かります。

</td>
<td width="50%" valign="top">

**シリアル接続:**
ルーター、スイッチ、マイコンなどのシリアル機器に、ブラウザやデスクトップアプリから接続できます。ボーレート、データビット、ストップビット、パリティを設定できます。対応ブラウザでは Web Serial API を、デスクトップアプリではネイティブのバックエンドを使います。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
tailnet から端末を取り込んで数クリックでホストとして追加でき、Tailscale SSH で接続すればアクセス制御は tailnet の ACL に任せられ、認証情報を保存する必要がありません。Headscale や独自のエンドポイントにも対応しています。

</td>
<td width="50%" valign="top">

**Proxmox:**
Proxmox のインスタンスからそのままホストを取り込めます。ノードやゲストの CPU、メモリ、ストレージなどの状態を専用のタブで確認できます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**ワークスペースとタブ:**
タブと分割レイアウトのセットを保存して、ワンクリックでまるごと開き直せます。Termix は前回のセッションも覚えているので、再読み込みしても端末を変えてもタブは戻ってきます。

</td>
<td width="50%" valign="top">

**ガイド付きセットアップ:**
短いセットアップが、画面のプリセット、テーマ、使いたい機能、最初のホストの選択を案内します。シンプルモードは使わないものを隠してくれます。セットアップはいつでもやり直せますし、プリセットも切り替えられます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**デスクトップ単体利用と同期:**
デスクトップアプリはローカルのバックエンドとデータベースを持ち、サーバーなしで単体で動きます。Termix サーバーにつなげば、ホスト、認証情報、スニペットなどを双方向で同期でき、接続をローカルから始めるかサーバー経由にするかも選べます。

</td>
<td width="50%" valign="top">

**コマンドラインツール:**
シェルやスクリプトから使える `termix` CLI です。ターミナルを開き、ホスト 1 台またはフリート全体でコマンドを実行し、SFTP でファイルを移動し、ホストやスニペット、認証情報を管理できます。`npm install -g @termix-cli/cli` で入れるか、単体のバイナリを使ってください。詳しくは [CLI ドキュメント](https://docs.termix.site/cli)をご覧ください。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**セキュリティ:**
パスワードや鍵などの秘密情報はユーザーごとに暗号化され、データベースのファイル自体もディスク上で暗号化できます。仕組みは[ドキュメント](https://docs.termix.site/security)をご覧ください。

</td>
<td width="50%" valign="top">

**多言語対応:**
約 30 言語に対応しており、[Crowdin](https://docs.termix.site/translations) で管理しています。

</td>
</tr>
</table>

<br />

<details>
<summary><b>その他の機能</b></summary>
<br />

- **ダッシュボード** - 自分で並べたカードでサーバーの状況をひと目で把握
- **ネットワーク図** - ホストからホームラボを図にして、状態をリアルタイム表示
- **tmux モニター** - tmux のセッション、ウィンドウ、ペインをプレビューと検索付きで一覧
- **API キー** - スクリプトや CI 用の、有効期限付きユーザー単位のキー
- **エクスポートとインポート** - ホスト、認証情報、ファイルマネージャーのデータを出し入れ
- **自動 SSL** - 証明書の発行と更新、HTTPS へのリダイレクトを自動で。自前の証明書も使えます
- **データベース** - 標準は SQLite、PostgreSQL と MySQL にも対応
- **モダンな UI** - デスクトップでもモバイルでも使える React の画面。ライト、ダーク、Dracula などのテーマ付き。どの接続も URL からフルスクリーンで開けます
- **コマンドパレット** - 左 Shift の 2 回押しで、キーボードからホストへ移動
- **キーボードショートカット** - タブの移動や閉じる操作など、すべて割り当て変更可能
- **Wake-on-LAN** - Termix からでも自動化のステップからでもマシンを起動
- **信頼済みプロキシ認証** - リバースプロキシにサインインを任せ、ユーザー情報を引き継ぎ
- **充実した SSH 機能** - 踏み台ホスト、Warpgate、TOTP の入力、SOCKS5、ホスト鍵の検証、パスワードの自動入力、[OPKSSH](https://github.com/openpubkey/opkssh)、tmux、ポートノッキング、ターミナルのログ、エージェント転送、Bitwarden SSH エージェント、HashiCorp Vault の SSH 署名など
- **Termix ID** - sshid.io のような仕組みを内蔵。ハンドルを取得し、公開鍵をリゾルバー URL で公開し、内蔵 CA から SSH 証明書を発行できます

</details>

<br />

## プラットフォーム対応

<table align="center">
<tr>
<th align="center">プラットフォーム</th>
<th align="center">配布形式</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>最近のブラウザ全般（Chrome、Safari、Firefox）· PWA 対応</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>ポータブル · MSI インストーラー · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>ポータブル · AUR · AppImage · Deb · Flatpak</td>
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

## インストール

すべてのプラットフォーム向けの詳しいインストール手順は [Termix ドキュメント](https://docs.termix.site/install)をご覧ください。

Docker Compose の例です（リモートデスクトップ機能を使わないなら `guacd` とネットワークの部分は省略できます）:

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

### コマンドラインツール

Termix には CLI もあるので、ターミナルからサーバーを管理したり、自分のスクリプトに組み込んだりできます。

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

ターミナルを開き、ホスト 1 台またはフリート全体でコマンドを実行し、SFTP でファイルを移動し、ホストやスニペット、認証情報を管理できます。詳しい説明は [docs.termix.site/cli](https://docs.termix.site/cli) にあります。

### クラウドでの運用

Termix のサーバーは自分のネットワーク内ではなく、VPS で動かすこともできます。管理対象のネットワーク上で動かしていると、障害が起きたときに Termix も一緒に落ちてしまい、直したいときに限って使えなくなります。外で動かしておけばいつでも届きますし、固定 IP も手に入り、VPN やポート開放なしでどこからでも入れます。

[GINERNET](https://docs.termix.site/install/ginernet) は Termix のスポンサーで、同社の VPS へデプロイする手順はドキュメントに詳しく載っています。

<br />

## テレメトリー

Termix は 1 日 1 回、匿名の小さなデータを送ります。どれくらいのインスタンスが動いていて、どの機能が使われているかを把握するためのものです。含まれるのはランダムなインスタンス ID、ユーザーとホストの数、アプリのバージョン、直近 24 時間に使われた機能（ターミナル、ファイルマネージャー、トンネル、Docker など）だけです。ユーザー名、ホスト名、IP アドレス、認証情報など、あなたやサーバーを特定できるものは一切含まれません。

初期状態では有効です。管理設定の「一般」から止められますし、Termix を起動する前に `ENABLE_TELEMETRY=false` を設定しておくこともできます。

<br />

## 寄付

Termix は無料でオープンソースで、サブスクリプションも有料プランもありません。役に立っていると感じたら、サーバー代、ドメイン、開発時間を支えるための寄付をご検討ください。寄付は SAML、Kubernetes、エージェント対応といった機能を作るための調査や学習の時間にもあてられます。進み具合の確認と寄付は下記からどうぞ。

[寄付する](https://donate.termix.site/)

<br />

## スポンサー

有料掲載で開発を支援することにご興味がありますか。[mail@termix.site](mailto:mail@termix.site) までご連絡ください。

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

## サポート

困ったときや機能の要望があるときは、[新しい issue](https://github.com/Termix-SSH/Support/issues) を作って、できるだけ詳しく、できれば英語で書いてください。[Discord](https://discord.gg/jVQGdvHDrf) のサポートチャンネルでも質問できますが、返信には時間がかかることがあります。

<br />

## スクリーンショット

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>YouTube でアップデートの紹介を見る</sub>

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

<sub>動画や画像は古くなっていたり、機能を十分に伝えられていない場合があります。</sub>

</div>

<br />

## 予定されている機能

予定されている機能はすべて [Projects](https://github.com/orgs/Termix-SSH/projects/5) にあります。貢献をお考えの方は[コントリビューションガイド](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md)をご覧ください。

<br />

## ライセンス

Apache License 2.0 のもとで配布しています。詳しくは `LICENSE` をご覧ください。
