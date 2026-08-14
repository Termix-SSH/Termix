<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Gestion de serveurs auto-hébergée, du SSH au bureau à distance jusqu'aux automatisations</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  Français ·
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

Termix est gratuit et open source. S'il vous est utile, pensez à [faire un don](https://donate.termix.site/) pour aider à payer les serveurs et le temps de développement.

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Obtenu le 1er septembre 2025</sub>
</p>

</div>

<br />

## Présentation

Termix est une plateforme gratuite, open source et auto-hébergée pour gérer vos serveurs. Elle réunit au même endroit les terminaux SSH, les bureaux à distance (RDP, VNC, Telnet), les transferts de fichiers, les tunnels, Docker, les métriques et les automatisations, sur le web, le bureau et le mobile. C'est une alternative auto-hébergée à Termius, gratuite pour toujours.

<br />

## Fonctionnalités

<table>
<tr>
<td width="50%" valign="top">

**Terminal SSH:**
Un vrai terminal avec des onglets façon navigateur et un écran divisé, jusqu'à 6 panneaux à la fois. Choisissez votre thème, votre police et vos couleurs. Une barre d'outils au-dessus de chaque session affiche le CPU, la mémoire et le disque en direct, avec des raccourcis vers les fichiers, Docker, les tunnels et les métriques de cet hôte.

</td>
<td width="50%" valign="top">

**Bureau à distance:**
RDP, VNC et Telnet dans le navigateur, en onglets et en écran divisé comme n'importe quelle autre session. Comprend un explorateur de fichiers pour les lecteurs RDP et l'envoi par glisser-déposer. Sur le bureau Windows, vous pouvez aussi ouvrir un hôte dans le client RDP natif.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tunnels SSH:**
Redirection locale, distante et SOCKS dynamique, avec reconnexion automatique et vérification de l'état. Les tunnels client vers serveur de l'application de bureau restent sur cette machine, et vous pouvez enregistrer des préréglages sur le serveur pour reprendre une configuration sur un autre poste.

</td>
<td width="50%" valign="top">

**Gestionnaire de fichiers:**
Parcourez, modifiez, envoyez, téléchargez, renommez, déplacez et supprimez des fichiers en SFTP, avec sudo. Affichez et modifiez du code, des images, de l'audio et de la vidéo. Copiez des fichiers directement d'un serveur à l'autre : le chemin le plus rapide est choisi pour vous et l'intégrité des transferts est vérifiée.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker et Podman:**
Démarrez, arrêtez, mettez en pause et supprimez des conteneurs, suivez leurs statistiques et ouvrez un shell à l'intérieur. Fonctionne avec Docker comme avec Podman. Le but n'est pas de remplacer Portainer ou Dockge, juste de gérer les conteneurs que vous avez déjà.

</td>
<td width="50%" valign="top">

**Gestionnaire d'hôtes:**
Rangez vos hôtes avec des étiquettes et des dossiers imbriqués que vous pouvez nommer et colorer. Réutilisez des identifiants enregistrés sur plusieurs hôtes, déployez des clés SSH automatiquement, regroupez des hôtes sous un hôte parent, modifiez et exportez en lot, et utilisez la connexion rapide pour les connexions ponctuelles que vous ne voulez pas garder.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Métriques des hôtes:**
CPU, mémoire, disque, réseau, température, temps de fonctionnement, processus, ports, connexions et informations système sur la plupart des serveurs Linux, avec des graphiques d'historique. Les cartes de gestion vous permettent de gérer les services, les tâches cron, les paquets, les utilisateurs, les règles de pare-feu, WireGuard, Tailscale, les certificats SSL, les journaux et les vérifications d'état sans quitter Termix.

</td>
<td width="50%" valign="top">

