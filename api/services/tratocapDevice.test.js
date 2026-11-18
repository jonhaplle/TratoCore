// Testes do pareamento de dispositivos do TratoCap.
// Banco simulado; nenhum PostgreSQL real é tocado.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const crypto = require("node:crypto");

const servicePath = require.resolve("./tratocapDevice.service");

// ------------------------------------------------------------------
// Banco simulado com as duas tabelas
// ------------------------------------------------------------------

function criarDb() {
    const estado = {
        devices: [],
        codes: [],
        proximoId: 1
    };

    return {
        estado,
        async query(sql, params = []) {
            const texto = String(sql).replace(/\s+/g, " ");

            // CREATE TABLE / INDEX
            if (/CREATE (TABLE|INDEX)/i.test(texto)) return { rows: [] };

            // Inserir/atualizar código de pareamento
            if (/INSERT INTO tratocap_pairing_codes/i.test(texto)) {
                const [hash, expira] = params;
                const existente = estado.codes.find(c => c.hash === hash);

                if (existente) {
                    existente.expira = expira;
                    existente.tentativas = 0;
                    existente.consumido = false;
                } else {
                    estado.codes.push({
                        hash,
                        expira: expira instanceof Date ? expira : new Date(expira),
                        tentativas: 0,
                        consumido: false
                    });
                }
                return { rows: [], rowCount: 1 };
            }

            // Consumir código (UPDATE ... WHERE ainda válido)
            if (/UPDATE tratocap_pairing_codes SET consumido = TRUE/i.test(texto)) {
                const [hash, maxTentativas] = params;
                const agora = new Date();
                const c = estado.codes.find(x => x.hash === hash);

                if (!c || c.consumido || c.expira <= agora || c.tentativas >= Number(maxTentativas)) {
                    return { rows: [] };
                }

                c.consumido = true;
                c.tentativas += 1;
                return { rows: [{ codigo_hash: hash }] };
            }

            // Registrar tentativa frustrada
            if (/UPDATE tratocap_pairing_codes SET tentativas = tentativas \+ 1/i.test(texto)) {
                const [hash] = params;
                const c = estado.codes.find(x => x.hash === hash);
                if (c && !c.consumido) c.tentativas += 1;
                return { rows: [] };
            }

            // Inserir dispositivo
            if (/INSERT INTO tratocap_devices/i.test(texto)) {
                const [tokenHash, apelido] = params;
                const device = {
                    id: estado.proximoId++,
                    token_hash: tokenHash,
                    apelido,
                    criado_em: new Date(),
                    ultimo_uso: null,
                    revogado: false
                };
                estado.devices.push(device);
                return { rows: [device] };
            }

            // Validar token
            if (/SELECT id, apelido FROM tratocap_devices/i.test(texto)) {
                const [tokenHash] = params;
                const d = estado.devices.find(x => x.token_hash === tokenHash && !x.revogado);
                return { rows: d ? [{ id: d.id, apelido: d.apelido }] : [] };
            }

            // Atualizar ultimo_uso
            if (/UPDATE tratocap_devices SET ultimo_uso/i.test(texto)) {
                return { rows: [] };
            }

            // Revogar
            if (/UPDATE tratocap_devices SET revogado = TRUE/i.test(texto)) {
                const [id] = params;
                const d = estado.devices.find(x => x.id === Number(id) && !x.revogado);
                if (!d) return { rows: [] };
                d.revogado = true;
                d.revogado_em = new Date();
                return { rows: [{ id: d.id, apelido: d.apelido }] };
            }

            // Listar
            if (/SELECT id, apelido, criado_em, ultimo_uso, revogado/i.test(texto)) {
                // Espelha o SQL real: NÃO inclui token_hash na projeção.
                return {
                    rows: estado.devices.map(d => ({
                        id: d.id,
                        apelido: d.apelido,
                        criado_em: d.criado_em,
                        ultimo_uso: d.ultimo_uso,
                        revogado: d.revogado,
                        revogado_em: d.revogado_em
                    }))
                };
            }

            return { rows: [], rowCount: 0 };
        }
    };
}

