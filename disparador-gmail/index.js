const fs = require('fs');
const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

// --- CONFIGURAÇÕES ---
const PASTA_ATUAL = process.cwd();
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const CAMINHO_TOKEN = path.join(PASTA_ATUAL, 'token.json');

// --- FIX: O ROBÔ PROCURA O ARQUIVO CERTO SOZINHO ---
let CAMINHO_CREDENCIAIS = path.join(PASTA_ATUAL, 'credentials.json');

if (!fs.existsSync(CAMINHO_CREDENCIAIS)) {
    const caminhoDuplicado = path.join(PASTA_ATUAL, 'credentials.json.json');
    if (fs.existsSync(caminhoDuplicado)) {
        console.log("⚠️ Aviso: O arquivo estava com nome duplicado (credentials.json.json), mas eu achei!");
        CAMINHO_CREDENCIAIS = caminhoDuplicado;
    } else {
        console.error("❌ ERRO CRÍTICO: O arquivo 'credentials.json' sumiu da pasta. Baixe de novo do Google.");
        process.exit(1);
    }
}

// --- HTML OTIMIZADO PRA CONVERSÃO ---
const montarHtml = (nome) => {
return `
<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: Arial, sans-serif; color:#333; line-height:1.6; background:#f6f6f6; }
.container { max-width:600px; margin:0 auto; border:1px solid #ddd; padding:25px; border-radius:8px; background:white; }
.titulo { font-size:26px; font-weight:bold; text-align:center; margin-bottom:15px; }
.sub { font-size:16px; text-align:center; color:#444; margin-bottom:20px; }
.box { background:#fff4f4; padding:18px; border-left:5px solid #ff3b3b; margin:25px 0; }
.lista p { margin:5px 0; }
.btn { display:inline-block; background:#25D366; color:white; padding:18px 30px; text-decoration:none; border-radius:6px; font-weight:bold; margin-top:20px; font-size:17px; }
.small { font-size:12px; color:#777; text-align:center; }
</style>
</head>

<body>

<div class="container">

<div class="titulo">
🏡 ${nome}, você pode estar mais perto do seu AP do que imagina
</div>

<div class="sub">
Descubra HOJE se você consegue sair do aluguel com ajuda do governo
</div>

<p>Fala <strong>${nome}</strong>,</p>

<p>
Muita gente acha que não consegue financiar um imóvel… mas quando faz a análise, descobre que <strong>já poderia estar morando no próprio AP</strong>.
</p>

<p>
Com o programa <strong>Minha Casa Minha Vida</strong>, você pode ter:
</p>

<div class="box">

<div class="lista">
<p>✔ Entrada reduzida (ou até zero em alguns casos)</p>
<p>✔ Parcelas menores que aluguel</p>
<p>✔ Subsídios do governo</p>
<p>✔ Aprovação rápida</p>
</div>

</div>

<p>
Eu faço sua análise <strong>gratuita</strong> e te digo exatamente:
</p>

<div class="lista">
<p>👉 Se você pode financiar</p>
<p>👉 Qual valor liberado</p>
<p>👉 Quanto ficaria sua parcela</p>
</div>

<p>
📊 Normalmente sai em <strong>menos de 2 horas</strong>.
</p>

<div style="text-align:center; margin:30px 0;">

<a href="https://wa.me/5541985380834?text=Quero%20saber%20se%20consigo%20meu%20imovel" class="btn">
QUERO SABER SE POSSO FINANCIAR
</a>

</div>

<p class="small">
Sem custo. Sem compromisso. Atendimento direto no WhatsApp.
</p>

<p>
<strong>Luan Biagioni</strong><br>
Especialista em aprovação de crédito imobiliário<br>
📞 (41) 98538-0834
</p>

</div>

</body>
</html>
`;
};

// --- FUNÇÃO DE SALVAR TOKEN ---
async function salvarCredenciais(client) {
  const content = await fs.promises.readFile(CAMINHO_CREDENCIAIS);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.promises.writeFile(CAMINHO_TOKEN, payload);
}

// --- AUTENTICAÇÃO ---
async function carregarOuAutenticar() {
  try {
    const content = await fs.promises.readFile(CAMINHO_TOKEN);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    const client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CAMINHO_CREDENCIAIS,
    });
    if (client.credentials) {
      await salvarCredenciais(client);
    }
    return client;
  }
}

// --- DISPARADOR ---
async function disparar() {
  console.log("📂 Lendo lista de clientes...");
  let listaClientes;
  try {
      const rawData = fs.readFileSync('lista5.json', 'utf8');
      listaClientes = JSON.parse(rawData);
  } catch (e) {
      console.error("❌ Erro: Não encontrei o arquivo 'lista12.json'.");
      return;
  }

  const auth = await carregarOuAutenticar();
  const gmail = google.gmail({ version: 'v1', auth });

  console.log(`🚀 Iniciando disparo para ${listaClientes.length} pessoas.`);
  
  for (const [index, cliente] of listaClientes.entries()) {
    const corpoEmail = montarHtml(cliente.nome);
    const assunto = `🏡 ${cliente.nome}, veja se você já pode sair do aluguel hoje`;

    const emailLines = [
        `To: ${cliente.email}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: =?utf-8?B?${Buffer.from(assunto).toString('base64')}?=`,
        '',
        corpoEmail
    ];
    
    const emailBase64 = Buffer.from(emailLines.join('\n'))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    try {
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: emailBase64 }
        });

        console.log(`✅ [${index + 1}/${listaClientes.length}] Enviado para: ${cliente.nome} (${cliente.email})`);
        
        // Delay pra não cair como spam
        await new Promise(r => setTimeout(r, 5000));
        
    } catch (erro) {
        console.error(`❌ Erro no envio para ${cliente.email}:`, erro.message);
    }
  }
}

disparar();