**Automatisations:**
Choisissez un déclencheur, puis dites ce qui doit se passer. Les déclencheurs peuvent être une métrique qui dépasse un seuil, un hôte qui tombe ou revient, une vérification d'état qui change, un horaire, un événement de conteneur ou un webhook entrant. Les étapes peuvent lancer des commandes et des extraits, piloter des conteneurs et des tunnels, réveiller un hôte, appeler une URL, attendre, se diviser selon une condition, lancer une autre automatisation et vous prévenir via ntfy, Discord ou un webhook. Les essais à blanc vous permettent de tester sans risque.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Flottes:**
Regroupez des hôtes dans une flotte en les choisissant ou avec des règles d'étiquettes, pour que les nouveaux hôtes s'ajoutent tout seuls. Lancez une commande sur tous les hôtes d'un coup, envoyez et récupérez des fichiers sur l'ensemble, installez des paquets et collectez un inventaire de l'OS, du noyau, de l'architecture et du temps de fonctionnement.

</td>
<td width="50%" valign="top">

**Assistant IA:**
Optionnel, et désactivé tant que vous ne l'activez pas. Connectez OpenAI, Anthropic, Gemini, Ollama ou n'importe quel point d'accès compatible OpenAI et posez des questions sur votre installation. Il lit les hôtes, les flottes, les extraits et les alertes, et propose des changements que vous validez au lieu de les appliquer lui-même. Il ne peut jamais toucher aux identifiants, aux utilisateurs ni aux réglages. Les administrateurs peuvent le laisser désactivé pour toute l'instance, et vous pouvez le masquer pendant la configuration.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Connexion et utilisateurs:**
Comptes locaux ainsi que connexion OIDC, LDAP, GitHub et Google, avec double authentification (TOTP), clés d'accès (WebAuthn) et appareils de confiance. Les administrateurs peuvent gérer les utilisateurs, associer les groupes OIDC aux rôles, voir toutes les sessions actives sur toutes les plateformes et les révoquer. Reliez vos comptes local et OIDC, et consultez le journal d'audit de ce que chacun a fait.

</td>
<td width="50%" valign="top">

**Rôles et partage:**
Créez des rôles et partagez des hôtes avec des utilisateurs ou des rôles selon quatre niveaux : connexion, lecture, modification et gestion. Cela fonctionne avec tous les types d'authentification et tous les protocoles, et vous pouvez remplacer les identifiants utilisés pour un hôte partagé.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Alertes:**
Définissez des règles sur les métriques des hôtes comme le CPU, la mémoire et le disque, et recevez une notification via ntfy, Discord ou un webhook quand elles se déclenchent. Consultez les alertes en cours et résolues dans un historique, et écartez celles qui ne vous intéressent pas.

</td>
<td width="50%" valign="top">

**Page d'accueil:**
Une grille de widgets en glisser-déposer que vous construisez vous-même. Des widgets pour l'état des hôtes, les pings, les liens de services, les favoris, la recherche, les horloges, les calendriers, les comptes à rebours, les notes, les flux RSS, la météo, les images, les iframes, Docker, les tunnels, les graphiques de métriques, les API personnalisées et même un terminal en direct.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Extraits et outils:**
Enregistrez les commandes que vous lancez souvent et exécutez-les en un clic, avec des variables pour l'hôte et vos propres saisies. Lancez une même commande dans tous les terminaux ouverts, et cherchez dans votre historique avec la complétion automatique.

</td>
<td width="50%" valign="top">

**Partage de session:**
Partagez en direct une session terminal, RDP, VNC ou Telnet. Envoyez un lien que n'importe qui peut rejoindre sans compte, ou partagez avec un utilisateur Termix précis, en lecture seule ou en lecture-écriture. Les partages peuvent expirer d'eux-mêmes ou être révoqués, et se désactivent globalement ou hôte par hôte.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Enregistrement et journaux de session:**
Enregistrez les sessions terminal, RDP et VNC pour les revoir plus tard. Téléchargez les journaux d'une session en texte simple, et consultez le journal de connexion pour voir exactement ce qui s'est passé pendant une connexion.

</td>
<td width="50%" valign="top">