function carregar(dbSimulado) {
    const originalLoad = Module._load;
    delete require.cache[servicePath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath && request === "../db") return dbSimulado;
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(servicePath);
    } finally {
        Module._load = originalLoad;
    }
}

function novoServico() {
    const db = criarDb();
    return { db, servico: carregar(db) };
}

// ------------------------------------------------------------------
// Código de pareamento
// ------------------------------------------------------------------

test("pareamento: gera código de 8 dígitos", async () => {
    const { servico } = novoServico();
    const r = await servico.criarCodigoPareamento({});

    assert.match(r.codigo, /^\d{8}$/, "código deve ter 8 dígitos");
    assert.ok(r.expira_em, "deve informar expiração");
    assert.equal(r.validade_minutos, 10);
});

test("pareamento: código é único a cada geração", async () => {
    const { servico } = novoServico();
    const codigos = new Set();

    for (let i = 0; i < 20; i++) {
        const r = await servico.criarCodigoPareamento({});
        codigos.add(r.codigo);
    }

    assert.ok(codigos.size >= 19, "códigos devem variar");
});

test("pareamento: código válido troca por token", async () => {
    const { servico } = novoServico();
    const { codigo } = await servico.criarCodigoPareamento({});

    const r = await servico.parearDispositivo({ codigo, apelido: "Celular do Alex" });

    assert.ok(r.token, "deve devolver token");
    assert.ok(r.token.length >= 40, "token longo");
    assert.equal(r.device.apelido, "Celular do Alex");
    assert.equal(r.erro, undefined);
});

test("pareamento: código não pode ser reutilizado", async () => {
    const { servico } = novoServico();
    const { codigo } = await servico.criarCodigoPareamento({});

    const primeiro = await servico.parearDispositivo({ codigo });
    assert.ok(primeiro.token);

    const segundo = await servico.parearDispositivo({ codigo });
    assert.equal(segundo.erro, "codigo_invalido", "segunda tentativa deve falhar");
});

test("pareamento: código expirado é rejeitado", async () => {
    const { db, servico } = novoServico();
    const { codigo } = await servico.criarCodigoPareamento({});

    // Força a expiração no banco simulado.
    const hash = crypto.createHash("sha256").update(codigo, "utf8").digest("hex");
    const registro = db.estado.codes.find(c => c.hash === hash);
    registro.expira = new Date(Date.now() - 1000);

    const r = await servico.parearDispositivo({ codigo });
    assert.equal(r.erro, "codigo_invalido");
    assert.equal(r.token, undefined);
});

test("pareamento: código inexistente é rejeitado", async () => {
    const { servico } = novoServico();
    const r = await servico.parearDispositivo({ codigo: "99999999" });

    assert.equal(r.erro, "codigo_invalido");
});

test("pareamento: código com formato inválido é rejeitado", async () => {
    const { servico } = novoServico();

    for (const codigo of ["", "123", "abcdefgh", "123456789"]) {
        const r = await servico.parearDispositivo({ codigo });
        assert.equal(r.erro, "codigo_invalido", "codigo: " + JSON.stringify(codigo));
    }
});

test("pareamento: limite de tentativas bloqueia após 5", async () => {
    const { db, servico } = novoServico();
    const { codigo } = await servico.criarCodigoPareamento({});

    const hash = crypto.createHash("sha256").update(codigo, "utf8").digest("hex");
    const registro = db.estado.codes.find(c => c.hash === hash);

    // Simula 5 tentativas já gastas.
    registro.tentativas = 5;

    const r = await servico.parearDispositivo({ codigo });
    assert.equal(r.erro, "codigo_invalido", "código bloqueado por tentativas");
});

// ------------------------------------------------------------------
// Token e hash
// ------------------------------------------------------------------

test("token: banco guarda apenas o hash, nunca o token", async () => {
    const { db, servico } = novoServico();
    const { codigo } = await servico.criarCodigoPareamento({});
    const { token } = await servico.parearDispositivo({ codigo });

    const device = db.estado.devices[0];

    assert.notEqual(device.token_hash, token, "o token cru não é gravado");
    assert.equal(device.token_hash, servico.hashToken(token), "grava o SHA-256");
    assert.equal(device.token_hash.length, 64, "SHA-256 em hexadecimal");
});

