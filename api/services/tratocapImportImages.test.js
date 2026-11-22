// Teste REAL de regressão: a proteção HTTP de product-images interfere na
// criação interna de imagens pelo TratoCap?
//
// Não usa banco: substitui o model ProductImage por uma versão em memória,
// então exercita o ProductImageService.create de verdade (validação,
// normalização, chamada ao model), que é o caminho usado pela importação.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");

// Intercepta o model ANTES de o service carregar.
const caminhoModel = require.resolve(
    path.join(RAIZ, "api", "models", "productImageModel")
);

const gravadas = [];
require.cache[caminhoModel] = {
    id: caminhoModel,
    filename: caminhoModel,
    loaded: true,
    exports: {
        async create(dados) {
            const registro = { id: gravadas.length + 1, ...dados };
            gravadas.push(registro);
            return registro;
        },
        async getByProductId() { return gravadas; }
    }
};

const ProductImageService = require(path.join(RAIZ, "api", "services", "productImageService"));

test("ProductImageService.create grava imagem sem exigir chave administrativa", async () => {
    // Garante que nenhuma chave está configurada nesse contexto.
    const anterior = process.env.TRATO_VENDEDOR_ADMIN_KEY;
    delete process.env.TRATO_VENDEDOR_ADMIN_KEY;

    try {
        const imagem = await ProductImageService.create({
            product_id: 42,
            file_name: "album-01.jpg",
            original_url: "/storage/originals/album-01.jpg",
            thumb_url: "/storage/thumbs/album-01.webp",
            mime_type: "image/jpeg",
            width: 800,
            height: 600,
            file_size: 123456,
            is_main: true,
            sort_order: 1
        });

        assert.ok(imagem, "imagem deve ser criada");
        assert.equal(imagem.product_id, 42);
        assert.equal(imagem.is_main, true);
        assert.equal(gravadas.length, 1);
    } finally {
        if (anterior !== undefined) process.env.TRATO_VENDEDOR_ADMIN_KEY = anterior;
    }
});

test("criação de várias imagens (como na importação de álbum) funciona", async () => {
    const antes = gravadas.length;

    for (let i = 0; i < 3; i++) {
        await ProductImageService.create({
            product_id: 43,
            file_name: `album-0${i}.jpg`,
            original_url: `/storage/originals/album-0${i}.jpg`,
            thumb_url: `/storage/thumbs/album-0${i}.webp`,
            mime_type: "image/jpeg",
            width: 100, height: 100, file_size: 1000,
            is_main: i === 0,
            sort_order: i + 1
        });
    }

    assert.equal(gravadas.length - antes, 3);

    const principais = gravadas.filter(g => g.product_id === 43 && g.is_main);
    assert.equal(principais.length, 1, "apenas uma imagem principal por produto");
});

test("a importação chama o service, não a rota HTTP", () => {
    const fs = require("node:fs");

    const importacao = fs.readFileSync(
        path.join(RAIZ, "api", "services", "tratocapImport.service.js"), "utf8"
    );

    assert.match(importacao, /ProductImageService\.create\(/);
    assert.ok(!importacao.includes("/api/product-images"),
        "a importação nunca deve usar a rota HTTP protegida");
});

test("a rota do TratoCap também usa o service", () => {
    const fs = require("node:fs");

    const tratocap = fs.readFileSync(path.join(RAIZ, "api", "routes", "tratocap.js"), "utf8");

    assert.match(tratocap, /ProductImageService\.create\(/);
});

test("o middleware de imagem não é importado pelo service", () => {
    const fs = require("node:fs");

    const service = fs.readFileSync(
        path.join(RAIZ, "api", "services", "productImageService.js"), "utf8"
    );

    assert.ok(!/publishKeyAuth|requireAdminKey/.test(service),
        "o service não deve conhecer autenticação HTTP");
});
