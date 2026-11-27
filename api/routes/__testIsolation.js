// Isolamento de diretório de armazenamento por arquivo de teste.
//
// PROBLEMA
// `recuperarAlbunsNoBoot()` varre TODO o diretório de álbuns. Com
// `--test-concurrency=4`, testes de arquivos diferentes criam fixtures no
// mesmo lugar e enxergam uns aos outros — resultando em falhas intermitentes.
//
// SOLUÇÃO
// Cada arquivo de teste aponta `TRATOCAP_STORAGE_ROOT` para um diretório
// próprio, criado sob o tmp do sistema e removido no encerramento.
//
// Uso — antes de qualquer `require` do router:
//
//     const { criarStorageIsolado } = require("./__testIsolation");
//     const STORAGE = criarStorageIsolado("c11");
//     const ALBUMS = path.join(STORAGE, "tratocap", "albums");
//
// O helper define a variável de ambiente e cria as subpastas esperadas.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let fila = Promise.resolve();

/**
 * Executa `carregar` com exclusividade em relação a outros chamadores.
 *
 * @param {Function} carregar devolve o resultado do require.
 * @returns {Promise<any>}
 */
function comIsolamento(carregar) {
    const vez = fila.then(() => carregar());

    // A fila avança mesmo quando `carregar` lança.
    fila = vez.then(() => {}, () => {});

    return vez;
}

/**
 * Cria um diretório de armazenamento exclusivo para um arquivo de teste e
 * aponta `TRATOCAP_STORAGE_ROOT` para ele.
 *
 * @param {string} prefixo identificador curto do arquivo
 * @returns {string} caminho absoluto da raiz de storage
 */
function criarStorageIsolado(prefixo) {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), `tratocore-${prefixo}-`));

    for (const sub of ["tratocap/albums", "tratocap/temp", "originals", "thumbs", "gallery/albums"]) {
        fs.mkdirSync(path.join(raiz, sub), { recursive: true });
    }

    process.env.TRATOCAP_STORAGE_ROOT = raiz;

    return raiz;
}

module.exports = { comIsolamento, criarStorageIsolado };