test("token: dois dispositivos recebem tokens diferentes", async () => {
    const { servico } = novoServico();

    const a = await servico.criarCodigoPareamento({});
    const ta = await servico.parearDispositivo({ codigo: a.codigo });

    const b = await servico.criarCodigoPareamento({});
    const tb = await servico.parearDispositivo({ codigo: b.codigo });

    assert.notEqual(ta.token, tb.token, "cada dispositivo tem o seu");
});

// ------------------------------------------------------------------
// Autenticação
// ------------------------------------------------------------------

test("autenticação: token válido é aceito", async () => {
    const { servico } = novoServico();
    const { codigo } = await servico.criarCodigoPareamento({});
    const { token, device } = await servico.parearDispositivo({ codigo, apelido: "Teste" });

    const validado = await servico.validarToken(token);

    assert.ok(validado, "token deve validar");
    assert.equal(validado.id, device.id);
    assert.equal(validado.apelido, "Teste");
});

test("autenticação: token inválido é rejeitado", async () => {
    const { servico } = novoServico();
    const r = await servico.validarToken("token-que-nao-existe-1234567890");

    assert.equal(r, null);
});

test("autenticação: token curto ou vazio é rejeitado sem consultar o banco", async () => {
    const { servico } = novoServico();

    assert.equal(await servico.validarToken(""), null);
    assert.equal(await servico.validarToken(null), null);
    assert.equal(await servico.validarToken("curto"), null);
});

// ------------------------------------------------------------------
// Revogação
// ------------------------------------------------------------------

test("revogação: token revogado deixa de autenticar", async () => {
    const { servico } = novoServico();
    const { codigo } = await servico.criarCodigoPareamento({});
    const { token, device } = await servico.parearDispositivo({ codigo });

    assert.ok(await servico.validarToken(token), "antes de revogar funciona");

    const revogado = await servico.revogarDispositivo(device.id);
    assert.ok(revogado, "revogação confirmada");

    assert.equal(await servico.validarToken(token), null, "após revogar, não autentica");
});

test("revogação: não afeta outros dispositivos", async () => {
    const { servico } = novoServico();

    const a = await servico.criarCodigoPareamento({});
    const da = await servico.parearDispositivo({ codigo: a.codigo, apelido: "A" });

    const b = await servico.criarCodigoPareamento({});
    const db = await servico.parearDispositivo({ codigo: b.codigo, apelido: "B" });

    await servico.revogarDispositivo(da.device.id);

    assert.equal(await servico.validarToken(da.token), null, "A revogado");
    assert.ok(await servico.validarToken(db.token), "B continua válido");
});

test("revogação: dispositivo inexistente devolve null", async () => {
    const { servico } = novoServico();
    assert.equal(await servico.revogarDispositivo(9999), null);
});

// ------------------------------------------------------------------
// Listagem e segurança
// ------------------------------------------------------------------

test("listagem: não expõe token_hash", async () => {
    const { servico } = novoServico();
    const { codigo } = await servico.criarCodigoPareamento({});
    await servico.parearDispositivo({ codigo, apelido: "Celular" });

    const lista = await servico.listarDispositivos();

    assert.equal(lista.length, 1);
    assert.equal(lista[0].apelido, "Celular");
    assert.equal(lista[0].token_hash, undefined, "hash nunca é exposto");
});

test("segurança: formato do código é validado", () => {
    const { servico } = novoServico();

    assert.equal(servico.validarFormatoCodigo("12345678"), true);
    assert.equal(servico.validarFormatoCodigo("1234-5678"), true, "aceita separador");
    assert.equal(servico.validarFormatoCodigo("1234567"), false);
    assert.equal(servico.validarFormatoCodigo("abcdefgh"), false);
});

test("segurança: constantes de validade e tentativas", () => {
    const { servico } = novoServico();

    assert.equal(servico.VALIDADE_CODIGO_MS, 10 * 60 * 1000, "10 minutos");
    assert.equal(servico.MAX_TENTATIVAS, 5);
});
