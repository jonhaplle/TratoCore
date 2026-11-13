const test = require("node:test");
const assert = require("node:assert/strict");

const copy = require("./listingCopy.service");

test("título do exemplo: Samsung Galaxy A15 128GB Usado", () => {
    const title = copy.buildTitle({
        identification: { brand: "Samsung", model: "Galaxy A15", capacity: "128GB" },
        condition: "used"
    });

    assert.equal(title, "Samsung Galaxy A15 128GB Usado");
});

test("título respeita o limite oficial da categoria", () => {
    const title = copy.buildTitle({
        identification: {
            brand: "Samsung",
            line: "Galaxy",
            model: "A15",
            version: "5G Dual Chip",
            capacity: "128GB",
            color: "Preto"
        },
        condition: "used",
        maxLength: 30
    });

    assert.ok(title.length <= 30, `título com ${title.length} caracteres`);
    assert.match(title, /^Samsung/);
});

test("título não repete palavras e remove hashtags", () => {
    const title = copy.buildTitle({
        identification: { brand: "Samsung", model: "Samsung Galaxy A15" },
        condition: "used"
    });

    assert.equal(title, "Samsung Galaxy A15 Usado");
    assert.ok(!title.includes("#"));
});

test("reviewTitle corta excesso, remove hashtag e palavra repetida", () => {
    const review = copy.reviewTitle("Galaxy Galaxy A15 #promo #oferta", {
        maxLength: 60,
        identification: { brand: "Samsung", model: "Galaxy A15" },
        condition: "used"
    });

    assert.equal(review.title, "Galaxy A15");
    assert.equal(review.changed, true);
    assert.ok(review.issues.length >= 2);
});

test("reviewTitle cria título quando o texto é muito curto", () => {
    const review = copy.reviewTitle("ok", {
        identification: { brand: "Samsung", model: "Galaxy A15" },
        condition: "used"
    });

    assert.equal(review.title, "Samsung Galaxy A15 Usado");
});

test("descrição usa só fatos declarados e é orientada à conversão", () => {
    const description = copy.buildDescription({
        identification: { brand: "Samsung", model: "Galaxy A15", capacity: "128GB", color: "Preto" },
        condition: "used",
        working: true,
        accessories: ["Carregador"],
        defects: ["Risco"],
        features: ["Tela de 6,5 polegadas", "Câmera tripla"]
    });

    assert.match(description, /Samsung Galaxy A15 128GB/);
    assert.match(description, /Estado: usado/i);
    assert.match(description, /Carregador/);
    assert.match(description, /Risco/);
    assert.match(description, /Despacho imediato/);
    assert.ok(!/garantia de (?:18|12|6) meses/i.test(description));
});

test("descrição sem estado não afirma condição", () => {
    const description = copy.buildDescription({
        identification: { brand: "Samsung", model: "Galaxy A15" },
        condition: ""
    });

    assert.ok(!/Estado:/i.test(description));
    assert.match(description, /\*\*Samsung Galaxy A15\*\*/);
});

test("sem marca e modelo a descrição não inventa um 'Produto' genérico", () => {
    const description = copy.buildDescription({
        identification: {},
        condition: "used",
        accessories: ["Carregador"]
    });

    assert.ok(!/^\*\*Produto\*\*/m.test(description));
    assert.match(description, /Estado: usado/);
    assert.match(description, /Carregador/);
});

test("descrição de produto que não funciona deixa isso explícito", () => {
    const description = copy.buildDescription({
        identification: { model: "Galaxy A15" },
        condition: "used",
        working: false
    });

    assert.match(description, /não está funcionando ou não foi testado/i);
});
