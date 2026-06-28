<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Selbst gehostete SSH-Verwaltung und Remote-Desktop-Zugriff</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  Deutsch ·
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
</p>

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Erreicht am 1. September 2025</sub>
</p>

</div>

<br />

## Uberblick

Termix ist eine quelloffene, dauerhaft kostenlose, selbst gehostete All-in-One-Serververwaltungsplattform. Sie bietet eine plattformubergreifende Losung zur Verwaltung Ihrer Server und Infrastruktur uber eine einzige, intuitive Oberflache. Termix bietet SSH-Terminalzugriff, Remote-Desktop-Steuerung (RDP, VNC, Telnet), SSH-Tunneling-Funktionen, Remote-SSH-Dateiverwaltung und viele weitere Werkzeuge. Termix ist die perfekte kostenlose und selbst gehostete Alternative zu Termius, verfugbar fur alle Plattformen.

<br />

## Funktionen

<table>
<tr>
<td width="50%" valign="top">

**SSH-Terminalzugriff:**
Voll ausgestattetes Terminal mit Split-Screen-Unterstutzung (bis zu 4 Panels) mit einem browserahnlichen Tab-System. Enthalt Unterstutzung fur die Anpassung des Terminals einschliesslich gangiger Terminal-Themes, Schriftarten und anderer Komponenten.

</td>
<td width="50%" valign="top">

**Remote-Desktop-Zugriff:**
RDP-, VNC- und Telnet-Unterstutzung uber den Browser mit vollstandiger Anpassung und Split-Screen.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH-Tunnelverwaltung:**
Erstellen und verwalten Sie Server-zu-Server-SSH-Tunnel mit automatischer Wiederverbindung und Gesundheitsuberwachung sowie lokaler, entfernter oder dynamischer SOCKS-Weiterleitung. Desktop-Client-zu-Server-Tunneleinstellungen werden lokal pro Desktop-Installation gespeichert, optionale C2S-Preset-Snapshots konnen auf dem Server gespeichert, umbenannt, geladen oder geloscht werden, um eine lokale Tunnelkonfiguration zwischen Clients zu ubertragen.

</td>
<td width="50%" valign="top">

**Remote-Dateimanager:**
Verwalten Sie Dateien direkt auf Remote-Servern mit Unterstutzung fur das Anzeigen und Bearbeiten von Code, Bildern, Audio und Video. Laden Sie Dateien hoch, herunter, benennen Sie sie um, loschen oder verschieben Sie sie nahtlos mit Sudo-Unterstutzung.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker-Verwaltung:**
Container starten, stoppen, pausieren, entfernen. Container-Statistiken anzeigen. Container uber Docker-Exec-Terminal steuern. Es wurde nicht entwickelt, um Portainer oder Dockge zu ersetzen, sondern um Ihre Container einfach zu verwalten, anstatt sie zu erstellen.

</td>
<td width="50%" valign="top">

**SSH-Host-Manager:**
Speichern, organisieren und verwalten Sie Ihre SSH-Verbindungen mit Tags und Ordnern (Ordneranpassung und verschachtelte Ordner werden unterstutzt) und speichern Sie einfach wiederverwendbare Anmeldeinformationen mit der Moglichkeit, die Bereitstellung von SSH-Schlusseln zu automatisieren.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Host-Metriken:**
CPU-, Arbeitsspeicher- und Festplattenauslastung, Netzwerk, Betriebszeit, Systeminformationen, Firewall, Port-Monitor, Log-Viewer, Benutzer/Berechtigungen, Zertifikate und vieles mehr auf den meisten Linux-basierten Servern anzeigen.

</td>
<td width="50%" valign="top">

**Benutzerauthentifizierung:**
Sichere Benutzerverwaltung mit Admin-Kontrollen und OIDC-/LDAP-/SSO-Unterstutzung (mit Zugriffskontrolle) sowie 2FA (TOTP)-Unterstutzung. Aktive Benutzersitzungen uber alle Plattformen anzeigen und Berechtigungen widerrufen. OIDC-/Lokale Konten miteinander verknupfen. Audit-Protokoll aller Benutzeraktionen anzeigen.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
Rollen erstellen und Hosts uber Benutzer/Rollen teilen.

</td>
<td width="50%" valign="top">

