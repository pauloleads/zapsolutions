// server.js - BUNKER V5.5 - DECODIFICADOR DE BOTÃO ATIVADO
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const axios = require('axios');
const path = require('path');
const app = express();

// --- CONSTANTES DE COMANDO ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;
const URL_DA_IMAGEM_DO_HEADER = "https://pauloleads.com.br/wp-content/uploads/2025/10/300000.png";

// --- MIDDLEWARES ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let db;

// --- FUNÇÃO DE DISPARO (A BOCA) ---
async function sendWhatsAppMessage(data) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  try {
    const response = await axios.post(url, data, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
    });
    console.log(`✅ Comando de envio executado para: ${data.to}`);

    const content = data.type === 'template' ? `Template: ${data.template.name}` : data.text.body;
    await db.run(
      `INSERT INTO messages (lead_phone, direction, type, content) VALUES (?, 'outbound', ?, ?)`,
      [data.to, data.type, content]
    );
    console.log(`✅ Mensagem [outbound] salva no histórico de ${data.to}`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`❌ FALHA NO DISPARO para ${data.to}:`, JSON.stringify(error.response?.data, null, 2));
    return { success: false, error: error.response?.data || error.message };
  }
}

// --- INICIALIZAÇÃO DO BANCO (O ARSENAL) ---
(async () => {
  try {
    const dbPath = path.join(__dirname, 'leads.db');
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    console.log(`✅ Conectado ao banco de dados SQLite: ${dbPath}`);

    await db.exec(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, name TEXT, status TEXT DEFAULT 'novo', last_message_at DATETIME)`);
    console.log("📊 Tabela 'leads' (com status) verificada.");

    await db.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_phone TEXT NOT NULL, wa_message_id TEXT, direction TEXT NOT NULL, type TEXT NOT NULL, content TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (lead_phone) REFERENCES leads (phone) ON DELETE CASCADE)`);
    console.log("📊 Tabela 'messages' verificada.");

  } catch (err) {
    console.error("❌ ERRO FATAL AO INICIAR BANCO:", err.message);
    process.exit(1);
  }
})();

// --- ROTAS DO WEBHOOK (OS OLHOS) ---
app.get('/webhook', (req, res) => {
  console.log("➡️ GET /webhook recebido para verificação.");
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ SUCESSO: Webhook verificado pelo Meta!');
    res.status(200).send(challenge);
  } else {
    console.log(`❌ FALHA: Token de verificação NÃO BATEU! (Recebido: ${token})`);
    res.sendStatus(403);
  }
});

// 🔥 POST /webhook (INTELIGÊNCIA DE TRIAGEM V5.5 - DECODIFICADOR) 🔥
app.post('/webhook', async (req, res) => {
  console.log("➡️ POST /webhook recebido (nova mensagem).");
  res.sendStatus(200);
  const body = req.body;

  try {
    if (body.object && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const value = body.entry[0].changes[0].value;
      const message = value.messages[0];
      const contact = value.contacts?.[0];
      const from = message.from;
      const name = contact?.profile?.name || 'Cliente';
      const wa_message_id = message.id;

      let messageType = message.type;
      let messageContent = `(${messageType})`; // Padrão

      // 1. Interpreta o que o trouxa mandou
      if (messageType === 'text') {
          messageContent = message.text.body;

      // 🔥 CORREÇÃO V5.5 (O DECODIFICADOR DE BOTÃO DE TEMPLATE)
      } else if (messageType === 'button') {
          messageContent = `(Botão: "${message.button.text}" | Payload: ${message.button.payload})`;
          messageType = 'button_click'; // Padroniza o tipo
      // 🔥 FIM DA CORREÇÃO

      } else if (messageType === 'interactive') {
          if (message.interactive?.button_reply) {
              messageContent = `(Botão: "${message.interactive.button_reply.title}" | ID: ${message.interactive.button_reply.id})`;
              messageType = 'button_click';
          } else if (message.interactive?.list_reply) {
              messageContent = `(Lista: "${message.interactive.list_reply.title}" | ID: ${message.interactive.list_reply.id})`;
              messageType = 'list_click';
          }
      } else if (messageType === 'reaction') {
          messageContent = `(Reação: ${message.reaction.emoji})`;
      } else if (['image', 'audio', 'video', 'document'].includes(messageType)) {
          messageContent = message[messageType].id; // Salva o ID da Mídia
      }

      console.log(`📬 MENSAGEM RECEBIDA: ${name} (${from}) -> Tipo: ${messageType} | Conteúdo: "${messageContent}"`);

      // 2. Atualiza o Lead para 'respondido'
      await db.run(
        `INSERT INTO leads (phone, name, last_message_at, status) VALUES (?, ?, CURRENT_TIMESTAMP, 'respondido')
         ON CONFLICT(phone) DO UPDATE SET name = excluded.name, last_message_at = CURRENT_TIMESTAMP, status = 'respondido'`,
        [from, name]
      );

      // 3. Salva a MENSAGEM INTERPRETADA no histórico
      await db.run(
        `INSERT INTO messages (lead_phone, wa_message_id, direction, type, content) VALUES (?, ?, 'inbound', ?, ?)`,
        [from, wa_message_id, messageType, messageContent]
      );

      console.log(`✅ Mensagem de ${name} salva no banco. Status: respondido.`);
    } else {
      console.log("🔌 Evento de webhook (não-mensagem) recebido. Ignorando.");
    }
  } catch (error) {
    console.error("💥 ERRO CRÍTICO ao processar webhook POST:", error.message);
  }
});

// --- API DA TORRE DE COMANDO (AS MÃOS) ---

