const DEFAULT_SUBJECT = '🏡 {nome}, veja se você já pode sair do aluguel hoje';

const DEFAULT_HTML = `<!DOCTYPE html>
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
  <div class="titulo">🏡 {nome}, você pode estar mais perto do seu AP do que imagina</div>
  <div class="sub">Descubra HOJE se você consegue sair do aluguel com ajuda do governo</div>
  <p>Fala <strong>{nome}</strong>,</p>
  <p>Muita gente acha que não consegue financiar um imóvel… mas quando faz a análise, descobre que <strong>já poderia estar morando no próprio AP</strong>.</p>
  <p>Com o programa <strong>Minha Casa Minha Vida</strong>, você pode ter:</p>
  <div class="box">
    <div class="lista">
      <p>✔ Entrada reduzida (ou até zero em alguns casos)</p>
      <p>✔ Parcelas menores que aluguel</p>
      <p>✔ Subsídios do governo</p>
      <p>✔ Aprovação rápida</p>
    </div>
  </div>
  <p>Eu faço sua análise <strong>gratuita</strong> e te digo exatamente:</p>
  <div class="lista">
    <p>👉 Se você pode financiar</p>
    <p>👉 Qual valor liberado</p>
    <p>👉 Quanto ficaria sua parcela</p>
  </div>
  <p>📊 Normalmente sai em <strong>menos de 2 horas</strong>.</p>
  <div style="text-align:center; margin:30px 0;">
    <a href="https://wa.me/5541985380834?text=Quero%20saber%20se%20consigo%20meu%20imovel" class="btn">QUERO SABER SE POSSO FINANCIAR</a>
  </div>
  <p class="small">Sem custo. Sem compromisso. Atendimento direto no WhatsApp.</p>
  <p><strong>Seu Nome</strong><br>Especialista<br>📞 (00) 00000-0000</p>
</div>
</body>
</html>`;

const DEFAULT_RECIPIENTS = `Luan Biagioni, luanbiagioni@gmail.com
Rodrigo Santos, rodrigosantos@gmail.com`;

export { DEFAULT_HTML, DEFAULT_RECIPIENTS, DEFAULT_SUBJECT };
