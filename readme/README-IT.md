# Statistiche Repo

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · 🇮🇹 Italiano
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Ottenuto il 1 settembre 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# Panoramica

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix è una piattaforma di gestione server tutto-in-uno, open-source, per sempre gratuita e self-hosted. Fornisce una soluzione multipiattaforma per gestire i tuoi server e la tua infrastruttura attraverso un'unica interfaccia intuitiva. Termix offre accesso al terminale SSH, controllo remoto del desktop (RDP, VNC, Telnet), funzionalità di tunneling SSH, gestione remota dei file SSH e molti altri strumenti. Termix è la perfetta alternativa gratuita e self-hosted a Termius, disponibile per tutte le piattaforme.

# Funzionalità

- **Accesso Terminale SSH** - Terminale completo con supporto schermo diviso (fino a 4 pannelli) con un sistema di schede in stile browser. Include il supporto per la personalizzazione del terminale, inclusi temi, font e altri componenti comuni.
- **Accesso Desktop Remoto** - Supporto RDP, VNC e Telnet tramite browser con personalizzazione completa e schermo diviso.
- **Gestione Tunnel SSH** - Crea e gestisci tunnel SSH da server a server con riconnessione automatica, monitoraggio dello stato e inoltro locale, remoto o SOCKS dinamico. Le impostazioni del tunnel da client desktop a server sono archiviate localmente per ogni installazione desktop; gli snapshot di preset C2S opzionali possono essere salvati sul server, rinominati, caricati o eliminati per spostare una configurazione di tunnel locale tra i client.
- **Gestore File Remoto** - Gestisci i file direttamente sui server remoti con supporto per la visualizzazione e la modifica di codice, immagini, audio e video. Carica, scarica, rinomina, elimina e sposta file senza problemi con supporto sudo.
- **Gestione Docker** - Avvia, ferma, metti in pausa, rimuovi container. Visualizza le statistiche dei container. Controlla i container tramite terminale docker exec. Non è stato creato per sostituire Portainer o Dockge, ma piuttosto per gestire semplicemente i tuoi container rispetto alla loro creazione.
- **Gestore Host SSH** - Salva, organizza e gestisci le tue connessioni SSH con tag e cartelle, salva facilmente le informazioni di accesso riutilizzabili e automatizza il deployment delle chiavi SSH.
- **Statistiche Server** - Visualizza l'utilizzo di CPU, memoria e disco insieme a rete, uptime, informazioni di sistema, firewall, monitoraggio porte sulla maggior parte dei server basati su Linux.
- **Dashboard** - Visualizza le informazioni del server a colpo d'occhio sulla tua dashboard.
- **RBAC** - Crea ruoli e condividi host tra utenti/ruoli.
- **Autenticazione Utente** - Gestione utenti sicura con controlli amministrativi e supporto OIDC (con controllo degli accessi) e 2FA (TOTP). Visualizza le sessioni utente attive su tutte le piattaforme e revoca i permessi. Collega i tuoi account OIDC/Locali tra loro.
- **Crittografia Database** - Il backend è archiviato come file di database SQLite crittografati. Consulta la [documentazione](https://docs.termix.site/security) per maggiori informazioni.
- **Chiavi API** - Crea chiavi API con ambito utente e date di scadenza da utilizzare per automazione/CI.
- **Esportazione/Importazione Dati** - Esporta e importa host SSH, credenziali e dati del gestore file.
- **Configurazione SSL Automatica** - Generazione e gestione integrata dei certificati SSL con reindirizzamenti HTTPS.
- **Interfaccia Moderna** - Interfaccia pulita e responsive per desktop/mobile costruita con React, Tailwind CSS e Shadcn. Scegli tra molti temi UI diversi, inclusi chiaro, scuro, Dracula, ecc. Usa i percorsi URL per aprire qualsiasi connessione a schermo intero.
- **Lingue** - Supporto integrato per ~30 lingue (gestito da [Crowdin](https://docs.termix.site/translations)).
- **Supporto Piattaforme** - Disponibile come app web, applicazione desktop (Windows, Linux e macOS, può essere eseguito in modo autonomo senza il backend Termix), PWA e app dedicata per mobile/tablet su iOS e Android.
- **Strumenti SSH** - Crea snippet di comandi riutilizzabili che si eseguono con un singolo clic. Esegui un comando simultaneamente su più terminali aperti.
- **Cronologia Comandi** - Autocompletamento e visualizzazione dei comandi SSH eseguiti in precedenza.
- **Connessione Rapida** - Connettiti a un server senza dover salvare i dati di connessione.
- **Palette Comandi** - Premi due volte shift sinistro per accedere rapidamente alle connessioni SSH con la tastiera.
- **SSH Ricco di Funzionalità** - Supporta jump host, Warpgate, connessioni basate su TOTP, SOCKS5, verifica chiave host, compilazione automatica password, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, ecc.
- **Grafico di Rete** - Personalizza la tua Dashboard per visualizzare il tuo homelab basato sulle connessioni SSH con supporto dello stato.
- **Schede Persistenti** - Le sessioni SSH e le schede rimangono aperte tra dispositivi/aggiornamenti se abilitato nel profilo utente.

# Funzionalità Pianificate

Consulta [Progetti](https://github.com/orgs/Termix-SSH/projects/2) per tutte le funzionalità pianificate. Se desideri contribuire, consulta [Contribuire](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Installazione

Dispositivi Supportati:

- Sito web (qualsiasi browser moderno su qualsiasi piattaforma come Chrome, Safari e Firefox) (include supporto PWA)
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
- macOS (x64/ia32 su v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

Visita la [Documentazione](https://docs.termix.site/install) di Termix per maggiori informazioni su come installare Termix su tutte le piattaforme. In alternativa, visualizza un file Docker Compose di esempio qui (puoi omettere guacd e la rete se non prevedi di utilizzare le funzioni di desktop remoto):

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

# Sponsor

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

# Supporto

Se hai bisogno di aiuto o vuoi richiedere una funzionalità per Termix, visita la pagina [Segnalazioni](https://github.com/Termix-SSH/Support/issues), accedi e premi `New Issue`.
Per favore, sii il più dettagliato possibile nella tua segnalazione, preferibilmente scritta in inglese. Puoi anche unirti al server [Discord](https://discord.gg/jVQGdvHDrf) e visitare il canale di supporto, tuttavia i tempi di risposta potrebbero essere più lunghi.

# Screenshot

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

Alcuni video e immagini potrebbero non essere aggiornati o potrebbero non mostrare perfettamente le funzionalità.

# Licenza

Distribuito sotto la Licenza Apache Versione 2.0. Consulta LICENSE per maggiori informazioni.
