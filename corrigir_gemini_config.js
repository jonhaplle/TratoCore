const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join('C:', 'TratoCore', '.env');
if (!fs.existsSync(envPath)) {
  console.error(`Arquivo não encontrado: ${envPath}`);
  process.exit(1);
}

let text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/);
let modelWritten = false;
let keyPresent = false;

const out = lines.map(line => {
  if (/^\s*GEMINI_API_KEY\s*=/.test(line)) {
    keyPresent = line.replace(/^\s*GEMINI_API_KEY\s*=\s*/, '').trim().length > 0;
    return line;
  }
  if (/^\s*GEMINI_MODEL\s*=/.test(line)) {
    modelWritten = true;
    return 'GEMINI_MODEL=gemini-3.5-flash-lite';
  }
  return line;
});

if (!modelWritten) out.push('GEMINI_MODEL=gemini-3.5-flash-lite');

if (!keyPresent) {
  console.error('ERRO: GEMINI_API_KEY não encontrada ou está vazia em C:\\TratoCore\\.env');
  process.exit(2);
}

fs.writeFileSync(envPath, out.join('\r\n').replace(/\r?\n*$/, '\r\n'), 'utf8');
console.log('OK: GEMINI_MODEL ajustado para gemini-3.5-flash-lite.');
console.log('OK: GEMINI_API_KEY presente no .env.');
