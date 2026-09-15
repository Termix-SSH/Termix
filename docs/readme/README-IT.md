<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Gestione dei server self-hosted, da SSH e desktop remoto fino alle automazioni</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
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
  Italiano
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

Termix è gratuito e open source. Se ti è utile, valuta una [donazione](https://donate.termix.site/) per aiutare a coprire i costi dei server e il tempo di sviluppo.

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Ottenuto il 1 settembre 2025</sub>
</p>

</div>

<br />

## Panoramica

Termix è una piattaforma gratuita, open source e self-hosted per gestire i tuoi server. Mette in un unico posto terminali SSH, desktop remoti (RDP, VNC, Telnet), trasferimenti di file, tunnel, Docker, metriche e automazioni, su web, desktop e mobile. È un'alternativa self-hosted a Termius che resta gratuita per sempre.

<br />

## Funzionalità

<table>
<tr>
<td width="50%" valign="top">

**Terminale SSH:**
Un terminale completo con schede come quelle del browser e schermo diviso, fino a 6 pannelli insieme. Scegli tema, carattere e colori. Sopra ogni sessione c'è una barra con CPU, memoria e disco in tempo reale, più scorciatoie ai file, a Docker, ai tunnel e alle metriche di quell'host.

</td>
<td width="50%" valign="top">

**Desktop remoto:**
RDP, VNC e Telnet nel browser, in schede e schermo diviso come qualsiasi altra sessione. Include un browser dei file per le unità RDP e il caricamento trascinando i file. Sul desktop Windows puoi anche aprire un host nel client RDP nativo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tunnel SSH:**
Inoltro locale, remoto e SOCKS dinamico, con riconnessione automatica e controlli di stato. I tunnel da client a server dell'app desktop restano su quella macchina, e puoi salvare delle preimpostazioni sul server per portare una configurazione su un altro computer.

</td>
<td width="50%" valign="top">

**Gestore file:**
Sfoglia, modifica, carica, scarica, rinomina, sposta ed elimina file via SFTP, anche con sudo. Guarda e modifica codice, immagini, audio e video. Copia i file direttamente da un server all'altro: il percorso più veloce viene scelto per te e i trasferimenti vengono verificati.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker e Podman:**
Avvia, ferma, metti in pausa ed elimina i container, guarda le loro statistiche e apri una shell dentro uno di essi. Funziona sia con Docker sia con Podman. Non vuole sostituire Portainer o Dockge, serve solo a gestire i container che hai già.

</td>
<td width="50%" valign="top">

**Gestore host:**
Salva e organizza gli host con etichette e cartelle annidate a cui puoi dare nome e colore. Riutilizza le credenziali salvate su più host, distribuisci le chiavi SSH in automatico, raggruppa gli host sotto un host padre, modifica ed esporta in blocco, e usa la connessione rapida per i collegamenti una tantum che non vuoi salvare.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Metriche host:**
CPU, memoria, disco, rete, temperatura, tempo di accensione, processi, porte, accessi e informazioni di sistema sulla maggior parte dei server Linux, con grafici storici. Le schede di gestione ti fanno seguire servizi, cron, pacchetti, utenti, regole del firewall, WireGuard, Tailscale, certificati SSL, log e controlli di stato senza uscire da Termix.

</td>
<td width="50%" valign="top">

**Automazioni:**
Scegli un evento che fa partire tutto, poi decidi cosa deve succedere. Gli eventi possono essere una metrica che supera una soglia, un host che cade o torna su, un controllo di stato che cambia, una pianificazione, un evento di un container o un webhook in arrivo. I passaggi possono eseguire comandi e frammenti, gestire container e tunnel, accendere un host, chiamare un URL, aspettare, seguire una condizione, avviare un'altra automazione e avvisarti via ntfy, Discord o webhook. Le prove a vuoto ti permettono di provare senza rischi.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Flotte:**
Raggruppa gli host in una flotta scegliendoli o con regole sulle etichette, così i nuovi host entrano da soli. Esegui un comando su tutti gli host in una volta, invia e recupera file su tutti quanti, installa pacchetti e raccogli un inventario di sistema operativo, kernel, architettura e tempo di accensione.

</td>
<td width="50%" valign="top">

**Assistente IA:**
È opzionale e resta spento finché non lo accendi tu. Collega OpenAI, Anthropic, Gemini, Ollama o qualsiasi endpoint compatibile con OpenAI e fai domande sulla tua installazione. Legge host, flotte, frammenti e avvisi, e propone modifiche da approvare invece di farle da solo. Non può mai toccare credenziali, utenti o impostazioni. Gli amministratori possono lasciarlo spento per tutta l'istanza, e tu puoi nasconderlo già durante la configurazione.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Accesso e utenti:**
Account locali più accesso con OIDC, LDAP, GitHub e Google, con doppia autenticazione (TOTP), passkey (WebAuthn) e dispositivi fidati. Gli amministratori possono gestire gli utenti, collegare i gruppi OIDC ai ruoli, vedere tutte le sessioni attive su ogni piattaforma e revocarle. Collega il tuo account locale a quello OIDC e consulta il registro di controllo di quello che ha fatto ognuno.

</td>
<td width="50%" valign="top">

**Ruoli e condivisione:**
Crea ruoli e condividi gli host con utenti o ruoli su quattro livelli: connessione, visualizzazione, modifica e gestione. Funziona con ogni tipo di autenticazione e ogni protocollo, e puoi cambiare le credenziali usate per un host condiviso.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Avvisi:**
Imposta regole sulle metriche degli host come CPU, memoria e disco, e ricevi una notifica via ntfy, Discord o webhook quando scattano. Guarda gli avvisi attivi e quelli rientrati in uno storico, e scarta quelli che non ti interessano.

</td>
<td width="50%" valign="top">

**Pagina iniziale:**
Una griglia di widget che costruisci tu trascinandoli. Ci sono widget per stato degli host, ping, collegamenti ai servizi, segnalibri, ricerca, orologi, calendari, conti alla rovescia, note, RSS, meteo, immagini, iframe, Docker, tunnel, grafici delle metriche, API personalizzate e perfino un terminale dal vivo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Frammenti e strumenti:**
Salva i comandi che usi spesso e lanciali con un clic, con variabili per l'host e per quello che scrivi tu. Esegui uno stesso comando su tutti i terminali aperti e cerca nella cronologia con il completamento automatico.

</td>
<td width="50%" valign="top">

**Condivisione sessione:**
Condividi dal vivo una sessione di terminale, RDP, VNC o Telnet. Manda un link a cui chiunque può accedere senza account, oppure condividi con un utente Termix preciso, in sola lettura o anche in scrittura. Le condivisioni possono scadere da sole o essere revocate, e si possono spegnere per tutti o per singolo host.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Registrazione e log delle sessioni:**
Registra le sessioni di terminale, RDP e VNC e riguardale dopo. Scarica i log di testo di una sessione e consulta il registro delle connessioni per vedere esattamente cosa è successo durante una connessione.

</td>
<td width="50%" valign="top">

**Connessioni seriali:**
Parla con dispositivi seriali come router, switch e microcontrollori dal browser o dall'app desktop. Imposta velocità, bit di dati, bit di stop e parità. Usa l'API Web Serial nei browser compatibili, oppure un backend nativo nell'app desktop.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Prendi i dispositivi dalla tua tailnet per aggiungerli come host in pochi clic, e collegati con Tailscale SSH così gli ACL della tailnet gestiscono l'accesso senza salvare credenziali. Funzionano anche Headscale e gli endpoint personalizzati.

</td>
<td width="50%" valign="top">

**Proxmox:**
Importa gli host direttamente da un'istanza Proxmox e segui le statistiche di nodi e macchine ospiti, comprese CPU, memoria e spazio, in una scheda dedicata.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Spazi di lavoro e schede:**
Salva un insieme di schede con la loro disposizione divisa e riapri tutto con un clic. Termix ricorda anche l'ultima sessione, così le schede tornano dopo un ricaricamento e su altri dispositivi.

</td>
<td width="50%" valign="top">

**Configurazione guidata:**
Una breve configurazione ti accompagna nella scelta di una preimpostazione dell'interfaccia, del tema, delle funzionalità che vuoi e del primo host. La modalità semplice nasconde quello che non usi, e puoi rifare la configurazione o cambiare preimpostazione quando vuoi.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Desktop autonomo e sincronizzazione:**
L'app desktop funziona da sola, con backend e database locali, senza bisogno di un server. Puoi anche collegarla a un server Termix per sincronizzare nei due sensi host, credenziali, frammenti e altro, e scegliere se le connessioni partono dal tuo computer o passano dal server.

</td>
<td width="50%" valign="top">

**Riga di comando:**
Una CLI `termix` per la tua shell e i tuoi script. Apri terminali, esegui un comando su un host o su un'intera flotta, sposta file via SFTP e gestisci host, frammenti e credenziali. Installala con `npm install -g @termix-cli/cli` oppure prendi un binario autonomo. Vedi la [documentazione della CLI](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Sicurezza:**
Password, chiavi e altri segreti sono cifrati per ogni utente, e gli stessi file del database possono essere cifrati su disco. Guarda la [documentazione](https://docs.termix.site/security) per capire come funziona.

</td>
<td width="50%" valign="top">

**Lingue:**
Circa 30 lingue incluse, gestite tramite [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Altre funzionalità</b></summary>
<br />

- **Dashboard** - I tuoi server a colpo d'occhio, con schede che disponi tu
- **Grafico di rete** - Il tuo homelab disegnato a partire dagli host, con stato in tempo reale
- **Monitor tmux** - Sfoglia sessioni, finestre e pannelli di tmux, con anteprime e ricerca
- **Chiavi API** - Chiavi per singolo utente con scadenza, per script e CI
- **Esporta e importa** - Sposta host, credenziali e dati del gestore file dentro e fuori
- **SSL automatico** - Certificati generati e rinnovati per te, con reindirizzamento a HTTPS, oppure usa i tuoi
- **Database** - SQLite di base, con supporto anche per PostgreSQL e MySQL
- **Interfaccia moderna** - Interfaccia React pulita che funziona su desktop e mobile, con temi come chiaro, scuro e Dracula. Ogni connessione si può aprire a schermo intero da un URL
- **Palette comandi** - Premi due volte Maiusc sinistro per saltare a un host da tastiera
- **Scorciatoie da tastiera** - Spostarsi tra le schede, chiuderle e altro, tutto riassegnabile
- **Wake-on-LAN** - Accendi una macchina da Termix o da un passaggio di un'automazione
- **Autenticazione tramite proxy fidato** - Lascia che un reverse proxy gestisca l'accesso e passi l'utente
- **SSH molto completo** - Host di salto, Warpgate, richieste TOTP, SOCKS5, verifica delle chiavi host, riempimento automatico della password, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, log del terminale, inoltro dell'agente, agente SSH di Bitwarden, firma SSH con HashiCorp Vault e altro
- **Termix ID** - Una versione integrata di sshid.io. Prendi un identificativo, pubblica le tue chiavi pubbliche su un URL di risoluzione ed emetti certificati SSH dalla CA integrata

</details>

<br />

## Piattaforme supportate

<table align="center">
<tr>
<th align="center">Piattaforma</th>
<th align="center">Distribuzione</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Qualsiasi browser recente (Chrome, Safari, Firefox) · Supporto PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portatile · Installer MSI · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portatile · AUR · AppImage · Deb · Flatpak</td>
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

## Installazione

Vai alla [documentazione di Termix](https://docs.termix.site/install) per le istruzioni complete di installazione su tutte le piattaforme.

Esempio di file Docker Compose (puoi togliere `guacd` e la rete se non pensi di usare il desktop remoto):

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

### Riga di comando

Termix ha anche una CLI, così puoi gestire i tuoi server dal terminale e usare Termix nei tuoi script.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

Può aprire terminali, eseguire un comando su un host o su un'intera flotta, spostare file via SFTP e gestire host, frammenti e credenziali. La documentazione completa è su [docs.termix.site/cli](https://docs.termix.site/cli).

### Hosting in cloud

Puoi far girare il server Termix su un VPS invece che dentro la tua rete. Se Termix gira sulla rete che gestisce, un guasto se lo porta via proprio quando ti servirebbe per sistemare le cose. Fuori resta raggiungibile, ti dà un IP fisso e ci entri da ovunque senza VPN né porte aperte.

[GINERNET](https://docs.termix.site/install/ginernet) sponsorizza Termix, e nella documentazione c'è una guida passo passo per il rilascio sulla loro piattaforma VPS.

<br />

## Telemetria

Termix invia una volta al giorno un piccolo segnale anonimo, così posso vedere quante istanze sono attive e quali funzionalità vengono usate davvero. Contiene un ID istanza casuale, quanti utenti e host hai, la versione dell'app e quali funzionalità (terminale, gestore file, tunnel, docker, ecc.) sono state usate nelle ultime 24 ore. Non contiene mai nomi utente, nomi host, indirizzi IP, credenziali o qualsiasi altra cosa che identifichi te o i tuoi server.

È attivo di base. Puoi spegnerlo nelle impostazioni di amministrazione, sezione Generale, oppure impostare `ENABLE_TELEMETRY=false` prima ancora di avviare Termix.

<br />

## Dona

Termix è gratuito e open source, senza abbonamenti né piani a pagamento. Se ti è utile, valuta una donazione per aiutare con server, domini e tempo di sviluppo. Le donazioni finanziano anche il tempo per studiare quello che serve a costruire funzionalità come SAML, Kubernetes e il supporto agli agenti. Segui i progressi e dona qui sotto.

[Dona](https://donate.termix.site/)

<br />

## Sponsor

Ti interessa uno spazio a pagamento per sostenere lo sviluppo? Scrivi a [mail@termix.site](mailto:mail@termix.site).

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

## Supporto

Ti serve aiuto o vuoi proporre una funzionalità? Apri una [nuova issue](https://github.com/Termix-SSH/Support/issues) con più dettagli possibile, in inglese se ci riesci. Puoi anche chiedere nel canale di supporto su [Discord](https://discord.gg/jVQGdvHDrf), anche se lì le risposte possono richiedere più tempo.

<br />

## Screenshot

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Guarda le panoramiche degli aggiornamenti su YouTube</sub>

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

<sub>Alcuni video e immagini possono essere datati o non mostrare al meglio le funzionalità.</sub>

</div>

<br />

## Funzionalità pianificate

Tutte le funzionalità pianificate sono su [Projects](https://github.com/orgs/Termix-SSH/projects/5). Se vuoi contribuire, guarda [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Licenza

Distribuito con licenza Apache versione 2.0. Vedi `LICENSE` per maggiori informazioni.
