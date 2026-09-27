const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client } = require('pg');

function loadEnv(file) {
  if (!fs.existsSync(file)) throw new Error(`.env não encontrado: ${file}`);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return env;
}

function mask(v) {
  return v ? `${String(v).slice(0, 6)}...${String(v).slice(-4)}` : '(ausente)';
}

(async () => {
  const root = 'C:\\TratoCore';
  const env = loadEnv(path.join(root, '.env'));
  console.log('============================================');
  console.log('TRATOCORE - DIAGNOSTICO PUBLICACAO ML');
  console.log('============================================');
  console.log(`DB_HOST: ${env.DB_HOST || '(ausente)'}`);
  console.log(`DB_PORT: ${env.DB_PORT || '(ausente)'}`);
  console.log(`DB_NAME: ${env.DB_NAME || '(ausente)'}`);
  console.log(`ML_CLIENT_ID: ${mask(env.ML_CLIENT_ID)}`);
  console.log(`ML_REDIRECT_URI: ${env.ML_REDIRECT_URI || '(ausente)'}`);

  const client = new Client({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME || 'tratocore',
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || ''
  });

  await client.connect();
  console.log('POSTGRES: OK');

  const r = await client.query(`
    SELECT user_id, access_token, refresh_token, expires_in, created_at, scope
    FROM ml_tokens
    ORDER BY created_at DESC
    LIMIT 1
  `);

  if (!r.rows.length) {
    console.log('ML TOKEN: AUSENTE');
    await client.end();
    process.exitCode = 2;
    return;
  }

  const token = r.rows[0];
  console.log(`ML TOKEN: encontrado (user_id ${token.user_id})`);
  console.log(`ML TOKEN CRIADO: ${token.created_at}`);
  console.log(`ML SCOPE: ${token.scope || '(não informado)'}`);

  try {
    const me = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      timeout: 30000
    });
    console.log(`ML /users/me: OK (id ${me.data?.id || '?'}, nickname ${me.data?.nickname || '?'})`);
  } catch (e) {
    console.log(`ML /users/me: FALHOU HTTP ${e.response?.status || 'N/A'}`);
    console.log(JSON.stringify(e.response?.data || { message: e.message }, null, 2));
    await client.end();
    process.exitCode = 3;
    return;
  }

  try {
    const cats = await axios.get('https://api.mercadolibre.com/sites/MLB/domain_discovery/search', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      params: { limit: 1, q: 'controle xbox' },
      timeout: 30000
    });
    console.log(`ML domain discovery: OK (${Array.isArray(cats.data) ? cats.data.length : 'não-array'} resultado(s))`);
  } catch (e) {
    console.log(`ML domain discovery: FALHOU HTTP ${e.response?.status || 'N/A'}`);
    console.log(JSON.stringify(e.response?.data || { message: e.message }, null, 2));
  }

  try {
    const items = await axios.get(`https://api.mercadolibre.com/users/${token.user_id}/items/search`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      params: { limit: 1 },
      timeout: 30000
    });
    console.log(`ML items/search: OK (${Array.isArray(items.data?.results) ? items.data.results.length : 'sem results'})`);
  } catch (e) {
    console.log(`ML items/search: FALHOU HTTP ${e.response?.status || 'N/A'}`);
    console.log(JSON.stringify(e.response?.data || { message: e.message }, null, 2));
  }

  await client.end();
  console.log('============================================');
  console.log('DIAGNOSTICO FINALIZADO');
  console.log('============================================');
})().catch(err => {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
});
