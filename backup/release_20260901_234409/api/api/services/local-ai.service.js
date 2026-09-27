const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ============================================================
// GEMINI AI - TratoCore
// Mantemos o mesmo módulo/exports usados pelo frontend e pelas
// rotas para não quebrar o restante do TratoCore.
// ============================================================

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function getGeminiModel() {
  const configured = String(process.env.GEMINI_MODEL || '').trim();
  if (!configured || configured === 'gemini-2.5-flash-lite' || configured === 'gemini-flash-lite-latest') {
    return 'gemini-3.5-flash-lite';
  }
  return configured.replace(/^models\//, '').trim();
}

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODEL_CANDIDATES = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash'
];

let resolvedModelCache = null;

const REGRAS_COMERCIAIS = `
REGRAS COMERCIAIS DO TRATOCORE — VERDADE ACIMA DA PERSUASÃO.

A observação do vendedor é uma fonte válida de dados declarados.
Quando o vendedor informar explicitamente condição, teste, funcionamento, característica, acessório, defeito, marca, modelo ou outro dado, incorpore diretamente essa informação.
NUNCA escreva "segundo o vendedor", "o vendedor informa" ou equivalentes.

Nunca invente marca, modelo, geração, versão, especificação, medida, potência, voltagem, capacidade, acessório, defeito, reparo ou funcionamento.
"Testado" não significa que todas as funções foram testadas.
"Funcionando" não significa que todas as funções foram testadas.

A fotografia é a fonte visual primária. A pesquisa visual é fonte auxiliar.
Não transforme hipótese em fato.
Se houver conflito, registre a dúvida e reduza a confiança.
Não mencione IA, vendedor, proprietário, fotografia ou processo de análise no anúncio.
`;

function cleanJson(text) {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function requireKey() {
  if (!getGeminiApiKey()) {
    throw new Error('GEMINI_API_KEY não configurada. Crie uma chave no Google AI Studio e coloque GEMINI_API_KEY=... no arquivo .env do TratoCore.');
  }
}

async function listAvailableModels() {
  requireKey();
  const response = await axios.get(GEMINI_MODELS_URL, {
    headers: { 'x-goog-api-key': getGeminiApiKey() },
    timeout: 30000
  });
  const models = Array.isArray(response.data?.models) ? response.data.models : [];
  return models
    .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, '').trim())
    .filter(Boolean);
}

async function resolveGeminiModel() {
  if (resolvedModelCache) return resolvedModelCache;
  const configured = getGeminiModel();
  try {
    const available = await listAvailableModels();
    const ordered = [configured, ...MODEL_CANDIDATES].filter((v, i, a) => v && a.indexOf(v) === i);
    const selected = ordered.find(model => available.includes(model));
    if (selected) {
      resolvedModelCache = selected;
      return selected;
    }
  } catch (_) {
    // A listagem pode falhar temporariamente. Tentamos o modelo configurado.
  }
  return configured;
}

function extractInteractionText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  return steps
    .filter(step => step?.type === 'model_output')
    .flatMap(step => Array.isArray(step.content) ? step.content : [])
    .filter(block => block?.type === 'text')
    .map(block => String(block.text || ''))
    .join('')
    .trim();
}

async function createInteraction(model, prompt, imageBase64 = null, mime = 'image/jpeg') {
  const input = [];

  if (imageBase64) {
    input.push({
      type: 'image',
      mime_type: mime,
      data: imageBase64
    });
  }

  input.push({ type: 'text', text: prompt });

  const response = await axios.post(
    GEMINI_INTERACTIONS_URL,
    {
      model,
      input,
      store: false,
      generation_config: {
        max_output_tokens: 5000,
        thinking_level: 'minimal'
      },
      response_format: {
        type: 'text',
        mime_type: 'application/json'
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': getGeminiApiKey(),
        'Api-Revision': '2026-05-20'
      },
      timeout: 180000
    }
  );

  const text = extractInteractionText(response.data);
  if (!text) {
    throw new Error('O Gemini não retornou conteúdo na Interactions API.');
  }

  return text;
}

async function gemini(prompt, imageBase64 = null, mime = 'image/jpeg') {
  requireKey();

  let model = await resolveGeminiModel();
  let lastError = null;

  const candidates = [model, ...MODEL_CANDIDATES]
    .filter((v, i, a) => v && a.indexOf(v) === i);

  for (const candidate of candidates) {
    try {
      const text = await createInteraction(candidate, prompt, imageBase64, mime);
      resolvedModelCache = candidate;
      return text;
    } catch (e) {
      lastError = e;
      const status = e.response?.status;
      const message = String(e.response?.data?.error?.message || '').toLowerCase();

      // Só fazemos fallback automático para erros de modelo/capacidade.
      // Erros de chave ou de solicitação são devolvidos imediatamente.
      const shouldTryNext =
        status === 404 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        message.includes('high demand') ||
        message.includes('temporarily') ||
        message.includes('overloaded');

      if (!shouldTryNext) break;
      resolvedModelCache = null;
    }
  }

  const apiMessage = lastError?.response?.data?.error?.message;
  const status = lastError?.response?.status;

  if (status === 400) {
    throw new Error(`Gemini recusou a solicitação: ${apiMessage || lastError.message}`);
  }
  if (status === 401 || status === 403) {
    throw new Error(`Chave do Gemini inválida ou sem permissão: ${apiMessage || lastError.message}`);
  }
  if (status === 429) {
    throw new Error(`Limite ou capacidade do Gemini atingida. O TratoCore tentou os modelos compatíveis disponíveis. ${apiMessage || ''}`.trim());
  }
  if (status === 404) {
    throw new Error(`Nenhum modelo Gemini compatível respondeu pela Interactions API. ${apiMessage || lastError.message}`);
  }
  throw new Error(`Erro na Interactions API do Gemini: ${apiMessage || lastError?.message || 'erro desconhecido'}`);
}

