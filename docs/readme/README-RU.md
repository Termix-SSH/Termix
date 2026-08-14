<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Управление серверами на своём хостинге, от SSH и удалённого рабочего стола до автоматизаций</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-PT.md">Português</a> ·
  Русский ·
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

Termix бесплатен и с открытым исходным кодом. Если он вам пригодился, подумайте о [пожертвовании](https://donate.termix.site/), чтобы помочь покрыть расходы на серверы и время на разработку.

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Получено 1 сентября 2025 года</sub>
</p>

</div>

<br />

## Обзор

Termix это бесплатная платформа с открытым исходным кодом для управления серверами на своём хостинге. Она собирает в одном месте SSH-терминалы, удалённые рабочие столы (RDP, VNC, Telnet), передачу файлов, туннели, Docker, метрики и автоматизации, в браузере, на компьютере и на телефоне. Это self-hosted замена Termius, которая остаётся бесплатной навсегда.

<br />

## Возможности

<table>
<tr>
<td width="50%" valign="top">

**SSH-терминал:**
Полноценный терминал с вкладками как в браузере и разделением экрана, до 6 панелей одновременно. Тему, шрифт и цвета выбираете вы. Над каждой сессией есть панель с текущей загрузкой процессора, памяти и диска, а также быстрые ссылки на файлы, Docker, туннели и метрики этого хоста.

</td>
<td width="50%" valign="top">

**Удалённый рабочий стол:**
RDP, VNC и Telnet прямо в браузере, во вкладках и с разделением экрана, как и любая другая сессия. Есть просмотр файлов на дисках RDP и загрузка перетаскиванием. В версии для Windows хост можно открыть и в обычном клиенте RDP.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH-туннели:**
Локальная, удалённая и динамическая переадресация SOCKS с автоматическим переподключением и проверкой состояния. Туннели от клиента к серверу в настольном приложении хранятся на этом компьютере, а наборы настроек можно сохранить на сервере, чтобы перенести конфигурацию на другую машину.

</td>
<td width="50%" valign="top">

**Файловый менеджер:**
Просматривайте, редактируйте, загружайте, скачивайте, переименовывайте, перемещайте и удаляйте файлы по SFTP, в том числе через sudo. Смотрите и правьте код, изображения, аудио и видео. Копируйте файлы напрямую с одного сервера на другой: самый быстрый маршрут подбирается сам, а целостность передачи проверяется.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker и Podman:**
Запускайте, останавливайте, ставьте на паузу и удаляйте контейнеры, смотрите их нагрузку и открывайте оболочку внутри. Работает и с Docker, и с Podman. Это не замена Portainer или Dockge, а способ управлять теми контейнерами, что у вас уже есть.

</td>
<td width="50%" valign="top">

**Менеджер хостов:**
Храните и упорядочивайте хосты с помощью меток и вложенных папок, которым можно задать имя и цвет. Используйте сохранённые учётные данные на нескольких хостах, разворачивайте SSH-ключи автоматически, группируйте хосты под родительским, редактируйте и выгружайте пакетно, а для разовых подключений, которые не хочется сохранять, есть быстрое подключение.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Метрики хостов:**
Процессор, память, диск, сеть, температура, время работы, процессы, порты, входы в систему и сведения о системе на большинстве серверов Linux, с графиками за прошлые периоды. Карточки управления позволяют работать со службами, задачами cron, пакетами, пользователями, правилами брандмауэра, WireGuard, Tailscale, сертификатами SSL, журналами и проверками состояния, не выходя из Termix.

</td>
<td width="50%" valign="top">

**Автоматизации:**
Выберите событие, а затем опишите, что должно произойти. Событием может быть превышение порога метрикой, хост, который упал или вернулся, изменение проверки состояния, расписание, событие контейнера или входящий webhook. Шаги умеют выполнять команды и сниппеты, управлять контейнерами и туннелями, будить хост, обращаться по адресу, ждать, ветвиться по условию, запускать другую автоматизацию и присылать уведомления через ntfy, Discord или webhook. Тестовый запуск позволяет всё безопасно проверить.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Флоты:**
Объединяйте хосты во флот вручную или по правилам меток, чтобы новые хосты попадали туда сами. Выполняйте одну команду сразу на всех хостах, отправляйте и забирайте файлы со всех, устанавливайте пакеты и собирайте сводку по системе, ядру, архитектуре и времени работы.

</td>
<td width="50%" valign="top">

**ИИ-помощник:**
Необязательная возможность, выключенная до тех пор, пока вы сами её не включите. Подключите OpenAI, Anthropic, Gemini, Ollama или любой совместимый с OpenAI адрес и спрашивайте о своей системе. Он читает хосты, флоты, сниппеты и оповещения и предлагает изменения на ваше утверждение, а не вносит их сам. До учётных данных, пользователей и настроек он не доберётся никогда. Администраторы могут оставить его выключенным для всей установки, а вы можете скрыть его ещё при первичной настройке.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Вход и пользователи:**
Локальные учётные записи, а также вход через OIDC, LDAP, GitHub и Google, с двухфакторной проверкой (TOTP), ключами доступа (WebAuthn) и доверенными устройствами. Администраторы могут управлять пользователями, сопоставлять группы OIDC с ролями, видеть все активные сессии на всех платформах и завершать их. Свяжите локальную учётную запись с OIDC и смотрите журнал аудита действий каждого.

</td>
<td width="50%" valign="top">

**Роли и общий доступ:**
Создавайте роли и делитесь хостами с пользователями или ролями на четырёх уровнях: подключение, просмотр, изменение и управление. Работает со всеми способами аутентификации и всеми протоколами, а учётные данные для общего хоста можно переопределить.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Оповещения:**
Задайте правила по метрикам хостов, например процессору, памяти и диску, и получайте уведомления через ntfy, Discord или webhook, когда они срабатывают. Смотрите активные и уже снятые оповещения в журнале и убирайте те, что вам не нужны.

</td>
<td width="50%" valign="top">

**Домашняя страница:**
Сетка виджетов, которую вы собираете сами перетаскиванием. Есть виджеты для состояния хостов, пингов, ссылок на сервисы, закладок, поиска, часов, календарей, обратного отсчёта, заметок, RSS, погоды, изображений, встроенных страниц, Docker, туннелей, графиков метрик, своих API и даже живого терминала.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Сниппеты и инструменты:**
Сохраняйте команды, которые часто набираете, и запускайте их одним нажатием, с переменными для хоста и для собственного ввода. Выполняйте одну команду сразу во всех открытых терминалах и ищите по истории команд с автодополнением.

</td>
<td width="50%" valign="top">

**Общий доступ к сессии:**
Делитесь живой сессией терминала, RDP, VNC или Telnet. Отправьте ссылку, по которой можно подключиться без учётной записи, или поделитесь с конкретным пользователем Termix, только для просмотра или с правом ввода. Доступ может истекать сам или отзываться в любой момент, и его можно отключить полностью или для отдельного хоста.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Запись сессий и журналы:**
Записывайте сессии терминала, RDP и VNC и просматривайте их позже. Скачивайте текстовые журналы сессии и заглядывайте в журнал подключения, чтобы увидеть, что именно происходило во время соединения.

</td>
<td width="50%" valign="top">

**Последовательные подключения:**
Общайтесь с последовательными устройствами вроде маршрутизаторов, коммутаторов и микроконтроллеров из браузера или настольного приложения. Настраивайте скорость, биты данных, стоповые биты и чётность. В подходящих браузерах используется Web Serial API, а в настольном приложении собственный бэкенд.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Подтягивайте устройства из своей tailnet, чтобы добавить их как хосты в пару нажатий, и подключайтесь через Tailscale SSH: доступом займутся правила tailnet, а учётные данные хранить не придётся. Headscale и свои адреса тоже работают.

</td>
<td width="50%" valign="top">

**Proxmox:**
Импортируйте хосты прямо из установки Proxmox и следите за показателями узлов и гостевых машин, включая процессор, память и хранилище, на отдельной вкладке.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Рабочие пространства и вкладки:**
Сохраните набор вкладок вместе с разделением экрана и откройте всё это одним нажатием. Termix помнит и последнюю сессию, поэтому вкладки возвращаются после обновления страницы и на других устройствах.

</td>
<td width="50%" valign="top">

**Пошаговая настройка:**
Короткая настройка поможет выбрать шаблон интерфейса, тему, нужные возможности и первый хост. Простой режим скрывает то, чем вы не пользуетесь, а настройку можно пройти заново или сменить шаблон в любой момент.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Автономный клиент и синхронизация:**
Настольное приложение работает само по себе, со своим бэкендом и базой данных, без сервера. Его можно подключить к серверу Termix, чтобы в обе стороны синхронизировать хосты, учётные данные, сниппеты и остальное, и выбрать, откуда идут подключения: с вашего компьютера или через сервер.

</td>
<td width="50%" valign="top">

**Командная строка:**
CLI `termix` для вашей оболочки и ваших скриптов. Открывайте терминалы, выполняйте команду на одном хосте или на целом флоте, перемещайте файлы по SFTP и управляйте хостами, сниппетами и учётными данными. Установите через `npm install -g @termix-cli/cli` или возьмите отдельный исполняемый файл. Смотрите [документацию CLI](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Безопасность:**
Пароли, ключи и другие секреты шифруются для каждого пользователя, а сами файлы базы данных можно зашифровать на диске. Как это устроено, описано в [документации](https://docs.termix.site/security).

</td>
<td width="50%" valign="top">

**Языки:**
Около 30 встроенных языков, которые ведутся через [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Другие возможности</b></summary>
<br />

- **Панель** - Ваши серверы одним взглядом, карточки расставляете вы сами
- **Схема сети** - Ваша домашняя лаборатория, нарисованная по хостам, с состоянием в реальном времени
- **Монитор tmux** - Просмотр сессий, окон и панелей tmux с предпросмотром и поиском
- **Ключи API** - Ключи для конкретного пользователя со сроком действия, для скриптов и CI
- **Экспорт и импорт** - Перенос хостов, учётных данных и данных файлового менеджера
- **Автоматический SSL** - Сертификаты выпускаются и обновляются за вас, с переходом на HTTPS, либо используйте свои
- **Базы данных** - По умолчанию SQLite, поддерживаются также PostgreSQL и MySQL
- **Современный интерфейс** - Аккуратный интерфейс на React для компьютера и телефона, с темами вроде светлой, тёмной и Dracula. Любое подключение открывается на весь экран по ссылке
- **Палитра команд** - Двойное нажатие левого Shift, чтобы перейти к хосту с клавиатуры
- **Сочетания клавиш** - Переход между вкладками, их закрытие и другое, всё можно переназначить
- **Wake-on-LAN** - Разбудите машину из Termix или из шага автоматизации
- **Доверенный прокси** - Пусть обратный прокси возьмёт вход на себя и передаст пользователя
- **Богатые возможности SSH** - Промежуточные хосты, Warpgate, запросы TOTP, SOCKS5, проверка ключей хоста, автозаполнение паролей, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, журналы терминала, проброс агента, SSH-агент Bitwarden, подпись SSH через HashiCorp Vault и другое
- **Termix ID** - Встроенный аналог sshid.io. Займите имя, опубликуйте открытые ключи по адресу распознавателя и выпускайте SSH-сертификаты через встроенный центр сертификации

</details>

<br />

## Поддержка платформ

<table align="center">
<tr>
<th align="center">Платформа</th>
<th align="center">Способ установки</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Любой современный браузер (Chrome, Safari, Firefox) · Поддержка PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Портативная версия · Установщик MSI · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Портативная версия · AUR · AppImage · Deb · Flatpak</td>
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

## Установка

Полные инструкции по установке для всех платформ смотрите в [документации Termix](https://docs.termix.site/install).

Пример файла Docker Compose (`guacd` и сеть можно убрать, если удалённый рабочий стол вам не нужен):

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

### Командная строка

У Termix есть и CLI, так что серверами можно управлять из терминала и использовать Termix в своих скриптах.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

Он умеет открывать терминалы, выполнять команду на одном хосте или на целом флоте, перемещать файлы по SFTP и управлять хостами, сниппетами и учётными данными. Полная документация есть на [docs.termix.site/cli](https://docs.termix.site/cli).

### Размещение в облаке

Сервер Termix можно держать на VPS, а не внутри своей сети. Если Termix работает в той же сети, которой управляет, при сбое он упадёт вместе с ней, как раз тогда, когда нужен для починки. Снаружи он остаётся доступным, даёт постоянный IP и позволяет зайти откуда угодно без VPN и проброса портов.

[GINERNET](https://docs.termix.site/install/ginernet) спонсирует Termix, и в документации есть пошаговое руководство по развёртыванию на их площадке VPS.

<br />

## Телеметрия

Termix раз в сутки отправляет небольшой анонимный сигнал, чтобы я понимал, сколько установок работает и какими возможностями действительно пользуются. В нём есть случайный идентификатор установки, число пользователей и хостов, версия приложения и то, какие возможности (терминал, файловый менеджер, туннели, docker и прочее) использовались за последние 24 часа. В нём никогда нет имён пользователей, имён хостов, IP-адресов, учётных данных и ничего другого, что указывало бы на вас или ваши серверы.

По умолчанию он включён. Выключить можно в настройках администратора в разделе «Общие» или задать `ENABLE_TELEMETRY=false` ещё до первого запуска Termix.

<br />

## Пожертвования

Termix бесплатен и открыт, без подписок и платных тарифов. Если он вам полезен, подумайте о пожертвовании: оно помогает с серверами, доменами и временем на разработку. Пожертвования также оплачивают время на изучение того, что нужно для таких возможностей, как SAML, Kubernetes и поддержка агентов. Следить за ходом работ и поддержать можно по ссылке ниже.

[Поддержать](https://donate.termix.site/)

<br />

## Спонсоры

Интересует платное размещение в поддержку разработки? Напишите на [mail@termix.site](mailto:mail@termix.site).

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

## Поддержка

Нужна помощь или хотите предложить функцию? Создайте [новое обращение](https://github.com/Termix-SSH/Support/issues) и опишите всё как можно подробнее, по возможности на английском. Ещё можно спросить в канале поддержки в [Discord](https://discord.gg/jVQGdvHDrf), хотя там ответа иногда приходится ждать дольше.

<br />

## Скриншоты

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Смотрите обзоры обновлений на YouTube</sub>

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

<sub>Некоторые видео и изображения могут устареть или не полностью показывать возможности.</sub>

</div>

<br />

## Запланированные функции

Все запланированные функции собраны в [Projects](https://github.com/orgs/Termix-SSH/projects/5). Если хотите поучаствовать, посмотрите [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Лицензия

Распространяется по лицензии Apache версии 2.0. Подробности в файле `LICENSE`.
