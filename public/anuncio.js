// ======================================================
// TRATO CORE — TELA ÚNICA DE REVISÃO E PUBLICAÇÃO
// ======================================================
//
// Fluxo:
//   1. escolher produto (fotos do TratoCap já salvas)
//   2. observar o produto e analisar
//   3. revisar e editar TUDO numa tela só
//   4. aprovar e publicar
//
// A publicação só chega à API depois de:
//   - todos os atributos exigidos preenchidos;
//   - a caixa "APROVO" marcada;
//   - o botão Publicar acionado por uma pessoa.

const API_PRODUTOS = "/api/products";
const API_REVISAO = "/api/vendedor/anuncio/revisao";
const API_PUBLICAR = "/api/vendedor/anuncio/publicar";
const API_STATUS = "/api/vendedor/anuncio/status";

const estado = {
    produtos: [],
    produto: null,
    revisao: null,
    // valores editados pelo vendedor
    edicao: {
        brand: "",
        model: "",
        capacity: "",
        color: "",
        condition: "",
        quantity: 1,
        title: "",
        description: "",
        sale_price: ""
    },
    // atributos confirmados pelo vendedor: id -> { value_id?, value_name?, value_struct? }
    atributos: {},
    loading: false
};

// ======================================================
// HELPERS
// ======================================================

const $ = id => document.getElementById(id);

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function dinheiro(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "—";
    return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function requisicao(url, options = {}) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });

    let json = null;
    try {
        json = await response.json();
    } catch (_) {
        json = null;
    }

    return { ok: response.ok, status: response.status, json: json || {} };
}

function mostrarOverlay(titulo, texto) {
    estado.loading = true;
    $("overlayTitulo").textContent = titulo;
    $("overlayTexto").textContent = texto || "";
    $("overlay").hidden = false;
}

function esconderOverlay() {
    estado.loading = false;
    $("overlay").hidden = true;
}

function aviso(mensagem, destino = null, tipo = "erro") {
    // Mensagens de validação sem alert bloqueante, ancoradas perto do ponto
    // onde o vendedor está trabalhando.
    const box = document.createElement("div");
    box.className = "aviso-info";

    if (tipo === "erro") {
        box.style.background = "#fef2f2";
        box.style.color = "#991b1b";
    } else {
        box.style.background = "#eff6ff";
        box.style.color = "#1e3a8a";
    }

    box.style.marginTop = "8px";
    box.textContent = mensagem;

    const container = destino || document.querySelector(".pagina");

    if (container === document.querySelector(".pagina") || !container.children.length) {
        container.prepend(box);
    } else {
        container.appendChild(box);
    }

    setTimeout(() => box.remove(), 12000);
}

// ======================================================
// STATUS DO MERCADO LIVRE
// ======================================================

async function carregarStatusML() {
    const pill = $("mlStatus");
    const iaPill = $("iaStatus");

    try {
        const { ok, json } = await requisicao(API_STATUS);

        aplicarStatusIA(json?.ia, iaPill);

        if (ok && json.mercado_livre?.conectado) {
            pill.textContent = `Mercado Livre: ${json.mercado_livre.nickname || json.mercado_livre.user_id}`;
            pill.className = "status-pill status-ok";
            return true;
        }

        pill.textContent = "Mercado Livre desconectado";
        pill.className = "status-pill status-erro";
        return false;
    } catch (_) {
        pill.textContent = "Servidor indisponível";
        pill.className = "status-pill status-erro";
        if (iaPill) {
            iaPill.textContent = "IA indisponível";
            iaPill.className = "status-pill status-erro";
        }
        return false;
    }
}

/**
 * Mostra de forma honesta qual IA está realmente respondendo. Nuvem só é
 * exibida como disponível quando a chave foi aceita pelo Google.
 */
function aplicarStatusIA(ia, pill) {
    if (!pill || !ia) return;

    if (ia.gemini?.disponivel) {
        pill.textContent = `IA: Gemini${ia.gemini.modelo ? ` (${ia.gemini.modelo})` : ""}`;
        pill.className = "status-pill status-ok";
        return;
    }

    if (ia.local?.disponivel) {
        pill.textContent = `IA: modelo local${ia.local.modelo ? ` (${ia.local.modelo})` : ""}`;
        pill.className = "status-pill status-alerta";
        return;
    }

    pill.textContent = "IA indisponível — use Preencher manualmente";
    pill.className = "status-pill status-erro";
}

// ======================================================
// ETAPA 1 — PRODUTOS
// ======================================================

async function carregarProdutos() {
    const lista = $("listaProdutos");
    lista.innerHTML = '<div class="vazio">Carregando produtos...</div>';

    try {
        const response = await fetch(API_PRODUTOS);

        if (!response.ok) throw new Error("Não foi possível carregar os produtos.");

        const produtos = await response.json();

        estado.produtos = (Array.isArray(produtos) ? produtos : [])
            .filter(produto => !produto.ml_item_id)
            .filter(produto => Array.isArray(produto.images) && produto.images.length > 0);

        renderProdutos();
    } catch (error) {
        lista.innerHTML = `<div class="vazio">${escapeHtml(error.message)}</div>`;
    }
}

function imagemDoProduto(produto) {
    const imagens = Array.isArray(produto.images) ? produto.images : [];

    for (const imagem of imagens) {
        if (imagem?.drive_file_id) {
            return `/api/product-images/drive/${encodeURIComponent(imagem.drive_file_id)}`;
        }
    }

    for (const imagem of imagens) {
        if (imagem?.thumb_url) return imagem.thumb_url;
        if (imagem?.original_url) return imagem.original_url;
    }

    return produto.thumb_url || produto.original_url || "/storage/thumbs/placeholder.webp";
}