function normalizeResult(resultado) {
  const id = resultado.identification || {};
  const conf = resultado.confidence || {};
  const draft = resultado.listing_draft || {};
  const parts = [id.brand, id.line, id.model, id.generation, id.product_type, id.color]
    .map(v => String(v || '').trim()).filter(Boolean);

  let title = String(draft.title || resultado.title || parts.join(' ') || '').trim();
  if (!title && Array.isArray(resultado.facts) && resultado.facts.length) {
    title = String(id.product_type || 'Produto identificado').trim();
  }

  const description = String(
    draft.description || resultado.description ||
    (Array.isArray(resultado.facts) ? resultado.facts.slice(0, 6).join(' ') : '')
  ).trim();

  const price = Number(draft.suggested_price ?? resultado.suggested_price ?? 0);

  return {
    ...resultado,
    product_type: id.product_type || '',
    brand: id.brand || '',
    line: id.line || '',
    model: id.model || '',
    generation: id.generation || '',
    version: id.version || '',
    color: id.color || '',
    condition: id.condition || '',
    confidence: Number(conf.score || 0),
    confidence_details: conf,
    title,
    description,
    suggested_price: Number.isFinite(price) ? price : 0,
    category: String(draft.category || resultado.category || '').trim()
  };
}

async function analisarImagem(imagePath, pesquisaVisual = null, observacaoVendedor = '') {
  const full = path.resolve(imagePath);
  if (!fs.existsSync(full)) throw new Error('Imagem não encontrada.');

  const ext = path.extname(full).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const base64 = fs.readFileSync(full, 'base64');

  const pesquisa = pesquisaVisual
    ? JSON.stringify({
        provider: pesquisaVisual.provider,
        search_url: pesquisaVisual.search_url,
        text: pesquisaVisual.text,
        links: pesquisaVisual.links
      })
    : 'Nenhuma pesquisa visual disponível.';

  const prompt = `Você é o cérebro de identificação e preparação de anúncios do TratoCore.

${REGRAS_COMERCIAIS}

A fotografia é a fonte visual primária. Cruze-a com a pesquisa visual auxiliar.
Se a observação do vendedor declarar explicitamente marca/modelo/linha/geração/versão ou condição, preserve como informação declarada.

REGRAS OBRIGATÓRIAS:
1. Nunca transforme hipótese em fato.
2. Não invente código, GTIN ou especificação.
3. Se houver conflito entre fontes, registre em contradictions/unresolved.
4. A categoria é apenas sugestão textual; a categoria oficial será resolvida pelo Publication Engine.
5. O preço sugerido é estimativa comercial; use 0 quando não houver base.
6. O título deve ser objetivo e adequado ao Mercado Livre.
7. Se marca/modelo não forem confirmados nem declarados, use o tipo de produto e características confirmadas.
8. Retorne SOMENTE JSON válido, sem markdown.

ESTRUTURA EXATA:
{
  "identification": {"product_type":"","brand":"","line":"","model":"","generation":"","version":"","color":"","condition":""},
  "facts": [],
  "hypotheses": [],
  "evidence": [],
  "cross_check": {"confirmed":[],"contradictions":[],"unresolved":[]},
  "confidence": {"score":0,"level":"LOW","reasons":[]},
  "catalog_input": {"search_terms":[],"product_type":"","brand":"","line":"","model":"","generation":""},
  "decision": {"status":"PROVISIONAL","reason":""},
  "listing_draft": {"title":"","description":"","suggested_price":0,"category":""}
}

OBSERVAÇÃO DO VENDEDOR:
${observacaoVendedor || 'nenhuma'}

PESQUISA VISUAL:
${pesquisa}`;

  const text = await gemini(prompt, base64, mime);

  try {
    return normalizeResult(JSON.parse(cleanJson(text)));
  } catch (e) {
    throw new Error('O Gemini retornou um JSON inválido.');
  }
}

