const fs = require('fs');
const axios = require('axios');

const ENV_PATH = 'C:\\TratoCore\\.env';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) throw new Error(`Arquivo nao encontrado: ${ENV_PATH}`);
  const values = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+)=(.*)\s*$/);
    if (m) values[m[1].trim()] = m[2].trim();
  }
  return values;
}

function extractText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  return (data?.steps || [])
    .filter(s => s?.type === 'model_output')
    .flatMap(s => Array.isArray(s.content) ? s.content : [])
    .filter(c => c?.type === 'text')
    .map(c => String(c.text || ''))
    .join('')
    .trim();
}

(async () => {
  try {
    const env = loadEnv();
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente em C:\\TratoCore\\.env');

    const listing = await axios.get(MODELS_URL, {
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
      timeout: 30000
    });

    const available = (listing.data?.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''));

    const candidates = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.5-flash'
    ];
    const model = candidates.find(m => available.includes(m));
    if (!model) throw new Error('Nenhum dos modelos recomendados foi retornado para esta chave.');

    console.log(`Modelo para o teste: ${model}`);
    console.log('Chamando Interactions API...');

    const response = await axios.post(INTERACTIONS_URL, {
      model,
      input: 'Responda somente: OK',
      store: false,
      generation_config: {
        max_output_tokens: 20,
        thinking_level: 'minimal'
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
        'Api-Revision': '2026-05-20'
      },
      timeout: 120000
    });

    console.log(`HTTP: ${response.status}`);
    console.log(`Resposta: ${extractText(response.data) || '(vazia)'}`);
    console.log('GEMINI INTERACTIONS OK.');
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.message;
    console.error(`GEMINI INTERACTIONS FALHOU${status ? ` (${status})` : ''}: ${msg}`);
    process.exit(1);
  }
})();