app.get('/api/leads', async (req, res) => {
  try {
    const leads = await db.all(`SELECT * FROM leads ORDER BY CASE status WHEN 'respondido' THEN 1 ELSE 2 END, last_message_at DESC`);
    res.json({ leads: leads });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/leads/:phone/mark_read', async (req, res) => {
    const { phone } = req.params;
    try {
        await db.run(`UPDATE leads SET status = 'lido' WHERE phone = ?`, [phone]);
        res.json({ success: true, message: "Marcado como lido." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/leads/:phone/messages', async (req, res) => {
  try {
    const { phone } = req.params;
    const messages = await db.all('SELECT * FROM messages WHERE lead_phone = ? ORDER BY timestamp ASC', [phone]);
    res.json(messages); // ENVIA O ARRAY PURO
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ROTA DE MÍDIA
app.get('/api/media/:media_id', async (req, res) => {
    const { media_id } = req.params;
    console.log(`➡️ GET /api/media/${media_id} solicitado.`);
    try {
        const urlResponse = await axios.get(`https://graph.facebook.com/v19.0/${media_id}`, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
        });
        const mediaUrl = urlResponse.data.url;
        if (!mediaUrl) throw new Error("Meta não retornou URL de mídia.");
        console.log(`⬇️  Baixando mídia da URL temporária...`);
        const mediaResponse = await axios.get(mediaUrl, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
            responseType: 'stream'
        });
        res.setHeader('Content-Type', mediaResponse.headers['content-type']);
        mediaResponse.data.pipe(res);
    } catch (error) {
        console.error(`❌ FALHA AO BUSCAR MÍDIA ${media_id}:`, JSON.stringify(error.response?.data, null, 2));
        res.status(500).json({ error: "Falha ao buscar mídia" });
    }
});

// ROTA DE ENVIO DE TEXTO (Manual e Pitch)
app.post('/api/send/text', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'Phone e message são obrigatórios' });
  const data = { messaging_product: "whatsapp", to: phone, type: "text", text: { body: message } };
  const result = await sendWhatsAppMessage(data);
  if (result.success) res.json({ success: true, message: "Comando de texto enviado." });
  else res.status(500).json({ success: false, error: "Falha no envio (ver log)" });
});

// ROTA DE CAÇA (Template)
app.post('/api/hunt/template', async (req, res) => {
    const { phone, name, templateName } = req.body;
    if (!phone || !templateName) return res.status(400).json({ error: 'Phone e templateName são obrigatórios' });
    const leadName = name || 'Alvo Frio';
    try {
      await db.run(
        `INSERT INTO leads (phone, name, last_message_at, status) VALUES (?, ?, CURRENT_TIMESTAMP, 'contatado')
         ON CONFLICT(phone) DO UPDATE SET name = excluded.name, last_message_at = CURRENT_TIMESTAMP, status = 'contatado'`,
        [phone, leadName]
      );
    } catch (dbError) {
      return res.status(500).json({ success: false, error: "Erro de banco de dados" });
    }

    // Lógica de Disparo (Com ou Sem Imagem)
    const templatesComImagem = ['primeiro', 'segundo', 'terceiro'];
    let data;

    if (templatesComImagem.includes(templateName)) {
        console.log(`🏹 Caçando ${phone} com Template (COM IMAGEM): ${templateName}`);
        data = {
            messaging_product: "whatsapp", to: phone, type: "template",
            template: {
                name: templateName, language: { code: "pt_BR" },
                components: [{"type": "header", "parameters": [{"type": "image", "image": { "link": URL_DA_IMAGEM_DO_HEADER }}]}]
            }
        };
    } else {
        console.log(`🏹 Caçando ${phone} com Template (SECO): ${templateName}`);
        data = {
            messaging_product: "whatsapp", to: phone, type: "template",
            template: { name: templateName, language: { code: "pt_BR" } }
        };
    }

    const result = await sendWhatsAppMessage(data);
    if (result.success) res.json({ success: true, message: `Caça iniciada para ${phone}.` });
    else res.status(500).json({ success: false, error: "Falha no envio (ver log)" });
});

// ROTA DE FILTRO EM MASSA
app.post('/api/hunt/batch_filter', async (req, res) => {
    const { phones } = req.body;
    if (!Array.isArray(phones)) return res.status(400).json({ error: "O corpo da requisição deve ser um array de 'phones'." });
    try {
        const existingLeads = await db.all('SELECT phone FROM leads');
        const existingPhones = new Set(existingLeads.map(l => l.phone));
        const uniqueNewPhones = [...new Set(phones)];
        const cleanList = uniqueNewPhones.filter(p => !existingPhones.has(p));
        res.json({ cleanList, totalEntrada: phones.length, totalUnicos: uniqueNewPhones.length, totalFiltrados: cleanList.length, totalRejeitados: uniqueNewPhones.length - cleanList.length });
    } catch (err) {
        res.status(500).json({ error: "Erro interno no filtro de lote" });
    }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(PORT, () => {
  console.log(`\n🚀 BUNKER V5.5 (DECODIFICADOR) ONLINE!`);
  console.log(`👂 Escutando na porta: ${PORT}`);
  console.log(`🔗 Webhook: http://localhost:${PORT}/webhook`);
  console.log(`📡 API: http://localhost:${PORT}/api/leads`);
  console.log(`🖥️  Torre de Comando: http://[SEU_IP_WSL]:${PORT}`);
});

// --- ENCERRAMENTO GRACIOSO ---
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM recebido. Encerrando o bunker...');
    try {
        await db.close();
        console.log('✅ Banco de dados fechado.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Erro ao fechar banco de dados:', err.message);
        process.exit(1);
    }
});
