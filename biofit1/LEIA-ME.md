# Biofit — Parte 1: base do sistema

Esta é a primeira entrega do Biofit, o sistema de gestão e acompanhamento de treinos da Academia Biofit. Ela traz o servidor com banco de dados e todas as telas principais.

## O que esta parte tem

- **Servidor Node.js com banco de dados SQLite** (`server.js`), sem dependências externas.
- **Login do administrador**, com senha protegida por scrypt e sessão no servidor.
- **Painel:** receita do mês, alunos em dia, inadimplentes, novos alunos e gráfico de receita dos últimos 6 meses.
- **Alunos:** cadastro, busca, edição, exclusão e registro de pagamento com renovação automática do vencimento.
- **Planos e Pagamentos:** cadastros completos.
- **Treinos:** os Treinos A, B e C já vêm cadastrados, cada um com dois exercícios (A: agachamento e flexão de braço; B: afundo e prancha; C: polichinelo e abdominal). Cada exercício tem séries e repetições e uma **animação** mostrando o movimento, visível pelo botão **Ver** e no portal do aluno.
- **Portal do aluno:** login próprio, semana de treinos conforme o plano e envio de foto ou vídeo de cada treino.
- **Validação:** o administrador aprova ou rejeita os envios dos alunos.
- **Backup:** exportação e restauração dos dados em JSON.

A Parte 2 acrescenta relatórios, frequência e histórico, a instalação como aplicativo (PWA) e os arquivos para publicar online.

## O que você precisa

- **Node.js 22.13 ou mais recente.** Baixe a versão LTS em https://nodejs.org.
- Não precisa instalar mais nada.

## Como rodar

1. Inicie o sistema:
   - **Windows:** dê dois cliques em `iniciar-windows.bat`.
   - **Mac ou Linux:** no Terminal, de dentro da pasta, rode `sh iniciar-mac-linux.sh`.
   - Se preferir, rode `node server.js`.
2. Abra **http://localhost:3000** e crie o login do administrador.
3. Para os alunos acessarem pelo celular, use o endereço `http://...:3000` que aparece na janela do servidor, com o celular no mesmo Wi-Fi.

## Onde ficam os dados

Na pasta `dados`, criada na primeira execução: `dados/biofit.db` (banco) e `dados/midia/` (fotos e vídeos). Essa pasta não deve ir para o GitHub, e o arquivo `.gitignore` já cuida disso.
