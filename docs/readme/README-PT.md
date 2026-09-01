<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Gestão de servidores auto-hospedada, do SSH e do desktop remoto às automações</p>

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
  <a href="https://donate.termix.site/"><img alt="Donate" src="https://img.shields.io/badge/Donate-Support%20Termix-F39044?style=flat&labelColor=1a1a1a" /></a>
</p>

<p>
  <a href="https://donate.termix.site/"><img alt="Donations this month" src="https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=Donations%20this%20month&query=%24.fiatTotal&prefix=%24&url=https%3A%2F%2Ftermix.site%2Fdonation-snapshot.json&color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

O Termix é gratuito e de código aberto. Se ele te ajuda, considera [doar](https://donate.termix.site/) para ajudar a cobrir os custos de servidor e o tempo de desenvolvimento.

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

## Visão geral

O Termix é uma plataforma gratuita, de código aberto e auto-hospedada para gerenciar os teus servidores. Ele junta num só lugar terminais SSH, desktops remotos (RDP, VNC, Telnet), transferência de arquivos, túneis, Docker, métricas e automações, na web, no desktop e no celular. É uma alternativa auto-hospedada ao Termius que continua gratuita para sempre.

<br />

## Funcionalidades

<table>
<tr>
<td width="50%" valign="top">

**Terminal SSH:**
Um terminal completo com abas como as do navegador e tela dividida, até 6 painéis ao mesmo tempo. Escolhe o teu tema, a fonte e as cores. Acima de cada sessão há uma barra com CPU, memória e disco ao vivo, além de atalhos para os arquivos, o Docker, os túneis e as métricas daquele host.

</td>
<td width="50%" valign="top">

**Desktop remoto:**
RDP, VNC e Telnet no navegador, em abas e tela dividida como qualquer outra sessão. Inclui um navegador de arquivos para as unidades RDP e envio arrastando e soltando. No desktop Windows também dá para abrir um host no cliente RDP nativo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Túneis SSH:**
Encaminhamento local, remoto e SOCKS dinâmico, com reconexão automática e verificação de estado. Os túneis de cliente para servidor do aplicativo de desktop ficam naquela máquina, e dá para salvar predefinições no servidor para levar uma configuração para outro computador.

</td>
<td width="50%" valign="top">

**Gerenciador de arquivos:**
Navega, edita, envia, baixa, renomeia, move e apaga arquivos por SFTP, com suporte a sudo. Vê e edita código, imagens, áudio e vídeo. Copia arquivos direto de um servidor para outro, com o caminho mais rápido escolhido para ti e a integridade das transferências verificada.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker e Podman:**
Inicia, para, pausa e remove containers, acompanha as estatísticas e abre um shell dentro de um deles. Funciona tanto com Docker quanto com Podman. Não é para substituir o Portainer ou o Dockge, só para gerenciar os containers que já tens.

</td>
<td width="50%" valign="top">

**Gerenciador de hosts:**
Salva e organiza hosts com etiquetas e pastas aninhadas que podes nomear e colorir. Reaproveita credenciais salvas entre hosts, distribui chaves SSH automaticamente, agrupa hosts sob um host pai, edita e exporta em lote, e usa a conexão rápida para conexões pontuais que não queres guardar.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Métricas de host:**
CPU, memória, disco, rede, temperatura, tempo ligado, processos, portas, logins e informações do sistema na maioria dos servidores Linux, com gráficos de histórico. Os cartões de gerenciamento deixam cuidar de serviços, tarefas cron, pacotes, usuários, regras de firewall, WireGuard, Tailscale, certificados SSL, logs e verificações de saúde sem sair do Termix.

</td>
<td width="50%" valign="top">

**Automações:**
Escolhe um gatilho e depois diz o que deve acontecer. Os gatilhos incluem uma métrica passando de um limite, um host caindo ou voltando, uma verificação de saúde mudando, um agendamento, um evento de container ou um webhook recebido. Os passos podem rodar comandos e trechos, controlar containers e túneis, acordar um host, chamar uma URL, esperar, seguir por uma condição, rodar outra automação e te avisar por ntfy, Discord ou webhook. As execuções de teste deixam experimentar com segurança primeiro.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Frotas:**
Junta hosts numa frota escolhendo um a um ou com regras de etiquetas, para que os novos entrem sozinhos. Roda um comando em todos os hosts de uma vez, envia e busca arquivos em todos eles, instala pacotes e reúne um inventário do sistema, do kernel, da arquitetura e do tempo ligado.

</td>
<td width="50%" valign="top">

**Assistente de IA:**
É opcional e fica desligado até tu ligares. Conecta OpenAI, Anthropic, Gemini, Ollama ou qualquer endpoint compatível com OpenAI e pergunta sobre a tua instalação. Ele lê hosts, frotas, trechos e alertas, e propõe mudanças para tu aprovares em vez de fazer sozinho. Nunca consegue mexer em credenciais, usuários ou configurações. Os administradores podem deixar desligado para toda a instância, e dá para escondê-lo já na configuração inicial.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Login e usuários:**
Contas locais além de login por OIDC, LDAP, GitHub e Google, com dois fatores (TOTP), chaves de acesso (WebAuthn) e dispositivos confiáveis. Os administradores podem gerenciar usuários, ligar grupos do OIDC a papéis, ver todas as sessões ativas em qualquer plataforma e encerrá-las. Liga a tua conta local com a do OIDC e consulta o registro de auditoria do que cada um fez.

</td>
<td width="50%" valign="top">

**Papéis e compartilhamento:**
Cria papéis e compartilha hosts com usuários ou papéis em quatro níveis: conectar, ver, editar e gerenciar. Funciona com todos os tipos de autenticação e todos os protocolos, e dá para trocar as credenciais usadas num host compartilhado.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Alertas:**
Define regras em métricas de host como CPU, memória e disco, e recebe aviso por ntfy, Discord ou webhook quando elas disparam. Vê os alertas ativos e resolvidos num histórico e dispensa os que não te interessam.

</td>
<td width="50%" valign="top">

**Página inicial:**
Uma grade de widgets que tu mesmo montas arrastando e soltando. Tem widget para status de host, ping, links de serviços, favoritos, busca, relógios, calendários, contagens regressivas, notas, RSS, previsão do tempo, imagens, iframes, Docker, túneis, gráficos de métricas, APIs próprias e até um terminal ao vivo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Trechos e ferramentas:**
Salva os comandos que usas sempre e dispara com um clique, com variáveis para o host e para o que tu digitares. Roda um mesmo comando em todos os terminais abertos e pesquisa o teu histórico com preenchimento automático.

</td>
<td width="50%" valign="top">

**Compartilhar sessão:**
Compartilha ao vivo uma sessão de terminal, RDP, VNC ou Telnet. Manda um link que qualquer um entra sem conta, ou compartilha com um usuário específico do Termix, em somente leitura ou com escrita. Os compartilhamentos podem expirar sozinhos ou ser revogados, e dá para desligar tudo de uma vez ou por host.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Gravação e registros de sessão:**
Grava sessões de terminal, RDP e VNC e reproduz depois. Baixa registros de texto de uma sessão e olha o registro de conexão para ver exatamente o que aconteceu durante ela.

</td>
<td width="50%" valign="top">

**Conexões seriais:**
Fala com dispositivos seriais como roteadores, switches e microcontroladores pelo navegador ou pelo aplicativo de desktop. Define taxa de transmissão, bits de dados, bits de parada e paridade. Usa a API Web Serial nos navegadores compatíveis, ou um backend nativo no aplicativo de desktop.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Traz dispositivos da tua tailnet para adicionar como hosts em poucos cliques, e conecta com Tailscale SSH para que as ACLs da tailnet cuidem do acesso sem guardar credenciais. Headscale e endpoints personalizados também funcionam.

</td>
<td width="50%" valign="top">

**Proxmox:**
Importa hosts direto de uma instância Proxmox e acompanha as estatísticas de nós e convidados, incluindo CPU, memória e armazenamento, numa aba própria.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Áreas de trabalho e abas:**
Salva um conjunto de abas com a divisão da tela e reabre tudo com um clique. O Termix também lembra da tua última sessão, então as abas voltam depois de recarregar e em outros dispositivos.

</td>
<td width="50%" valign="top">

**Configuração guiada:**
Uma configuração curta te leva por escolher uma predefinição de interface, o tema, as funcionalidades que queres e o teu primeiro host. O modo simples esconde o que não usas, e dá para refazer a configuração ou trocar de predefinição quando quiseres.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Desktop independente e sincronização:**
O aplicativo de desktop roda sozinho, com backend e banco de dados locais, sem servidor. Também dá para ligar num servidor Termix e sincronizar nos dois sentidos hosts, credenciais, trechos e mais, e escolher se as conexões saem da tua máquina ou passam pelo servidor.

</td>
<td width="50%" valign="top">

**Linha de comando:**
Um CLI `termix` para o teu shell e os teus scripts. Abre terminais, roda um comando num host ou numa frota inteira, move arquivos por SFTP e gerencia hosts, trechos e credenciais. Instala com `npm install -g @termix-cli/cli` ou pega um binário independente. Vê a [documentação do CLI](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Segurança:**
Senhas, chaves e outros segredos são criptografados por usuário, e os próprios arquivos do banco de dados podem ser criptografados em disco. Vê a [documentação](https://docs.termix.site/security) para entender como funciona.

</td>
<td width="50%" valign="top">

**Idiomas:**
Cerca de 30 idiomas incluídos, gerenciados pelo [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Mais funcionalidades</b></summary>
<br />

- **Painel** - Os teus servidores num relance, com cartões que tu mesmo organizas
- **Gráfico de rede** - O teu homelab desenhado a partir dos teus hosts, com status ao vivo
- **Monitor tmux** - Percorre sessões, janelas e painéis do tmux, com prévia e busca
- **Chaves de API** - Chaves por usuário com data de validade para scripts e CI
- **Exportar e importar** - Leva e traz hosts, credenciais e dados do gerenciador de arquivos
- **SSL automático** - Certificados gerados e renovados para ti, com redirecionamento para HTTPS, ou usa os teus
- **Bancos de dados** - SQLite por padrão, com PostgreSQL e MySQL também suportados
- **Interface moderna** - Interface React limpa que funciona no desktop e no celular, com temas como claro, escuro e Dracula. Qualquer conexão abre em tela cheia por uma URL
- **Paleta de comandos** - Toca duas vezes no Shift esquerdo para ir a um host pelo teclado
- **Atalhos de teclado** - Trocar de aba, fechar abas e mais, tudo remapeável
- **Wake-on-LAN** - Liga uma máquina pelo Termix ou por um passo de automação
- **Autenticação por proxy confiável** - Deixa um proxy reverso cuidar do login e repassar o usuário
- **SSH bem completo** - Hosts de salto, Warpgate, pedidos de TOTP, SOCKS5, verificação de chave de host, preenchimento automático de senha, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, registro do terminal, encaminhamento de agente, agente SSH do Bitwarden, assinatura SSH com HashiCorp Vault e mais
- **Termix ID** - Uma versão embutida do sshid.io. Registra um identificador, publica as tuas chaves públicas numa URL de resolução e emite certificados SSH pela CA embutida

</details>

<br />

## Plataformas suportadas

<table align="center">
<tr>
<th align="center">Plataforma</th>
<th align="center">Distribuição</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Qualquer navegador moderno (Chrome, Safari, Firefox) · Suporte a PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portátil · Instalador MSI · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portátil · AUR · AppImage · Deb · Flatpak</td>
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

## Instalação

Vê a [documentação do Termix](https://docs.termix.site/install) para as instruções completas de instalação em todas as plataformas.

Exemplo de arquivo Docker Compose (dá para tirar o `guacd` e a rede se não pretendes usar o desktop remoto):

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

### Linha de comando

O Termix também tem um CLI, para gerenciares os teus servidores pelo terminal e usares o Termix nos teus próprios scripts.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

Ele abre terminais, roda um comando num host ou numa frota inteira, move arquivos por SFTP e gerencia hosts, trechos e credenciais. A documentação completa está em [docs.termix.site/cli](https://docs.termix.site/cli).

### Hospedagem na nuvem

Dá para rodar o servidor do Termix num VPS em vez de dentro da tua própria rede. Se o Termix roda na rede que ele gerencia, uma queda leva ele junto, bem na hora em que precisas dele para resolver. Rodando fora ele continua acessível, te dá um IP fixo e dá para entrar de qualquer lugar sem VPN nem abrir portas.

A [GINERNET](https://docs.termix.site/install/ginernet) patrocina o Termix, e a documentação tem um guia passo a passo para publicar na plataforma de VPS deles.

<br />

## Telemetria

O Termix manda uma vez por dia um pequeno sinal anônimo, para eu saber quantas instâncias estão rodando e quais funcionalidades são usadas. Ele contém um ID de instância aleatório, quantos usuários e hosts tu tens, a versão do aplicativo e quais funcionalidades (terminal, gerenciador de arquivos, túneis, docker, etc.) foram usadas nas últimas 24 horas. Nunca contém nomes de usuário, nomes de host, endereços IP, credenciais ou qualquer coisa que identifique ti ou os teus servidores.

Vem ligado por padrão. Podes desligar nas configurações de administração, em Geral, ou definir `ENABLE_TELEMETRY=false` antes mesmo de iniciar o Termix.

<br />

## Doar

O Termix é gratuito e de código aberto, sem assinaturas nem planos pagos. Se ele te ajuda, considera doar para ajudar com servidores, domínios e tempo de desenvolvimento. As doações também custeiam o tempo de pesquisar e aprender o necessário para funcionalidades como SAML, Kubernetes e suporte a agentes. Acompanha o progresso e doa abaixo.

[Doar](https://donate.termix.site/)

<br />

## Patrocinadores

Tens interesse num espaço pago para apoiar o desenvolvimento? Escreve para [mail@termix.site](mailto:mail@termix.site).

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

## Suporte

Precisas de ajuda ou queres pedir uma funcionalidade? Abre uma [nova issue](https://github.com/Termix-SSH/Support/issues) com o máximo de detalhes possível, em inglês se der. Também podes perguntar no canal de suporte do [Discord](https://discord.gg/jVQGdvHDrf), embora as respostas por lá possam demorar mais.

<br />

## Capturas de tela

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Vê as apresentações das atualizações no YouTube</sub>

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

<sub>Alguns vídeos e imagens podem estar desatualizados ou não mostrar as funcionalidades perfeitamente.</sub>

</div>

<br />

## Funcionalidades planejadas

Todas as funcionalidades planejadas estão em [Projects](https://github.com/orgs/Termix-SSH/projects/5). Se queres contribuir, vê [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Licença

Distribuído sob a Licença Apache versão 2.0. Vê `LICENSE` para mais informações.
