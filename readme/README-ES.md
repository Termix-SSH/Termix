# Estadísticas del Repositorio

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · 🇪🇸 Español · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Logrado el 1 de septiembre de 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# Descripción General

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix es una plataforma de gestión de servidores todo en uno, de código abierto, siempre gratuita y autoalojada. Proporciona una solución multiplataforma para gestionar sus servidores e infraestructura a través de una interfaz única e intuitiva. Termix ofrece acceso a terminal SSH, control de escritorio remoto (RDP, VNC, Telnet), capacidades de túneles SSH, gestión remota de archivos SSH y muchas otras herramientas. Termix es la alternativa perfecta, gratuita y autoalojada a Termius, disponible para todas las plataformas.

# Características

- **Acceso a Terminal SSH** - Terminal completo con soporte de pantalla dividida (hasta 4 paneles) con un sistema de pestañas similar al navegador. Incluye soporte para personalizar el terminal incluyendo temas comunes de terminal, fuentes y otros componentes.
- **Acceso a Escritorio Remoto** - Soporte RDP, VNC y Telnet a través del navegador con personalización completa y pantalla dividida.
- **Gestión de Túneles SSH** - Cree y gestione túneles SSH de servidor a servidor con reconexión automática, monitoreo de estado y reenvío local, remoto o dinámico SOCKS. La configuración de túneles de cliente de escritorio a servidor se almacena localmente por instalación de escritorio; los snapshots de presets C2S opcionales pueden guardarse en el servidor, renombrarse, cargarse o eliminarse para mover una configuración de túnel local entre clientes.
- **Gestor Remoto de Archivos** - Gestione archivos directamente en servidores remotos con soporte para visualizar y editar código, imágenes, audio y video. Suba, descargue, renombre, elimine y mueva archivos sin problemas con soporte sudo.
- **Gestión de Docker** - Inicie, detenga, pause, elimine contenedores. Vea estadísticas de contenedores. Controle contenedores usando el terminal docker exec. No fue creado para reemplazar Portainer o Dockge, sino para simplemente gestionar sus contenedores en lugar de crearlos.
- **Gestor de Hosts SSH** - Guarde, organice y gestione sus conexiones SSH con etiquetas y carpetas, y guarde fácilmente información de inicio de sesión reutilizable con la capacidad de automatizar el despliegue de claves SSH.
- **Estadísticas del Servidor** - Vea el uso de CPU, memoria y disco junto con red, tiempo de actividad, información del sistema, firewall, monitor de puertos en la mayoría de los servidores basados en Linux.
- **Dashboard** - Vea la información del servidor de un vistazo en su dashboard.
- **RBAC** - Cree roles y comparta hosts entre usuarios/roles.
- **Autenticación de Usuarios** - Gestión segura de usuarios con controles de administrador y soporte para OIDC (con control de acceso) y 2FA (TOTP). Vea sesiones activas de usuarios en todas las plataformas y revoque permisos. Vincule sus cuentas OIDC/Locales entre sí.
- **Cifrado de Base de Datos** - Backend almacenado como archivos de base de datos SQLite cifrados. Consulte la [documentación](https://docs.termix.site/security) para más información.
- **Claves API** - Cree claves API con ámbito de usuario y fechas de vencimiento para usar en automatización/CI.
- **Exportación/Importación de Datos** - Exporte e importe hosts SSH, credenciales y datos del gestor de archivos.
- **Configuración Automática de SSL** - Generación y gestión integrada de certificados SSL con redirecciones HTTPS.
- **Interfaz Moderna** - Interfaz limpia compatible con escritorio/móvil construida con React, Tailwind CSS y Shadcn. Elija entre muchos temas de UI diferentes, incluyendo claro, oscuro, Dracula, etc. Use rutas URL para abrir cualquier conexión en pantalla completa.
- **Idiomas** - Soporte integrado para ~30 idiomas (gestionado por [Crowdin](https://docs.termix.site/translations)).
- **Soporte de Plataformas** - Disponible como aplicación web, aplicación de escritorio (Windows, Linux y macOS, se puede ejecutar de forma independiente sin el backend de Termix), PWA y aplicación dedicada para móviles/tablets en iOS y Android.
- **Herramientas SSH** - Cree fragmentos de comandos reutilizables que se ejecutan con un solo clic. Ejecute un comando simultáneamente en múltiples terminales abiertos.
- **Historial de Comandos** - Autocompletado y visualización de comandos SSH ejecutados anteriormente.
- **Conexión Rápida** - Conéctese a un servidor sin necesidad de guardar los datos de conexión.
- **Paleta de Comandos** - Pulse dos veces la tecla Shift izquierda para acceder rápidamente a las conexiones SSH con su teclado.
- **SSH Rico en Funciones** - Soporta jump hosts, Warpgate, conexiones basadas en TOTP, SOCKS5, verificación de clave de host, autocompletado de contraseñas, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, etc.
- **Gráfico de Red** - Personalice su Dashboard para visualizar su homelab basado en sus conexiones SSH con soporte de estado.
- **Pestañas Persistentes** - Las sesiones SSH y pestañas permanecen abiertas entre dispositivos/actualizaciones si está habilitado en el perfil de usuario.

# Características Planeadas

Consulte [Proyectos](https://github.com/orgs/Termix-SSH/projects/2) para todas las características planeadas. Si desea contribuir, consulte [Contribuir](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Instalación

Dispositivos soportados:

- Sitio web (cualquier navegador moderno en cualquier plataforma como Chrome, Safari y Firefox) (incluye soporte PWA)
- Windows (x64/ia32)
  - Portable
  - Instalador MSI
  - Gestor de paquetes Chocolatey
- Linux (x64/ia32)
  - Portable
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32 en v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

Visite la [documentación](https://docs.termix.site/install) de Termix para más información sobre cómo instalar Termix en todas las plataformas. De lo contrario, vea un archivo Docker Compose de ejemplo aquí (puede omitir guacd y la red si no planea usar funciones de escritorio remoto):

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

# Patrocinadores

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

# Soporte

Si necesita ayuda o desea solicitar una función para Termix, visite la página de [Issues](https://github.com/Termix-SSH/Support/issues), inicie sesión y pulse `New Issue`.
Por favor, sea lo más detallado posible en su reporte, preferiblemente escrito en inglés. También puede unirse al servidor de [Discord](https://discord.gg/jVQGdvHDrf) y visitar el canal de soporte, sin embargo, los tiempos de respuesta pueden ser más largos.

# Capturas de Pantalla

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

Algunos videos e imágenes pueden estar desactualizados o no mostrar perfectamente las características.

# Licencia

Distribuido bajo la Licencia Apache Versión 2.0. Consulte LICENSE para más información.