async function buildListing({ identification, facts, cross_check, catalogMatch, sellerObservation = '' }) {
  const prompt = `Você é o COPYWRITER DO TRATOCORE para Mercado Livre.

${REGRAS_COMERCIAIS}

Escreva como um vendedor experiente de produtos usados, eletrônicos, videogames, antiguidades e peças de coleção. Seja comercial e convincente, porém factual.

O anúncio deve:
- destacar o que realmente torna a peça interessante;
- usar marca/modelo quando sustentados;
- informar condição e funcionamento somente quando sustentados;
- tratar marcas de uso de forma objetiva, sem dramatizar;
- não esconder defeitos ou limitações relevantes;
- nunca inventar acessórios ou características;
- nunca mencionar IA, análise visual ou processo de identificação;
- incorporar diretamente a observação do vendedor.

RETORNE SOMENTE JSON VÁLIDO:
{"title":"","description":"","suggested_price":0,"category":""}

IDENTIFICAÇÃO:
${JSON.stringify(identification || {})}

FATOS:
${JSON.stringify(facts || [])}

CRUZAMENTO:
${JSON.stringify(cross_check || {})}

CATÁLOGO:
${JSON.stringify(catalogMatch || null)}

OBSERVAÇÃO DO VENDEDOR:
${sellerObservation || 'nenhuma'}`;

  const text = await gemini(prompt);
  try {
    const r = JSON.parse(cleanJson(text));
    return {
      title: String(r.title || '').trim(),
      description: String(r.description || '').trim(),
      suggested_price: Number(r.suggested_price || 0),
      category: String(r.category || '').trim()
    };
  } catch {
    throw new Error('O Gemini retornou um rascunho inválido.');
  }
}

async function improveListing(data) {
  const prompt = `Melhore o anúncio abaixo para Mercado Livre.
${REGRAS_COMERCIAIS}
Mantenha estritamente os fatos fornecidos. Não invente nada.
Retorne SOMENTE JSON válido: {"title":"","description":"","suggested_price":0,"category":""}
DADOS: ${JSON.stringify(data || {})}`;

  const text = await gemini(prompt);
  try {
    return JSON.parse(cleanJson(text));
  } catch {
    throw new Error('O Gemini retornou uma correção inválida.');
  }
}


async function inferBrandModel(imagePath, context = {}) {
  requireKey();
  const full = path.resolve(imagePath);
  if (!fs.existsSync(full)) throw new Error('Imagem não encontrada para identificação de marca/modelo.');

  const ext = path.extname(full).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const base64 = fs.readFileSync(full, 'base64');

  const prompt = `Você é o módulo de preenchimento automático do TratoCore para publicação no Mercado Livre.\n\n${REGRAS_COMERCIAIS}\n\nObjetivo: identificar SOMENTE marca e modelo quando houver evidência suficiente na foto, texto visível na foto ou contexto fornecido.\n\nREGRAS ESPECÍFICAS:\n- Não invente marca ou modelo.\n- NUNCA use o tipo do produto como marca. Exemplos: "abridor de garrafa", "controle", "televisão", "rádio" NÃO são marcas.\n- NUNCA use cor, material, função ou categoria como marca.\n- Não use "Genérica", "Vintage", "Universal", "Sem marca" ou similares como marca, a menos que isso esteja explicitamente escrito no produto/embalagem.\n- Se a marca não estiver clara, retorne marca vazia.\n- Se o modelo não estiver claro, retorne modelo vazio.\n- Se houver texto parcial, use somente o que estiver realmente legível.\n- Se apenas a linha estiver identificável, retorne a linha e deixe modelo vazio.\n- Retorne SOMENTE JSON válido.\n\nCONTEXTO DO PRODUTO:\n${JSON.stringify({ title: context.title || '', description: context.description || '', seller_observation: context.seller_observation || '', current_brand: context.brand || '', current_model: context.model || '' })}\n\nFORMATO:\n{"brand":"","model":"","line":"","generation":"","confidence":0,"evidence":[],"reason":""}`;

  const text = await gemini(prompt, base64, mime);
  try {
    const r = JSON.parse(cleanJson(text));
    return {
      brand: String(r.brand || '').trim(),
      model: String(r.model || '').trim(),
      product_type: String(r.product_type || '').trim(),
      line: String(r.line || '').trim(),
      generation: String(r.generation || '').trim(),
      confidence: Number(r.confidence || 0),
      evidence: Array.isArray(r.evidence) ? r.evidence : [],
      reason: String(r.reason || '').trim()
    };
  } catch {
    throw new Error('O Gemini retornou uma identificação de marca/modelo inválida.');
  }
}

async function status() {
  const key = getGeminiApiKey();
  if (!key) {
    return {
      online: false,
      provider: 'Gemini API',
      model: getGeminiModel(),
      vision_model: getGeminiModel(),
      copywriter_model: getGeminiModel(),
      vision_ready: false,
      configured: false
    };
  }

  let model = getGeminiModel();
  let modelsCount = null;
  try {
    const available = await listAvailableModels();
    modelsCount = available.length;
    const selected = [model, ...MODEL_CANDIDATES].find(m => available.includes(m));
    if (selected) {
      model = selected;
      resolvedModelCache = selected;
    }
  } catch (_) {}

  return {
    online: true,
    provider: 'Gemini API',
    model,
    vision_model: model,
    copywriter_model: model,
    vision_ready: true,
    configured: true,
    models_available: modelsCount
  };
}

module.exports = { analisarImagem, buildListing, improveListing, inferBrandModel, status };