function renderProdutos() {
    const lista = $("listaProdutos");

    if (!estado.produtos.length) {
        lista.innerHTML = "";
        $("semProdutos").hidden = false;
        return;
    }

    $("semProdutos").hidden = true;

    lista.innerHTML = estado.produtos.map(produto => `
        <button type="button" class="produto-card" data-product-id="${produto.id}">
            <img src="${escapeHtml(imagemDoProduto(produto))}" alt="Foto do produto" loading="lazy"
                 onerror="this.style.display='none'">
            <strong>${escapeHtml(produto.title || "Produto sem título")}</strong>
            <small>ID ${produto.id} · ${dinheiro(produto.sale_price)}</small>
            <small>${(Array.isArray(produto.images) ? produto.images.length : 0)} foto(s)</small>
        </button>
    `).join("");
}

function selecionarProduto(id) {
    const produto = estado.produtos.find(item => Number(item.id) === Number(id));
    if (!produto) return;

    estado.produto = produto;
    estado.revisao = null;
    estado.atributos = {};
    estado.edicao = {
        brand: produto.brand || "",
        model: produto.model || "",
        capacity: "",
        color: produto.color || "",
        condition: "",
        quantity: Math.max(1, Number(produto.quantity || 1)),
        title: produto.title || "",
        description: produto.description || "",
        sale_price: ""
    };

    $("produtoSelecionadoTitulo").textContent = produto.title || `Produto ${produto.id}`;
    $("etapaObservacao").hidden = false;
    $("etapaRevisao").hidden = true;
    $("barraAprovacao").hidden = true;
    $("resultadoPublicacao").hidden = true;

    const observacao = produto.seller_observation || "";
    $("observacaoVendedor").value = observacao;

    $("etapaObservacao").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ======================================================
// ETAPA 2 — ANÁLISE
// ======================================================

function lerEdicaoDosCampos() {
    return {
        brand: $("campoMarca").value.trim(),
        model: $("campoModelo").value.trim(),
        capacity: $("campoCapacidade").value.trim(),
        color: $("campoCor").value.trim(),
        condition: (document.querySelector('input[name="estado"]:checked') || {}).value || "",
        quantity: Math.max(1, Number($("campoQuantidade").value || 1)),
        title: $("campoTitulo").value.trim(),
        description: $("campoDescricao").value.trim(),
        sale_price: Number($("campoPreco").value || 0)
    };
}

async function analisar({ apenasManual = false } = {}) {
    if (!estado.produto) {
        aviso("Selecione um produto primeiro.");
        return;
    }

    // Reanálise (mudança de estado/campos) não é o primeiro "Analisar":
    // nesse caso a tela já está montada e não deve rolar para o topo.
    const reanalise = Boolean(estado.revisao);

    if (reanalise) {
        // Preserva o que já foi digitado.
        estado.edicao = { ...estado.edicao, ...lerEdicaoDosCampos() };
    }

    // Na reanálise não bloqueamos a tela inteira: um overlay sobre o campo
    // alterado evita deslocamentos e mantém o preenchimento visível.
    if (reanalise) {
        mostrarOverlay("Atualizando revisão", "Recalculando categoria, preço e atributos...");
    } else {
        mostrarOverlay(
            apenasManual ? "Preparando revisão" : "Analisando produto",
            apenasManual
                ? "Consultando categoria e atributos do Mercado Livre..."
                : "Lendo as fotos, consultando a categoria e montando o anúncio..."
        );
    }

    try {
        const observacao = $("observacaoVendedor").value.trim();

        const { ok, status, json } = await requisicao(API_REVISAO, {
            method: "POST",
            body: JSON.stringify({
                productId: estado.produto.id,
                sellerObservation: observacao,
                identification: {
                    brand: estado.edicao.brand,
                    model: estado.edicao.model,
                    capacity: estado.edicao.capacity,
                    color: estado.edicao.color
                },
                overrides: {
                    ...estado.edicao,
                    condition: estado.edicao.condition || undefined,
                    sale_price: Number(estado.edicao.sale_price) || undefined,
                    ml_category_id: estado.categoriaEscolhida || undefined
                },
                attributeOverrides: estado.atributos,
                skipAi: apenasManual
            })
        });

        if (!ok || !json.success) {
            const detalhe = typeof json.error === "string"
                ? json.error
                : json.message || "Não foi possível montar a revisão.";
            throw new Error(detalhe);
        }

        estado.revisao = json;

        if (reanalise) {
            mesclarRevisao(json);
        } else {
            aplicarRevisaoNoFormulario(json);
        }

        renderRevisao();
        $("etapaRevisao").hidden = false;
        $("barraAprovacao").hidden = false;
        $("avisosRevisao").hidden = false;

        // Avisos ficam ancorados nesta área (não no topo da página), para não
        // deslocar a tela depois que o vendedor começou a revisar.
        const areaAvisos = $("avisosRevisao") || document.querySelector(".pagina");

        if (json.warnings?.length) {
            json.warnings.forEach(texto => aviso(texto, areaAvisos));
        }

        if (json.category_error) {
            aviso(json.category_error, areaAvisos);
        }

        if (json.category_note) {
            aviso(json.category_note, areaAvisos, "info");
        }

        // Uma reanálise disparada pelo próprio vendedor não deve empurrar a
        // tela para o topo a cada mudança de estado.
        if (!reanalise) {
            $("etapaRevisao").scrollIntoView({ behavior: "smooth", block: "start" });
        }
    } catch (error) {
        aviso(error.message || "Erro ao analisar o produto.");
    } finally {
        esconderOverlay();
    }
}

function aplicarRevisaoNoFormulario(revisao) {
    const identificacao = revisao.identification || {};

    // Campos de texto só são preenchidos se o vendedor ainda não os editou.
    if (!estado.edicao.brand) estado.edicao.brand = identificacao.brand || "";
    if (!estado.edicao.model) estado.edicao.model = identificacao.model || "";
    if (!estado.edicao.capacity) estado.edicao.capacity = identificacao.capacity || "";
    if (!estado.edicao.color) estado.edicao.color = identificacao.color || "";
    if (!estado.edicao.condition) estado.edicao.condition = revisao.seller?.condition || "";
    if (!estado.edicao.title) estado.edicao.title = revisao.title?.value || "";
    if (!estado.edicao.description) estado.edicao.description = revisao.description?.value || "";
    if (!Number(estado.edicao.sale_price) && revisao.price?.value) {
        estado.edicao.sale_price = revisao.price.value;
    }

    $("campoMarca").value = estado.edicao.brand || "";
    $("campoModelo").value = estado.edicao.model || "";
    $("campoCapacidade").value = estado.edicao.capacity || "";
    $("campoCor").value = estado.edicao.color || "";
    $("campoQuantidade").value = estado.edicao.quantity;

    document.querySelectorAll('input[name="estado"]').forEach(input => {
        input.checked = input.value === estado.edicao.condition;
    });

    $("campoTitulo").value = estado.edicao.title || "";
    $("campoDescricao").value = estado.edicao.description || "";
    $("campoPreco").value = Number(estado.edicao.sale_price) || "";

    // Atributos preenchidos pelo sistema entram como valores iniciais,
    // menos hipóteses (que aguardam confirmação explícita).
    estado.atributos = {};
    for (const atributo of revisao.attributes?.filled || []) {
        estado.atributos[atributo.id] = {
            value_id: atributo.value_id || undefined,
            value_name: atributo.value_name,
            value_struct: atributo.value_struct || undefined,
            origin: atributo.origin
        };
    }
}

// Aplica somente os valores que chegam na revisão, sem sobrescrever o que
// o vendedor já preencheu (usado nas reanálises).
function mesclarRevisao(revisao) {
    const identificacao = revisao.identification || {};

    if (identificacao.brand) estado.edicao.brand = identificacao.brand;
    if (identificacao.model) estado.edicao.model = identificacao.model;
    if (identificacao.capacity) estado.edicao.capacity = identificacao.capacity;
    if (identificacao.color) estado.edicao.color = identificacao.color;
    if (!estado.edicao.condition) estado.edicao.condition = revisao.seller?.condition || "";
    if (!estado.edicao.title && revisao.title?.value) estado.edicao.title = revisao.title.value;
    if (!estado.edicao.description && revisao.description?.value) estado.edicao.description = revisao.description.value;

    if (!Number(estado.edicao.sale_price) && revisao.price?.value) {
        estado.edicao.sale_price = revisao.price.value;
    }

    $("campoMarca").value = estado.edicao.brand || "";
    $("campoModelo").value = estado.edicao.model || "";
    $("campoCapacidade").value = estado.edicao.capacity || "";
    $("campoCor").value = estado.edicao.color || "";

    document.querySelectorAll('input[name="estado"]').forEach(input => {
        input.checked = input.value === estado.edicao.condition;
    });

    $("campoTitulo").value = estado.edicao.title || "";
    $("campoDescricao").value = estado.edicao.description || "";

    if (!Number($("campoPreco").value) && Number(estado.edicao.sale_price)) {
        $("campoPreco").value = estado.edicao.sale_price;
    }

    atualizarTitulo();
    atualizarDescricao();
}

// ======================================================
// RENDER — FOTOS
// ======================================================

function renderFotos(revisao) {
    const container = $("fotosAnuncio");

    const fotos = (revisao.pictures || []).map(foto => `
        <figure class="${foto.is_main ? "principal" : ""}">
            <img src="${escapeHtml(foto.url)}" alt="Foto do produto" loading="lazy" onerror="this.style.opacity=.3">
            ${foto.is_main ? "<figcaption>Principal</figcaption>" : ""}
        </figure>
    `).join("");

    container.innerHTML = fotos || '<div class="vazio">Nenhuma foto vinculada.</div>';
}

// ======================================================
// RENDER — EVIDÊNCIAS E HIPÓTESES
// ======================================================

function renderEvidencias(revisao) {
    const container = $("blocoEvidencias");
    const blocos = [];

    const confianca = revisao.identification
        ? null
        : null;

    // pesquisa técnica
    if (revisao.research?.matched) {
        blocos.push(`
            <div class="subtitulo-bloco">Pesquisa do modelo</div>
            <div class="evidencia">
                <strong>${escapeHtml(revisao.research.label)}</strong>
                <span>${escapeHtml(revisao.research.note || "")}</span>
                <span>${escapeHtml((revisao.research.observations || []).join(" "))}</span>
            </div>
        `);
    }

    // evidências
    const evidencias = revisao.evidence || [];
    if (evidencias.length) {
        blocos.push('<div class="subtitulo-bloco">Confirmado pelas fotos e pela sua observação</div>');
        blocos.push('<div class="lista-evidencia">');
        for (const item of evidencias) {
            blocos.push(`
                <div class="evidencia">
                    <strong>${escapeHtml(item.field)}: ${escapeHtml(item.value)}</strong>
                    <span>Origem: ${escapeHtml(item.source || "")}</span>
                </div>
            `);
        }
        blocos.push("</div>");
    }

    // hipóteses
    const hipoteses = (revisao.hypotheses || []).filter(item => item.field !== undefined);
    if (hipoteses.length) {
        blocos.push('<div class="subtitulo-bloco">Hipóteses — confirme antes de publicar</div>');
        blocos.push('<div class="lista-evidencia">');
        for (const item of hipoteses) {
            blocos.push(`
                <div class="evidencia hipotese">
                    <strong>${escapeHtml(item.field)}: ${escapeHtml(item.value)}</strong>
                    <span>${escapeHtml(item.reason || "")}</span>
                </div>
            `);
        }
        blocos.push("</div>");
    }

    if (!blocos.length) {
        blocos.push('<div class="vazio">Sem informações adicionais.</div>');
    }

    container.innerHTML = blocos.join("");

    const confiancaEl = $("confiancaIA");
    if (revisao.ai?.ok) {
        const nivel = revisao.confidence?.level || "LOW";
        const score = Number(revisao.confidence?.score || 0);
        confiancaEl.textContent = `IA: ${nivel} (${score}%)`;
        confiancaEl.className = `selo ${nivel === "HIGH" ? "selo-ok" : nivel === "MEDIUM" ? "" : "selo-alerta"}`;
    } else {
        confiancaEl.textContent = "Análise manual";
        confiancaEl.className = "selo selo-neutro";
    }
}

// ======================================================
// RENDER — PERGUNTAS
// ======================================================

function renderPerguntas(revisao) {
    const container = $("blocoPerguntas");
    const perguntas = revisao.questions || [];

    const pendentesAtributos = (revisao.attributes?.pending || []);

    $("contadorPendencias").textContent = String(perguntas.length);
    $("contadorPendencias").className = perguntas.length
        ? "selo selo-alerta"
        : "selo selo-ok";

    if (!perguntas.length) {
        container.innerHTML = '<div class="sem-pendencias">Tudo preenchido. Revise e aprove.</div>';
        return;
    }

    container.innerHTML = perguntas.map((pergunta, index) => {
        const campo = String(pergunta.field || "");
        const atributoId = campo.startsWith("attribute:") ? campo.split(":")[1] : pergunta.attribute_id;
        const opcoes = Array.isArray(pergunta.options) ? pergunta.options : [];

        const botoes = opcoes.map(opcao => `
            <button type="button"
                    data-pergunta="${index}"
                    data-campo="${escapeHtml(campo)}"
                    data-atributo="${escapeHtml(atributoId || "")}"
                    data-valor="${escapeHtml(opcao.value)}">
                ${escapeHtml(opcao.label)}
            </button>
        `).join("");

        let entrada = "";

        if (atributoId) {
            const definicao = pendentesAtributos.find(item => item.id === atributoId) || {};

            if (Array.isArray(definicao.values) && definicao.values.length) {
                entrada = `
                    <select data-atributo="${escapeHtml(atributoId)}" data-campo="${escapeHtml(campo)}">
                        <option value="">Selecione ${escapeHtml(definicao.name || atributoId)}</option>
                        ${definicao.values.map(valor => `
                            <option value="${escapeHtml(valor.id)}" data-nome="${escapeHtml(valor.name)}">
                                ${escapeHtml(valor.name)}
                            </option>
                        `).join("")}
                    </select>
                `;
            } else {
                entrada = `
                    <input type="text"
                           data-atributo="${escapeHtml(atributoId)}"
                           data-campo="${escapeHtml(campo)}"
                           placeholder="Digite ${escapeHtml((definicao.name || atributoId).toLowerCase())}">
                `;
            }
        }

        return `
            <div class="pergunta">
                <p>${escapeHtml(pergunta.question)}</p>
                ${botoes ? `<div class="opcoes">${botoes}</div>` : ""}
                ${entrada}
            </div>
        `;
    }).join("");
}

// ======================================================
// RENDER — ATRIBUTOS DO MERCADO LIVRE
// ======================================================

function renderAtributos(revisao) {
    const container = $("blocoAtributos");
    const categorias = revisao.category || {};

    $("seloCategoria").textContent = categorias.id
        ? `${categorias.id} · ${categorias.name}`
        : "Categoria não resolvida";
    $("seloCategoria").className = categorias.id ? "selo selo-ok" : "selo selo-erro";

    // Aviso de categoria (acessório x produto) logo acima dos atributos.
    let notaCategoria = "";

    if (revisao.category_note) {
        notaCategoria = `
            <div class="aviso-info" style="background:#fffbeb;color:#92400e;margin-bottom:14px;">
                ${escapeHtml(revisao.category_note)}
            </div>
        `;
    }

    if (!revisao.attributes) {
        container.innerHTML = `${notaCategoria}<div class="vazio">Informe o preço para consultar os atributos exigidos pela categoria.</div>`;
        return;
    }

    const { filled, pending } = revisao.attributes;

    const grupos = [];

    // Categoria errada é a causa mais comum de "atributo que não existe no
    // meu produto" (ex.: Título do ebook para dados de RPG). O vendedor pode
    // corrigir a categoria aqui mesmo.
    const sugeridas = Array.isArray(revisao.category_suggestions)
        ? revisao.category_suggestions.filter(item => item?.id)
        : [];

    if (sugeridas.length || categorias.id) {
        const opcoes = sugeridas
            .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.id)})</option>`)
            .join("");

        grupos.push(`
            <div class="grupo-atributos">
                <div class="subtitulo-bloco">Categoria do anúncio</div>
                <div class="atributo">
                    <label for="categoriaEscolhida">
                        Categoria
                        <span class="exigencia exigencia-preenchido">define os atributos</span>
                    </label>
                    <div>
                        <select id="categoriaEscolhida">
                            ${categorias.id ? `<option value="${escapeHtml(categorias.id)}" selected>${escapeHtml(categorias.name)} (${escapeHtml(categorias.id)})</option>` : ""}
                            ${sugeridas
                                .filter(item => item.id !== categorias.id)
                                .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.id)})</option>`)
                                .join("")}
                        </select>
                    </div>
                </div>
                <div class="dica">
                    Se os atributos exigidos não existirem para este produto, escolha outra categoria e a revisão será refeita.
                </div>
            </div>
        `);
    }

    if (pending.length) {
        grupos.push(`
            <div class="grupo-atributos">
                <div class="subtitulo-bloco">Exigidos pelo Mercado Livre — pendentes (${pending.length})</div>
                ${pending.map(atributo => renderAtributo(atributo, "obrigatorio", true)).join("")}
            </div>
        `);
    }

    if (filled.length) {
        grupos.push(`
            <div class="grupo-atributos">
                <div class="subtitulo-bloco">Atributos do anúncio (${filled.length})</div>
                ${filled.map(atributo => renderAtributoPreenchido(atributo)).join("")}
            </div>
        `);
    }

    container.innerHTML = notaCategoria + (grupos.join("") || '<div class="vazio">Sem atributos para esta categoria.</div>');
}