**Connexions série:**
Dialoguez avec des appareils série comme des routeurs, des commutateurs et des microcontrôleurs depuis le navigateur ou l'application de bureau. Réglez la vitesse, les bits de données, les bits d'arrêt et la parité. Utilise l'API Web Serial dans les navigateurs compatibles, ou un backend natif dans l'application de bureau.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Récupérez les appareils de votre tailnet pour les ajouter comme hôtes en quelques clics, et connectez-vous avec Tailscale SSH pour que les ACL de votre tailnet gèrent les accès, sans stocker d'identifiants. Headscale et les points d'accès personnalisés fonctionnent aussi.

</td>
<td width="50%" valign="top">

**Proxmox:**
Importez des hôtes directement depuis une instance Proxmox, et suivez les statistiques des nœuds et des invités, dont le CPU, la mémoire et le stockage, dans un onglet dédié.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Espaces de travail et onglets:**
Enregistrez un ensemble d'onglets avec leur disposition en écran divisé et rouvrez le tout en un clic. Termix retient aussi votre dernière session, donc vos onglets reviennent après un rafraîchissement ou sur un autre appareil.

</td>
<td width="50%" valign="top">

**Configuration guidée:**
Une courte configuration vous aide à choisir un préréglage d'interface, votre thème, les fonctionnalités que vous voulez et votre premier hôte. Le mode simple masque ce que vous n'utilisez pas, et vous pouvez relancer la configuration ou changer de préréglage quand vous voulez.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Application de bureau autonome et synchronisation:**
L'application de bureau fonctionne toute seule, avec son propre backend et sa base de données, sans serveur. Vous pouvez aussi la relier à un serveur Termix pour synchroniser dans les deux sens les hôtes, les identifiants, les extraits et le reste, et choisir si les connexions partent de votre machine ou passent par le serveur.

</td>
<td width="50%" valign="top">

