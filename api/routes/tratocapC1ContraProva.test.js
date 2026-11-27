// CONTRA-PROVA: o teste de concorrência realmente detecta a ausência da trava?
//
// Executa o MESMO cenário do teste de integração contra uma cópia do
// tratocap.js com a trava REMOVIDA. Se o teste for válido, aqui deve
// ocorrer DUAS criações de produto.
//
// Não altera o repositório: a cópia fica em arquivo temporário.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { comIsolamento } = require("./__testIsolation");

const RAIZ = path.join(__dirname, "..", "..");

// A cópia precisa ficar DENTRO do projeto para resolver node_modules
// (multer, sharp, uuid...). Fica ao lado do original e é removida no finally.
const TEMP = path.join(RAIZ, "api", "routes", "__contra_prova_tratocap.tmp.js");

const JPEG = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00, 0x00
]);

test("CONTRA-PROVA: sem a trava, duas importações concorrentes criam DOIS produtos", async () => {
    // Gera a cópia sem trava a partir do fonte atual.
    const fonte = fs.readFileSync(path.join(RAIZ, "api", "routes", "tratocap.js"), "utf8");

    const semTrava = fonte.replace(
        /await comTravaDeAlbum\(album, \(\) =>\s*\r?\n\s*importarAlbum\(album, imported, skipped\)\s*\r?\n\s*\);/,
        "await importarAlbum(album, imported, skipped);"
    );

    assert.notEqual(semTrava, fonte, "a substituição deve ter ocorrido");

    fs.mkdirSync(path.dirname(TEMP), { recursive: true });
    fs.writeFileSync(TEMP, semTrava);

    const estado = {
        produtos: [],
        imagens: [],
        atrasoCriacaoMs: 40,
        criacoes: 0
    };

    const mapa = {};
    const originalLoad = Module._load;

    Module._load = function (request) {
        if (mapa[request]) return mapa[request];
        return originalLoad.apply(this, arguments);
    };

    mapa["sharp"] = () => ({
        metadata: async () => ({ format: "jpeg", width: 100, height: 100 }),
        rotate() { return this; }, resize() { return this; }, webp() { return this; },
        toFile: async (d) => { fs.writeFileSync(d, "t"); return {}; }
    });

    mapa["../services/productService"] = {
        create: async (dados) => {
            estado.criacoes += 1;
            await new Promise(r => setTimeout(r, estado.atrasoCriacaoMs));
            const p = { id: 2000 + estado.produtos.length, ...dados };
            estado.produtos.push(p);
            return p;
        },
        getById: async () => null,
        update: async (id, d) => ({ id, ...d })
    };

    mapa["../services/productImageService"] = {
        create: async (d) => {
            if (d.client_uuid) {
                const ex = estado.imagens.find(i => i.client_uuid === d.client_uuid);
                if (ex) {
                    const e = new Error("duplicate");
                    e.code = "23505";
                    throw e;
                }
            }
            const img = { id: estado.imagens.length + 1, ...d };
            estado.imagens.push(img);
            return img;
        },
        getByProductId: async (id) => estado.imagens.filter(i => String(i.product_id) === String(id)),
        getByClientUuid: async (u) => estado.imagens.find(i => i.client_uuid === u) || null
    };

    mapa["../services/tratocapSyncQueue.service"] = {
        ensureSchema: async () => {},
        getUnimportedProductImages: async () => [],
        getByClientUuid: async () => null,
        markAlbumImported: async () => {}
    };

    mapa["../services/listingPreparation.service"] = { prepare: async () => null, prepareListing: async () => null };
    mapa["../services/googleDriveOAuthService"] = {
        createGoogleDriveOAuthService: () => ({
            getFileMetadata: async () => ({ mimeType: "image/jpeg" }),
            getFileStream: async () => ({ on() {}, pipe() {} })
        })
    };

    const nome = "contra-prova-sem-trava";
    const raizAlbuns = path.join(RAIZ, "storage", "tratocap", "albums");
    const dir = path.join(raizAlbuns, nome);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "f.jpg"), JPEG);
    fs.writeFileSync(
        path.join(dir, "f.jpg.json"),
        JSON.stringify({ client_uuid: `uuid-contra-${Date.now()}`, sha256: "h" })
    );

    let router;

    try {
        delete require.cache[TEMP];
        router = await comIsolamento(() => require(TEMP));
    } finally {
        Module._load = originalLoad;
    }

    try {
        await Promise.all([
            router.importAlbums(nome),
            router.importAlbums(nome)
        ]);

        // Sem a trava, o atraso de 40 ms permite a segunda entrada criar
        // outro produto antes de a primeira gravar o marcador.
        assert.equal(estado.produtos.length, 2,
            "SEM a trava o cenário DEVE duplicar — se não duplicou, o teste não prova nada");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(TEMP, { force: true });
    }
});