function renderAtributo(atributo, exigencia, editavel) {
    const id = atributo.id;
    const nome = atributo.name || id;
    const valores = Array.isArray(atributo.values) ? atributo.values : [];
    const atual = estado.atributos[id] || {};

    const valorAtual = atual.value_id || atual.value_name || "";

    let campo;

    if (valores.length) {
        campo = `
            <select data-attr-id="${escapeHtml(id)}" data-tipo="list">
                <option value="">Selecione</option>
                ${valores.map(valor => `
                    <option value="${escapeHtml(valor.id)}"
                            data-nome="${escapeHtml(valor.name)}"
                            ${String(valor.id) === String(valorAtual) ? "selected" : ""}>
                        ${escapeHtml(valor.name)}
                    </option>
                `).join("")}
            </select>
        `;
    } else {
        const tipo = String(atributo.value_type || "string").toLowerCase();
        campo = `
            <input type="${tipo === "number" || tipo === "number_unit" ? "text" : "text"}"
                   data-attr-id="${escapeHtml(id)}"
                   data-tipo="${escapeHtml(tipo)}"
                   value="${escapeHtml(valorAtual)}"
                   placeholder="${escapeHtml(tipo === "number_unit" ? "Ex.: 128 GB" : "Digite o valor")}"
                   ${tipo === "number" ? 'inputmode="numeric"' : ""}>
        `;
    }

    const rotuloExigencia = {
        obrigatorio: { texto: "Obrigatório", classe: "exigencia-obrigatorio" },
        condicional: { texto: "Condicional", classe: "exigencia-condicional" }
    }[exigencia] || { texto: "Opcional", classe: "exigencia-opcional" };

    const respondido = String(valorAtual).length > 0;

    return `
        <div class="atributo pendente ${respondido ? "respondido" : ""}">
            <label for="attr-${escapeHtml(id)}">
                ${escapeHtml(nome)}
                <span class="exigencia ${rotuloExigencia.classe}">${rotuloExigencia.texto}</span>
            </label>
            <div>${campo}</div>
            ${atributo.note ? `<div class="nota-atributo">${escapeHtml(atributo.note)}</div>` : ""}
        </div>
    `;
}

