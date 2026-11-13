// Testes de getSelectedRoot via uploadBuffer (caminho REAL do worker).
// Intercepta o modulo googleapis: nenhuma chamada de rede e feita.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");

const servicePath = require.resolve("./googleDriveOAuthService");

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const FOTOS_ID = "12aCbRT-QoVKz8bgGgbi6RoDT62yaSnFg";

function carregar({ pastaNoDrive, saved }) {
    const chamadas = { filesGet: [], create: 0 };

    const arquivos = {
        async get({ fileId }) {
            chamadas.filesGet.push(fileId);
            if (!pastaNoDrive) {
                const erro = new Error("File not found.");
                erro.code = 404;
                throw erro;
            }
            return { data: { id: fileId, ...pastaNoDrive } };
        },
        async list() {
            return { data: { files: [] } };
        },
        async create() {
            chamadas.create += 1;
            return { data: { id: "ARQUIVO-CRIADO", name: "foto.jpg", webViewLink: "https://drive/x" } };
        }
    };

    const googleapisFalso = {
        google: {
            auth: {
                OAuth2: class {
                    setCredentials() {}
                    async getAccessToken() { return { token: "token-falso" }; }
                    generateAuthUrl() { return "https://exemplo"; }
                    // google.drive() real assina eventos no cliente
                    on() { return this; }
                    removeListener() { return this; }
                }
            },
            drive() { return { files: arquivos }; }
        }
    };

    const estado = {
        saved: { refreshToken: "refresh-simulado", writeVerifiedAt: new Date(), ...saved }
    };

    const store = {
        async ensureSchema() {},
        async get() { return estado.saved; },
        async saveSelectedFolder() {},
        async markWriteVerified() {},
        async saveRefreshToken() {}
    };

    const originalLoad = Module._load;
    delete require.cache[servicePath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath) {
            if (request === "googleapis") return googleapisFalso;
            if (request === "../db") return { query: async () => ({ rows: [] }) };
            if (request === "./googleDriveOAuthStore") {
                return { createGoogleDriveOAuthStore: () => store };
            }
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let servico;
    try {
        const fabrica = require(servicePath);
        servico = fabrica.createGoogleDriveOAuthService({
            store,
            env: {
                GOOGLE_OAUTH_CLIENT_ID: "cliente-teste",
                GOOGLE_OAUTH_CLIENT_SECRET: "segredo-teste",
                GOOGLE_OAUTH_ENCRYPTION_KEY: "0".repeat(64)
            }
        });
    } finally {
        Module._load = originalLoad;
    }

    return { servico, estado, chamadas };
}

const BYTES = Buffer.from("conteudo-de-imagem-teste");

test("selectedFolderName nulo + ID valido: upload prossegue e acha a pasta", async () => {
    const { servico, chamadas } = carregar({
        pastaNoDrive: { name: "FOTOS", mimeType: FOLDER_MIME_TYPE },
        saved: { selectedFolderId: FOTOS_ID, selectedFolderName: null }
    });

    const resultado = await servico.uploadBuffer(BYTES, "foto.jpg", "image/jpeg", "album-teste", "uuid-1");

    assert.ok(chamadas.filesGet.includes(FOTOS_ID), "consultou a pasta pelo ID");
    assert.ok(resultado?.id, "upload concluido: nao lancou Selecione a pasta FOTOS");
});

test("selectedFolderName divergente do Drive atual nao bloqueia", async () => {
    const { servico, chamadas } = carregar({
        pastaNoDrive: { name: "FOTOS", mimeType: FOLDER_MIME_TYPE },
        saved: { selectedFolderId: FOTOS_ID, selectedFolderName: "Pasta Antiga" }
    });

    const resultado = await servico.uploadBuffer(BYTES, "foto.jpg", "image/jpeg", "album-teste", "uuid-2");

    assert.ok(chamadas.filesGet.includes(FOTOS_ID));
    assert.ok(resultado?.id, "a API do Drive e a fonte final de verdade");
});

test("ID apontando para pasta que NAO e FOTOS continua sendo recusado", async () => {
    const { servico, chamadas } = carregar({
        pastaNoDrive: { name: "OUTRA PASTA", mimeType: FOLDER_MIME_TYPE },
        saved: { selectedFolderId: "outro-id", selectedFolderName: "FOTOS" }
    });

    await assert.rejects(
        () => servico.uploadBuffer(BYTES, "foto.jpg", "image/jpeg", "album-teste", "uuid-3"),
        /não é mais a pasta FOTOS/
    );

    assert.equal(chamadas.create, 0, "nada foi enviado ao Drive");
});

test("selectedFolderId nulo continua recusado (nao sincroniza no escuro)", async () => {
    const { servico } = carregar({
        pastaNoDrive: { name: "FOTOS", mimeType: FOLDER_MIME_TYPE },
        saved: { selectedFolderId: null, selectedFolderName: "FOTOS" }
    });

    await assert.rejects(
        () => servico.uploadBuffer(BYTES, "foto.jpg", "image/jpeg", "album-teste", "uuid-4"),
        /Selecione a pasta FOTOS/
    );
});

test("mimeType que nao e pasta continua recusado", async () => {
    const { servico } = carregar({
        pastaNoDrive: { name: "FOTOS", mimeType: "application/pdf" },
        saved: { selectedFolderId: FOTOS_ID, selectedFolderName: "FOTOS" }
    });

    await assert.rejects(
        () => servico.uploadBuffer(BYTES, "foto.jpg", "image/jpeg", "album-teste", "uuid-5"),
        /não é mais a pasta FOTOS/
    );
});

test("writeVerifiedAt continua obrigatorio (nao foi afrouxado)", async () => {
    const { servico } = carregar({
        pastaNoDrive: { name: "FOTOS", mimeType: FOLDER_MIME_TYPE },
        saved: { selectedFolderId: FOTOS_ID, selectedFolderName: null, writeVerifiedAt: null }
    });

    await assert.rejects(
        () => servico.uploadBuffer(BYTES, "foto.jpg", "image/jpeg", "album-teste", "uuid-6"),
        /Valide a gravação no Google Drive/
    );
});

test("getSelectedRoot nao implementa verificacao automatica de gravacao", () => {
    const src = fs.readFileSync(servicePath, "utf8");
    const inicio = src.indexOf("async function getSelectedRoot");
    const fim = src.indexOf("async function findOrCreateAlbumFolder");

    assert.ok(inicio > 0 && fim > inicio, "funcao localizada no arquivo");

    const trecho = src.slice(inicio, fim);
    assert.ok(!/verifyWrite|markWriteVerified/.test(trecho), "sem verificacao automatica de gravacao");
});