**Datenbankverschlusselung:**
Backend gespeichert als verschlusselte SQLite-Datenbankdateien. Weitere Informationen in der [Dokumentation](https://docs.termix.site/security).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Netzwerkgraph:**
Passen Sie Ihr Dashboard an, um Ihr Homelab basierend auf Ihren SSH-Verbindungen mit Statusunterstutzung zu visualisieren.

</td>
<td width="50%" valign="top">

**SSH-Werkzeuge:**
Erstellen Sie wiederverwendbare Befehlsvorlagen, die mit einem einzigen Klick ausgefuhrt werden. Fuhren Sie einen Befehl gleichzeitig in mehreren geoffneten Terminals aus.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Persistente Tabs:**
SSH-Sitzungen und Tabs bleiben uber Gerate/Aktualisierungen hinweg offen, wenn im Benutzerprofil aktiviert.

</td>
<td width="50%" valign="top">

**Sprachen:**
Integrierte Unterstutzung fur ca. 30 Sprachen (verwaltet uber [Crowdin](https://docs.termix.site/translations)).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Weitere Funktionen</b></summary>
<br />

- **Dashboard** - Serverinformationen auf einen Blick auf Ihrem Dashboard anzeigen
- **API-Schlussel** - Erstellen Sie benutzerbezogene API-Schlussel mit Ablaufdaten zur Verwendung fur Automatisierung/CI
- **Datenexport/-import** - SSH-Hosts, Anmeldeinformationen und Dateimanager-Daten exportieren und importieren
- **Automatische SSL-Einrichtung** - Integrierte SSL-Zertifikatsgenerierung und -verwaltung mit HTTPS-Weiterleitungen
- **Moderne Benutzeroberflache** - Saubere desktop-/mobilfreundliche Oberflache, erstellt mit React, Tailwind CSS und Shadcn. Wahlen Sie zwischen vielen verschiedenen UI-Themes einschliesslich Hell, Dunkel, Dracula usw. Verwenden Sie URL-Routen, um jede Verbindung im Vollbildmodus zu offnen.
- **Befehlsverlauf** - Autovervollstandigung und Anzeige zuvor ausgefuhrter SSH-Befehle
- **Schnellverbindung** - Verbinden Sie sich mit einem Server, ohne die Verbindungsdaten speichern zu mussen
- **Befehlspalette** - Doppeltippen Sie die linke Umschalttaste, um schnell auf SSH-Verbindungen mit Ihrer Tastatur zuzugreifen
- **Proxmox-Integration** - Automatisches Hinzufugen von Hosts zu Termix aus Ihrer Proxmox-Instanz
- **SSH-Funktionsreich** - Unterstutzt Jump-Hosts, Warpgate, TOTP-basierte Verbindungen, SOCKS5, Host-Key-Verifizierung, automatisches Ausfullen von Passwortern, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, Port Knocking, Terminal-Protokollierung usw.

</details>

<br />

## Plattformunterstutzung

<table align="center">
<tr>
<th align="center">Plattform</th>
<th align="center">Distribution</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Jeder moderne Browser (Chrome, Safari, Firefox) · PWA-Unterstutzung</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portabel · MSI-Installationsprogramm · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portabel · AUR · AppImage · Deb · Flatpak</td>
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

## Installation

Besuchen Sie die Termix-[Dokumentation](https://docs.termix.site/install) fur weitere Informationen zur Installation von Termix auf allen Plattformen. Alternativ finden Sie hier eine Docker Compose-Beispieldatei (Sie konnen guacd und das Netzwerk weglassen, wenn Sie keine Remote-Desktop-Funktionen nutzen mochten):

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

## Spenden

Termix ist kostenlos und Open Source ohne Abonnements oder kostenpflichtige Pläne. Wenn Sie es nützlich finden, erwägen Sie eine Spende, um Serverkosten, Domains und Entwicklungszeit zu decken.

[Spenden](https://donate.termix.site/)

<br />

## Screenshots

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Update-Ubersichten auf YouTube ansehen</sub>

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

<sub>Einige Videos und Bilder konnen veraltet sein oder Funktionen moglicherweise nicht perfekt darstellen.</sub>

</div>

<br />

## Geplante Funktionen

Siehe [Projekte](https://github.com/orgs/Termix-SSH/projects/2) fur alle geplanten Funktionen. Wenn Sie beitragen mochten, siehe [Mitwirken](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Sponsoren

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

## Support

Wenn Sie Hilfe benotigen oder eine Funktion fur Termix anfragen mochten, besuchen Sie die [Issues](https://github.com/Termix-SSH/Support/issues)-Seite, melden Sie sich an und klicken Sie auf `New Issue`. Bitte beschreiben Sie Ihr Anliegen so detailliert wie moglich, vorzugsweise auf Englisch. Sie konnen auch dem [Discord](https://discord.gg/jVQGdvHDrf)-Server beitreten und den Support-Kanal besuchen, allerdings konnen die Antwortzeiten dort langer sein.

<br />

## Lizenz

Verteilt unter der Apache License Version 2.0. Siehe `LICENSE` fur weitere Informationen.