function renderAtributoPreenchido(atributo) {
    const origem = {
        seller: "confirmado por você",
        identification: "identificado no produto",
        catalog_hypothesis: "padrão do modelo — confirme",
        commercial_hint: "sugestão comercial"
    }[atributo.origin] || "";

    const ehHipotese = atributo.confidence === "hypothesis" || atributo.origin === "catalog_hypothesis";

    return `
        <div class="atributo">
            <label>
                ${escapeHtml(atributo.name || atributo.id)}
                <span class="exigencia ${ehHipotese ? "exigencia-condicional" : "exigencia-preenchido"}">
                    ${ehHipotese ? "confirmar" : origem}
                </span>
            </label>
            <div>
                <input type="text" data-attr-id="${escapeHtml(atributo.id)}" data-tipo="text"
                       value="${escapeHtml(atributo.value_name || "")}">
            </div>
            ${atributo.note ? `<div class="nota-atributo">${escapeHtml(atributo.note)}</div>` : ""}
        </div>
    `;
}

// ======================================================
// RENDER — PREÇO
// ======================================================

function renderPreco(revisao) {
    const container = $("blocoPrecoReferencia");
    const preco = revisao.price || {};
    const referencia = preco.reference || {};

    const selo = $("seloPreco");
    const origens = {
        seller: "preço informado por você",
        market: "referência de mercado",
        estimate: "estimativa",
        curated_range: "faixa de mercado cadastrada",
        none: "sem referência"
    };

    selo.textContent = origens[preco.origin] || "—";
    selo.className = `selo ${
        preco.origin === "seller" ? "selo-neutro"
            : preco.origin === "market" ? "selo-ok"
                : preco.origin === "none" ? "selo-erro"
                    : "selo-alerta"
    }`;

    const partes = [];

    if (preco.min && preco.max) {
        partes.push(`
            <div class="faixa-referencia">
                <span>Faixa: ${dinheiro(preco.min)} — ${dinheiro(preco.max)}</span>
                ${preco.value ? `<span>Sugerido: ${dinheiro(preco.value)}</span>` : ""}
            </div>
        `);
    }

    const explicacoes = Array.isArray(preco.explanation) ? preco.explanation : [];

    if (explicacoes.length || referencia.warning) {
        partes.push(`
            <div class="referencia">
                <h4>Como chegamos ao preço</h4>
                <ul>
                    ${explicacoes.map(texto => `<li>${escapeHtml(texto)}</li>`).join("")}
                    ${referencia.warning ? `<li>${escapeHtml(referencia.warning)}</li>` : ""}
                </ul>
            </div>
        `);
    }

    const referencias = Array.isArray(referencia.references) ? referencia.references : [];

    if (referencias.length) {
        partes.push(`
            <div class="subtitulo-bloco">Referências encontradas (${referencias.length})</div>
            <div class="referencia">
                <ul>
                    ${referencias.slice(0, 6).map(item => `
                        <li>
                            ${dinheiro(item.price)}
                            ${item.condition ? `· ${item.condition === "new" ? "novo" : "usado"}` : ""}
                            ${item.title ? `— ${escapeHtml(item.title)}` : ""}
                        </li>
                    `).join("")}
                </ul>
            </div>
        `);
    }

    container.innerHTML = partes.join("");
}

