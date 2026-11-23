# Biofit — app da academia (PWA + Node.js + SQLite)

O Biofit é um **app instalável (PWA)** com servidor **Node.js** e banco de dados **SQLite**:

- O **administrador** cuida de alunos, planos, pagamentos e treinos, e valida os treinos enviados pelos alunos.
- Os **treinos A, B e C** já vêm cadastrados, cada um com dois exercícios, e cada exercício mostra uma **animação** de como fazer.
- O **aluno** instala o app no celular, vê a rotina da semana e envia uma foto ou um vídeo de cada treino.
- Os **relatórios** e o **histórico** mostram a frequência de cada aluno, a sequência de treinos e a receita por plano, com exportação em CSV.
- Tudo fica guardado no banco de dados do servidor. Qualquer aparelho vê os mesmos dados.

O projeto não tem dependências. Só precisa do **Node.js 22.13 ou mais recente**.

---

## 1. Testar no seu computador

1. Instale o Node.js, versão LTS, em https://nodejs.org.
2. Descompacte o zip.
3. Inicie o sistema:
   - **Windows:** dê dois cliques em `iniciar-windows.bat`.
   - **Mac ou Linux:** no Terminal, de dentro da pasta, rode `sh iniciar-mac-linux.sh`.
   - Se preferir, rode `node server.js` no terminal, de dentro da pasta.
4. O navegador abre em **http://localhost:3000**. No primeiro acesso, crie o login do administrador.

A janela do servidor também mostra um endereço como `http://192.168.0.10:3000`, que abre o sistema em qualquer aparelho no mesmo Wi-Fi.

> Para **instalar como app** no celular, o sistema precisa estar online com **HTTPS** (veja o passo 2). No seu computador, pelo `localhost`, a instalação já funciona.

---

## 2. Colocar online (para o app funcionar em qualquer lugar)

**Por que não dá para usar o GitHub Pages:** ele só hospeda páginas estáticas. Não executa o servidor Node e não guarda banco de dados.

O que o Biofit precisa:
- Um serviço que rode **Node.js** ou **Docker**. O projeto já tem um `Dockerfile`.
- Um **disco permanente** (volume), montado em `/data`. É onde ficam o banco e as fotos. Sem ele, os dados se apagam a cada reinício.
- **HTTPS**, que esses serviços já oferecem.

### Opção A — Railway (mais simples)

1. Suba esta pasta para um repositório no GitHub. O `.gitignore` já impede que a pasta `dados` vá junto.
2. No Railway, crie um projeto com **Deploy from GitHub repo** e escolha o repositório. Ele detecta o `Dockerfile` sozinho.
3. Adicione um **Volume** ao serviço, com o caminho de montagem **`/data`**.
4. Em **Settings → Networking**, gere um domínio público. Ele já vem com HTTPS.
5. Abra o endereço, crie o administrador e pronto.

### Opção B — Fly.io, Render ou outro serviço com Docker

Use o `Dockerfile` e crie um volume ou disco permanente montado em `/data`. No Render, o disco permanente só existe nos planos pagos.

### Opção C — VPS (Hostinger, DigitalOcean, Contabo…)

1. Instale o Node.js 22 LTS no servidor e copie esta pasta para lá.
2. Rode com `TRUST_PROXY=1 node server.js`. Para manter o sistema sempre ligado, use um gerenciador como `pm2` ou `systemd`.
3. Coloque um **Nginx** ou **Caddy** na frente, com certificado HTTPS, encaminhando para a porta 3000. Com o Caddy, basta: `seudominio.com.br { reverse_proxy localhost:3000 }`.

---

## 3. Instalar o app no celular

Com o sistema online:

- **Android (Chrome):** abra o endereço e toque em **Instalar app** na tela de login, ou use o menu ⋮ → **Instalar app**.
- **iPhone (Safari):** abra o endereço, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
- **Computador (Chrome ou Edge):** clique no ícone de instalar na barra de endereço, ou no botão **Instalar app**.

Para o aluno entrar, ele abre o app, toca em **Sou aluno** e usa o usuário e a senha que você cadastrou para ele.

---

## 4. Dados e backup

- Banco: `dados/biofit.db`, ou `/data/biofit.db` quando o sistema roda online.
- Fotos e vídeos: `dados/midia/`, ou `/data/midia/` online.
- **Backup completo:** copie a pasta de dados inteira, com o servidor parado.
- **Botão Backup**, dentro do sistema: gera um `.json` com todos os dados, menos as fotos e os vídeos. O mesmo botão serve para restaurar.

### Trazer os dados da versão antiga (a que guardava tudo no navegador)

1. Na versão antiga, clique em **Backup** e copie todo o texto.
2. Na versão nova, entre como administrador, clique em **Backup**, apague o texto da caixa e cole o que você copiou.
3. Clique em **Restaurar**. Alunos, planos, pagamentos, treinos e as senhas dos alunos vêm junto. As fotos e os vídeos antigos não vêm.

---

## 5. Configurações (variáveis de ambiente)

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DATA_DIR` | `./dados` (no Docker: `/data`) | Pasta do banco e das fotos |
| `TRUST_PROXY` | desligado (no Docker: `1`) | Ligue quando houver HTTPS/proxy na frente: ativa cookies seguros e identifica o IP real |
| `TZ` | `America/Sao_Paulo` | Fuso horário usado para datas e vencimentos |

## Estrutura

```
server.js              servidor + API + banco SQLite
public/index.html      o app (painel do administrador e portal do aluno)
public/sw.js           service worker (PWA)
public/manifest.webmanifest
public/icons/          ícones do app
Dockerfile             para publicar online
```
