<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Gestión de servidores autoalojada, desde SSH y escritorio remoto hasta automatizaciones</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  Español ·
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

Termix es gratuito y de código abierto. Si te resulta útil, considera [donar](https://donate.termix.site/) para ayudar a cubrir los costes de servidor y el tiempo de desarrollo.

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Conseguido el 1 de septiembre de 2025</sub>
</p>

</div>

<br />

## Descripción general

Termix es una plataforma gratuita, de código abierto y autoalojada para gestionar tus servidores. Reúne en un solo sitio terminales SSH, escritorios remotos (RDP, VNC, Telnet), transferencias de archivos, túneles, Docker, métricas y automatizaciones, en web, escritorio y móvil. Es una alternativa autoalojada a Termius que seguirá siendo gratuita.

<br />

## Características

<table>
<tr>
<td width="50%" valign="top">

**Terminal SSH:**
Un terminal completo con pestañas como las del navegador y pantalla dividida, hasta 6 paneles a la vez. Elige tu tema, tu fuente y tus colores. Sobre cada sesión hay una barra con CPU, memoria y disco en vivo, además de accesos rápidos a los archivos, Docker, túneles y métricas de ese host.

</td>
<td width="50%" valign="top">

**Escritorio remoto:**
RDP, VNC y Telnet en el navegador, en pestañas y pantalla dividida como cualquier otra sesión. Incluye un explorador de archivos para las unidades RDP y subida arrastrando y soltando. En el escritorio de Windows también puedes abrir un host en el cliente RDP nativo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Túneles SSH:**
Reenvío local, remoto y SOCKS dinámico, con reconexión automática y comprobaciones de estado. Los túneles de cliente a servidor de la aplicación de escritorio se guardan en ese equipo, y puedes guardar ajustes en el servidor para llevarte una configuración a otro equipo.

</td>
<td width="50%" valign="top">

**Gestor de archivos:**
Navega, edita, sube, descarga, renombra, mueve y borra archivos por SFTP, con soporte para sudo. Mira y edita código, imágenes, audio y vídeo. Copia archivos directamente de un servidor a otro, con la ruta más rápida elegida por ti y las transferencias verificadas.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker y Podman:**
Arranca, para, pausa y elimina contenedores, mira sus estadísticas y abre una consola dentro de uno. Funciona con Docker y con Podman. No pretende sustituir a Portainer ni a Dockge, solo gestionar los contenedores que ya tienes.

</td>
<td width="50%" valign="top">

**Gestor de hosts:**
Guarda y organiza hosts con etiquetas y carpetas anidadas que puedes nombrar y colorear. Reutiliza credenciales guardadas entre hosts, despliega claves SSH automáticamente, agrupa hosts bajo un host padre, edita y exporta en lote, y usa la conexión rápida para conexiones puntuales que no quieres guardar.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Métricas de host:**
CPU, memoria, disco, red, temperatura, tiempo encendido, procesos, puertos, inicios de sesión e información del sistema en la mayoría de servidores Linux, con gráficas de histórico. Las tarjetas de gestión te dejan manejar servicios, tareas cron, paquetes, usuarios, reglas del cortafuegos, WireGuard, Tailscale, certificados SSL, registros y comprobaciones de estado sin salir de Termix.

</td>
<td width="50%" valign="top">

**Automatizaciones:**
Elige un disparador y luego di qué debe pasar. Los disparadores incluyen una métrica que supera un umbral, un host que se cae o vuelve, una comprobación de estado que cambia, una programación, un evento de contenedor o un webhook entrante. Los pasos pueden ejecutar comandos y fragmentos, controlar contenedores y túneles, despertar un host, llamar a una URL, esperar, ramificarse según una condición, ejecutar otra automatización y avisarte por ntfy, Discord o un webhook. Las ejecuciones de prueba te dejan probarlo sin riesgo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Flotas:**
Agrupa hosts en una flota eligiéndolos o con reglas de etiquetas, para que los nuevos entren solos. Ejecuta un comando en todos los hosts a la vez, envía y recoge archivos de todos ellos, instala paquetes y reúne un inventario del sistema, el kernel, la arquitectura y el tiempo encendido.

</td>
<td width="50%" valign="top">

**Asistente de IA:**
Es opcional y está apagado hasta que tú lo enciendas. Conecta OpenAI, Anthropic, Gemini, Ollama o cualquier punto de acceso compatible con OpenAI y pregúntale sobre tu instalación. Puede leer hosts, flotas, fragmentos y alertas, y propone cambios para que los apruebes en lugar de hacerlos él. Nunca puede tocar credenciales, usuarios ni ajustes. Los administradores pueden dejarlo apagado para toda la instancia, y tú puedes ocultarlo durante la configuración.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Acceso y usuarios:**
Cuentas locales más inicio de sesión con OIDC, LDAP, GitHub y Google, con doble factor (TOTP), llaves de acceso (WebAuthn) y dispositivos de confianza. Los administradores pueden gestionar usuarios, asignar grupos de OIDC a roles, ver todas las sesiones activas en cualquier plataforma y revocarlas. Enlaza tu cuenta local con la de OIDC y consulta el registro de auditoría de lo que ha hecho cada uno.

</td>
<td width="50%" valign="top">

**Roles y compartición:**
Crea roles y comparte hosts con usuarios o roles en cuatro niveles: conectar, ver, editar y gestionar. Funciona con todos los tipos de autenticación y todos los protocolos, y puedes cambiar las credenciales que se usan en un host compartido.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Alertas:**
Pon reglas sobre métricas de host como CPU, memoria y disco, y recibe avisos por ntfy, Discord o un webhook cuando salten. Consulta las alertas activas y resueltas en un histórico y descarta las que no te importan.

</td>
<td width="50%" valign="top">

**Página de inicio:**
Una rejilla de widgets que montas tú mismo arrastrando y soltando. Hay widgets para el estado de los hosts, pings, enlaces a servicios, marcadores, búsqueda, relojes, calendarios, cuentas atrás, notas, RSS, tiempo, imágenes, iframes, Docker, túneles, gráficas de métricas, APIs propias e incluso un terminal en vivo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Fragmentos y herramientas:**
Guarda los comandos que usas a menudo y lánzalos con un clic, con variables para el host y para lo que tú escribas. Ejecuta un mismo comando en todos los terminales abiertos y busca en tu historial con autocompletado.

</td>
<td width="50%" valign="top">

**Compartir sesión:**
Comparte en directo una sesión de terminal, RDP, VNC o Telnet. Manda un enlace al que cualquiera puede entrar sin cuenta, o compártela con un usuario concreto de Termix, en solo lectura o con escritura. Las comparticiones pueden caducar solas o revocarse, y se pueden desactivar globalmente o por host.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Grabación y registros de sesión:**
Graba sesiones de terminal, RDP y VNC y reprodúcelas después. Descarga registros de texto de una sesión y mira el registro de conexión para ver exactamente qué pasó durante ella.

</td>
<td width="50%" valign="top">

**Conexiones serie:**
Habla con dispositivos serie como routers, switches y microcontroladores desde el navegador o la aplicación de escritorio. Ajusta velocidad, bits de datos, bits de parada y paridad. Usa la API Web Serial en los navegadores compatibles, o un backend nativo en la aplicación de escritorio.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Trae dispositivos de tu tailnet para añadirlos como hosts en un par de clics, y conéctate con Tailscale SSH para que las ACL de tu tailnet controlen el acceso sin guardar credenciales. También funcionan Headscale y los puntos de acceso personalizados.

</td>
<td width="50%" valign="top">

**Proxmox:**
Importa hosts directamente desde una instancia de Proxmox y observa las estadísticas de nodos e invitados, incluidas CPU, memoria y almacenamiento, en su propia pestaña.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Espacios de trabajo y pestañas:**
Guarda un conjunto de pestañas con su distribución dividida y reábrelo entero con un clic. Termix también recuerda tu última sesión, así que tus pestañas vuelven tras recargar y en otros dispositivos.

</td>
<td width="50%" valign="top">

**Configuración guiada:**
Una configuración corta te lleva por elegir un preajuste de interfaz, tu tema, las funciones que quieres y tu primer host. El modo sencillo esconde lo que no usas, y puedes repetir la configuración o cambiar de preajuste cuando quieras.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Escritorio independiente y sincronización:**
La aplicación de escritorio funciona sola, con su backend y su base de datos locales, sin necesidad de servidor. También puedes conectarla a un servidor Termix para sincronizar en ambos sentidos hosts, credenciales, fragmentos y más, y decidir si las conexiones salen de tu equipo o pasan por el servidor.

</td>
<td width="50%" valign="top">

**Línea de comandos:**
Un CLI `termix` para tu shell y tus scripts. Abre terminales, ejecuta un comando en un host o en una flota entera, mueve archivos por SFTP y gestiona hosts, fragmentos y credenciales. Instálalo con `npm install -g @termix-cli/cli` o coge un binario independiente. Consulta la [documentación del CLI](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Seguridad:**
Las contraseñas, las claves y otros secretos se cifran por usuario, y los propios archivos de la base de datos se pueden cifrar en disco. Mira la [documentación](https://docs.termix.site/security) para saber cómo funciona.

</td>
<td width="50%" valign="top">

**Idiomas:**
Unos 30 idiomas incluidos, gestionados a través de [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Más características</b></summary>
<br />

- **Panel** - Tus servidores de un vistazo, con tarjetas que colocas tú
- **Gráfico de red** - Tu homelab dibujado a partir de tus hosts, con estado en vivo
- **Monitor de tmux** - Revisa sesiones, ventanas y paneles de tmux, con vista previa y búsqueda
- **Claves de API** - Claves por usuario con fecha de caducidad para scripts y CI
- **Exportar e importar** - Mueve hosts, credenciales y datos del gestor de archivos
- **SSL automático** - Certificados generados y renovados por ti, con redirección a HTTPS, o usa los tuyos
- **Bases de datos** - SQLite por defecto, y también PostgreSQL y MySQL
- **Interfaz moderna** - Una interfaz React limpia que funciona en escritorio y móvil, con temas como claro, oscuro y Dracula. Cualquier conexión se puede abrir a pantalla completa desde una URL
- **Paleta de comandos** - Pulsa dos veces Mayús izquierda para ir a un host desde el teclado
- **Atajos de teclado** - Moverte entre pestañas, cerrarlas y más, todo reasignable
- **Wake-on-LAN** - Enciende una máquina desde Termix o desde un paso de automatización
- **Proxy de confianza** - Deja que un proxy inverso gestione el acceso y pase al usuario
- **SSH muy completo** - Hosts de salto, Warpgate, peticiones TOTP, SOCKS5, verificación de claves de host, autorrelleno de contraseñas, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, registro del terminal, reenvío de agente, agente SSH de Bitwarden, firma SSH con HashiCorp Vault y más
- **Termix ID** - Una versión integrada de sshid.io. Reserva un identificador, publica tus claves públicas en una URL de resolución y emite certificados SSH desde la CA integrada

</details>

<br />

## Plataformas compatibles

<table align="center">
<tr>
<th align="center">Plataforma</th>
<th align="center">Distribución</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Cualquier navegador moderno (Chrome, Safari, Firefox) · Compatible con PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portable · Instalador MSI · Chocolatey</td>
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

## Instalación

Visita la [documentación de Termix](https://docs.termix.site/install) para ver las instrucciones completas de instalación en todas las plataformas.

Ejemplo de archivo Docker Compose (puedes quitar `guacd` y la red si no piensas usar el escritorio remoto):

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

### Línea de comandos

Termix también tiene un CLI, para que gestiones tus servidores desde un terminal y uses Termix en tus propios scripts.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

Puede abrir terminales, ejecutar un comando en un host o en una flota entera, mover archivos por SFTP y gestionar hosts, fragmentos y credenciales. La documentación completa está en [docs.termix.site/cli](https://docs.termix.site/cli).

### Alojamiento en la nube

Puedes ejecutar el servidor de Termix en un VPS en lugar de dentro de tu propia red. Si Termix corre en la red que gestiona, una caída se lo lleva por delante justo cuando lo necesitas para arreglar las cosas. Fuera se mantiene accesible, te da una IP fija y puedes entrar desde cualquier sitio sin VPN ni abrir puertos.

[GINERNET](https://docs.termix.site/install/ginernet) patrocina Termix, y la documentación tiene una guía paso a paso para desplegar en su plataforma de VPS.

<br />

## Telemetría

Termix envía una vez al día un pequeño aviso anónimo para que pueda ver cuántas instancias hay funcionando y qué funciones se usan. Contiene un identificador de instancia aleatorio, cuántos usuarios y hosts tienes, la versión de la aplicación y qué funciones (terminal, gestor de archivos, túneles, docker, etc.) se han usado en las últimas 24 horas. Nunca contiene nombres de usuario, nombres de host, direcciones IP, credenciales ni nada que te identifique a ti o a tus servidores.

Viene activado. Puedes desactivarlo en los ajustes de administración, en General, o poner `ENABLE_TELEMETRY=false` antes incluso de arrancar Termix.

<br />

## Donar

Termix es gratuito y de código abierto, sin suscripciones ni planes de pago. Si te resulta útil, considera donar para ayudar con los servidores, los dominios y el tiempo de desarrollo. Las donaciones también financian el tiempo de investigar y aprender lo necesario para funciones como SAML, Kubernetes y el soporte de agentes. Sigue el progreso y dona abajo.

[Donar](https://donate.termix.site/)

<br />

## Patrocinadores

¿Te interesa un espacio de pago para apoyar el desarrollo? Escribe a [mail@termix.site](mailto:mail@termix.site).

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

## Soporte

¿Necesitas ayuda o quieres pedir una función? Abre una [nueva incidencia](https://github.com/Termix-SSH/Support/issues) y añade todo el detalle que puedas, en inglés si te es posible. También puedes preguntar en el canal de soporte de [Discord](https://discord.gg/jVQGdvHDrf), aunque allí las respuestas pueden tardar más.

<br />

## Capturas de pantalla

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Mira los resúmenes de las actualizaciones en YouTube</sub>

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

<sub>Algunos vídeos e imágenes pueden estar desactualizados o no mostrar del todo bien las funciones.</sub>

</div>

<br />

## Características planeadas

Todas las funciones planeadas están en [Projects](https://github.com/orgs/Termix-SSH/projects/5). Si quieres colaborar, consulta [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Licencia

Distribuido bajo la Licencia Apache versión 2.0. Consulta `LICENSE` para más información.