// ======================================================
// RENDER — APROVAÇÃO
// ======================================================

function atualizarAprovacao() {
    const revisao = estado.revisao;
    if (!revisao) return;

    const edicao = lerEdicaoDosCampos();
    const bloqueios = [];

    if (!edicao.condition) bloqueios.push("Informe se o produto é novo ou usado.");
    if (!Number(edicao.sale_price)) bloqueios.push("Informe o preço de venda.");
    if (!edicao.title) bloqueios.push("Informe o título do anúncio.");
    if (!(revisao.pictures || []).length) bloqueios.push("O anúncio precisa de pelo menos uma foto.");

    const pendentes = (revisao.attributes?.pending || []).filter(atributo => {
        const valor = estado.atributos[atributo.id];
        return !valor || !(valor.value_id || valor.value_name);
    });

    if (pendentes.length) {
        bloqueios.push(`Preencha ${pendentes.length} atributo(s) exigido(s): ${pendentes.map(item => item.name || item.id).join(", ")}.`);
    }

    if (revisao.category_error) bloqueios.push(revisao.category_error);

    const aprovado = $("checkAprovacao").checked;
    // Mudou algo depois de aprovar? Exige nova aprovação.
    if (aprovado && estado.aprovouCom && JSON.stringify(estado.aprovouCom) !== JSON.stringify({ edicao, atributos: estado.atributos })) {
        $("checkAprovacao").checked = false;
    }

    const pronto = bloqueios.length === 0 && $("checkAprovacao").checked;

    $("btnPublicar").disabled = !pronto || estado.loading || estado.publicando;

    const boxBloqueios = $("bloqueios");
    if (bloqueios.length) {
        boxBloqueios.hidden = false;
        boxBloqueios.innerHTML = `<ul>${bloqueios.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    } else {
        boxBloqueios.hidden = true;
        boxBloqueios.innerHTML = "";
    }

    $("resumoAprovacao").textContent = pronto
        ? `Pronto para publicar: ${edicao.title} — ${dinheiro(Number(edicao.sale_price))}`
        : bloqueios.length
            ? "Ajuste os itens abaixo para habilitar a publicação."
            : "Marque a caixa de aprovação para liberar a publicação.";
}

// ======================================================
// RENDER GERAL
// ======================================================

function renderRevisao() {    const revisao = estado.revisao;
    if (!revisao) return;

    renderFotos(revisao);
    renderEvidencias(revisao);
    renderPerguntas(revisao);
    renderAtributos(revisao);
    renderPreco(revisao);

    // origens dos campos de identificação
    const aplicarOrigem = (campo, elementoOrigem, valor) => {
        const hipotese = (revisao.hypotheses || []).find(item =>
            item.field === campo && String(item.value).toLowerCase() === String(valor || "").toLowerCase());

        if (hipotese) {
            elementoOrigem.textContent = "Hipótese — confirme";
            elementoOrigem.className = "origem hipotese";
        } else if (valor) {
            elementoOrigem.textContent = "Identificado / informado";
            elementoOrigem.className = "origem confirmado";
        } else {
            elementoOrigem.textContent = "Não identificado";
            elementoOrigem.className = "origem";
        }
    };

    aplicarOrigem("brand", $("origemMarca"), $("campoMarca").value);
    aplicarOrigem("model", $("origemModelo"), $("campoModelo").value);
    aplicarOrigem("capacity", $("origemCapacidade"), $("campoCapacidade").value);
    aplicarOrigem("color", $("origemCor"), $("campoCor").value);

    atualizarTitulo();
    atualizarDescricao();
    atualizarAprovacao();
}

function atualizarTitulo() {
    const titulo = $("campoTitulo").value;
    const limite = Number(estado.revisao?.title?.max_length || 60);
    const contador = $("contadorTitulo");

    contador.textContent = `${titulo.length}/${limite}`;
    contador.className = `contador-caracteres ${titulo.length > limite ? "estourado" : ""}`;

    const dica = $("dicaTitulo");

    if (titulo.length > limite) {
        dica.textContent = `O Mercado Livre aceita ${limite} caracteres. O excedente será cortado ao publicar.`;
        dica.className = "dica alerta";
    } else if (/(#\S)/.test(titulo)) {
        dica.textContent = "Evite hashtags no título: prejudicam a busca e a clareza.";
        dica.className = "dica alerta";
    } else {
        dica.textContent = "Marca, modelo, variante e estado. Sem apelos, sem hashtags.";
        dica.className = "dica";
    }
}

function atualizarDescricao() {
    const texto = $("campoDescricao").value;
    $("dicaDescricao").textContent = `${texto.length} caracteres · apenas o que foi identificado ou declarado.`;
}

// ======================================================
// EDIÇÃO
// ======================================================

function registrarEdicaoDeAtributo(elemento) {
    const id = elemento.getAttribute("data-attr-id");
    if (!id) return;

    const tipo = elemento.getAttribute("data-tipo");
    const valor = String(elemento.value || "").trim();

    if (!valor) {
        delete estado.atributos[id];
    } else if (elemento.tagName === "SELECT") {
        const opcao = elemento.options[elemento.selectedIndex];
        estado.atributos[id] = {
            value_id: valor,
            value_name: opcao?.dataset?.nome || opcao?.textContent?.trim() || valor
        };
    } else if (tipo === "number_unit") {
        const match = valor.match(/(\d+(?:[.,]\d+)?)\s*([A-Za-z]{1,4})?/);
        estado.atributos[id] = match
            ? {
                value_struct: {
                    number: Number(match[1].replace(",", ".")),
                    unit: (match[2] || "").toUpperCase()
                },
                value_name: valor
            }
            : { value_name: valor };
    } else {
        estado.atributos[id] = { value_name: valor };
    }

    atualizarAprovacao();
}

function responderPergunta(botao) {
    const campo = botao.getAttribute("data-campo");
    const atributo = botao.getAttribute("data-atributo");
    const valor = botao.getAttribute("data-valor");

    const familia = botao.parentElement;
    familia.querySelectorAll("button").forEach(item => item.classList.remove("selecionado"));
    botao.classList.add("selecionado");

    if (campo === "condition") {
        estado.edicao.condition = valor === "new" ? "new" : "used";
        document.querySelectorAll('input[name="estado"]').forEach(input => {
            input.checked = input.value === estado.edicao.condition;
        });
        // O estado muda o preço de referência: reanalisa em segundo plano.
        analisar({ apenasManual: true });
        return;
    }

    if (campo === "working") {
        if (!estado.revisao.seller) estado.revisao.seller = {};
        estado.revisao.seller.working = valor === "true";
        atualizarAprovacao();
        return;
    }

    if (atributo) {
        estado.atributos[atributo] = { value_name: valor };
        atualizarAprovacao();
    }
}

/**
 * Monta uma mensagem curta e legível a partir da resposta de erro da API,
 * cobrindo texto, objeto de erro do Mercado Livre e lista de causas.
 */
function textoDoErro(json = {}) {
    const partes = [];

    if (typeof json.message === "string" && json.message) partes.push(json.message);

    const erro = json.error;

    if (typeof erro === "string") {
        partes.push(erro);
    } else if (erro && typeof erro === "object") {
        if (typeof erro.message === "string") partes.push(erro.message);

        if (Array.isArray(erro.cause)) {
            const causas = erro.cause
                .map(causa => causa?.message || causa?.code)
                .filter(Boolean)
                .slice(0, 4);

            if (causas.length) partes.push(causas.join("; "));
        }
    }

    if (Array.isArray(json.missing) && json.missing.length) {
        partes.push(`Pendentes: ${json.missing.map(item => item.name || item.id).join(", ")}`);
    }

    const texto = [...new Set(partes.map(item => String(item).trim()).filter(Boolean))].join(" — ");

    return texto || `Erro ao publicar (${json.status || "sem detalhes"}).`;
}

async function melhorarDescricao() {
    const texto = $("campoDescricao").value.trim();

    if (!texto) {
        aviso("Gere a descrição antes de melhorá-la.");
        return;
    }

    mostrarOverlay("Melhorando descrição", "Reescrevendo sem inventar características...");

    try {
        const { ok, json } = await requisicao("/api/ai/improve-draft", {
            method: "POST",
            body: JSON.stringify({
                title: $("campoTitulo").value.trim(),
                description: texto,
                brand: $("campoMarca").value.trim(),
                model: $("campoModelo").value.trim(),
                color: $("campoCor").value.trim(),
                condition: estado.edicao.condition,
                seller_observation: $("observacaoVendedor").value.trim()
            })
        });

        if (!ok || !json.sucesso) {
            throw new Error(json.erro || json.message || "A IA não respondeu.");
        }

        const nova = json.resultado?.description || "";

        if (!nova) throw new Error("A IA não retornou descrição.");

        $("campoDescricao").value = nova;
        atualizarDescricao();
        atualizarAprovacao();

        if (json.provider === "regras_locais") {
            aviso(json.aviso || "Descrição organizada pelas regras do TratoCore (IA indisponível).", null, "info");
        }
        return;
    } catch (error) {
        aviso(`Melhoria por IA indisponível: ${error.message}`);
    } finally {
        esconderOverlay();
    }
}

function regerarDescricao() {
    if (!estado.revisao) return;

    const original = estado.revisao.description?.value || "";

    if (!original) {
        aviso("Não há descrição base para restaurar.");
        return;
    }

    $("campoDescricao").value = original;
    atualizarDescricao();
    atualizarAprovacao();
}

async function recalcularPreco() {
    if (!estado.revisao) return;

    mostrarOverlay("Calculando referência", "Consultando preços do Mercado Livre...");

    try {
        const edicao = lerEdicaoDosCampos();

        const { ok, json } = await requisicao(API_REVISAO, {
            method: "POST",
            body: JSON.stringify({
                productId: estado.produto.id,
                sellerObservation: $("observacaoVendedor").value.trim(),
                identification: {
                    brand: edicao.brand,
                    model: edicao.model,
                    capacity: edicao.capacity,
                    color: edicao.color
                },
                overrides: {
                    title: edicao.title,
                    description: edicao.description,
                    condition: edicao.condition,
                    quantity: edicao.quantity
                },
                attributeOverrides: estado.atributos,
                skipAi: true
            })
        });

        if (!ok || !json.success) {
            throw new Error(json.message || "Não foi possível recalcular.");
        }

        estado.revisao.price = json.price;
        estado.revisao.category = json.category;
        estado.revisao.category_error = json.category_error;
        estado.revisao.attributes = json.attributes;
        estado.revisao.questions = json.questions;

        if (json.price?.value && !Number($("campoPreco").value)) {
            $("campoPreco").value = json.price.value;
            estado.edicao.sale_price = json.price.value;
        }

        renderAtributos(estado.revisao);
        renderPreco(estado.revisao);
        renderPerguntas(estado.revisao);
        atualizarAprovacao();
    } catch (error) {
        aviso(error.message);
    } finally {
        esconderOverlay();
    }
}

// ======================================================
// PUBLICAÇÃO
// ======================================================

async function publicar() {
    if (!estado.revisao || estado.publicando) return;

    const edicao = lerEdicaoDosCampos();

    if (!edicao.condition) {
        aviso("Informe se o produto é novo ou usado.");
        return;
    }

    if (!Number(edicao.sale_price)) {
        aviso("Informe o preço de venda.");
        return;
    }

    if (!$("checkAprovacao").checked) {
        aviso("Marque a caixa de aprovação antes de publicar.");
        return;
    }

    const confirmado = window.confirm(
        "Publicar este anúncio agora no Mercado Livre?\n\n" +
        `Título: ${edicao.title}\n` +
        `Preço: ${dinheiro(Number(edicao.sale_price))}\n\n` +
        "O anúncio ficará visível para os compradores."
    );

    if (!confirmado) return;

    estado.publicando = true;
    $("btnPublicar").disabled = true;
    $("btnPublicar").textContent = "Publicando...";

    try {
        const { ok, json } = await requisicao(API_PUBLICAR, {
            method: "POST",
            body: JSON.stringify({
                productId: estado.produto.id,
                approve: true,
                identification: {
                    brand: edicao.brand,
                    model: edicao.model,
                    capacity: edicao.capacity,
                    color: edicao.color
                },
                overrides: {
                    title: edicao.title,
                    description: edicao.description,
                    sale_price: edicao.sale_price,
                    condition: edicao.condition,
                    quantity: edicao.quantity
                },
                attributeOverrides: Object.entries(estado.atributos).map(([id, valor]) => ({ id, ...valor }))
            })
        });

        if (!ok) {
            if (json.needs_input && Array.isArray(json.missing)) {
                json.missing.forEach(atributo => {
                    if (!estado.revisao.attributes.pending.some(item => item.id === atributo.id)) {
                        estado.revisao.attributes.pending.push(atributo);
                    }
                });
                renderAtributos(estado.revisao);
                renderPerguntas(estado.revisao);
                throw new Error(`O Mercado Livre ainda exige: ${json.missing.map(item => item.name).join(", ")}.`);
            }

            if (json.persisted === false && json.ml?.id) {
                mostrarResultado(json.ml);
                throw new Error(
                    `O anúncio foi criado (${json.ml.id}), mas não foi registrado no banco. ` +
                    "Não publique novamente."
                );
            }

            // Erros do Mercado Livre chegam em formatos diferentes; mostramos
            // sempre um texto legível (nunca "[object Object]").
            throw new Error(textoDoErro(json));
        }

        mostrarResultado(json.ml || json);
        $("barraAprovacao").hidden = true;
    } catch (error) {
        aviso(error.message || "Erro ao publicar no Mercado Livre.");
    } finally {
        estado.publicando = false;
        $("btnPublicar").textContent = "Publicar no Mercado Livre";
        atualizarAprovacao();
    }
}

function mostrarResultado(ml) {
    const container = $("resultadoPublicacao");
    container.hidden = false;

    $("resultadoId").textContent = ml.id || "—";
    $("resultadoStatus").textContent = ml.status || "—";

    const link = $("resultadoLink");
    if (ml.permalink) {
        link.href = ml.permalink;
        link.style.display = "inline-block";
        link.textContent = "Abrir anúncio no Mercado Livre";
    } else {
        link.style.display = "none";
    }

    $("resultadoDescricao").textContent = ml.description_error
        ? "A descrição não pôde ser gravada. Edite a descrição no painel do Mercado Livre."
        : "";

    container.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ======================================================
// EVENTOS
// ======================================================

document.addEventListener("click", event => {
    const card = event.target.closest(".produto-card");
    if (card) {
        selecionarProduto(card.getAttribute("data-product-id"));
        return;
    }

    const botaoPergunta = event.target.closest("[data-pergunta]");
    if (botaoPergunta) {
        responderPergunta(botaoPergunta);
    }
});

document.addEventListener("change", event => {
    const alvo = event.target;

    if (alvo.id === "categoriaEscolhida") {
        estado.categoriaEscolhida = alvo.value || "";
        estado.edicao = { ...estado.edicao, ...lerEdicaoDosCampos() };
        analisar({ apenasManual: true });
        return;
    }

    if (alvo.matches("[data-attr-id]")) {
        registrarEdicaoDeAtributo(alvo);
        const linha = alvo.closest(".atributo");
        if (linha && String(alvo.value || "").trim()) linha.classList.add("respondido");
        return;
    }

    if (alvo.matches("[data-atributo][data-campo]")) {
        const id = alvo.getAttribute("data-atributo");
        const valor = String(alvo.value || "").trim();

        if (valor) {
            const opcao = alvo.tagName === "SELECT" ? alvo.options[alvo.selectedIndex] : null;
            estado.atributos[id] = opcao && opcao.dataset.nome
                ? { value_id: valor, value_name: opcao.dataset.nome }
                : { value_name: valor };
        }

        atualizarAprovacao();
        return;
    }

    if (alvo.id === "checkAprovacao") {
        if (alvo.checked) {
            estado.aprovouCom = {
                edicao: lerEdicaoDosCampos(),
                atributos: JSON.parse(JSON.stringify(estado.atributos))
            };
        }
        atualizarAprovacao();
    }
});

document.addEventListener("input", event => {
    const alvo = event.target;

    if (alvo.id === "campoTitulo") {
        estado.edicao.title = alvo.value;
        atualizarTitulo();
        atualizarAprovacao();
    }
    if (alvo.id === "campoDescricao") {
        estado.edicao.description = alvo.value;
        atualizarDescricao();
        atualizarAprovacao();
    }

    if (alvo.id === "campoPreco") {
        estado.edicao.sale_price = alvo.value;
        atualizarAprovacao();
    }

    if (alvo.id === "campoMarca") estado.edicao.brand = alvo.value.trim();
    if (alvo.id === "campoModelo") estado.edicao.model = alvo.value.trim();
    if (alvo.id === "campoCapacidade") estado.edicao.capacity = alvo.value.trim();
    if (alvo.id === "campoCor") estado.edicao.color = alvo.value.trim();
    if (alvo.id === "campoQuantidade") estado.edicao.quantity = Math.max(1, Number(alvo.value || 1));
});

document.querySelectorAll('input[name="estado"]').forEach(input => {
    input.addEventListener("change", () => {
        estado.edicao.condition = input.value;

        // O estado muda a referência de preço: reanalisa em segundo plano.
        if (estado.revisao) {
            estado.atributos.ITEM_CONDITION = {
                value_name: input.value === "new" ? "Novo" : "Usado",
                origin: "seller"
            };
            analisar({ apenasManual: true });
        } else {
            atualizarAprovacao();
        }
    });
});

$("btnRecarregar").addEventListener("click", carregarProdutos);
$("btnTrocarProduto").addEventListener("click", () => {
    $("etapaObservacao").hidden = true;
    $("etapaRevisao").hidden = true;
    $("barraAprovacao").hidden = true;
    $("etapaProduto").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("btnAnalisar").addEventListener("click", () => analisar({ apenasManual: false }));
$("btnSomenteManual").addEventListener("click", () => {
    $("avisoManual").hidden = false;
    analisar({ apenasManual: true });
});

$("btnMelhorarDescricao").addEventListener("click", melhorarDescricao);
$("btnRegerarDescricao").addEventListener("click", regerarDescricao);
$("btnRecalcularPreco").addEventListener("click", recalcularPreco);
$("btnPublicar").addEventListener("click", publicar);

// ======================================================
// INICIALIZAÇÃO
// ======================================================

(async function iniciar() {
    await carregarStatusML();
    await carregarProdutos();

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    if (id) {
        const produto = estado.produtos.find(item => Number(item.id) === Number(id));
        if (produto) selecionarProduto(produto.id);
    }
})();
