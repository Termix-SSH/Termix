# Repo-Statistiken

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · 🇩🇪 Deutsch · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Erreicht am 1. September 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# Überblick

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix ist eine quelloffene, dauerhaft kostenlose, selbst gehostete All-in-One-Serververwaltungsplattform. Sie bietet eine plattformübergreifende Lösung zur Verwaltung Ihrer Server und Infrastruktur über eine einzige, intuitive Oberfläche. Termix bietet SSH-Terminalzugriff, Remote-Desktop-Steuerung (RDP, VNC, Telnet), SSH-Tunneling-Funktionen, Remote-SSH-Dateiverwaltung und viele weitere Werkzeuge. Termix ist die perfekte kostenlose und selbst gehostete Alternative zu Termius, verfügbar für alle Plattformen.

# Funktionen

- **SSH-Terminalzugriff** - Voll ausgestattetes Terminal mit Split-Screen-Unterstützung (bis zu 4 Panels) mit einem browserähnlichen Tab-System. Enthält Unterstützung für die Anpassung des Terminals einschließlich gängiger Terminal-Themes, Schriftarten und anderer Komponenten.
- **Remote-Desktop-Zugriff** - RDP-, VNC- und Telnet-Unterstützung über den Browser mit vollständiger Anpassung und Split-Screen.
- **SSH-Tunnelverwaltung** - Erstellen und verwalten Sie Server-zu-Server-SSH-Tunnel mit automatischer Wiederverbindung und Gesundheitsüberwachung sowie lokaler, entfernter oder dynamischer SOCKS-Weiterleitung. Desktop-Client-zu-Server-Tunneleinstellungen werden lokal pro Desktop-Installation gespeichert, optionale C2S-Preset-Snapshots können auf dem Server gespeichert, umbenannt, geladen oder gelöscht werden, um eine lokale Tunnelkonfiguration zwischen Clients zu übertragen.
- **Remote-Dateimanager** - Verwalten Sie Dateien direkt auf Remote-Servern mit Unterstützung für das Anzeigen und Bearbeiten von Code, Bildern, Audio und Video. Laden Sie Dateien hoch, herunter, benennen Sie sie um, löschen oder verschieben Sie sie nahtlos mit Sudo-Unterstützung.
- **Docker-Verwaltung** - Container starten, stoppen, pausieren, entfernen. Container-Statistiken anzeigen. Container über Docker-Exec-Terminal steuern. Es wurde nicht entwickelt, um Portainer oder Dockge zu ersetzen, sondern um Ihre Container einfach zu verwalten, anstatt sie zu erstellen.
- **SSH-Host-Manager** - Speichern, organisieren und verwalten Sie Ihre SSH-Verbindungen mit Tags und Ordnern und speichern Sie einfach wiederverwendbare Anmeldeinformationen mit der Möglichkeit, die Bereitstellung von SSH-Schlüsseln zu automatisieren.
- **Serverstatistiken** - CPU-, Arbeitsspeicher- und Festplattenauslastung sowie Netzwerk, Betriebszeit, Systeminformationen, Firewall, Port-Monitor auf den meisten Linux-basierten Servern anzeigen.
- **Dashboard** - Serverinformationen auf einen Blick auf Ihrem Dashboard anzeigen.
- **RBAC** - Rollen erstellen und Hosts über Benutzer/Rollen teilen.
- **Benutzerauthentifizierung** - Sichere Benutzerverwaltung mit Admin-Kontrollen und OIDC- (mit Zugriffskontrolle) sowie 2FA (TOTP)-Unterstützung. Aktive Benutzersitzungen über alle Plattformen anzeigen und Berechtigungen widerrufen. OIDC-/Lokale Konten miteinander verknüpfen.
- **Datenbankverschlüsselung** - Backend gespeichert als verschlüsselte SQLite-Datenbankdateien. Weitere Informationen in der [Dokumentation](https://docs.termix.site/security).
- **API-Schlüssel** - Erstellen Sie benutzerbezogene API-Schlüssel mit Ablaufdaten zur Verwendung für Automatisierung/CI.
- **Datenexport/-import** - SSH-Hosts, Anmeldeinformationen und Dateimanager-Daten exportieren und importieren.
- **Automatische SSL-Einrichtung** - Integrierte SSL-Zertifikatsgenerierung und -verwaltung mit HTTPS-Weiterleitungen.
- **Moderne Benutzeroberfläche** - Saubere desktop-/mobilfreundliche Oberfläche, erstellt mit React, Tailwind CSS und Shadcn. Wählen Sie zwischen vielen verschiedenen UI-Themes einschließlich Hell, Dunkel, Dracula usw. Verwenden Sie URL-Routen, um jede Verbindung im Vollbildmodus zu öffnen.
- **Sprachen** - Integrierte Unterstützung für ~30 Sprachen (verwaltet über [Crowdin](https://docs.termix.site/translations)).
- **Plattformunterstützung** - Verfügbar als Web-App, Desktop-Anwendung (Windows, Linux und macOS, kann eigenständig ohne Termix-Backend ausgeführt werden), PWA und dedizierte Mobil-/Tablet-App für iOS und Android.
- **SSH-Werkzeuge** - Erstellen Sie wiederverwendbare Befehlsvorlagen, die mit einem einzigen Klick ausgeführt werden. Führen Sie einen Befehl gleichzeitig in mehreren geöffneten Terminals aus.
- **Befehlsverlauf** - Autovervollständigung und Anzeige zuvor ausgeführter SSH-Befehle.
- **Schnellverbindung** - Verbinden Sie sich mit einem Server, ohne die Verbindungsdaten speichern zu müssen.
- **Befehlspalette** - Doppeltippen Sie die linke Umschalttaste, um schnell auf SSH-Verbindungen mit Ihrer Tastatur zuzugreifen.
- **SSH-Funktionsreich** - Unterstützt Jump-Hosts, Warpgate, TOTP-basierte Verbindungen, SOCKS5, Host-Key-Verifizierung, automatisches Ausfüllen von Passwörtern, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, Port Knocking usw.
- **Netzwerkgraph** - Passen Sie Ihr Dashboard an, um Ihr Homelab basierend auf Ihren SSH-Verbindungen mit Statusunterstützung zu visualisieren.
- **Persistente Tabs** - SSH-Sitzungen und Tabs bleiben über Geräte/Aktualisierungen hinweg offen, wenn im Benutzerprofil aktiviert.

# Geplante Funktionen

Siehe [Projekte](https://github.com/orgs/Termix-SSH/projects/2) für alle geplanten Funktionen. Wenn Sie beitragen möchten, siehe [Mitwirken](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Installation

Unterstützte Geräte:

- Website (jeder moderne Browser auf jeder Plattform wie Chrome, Safari und Firefox) (einschließlich PWA-Unterstützung)
- Windows (x64/ia32)
  - Portabel
  - MSI-Installationsprogramm
  - Chocolatey-Paketmanager
- Linux (x64/ia32)
  - Portabel
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32 ab v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

Besuchen Sie die Termix-[Dokumentation](https://docs.termix.site/install) für weitere Informationen zur Installation von Termix auf allen Plattformen. Alternativ finden Sie hier eine Docker Compose-Beispieldatei (Sie können guacd und das Netzwerk weglassen, wenn Sie keine Remote-Desktop-Funktionen nutzen möchten):

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

# Sponsoren

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

# Support

Wenn Sie Hilfe benötigen oder eine Funktion für Termix anfragen möchten, besuchen Sie die [Issues](https://github.com/Termix-SSH/Support/issues)-Seite, melden Sie sich an und klicken Sie auf `New Issue`.
Bitte beschreiben Sie Ihr Anliegen so detailliert wie möglich, vorzugsweise auf Englisch. Sie können auch dem [Discord](https://discord.gg/jVQGdvHDrf)-Server beitreten und den Support-Kanal besuchen, allerdings können die Antwortzeiten dort länger sein.

# Screenshots

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

Einige Videos und Bilder können veraltet sein oder Funktionen möglicherweise nicht perfekt darstellen.

# Lizenz

Verteilt unter der Apache License Version 2.0. Siehe LICENSE für weitere Informationen.
