<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Gerenciamento SSH auto-hospedado e acesso a area de trabalho remota</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  Português ·
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
  <sub>Conquistado em 1 de setembro de 2025</sub>
</p>

</div>

<br />

## Visao Geral

Termix e uma plataforma de gerenciamento de servidores tudo-em-um, de codigo aberto, sempre gratuita e auto-hospedada. Ela fornece uma solucao multiplataforma para gerenciar seus servidores e infraestrutura atraves de uma interface unica e intuitiva. Termix oferece acesso a terminal SSH, controle de desktop remoto (RDP, VNC, Telnet), capacidades de tunelamento SSH, gerenciamento remoto de arquivos SSH e muitas outras ferramentas. Termix e a alternativa perfeita, gratuita e auto-hospedada ao Termius, disponivel para todas as plataformas.

<br />

## Funcionalidades

<table>
<tr>
<td width="50%" valign="top">

**Acesso ao Terminal SSH:**
Terminal completo com suporte a tela dividida (ate 4 paineis) com um sistema de abas similar ao navegador. Inclui suporte para personalizacao do terminal incluindo temas comuns de terminal, fontes e outros componentes.

</td>
<td width="50%" valign="top">

**Acesso a Area de Trabalho Remota:**
Suporte a RDP, VNC e Telnet pelo navegador com personalizacao completa e tela dividida.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Gerenciamento de Tuneis SSH:**
Crie e gerencie tuneis SSH de servidor para servidor com reconexao automatica, monitoramento de saude e encaminhamento local, remoto ou SOCKS dinamico. As configuracoes de tunel de cliente desktop para servidor sao armazenadas localmente por instalacao de desktop; snapshots de predefinicoes C2S opcionais podem ser salvos no servidor, renomeados, carregados ou excluidos para mover uma configuracao de tunel local entre clientes.

</td>
<td width="50%" valign="top">

**Gerenciador Remoto de Arquivos:**
Gerencie arquivos diretamente em servidores remotos com suporte para visualizar e editar codigo, imagens, audio e video. Faca upload, download, renomeie, exclua e mova arquivos facilmente com suporte sudo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Gerenciamento de Docker:**
Inicie, pare, pause, remova conteineres. Visualize estatisticas de conteineres. Controle conteineres usando o terminal Docker Exec. Nao foi feito para substituir Portainer ou Dockge, mas sim para simplesmente gerenciar seus conteineres em vez de cria-los.

</td>
<td width="50%" valign="top">

**Gerenciador de Hosts SSH:**
Salve, organize e gerencie suas conexoes SSH com tags e pastas, e salve facilmente informacoes de login reutilizaveis com a capacidade de automatizar a implantacao de chaves SSH.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Estatisticas do Servidor:**
Visualize o uso de CPU, memoria e disco junto com rede, tempo de atividade, informacoes do sistema, firewall, monitor de portas na maioria dos servidores baseados em Linux.

</td>
<td width="50%" valign="top">

**Autenticacao de Usuarios:**
Gerenciamento seguro de usuarios com controles de administrador e suporte para OIDC (com controle de acesso) e 2FA (TOTP). Visualize sessoes ativas de usuarios em todas as plataformas e revogue permissoes. Vincule suas contas OIDC/Locais entre si.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
Crie funcoes e compartilhe hosts entre usuarios/funcoes.

</td>
<td width="50%" valign="top">

**Criptografia de Banco de Dados:**
Backend armazenado como arquivos de banco de dados SQLite criptografados. Consulte a [documentacao](https://docs.termix.site/security) para mais informacoes.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Grafico de Rede:**
Personalize seu Dashboard para visualizar seu homelab baseado nas suas conexoes SSH com suporte de status.

</td>
<td width="50%" valign="top">

**Ferramentas SSH:**
Crie trechos de comandos reutilizaveis que sao executados com um unico clique. Execute um comando simultaneamente em multiplos terminais abertos.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Abas Persistentes:**
Sessoes SSH e abas permanecem abertas entre dispositivos/atualizacoes se habilitado no perfil do usuario.

</td>
<td width="50%" valign="top">

**Idiomas:**
Suporte integrado para aproximadamente 30 idiomas (gerenciado pelo [Crowdin](https://docs.termix.site/translations)).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Mais funcionalidades</b></summary>
<br />

- **Dashboard** - Visualize informacoes do servidor de relance no seu dashboard
- **Chaves de API** - Crie chaves de API com escopo de usuario e datas de expiracao para uso em automacao/CI
- **Exportacao/Importacao de Dados** - Exporte e importe hosts SSH, credenciais e dados do gerenciador de arquivos
- **Configuracao Automatica de SSL** - Geracao e gerenciamento integrado de certificados SSL com redirecionamentos HTTPS
- **Interface Moderna** - Interface limpa compativel com desktop/mobile construida com React, Tailwind CSS e Shadcn. Escolha entre muitos temas de interface diferentes, incluindo claro, escuro, Dracula, etc. Use rotas de URL para abrir qualquer conexao em tela cheia.
- **Historico de Comandos** - Autocompletar e visualizar comandos SSH executados anteriormente
- **Conexao Rapida** - Conecte-se a um servidor sem precisar salvar os dados de conexao
- **Paleta de Comandos** - Pressione duas vezes a tecla Shift esquerda para acessar rapidamente as conexoes SSH com seu teclado
- **SSH Rico em Funcionalidades** - Suporta jump hosts, Warpgate, conexoes baseadas em TOTP, SOCKS5, verificacao de chave do host, preenchimento automatico de senhas, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, etc.

</details>

<br />

## Suporte a Plataformas

<table align="center">
<tr>
<th align="center">Plataforma</th>
<th align="center">Distribuicao</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Qualquer navegador moderno (Chrome, Safari, Firefox) · Suporte PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portatil · Instalador MSI · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portatil · AUR · AppImage · Deb · Flatpak</td>
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

## Instalacao

Visite a [documentacao](https://docs.termix.site/install) do Termix para mais informacoes sobre como instalar o Termix em todas as plataformas. Caso contrario, veja um arquivo Docker Compose de exemplo aqui (voce pode omitir o guacd e a rede se nao planeja usar recursos de area de trabalho remota):

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

## Capturas de Tela

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Assista resumos de atualizacoes no YouTube</sub>

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

<sub>Alguns videos e imagens podem estar desatualizados ou podem nao mostrar perfeitamente as funcionalidades.</sub>

</div>

<br />

## Funcionalidades Planejadas

Consulte [Projetos](https://github.com/orgs/Termix-SSH/projects/2) para todas as funcionalidades planejadas. Se voce deseja contribuir, consulte [Contribuir](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Patrocinadores

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

## Suporte

Se voce precisa de ajuda ou deseja solicitar uma funcionalidade para o Termix, visite a pagina de [Issues](https://github.com/Termix-SSH/Support/issues), faca login e clique em `New Issue`. Por favor, seja o mais detalhado possivel no seu relato, preferencialmente escrito em ingles. Voce tambem pode entrar no servidor do [Discord](https://discord.gg/jVQGdvHDrf) e visitar o canal de suporte, porem, os tempos de resposta podem ser mais longos.

<br />

## Licenca

Distribuido sob a Licenca Apache Versao 2.0. Consulte `LICENSE` para mais informacoes.
