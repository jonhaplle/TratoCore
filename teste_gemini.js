const fs = require('fs');
const path = require('path');
const https = require('https');
const dotenv = require('dotenv');

const ENV_PATH = path.join('C:', 'TratoCore', '.env');
const envResult = dotenv.config({ path: ENV_PATH, override: true });

function mask(value) {
  const s = String(value || '').trim();
  if (!s) return '(vazia)';
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function getValue(key) {
  if (key === 'GEMINI_API_KEY') return String(process.env.GEMINI_API_KEY || '').trim();
  return String(process.env.GEMINI_MODEL || '').trim();
}

function getModels(apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeout: 30000,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(body); } catch (_) {
          return reject(new Error(`Resposta não-JSON da API (HTTP ${res.statusCode}).`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(data?.error?.message || `HTTP ${res.statusCode}`));
        }
        resolve(Array.isArray(data.models) ? data.models : []);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo limite ao consultar o Gemini.')));
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('=============================================');
  console.log('       TESTE GEMINI - TRATOCORE');
  console.log('=============================================');
  console.log(`.env: ${ENV_PATH}`);
  if (envResult.error && !fs.existsSync(ENV_PATH)) {
    console.error('ERRO: C:\\TratoCore\\.env não encontrado.');
    process.exit(1);
  }

  const apiKey = getValue('GEMINI_API_KEY');
  let model = getValue('GEMINI_MODEL') || 'gemini-3.5-flash-lite';

  console.log(`Modelo configurado: ${model}`);
  console.log(`Chave: ${apiKey ? `encontrada (${mask(apiKey)})` : 'NÃO encontrada'}`);

  if (!apiKey) {
    console.error('ERRO: GEMINI_API_KEY não encontrada no C:\\TratoCore\\.env');
    process.exit(2);
  }

  if (model === 'gemini-3.5-flash-lite') {
    console.log('AVISO: gemini-3.5-flash-lite é um modelo antigo para este projeto.');
    console.log('A versão atual do TratoCore prefere gemini-3.5-flash-lite.');
  }

  console.log('');
  console.log('Consultando modelos disponíveis para esta chave...');
  try {
    const models = await getModels(apiKey);
    const usable = models
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean)
      .sort();

    const preferred = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite'
    ];
    const found = preferred.find(m => usable.includes(m));

    console.log('');
    console.log('Modelos compatíveis encontrados:');
    if (!usable.length) console.log('  (nenhum modelo com generateContent foi retornado)');
    else usable.filter(m => /gemini/i.test(m)).forEach(m => console.log(`  - ${m}`));

    console.log('');
    if (found) {
      console.log(`OK: modelo recomendado disponível: ${found}`);
      if (model !== found) console.log(`Recomendação: use GEMINI_MODEL=${found}`);
      process.exit(0);
    }

    console.error('ERRO: não encontrei nenhum dos modelos compatíveis esperados para esta chave.');
    process.exit(3);
  } catch (err) {
    console.error(`ERRO ao consultar Gemini: ${err.message}`);
    process.exit(4);
  }
})();