**Ligne de commande:**
Un CLI `termix` pour votre shell et vos scripts. Ouvrez des terminaux, lancez une commande sur un hôte ou une flotte entière, déplacez des fichiers en SFTP et gérez hôtes, extraits et identifiants. Installez-le avec `npm install -g @termix-cli/cli` ou récupérez un binaire autonome. Voir la [documentation du CLI](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Sécurité:**
Les mots de passe, les clés et les autres secrets sont chiffrés par utilisateur, et les fichiers de base de données eux-mêmes peuvent être chiffrés sur le disque. Voir la [documentation](https://docs.termix.site/security) pour le détail.

</td>
<td width="50%" valign="top">

**Langues:**
Une trentaine de langues intégrées, gérées via [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Plus de fonctionnalités</b></summary>
<br />

- **Tableau de bord** - Vos serveurs en un coup d'œil, avec des cartes que vous rangez vous-même
- **Graphe réseau** - Votre homelab dessiné à partir de vos hôtes, avec l'état en direct
- **Moniteur tmux** - Parcourez les sessions, fenêtres et panneaux tmux, avec aperçus et recherche
- **Clés API** - Des clés par utilisateur avec date d'expiration, pour vos scripts et votre CI
- **Export et import** - Faites entrer et sortir hôtes, identifiants et données du gestionnaire de fichiers
- **SSL automatique** - Certificats générés et renouvelés pour vous, avec redirection HTTPS, ou apportez les vôtres
- **Bases de données** - SQLite par défaut, PostgreSQL et MySQL également pris en charge
- **Interface moderne** - Une interface React soignée qui marche sur ordinateur et mobile, avec des thèmes clair, sombre et Dracula. Chaque connexion peut s'ouvrir en plein écran depuis une URL
- **Palette de commandes** - Double appui sur Maj gauche pour rejoindre un hôte au clavier
- **Raccourcis clavier** - Naviguer entre les onglets, les fermer et plus encore, tout est reconfigurable
- **Wake-on-LAN** - Réveillez une machine depuis Termix ou depuis une étape d'automatisation
- **Authentification par proxy de confiance** - Laissez un reverse proxy gérer la connexion et transmettre l'utilisateur
- **SSH complet** - Hôtes de rebond, Warpgate, demandes TOTP, SOCKS5, vérification des clés d'hôte, remplissage automatique des mots de passe, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, journalisation du terminal, transfert d'agent, agent SSH Bitwarden, signature SSH HashiCorp Vault et plus encore
- **Termix ID** - Une version intégrée de sshid.io. Réservez un identifiant, publiez vos clés publiques sur une URL de résolution et émettez des certificats SSH depuis l'autorité intégrée

</details>

<br />

## Plateformes prises en charge

<table align="center">
<tr>
<th align="center">Plateforme</th>
<th align="center">Distribution</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Tout navigateur récent (Chrome, Safari, Firefox) · Compatible PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portable · Installeur MSI · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portable · AUR · AppImage · Deb · Flatpak</td>
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

Consultez la [documentation Termix](https://docs.termix.site/install) pour les instructions d'installation complètes sur toutes les plateformes.

Exemple de fichier Docker Compose (vous pouvez retirer `guacd` et le réseau si vous ne comptez pas utiliser le bureau à distance) :

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

### Ligne de commande

Termix propose aussi un CLI, pour gérer vos serveurs depuis un terminal et utiliser Termix dans vos propres scripts.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

Il peut ouvrir des terminaux, lancer une commande sur un hôte ou une flotte entière, déplacer des fichiers en SFTP et gérer hôtes, extraits et identifiants. La documentation complète est sur [docs.termix.site/cli](https://docs.termix.site/cli).

### Hébergement cloud

Vous pouvez faire tourner le serveur Termix sur un VPS plutôt que dans votre propre réseau. Si Termix tourne sur le réseau qu'il gère, une panne l'emporte avec elle, juste au moment où vous en avez besoin pour réparer. Ailleurs, il reste joignable, vous avez une IP fixe et vous pouvez y accéder de partout sans VPN ni redirection de port.

[GINERNET](https://docs.termix.site/install/ginernet) sponsorise Termix, et la documentation contient un guide pas à pas pour déployer sur leur plateforme VPS.

<br />

## Télémétrie

Termix envoie une fois par jour un petit signal anonyme, pour que je puisse voir combien d'instances tournent et quelles fonctionnalités servent vraiment. Il contient un identifiant d'instance aléatoire, le nombre d'utilisateurs et d'hôtes, la version de l'application et les fonctionnalités utilisées ces dernières 24 heures (terminal, gestionnaire de fichiers, tunnels, docker, etc.). Il ne contient jamais de noms d'utilisateur, de noms d'hôtes, d'adresses IP, d'identifiants ni quoi que ce soit qui puisse vous identifier, vous ou vos serveurs.

C'est activé par défaut. Désactivez-le dans les paramètres d'administration, section Général, ou définissez `ENABLE_TELEMETRY=false` avant même de démarrer Termix.

<br />

## Faire un don

Termix est gratuit et open source, sans abonnement ni offre payante. S'il vous est utile, pensez à faire un don pour aider à couvrir les serveurs, les noms de domaine et le temps de développement. Les dons financent aussi le temps de recherche nécessaire pour construire des fonctionnalités comme SAML, Kubernetes et le support des agents. Suivez l'avancement et faites un don ci-dessous.

[Faire un don](https://donate.termix.site/)

<br />

## Sponsors

Intéressé par un emplacement payant pour soutenir le développement ? Écrivez à [mail@termix.site](mailto:mail@termix.site).

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

## Support

Besoin d'aide ou envie de proposer une fonctionnalité ? Ouvrez un [nouveau ticket](https://github.com/Termix-SSH/Support/issues) avec le plus de détails possible, en anglais si vous le pouvez. Vous pouvez aussi demander dans le canal support sur [Discord](https://discord.gg/jVQGdvHDrf), même si les réponses y prennent parfois plus de temps.

<br />

## Captures d'écran

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Regarder les présentations des mises à jour sur YouTube</sub>

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

<sub>Certaines vidéos et images peuvent être dépassées ou ne pas montrer parfaitement les fonctionnalités.</sub>

</div>

<br />

## Fonctionnalités prévues

Toutes les fonctionnalités prévues sont dans [Projects](https://github.com/orgs/Termix-SSH/projects/5). Si vous souhaitez contribuer, voir [Contribuer](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Licence

Distribué sous licence Apache version 2.0. Voir `LICENSE` pour plus d'informations.
