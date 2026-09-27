const tbody = document.querySelector("#tabelaProdutos tbody");
const pesquisa = document.querySelector("#pesquisa");
const selecionarTodos = document.getElementById("selecionarTodos");
const contadorSelecionados = document.getElementById("contadorSelecionados");
const btnPublicarSelecionados = document.getElementById("btnPublicarSelecionados");

let publicacaoMassaEmAndamento = false;
let filaPublicacaoMassa = [];
let indiceFilaPublicacaoMassa = 0;

const modal = document.getElementById("modalEditar");

const editId = document.getElementById("editId");
const editSku = document.getElementById("editSku");
const editTitulo = document.getElementById("editTitulo");
const editPreco = document.getElementById("editPreco");
const editQuantidade = document.getElementById("editQuantidade");
const editStatus = document.getElementById("editStatus");

const btnSalvar = document.getElementById("btnSalvar");
const btnCancelar = document.getElementById("btnCancelar");

let produtos = [];

// =========================================
// CARREGAR PRODUTOS
// =========================================

async function carregarProdutos() {

    try {

        const response = await fetch("/api/products");

        if (!response.ok)
            throw new Error("Erro ao buscar produtos.");

        produtos = await response.json();

        renderizarTabela(produtos);
        atualizarSelecaoUI();

    } catch (err) {

        console.error(err);
        alert("Erro ao carregar produtos.");

    }

}

// =========================================
// TABELA
// =========================================

function renderizarTabela(lista) {

    tbody.innerHTML = "";
    selecionarTodos.checked = false;
    selecionarTodos.indeterminate = false;

    lista.forEach(produto => {

        const tr = document.createElement("tr");
        tr.dataset.productId = String(produto.id);
        tr.classList.add("produto-row");

        const primeiraImagem = Array.isArray(produto.images) && produto.images.length
            ? produto.images[0]
            : null;

        const imagemUrl = produto.thumb_url || produto.original_url || primeiraImagem?.thumb_url || primeiraImagem?.original_url || "";
        const originalUrl = produto.original_url || primeiraImagem?.original_url || imagemUrl;

        const foto = imagemUrl
            ? `
                <img
                    class="thumb"
                    src="${imagemUrl}"
                    alt="Foto do produto"
                    style="width:60px;height:60px;object-fit:cover;cursor:pointer;border-radius:6px"
                    data-original-url="${originalUrl}"
                    data-product-id="${produto.id}"
                    onerror="if(this.dataset.originalUrl && this.src !== this.dataset.originalUrl){this.src=this.dataset.originalUrl;}else{this.style.display='none'; this.parentElement.innerHTML='' }">
              `
            : `<div class="sem-foto">Sem foto</div>`;

        const jaPublicado = Boolean(produto.ml_item_id || produto.ml_permalink);
        const linkML = produto.ml_permalink
            ? `<a class="ver-anuncio-ml" href="${escapeHtml(produto.ml_permalink)}" target="_blank" rel="noopener noreferrer">VER ANÚNCIO</a>`
            : "";

        const botaoPublicacao = jaPublicado
            ? `${linkML || '<span class="ml-publicado">Publicado no ML</span>'}`
            : `
                <button
                    class="publicar"
                    onclick="publicarML(${produto.id})">
                    Publicar ML
                </button>
              `;

        tr.innerHTML = `

            <td class="celula-selecao">
                <input
                    type="checkbox"
                    class="produto-selecao"
                    data-product-id="${produto.id}"
                    ${jaPublicado ? "disabled title=\"Já publicado no Mercado Livre\"" : ""}
                >
            </td>

            <td>${foto}</td>

            <td>${produto.id}</td>

            <td>${produto.sku || "-"}</td>

            <td>${produto.title}</td>

            <td>R$ ${Number(produto.sale_price).toFixed(2)}</td>

            <td>${produto.quantity}</td>

            <td>${produto.status}</td>

            <td>

                ${botaoPublicacao}

                <button
                    class="corrigir-ia"
                    onclick="corrigirComIA(${produto.id})">
                    Corrigir com IA
                </button>

                <button
                    class="editar"
                    onclick="editar(${produto.id})">
                    Editar
                </button>

                <button
                    class="excluir"
                    onclick="excluirProduto(${produto.id})">
                    Excluir
                </button>

            </td>

        `;

        tbody.appendChild(tr);

    });

}

// =========================================
// PUBLICAÇÃO EM MASSA
// =========================================

function obterProdutosSelecionados() {
    return [...document.querySelectorAll(".produto-selecao:checked")]
        .map(input => Number(input.dataset.productId))
        .filter(Number.isFinite);
}

function atualizarSelecaoUI() {
    const selecionados = obterProdutosSelecionados();
    const caixas = [...document.querySelectorAll(".produto-selecao:not(:disabled)")];

    contadorSelecionados.textContent =
        `${selecionados.length} selecionado${selecionados.length === 1 ? "" : "s"}`;

    btnPublicarSelecionados.disabled =
        publicacaoMassaEmAndamento || selecionados.length === 0;

    if (!caixas.length) {
        selecionarTodos.checked = false;
        selecionarTodos.indeterminate = false;
        return;
    }

    selecionarTodos.checked =
        caixas.length > 0 && caixas.every(input => input.checked);

    selecionarTodos.indeterminate =
        caixas.some(input => input.checked) && !selecionarTodos.checked;
}

function marcarProduto(id, marcado) {
    const input = document.querySelector(`.produto-selecao[data-product-id="${id}"]`);
    if (input && !input.disabled) {
        input.checked = Boolean(marcado);
        atualizarSelecaoUI();
    }
}

async function processarFilaPublicacaoML(ids) {
    if (!ids.length) return;

    publicacaoMassaEmAndamento = true;
    filaPublicacaoMassa = ids.slice();
    indiceFilaPublicacaoMassa = 0;
    atualizarSelecaoUI();

    const resultados = [];

    try {
        for (let i = 0; i < filaPublicacaoMassa.length; i++) {
            indiceFilaPublicacaoMassa = i;
            const id = filaPublicacaoMassa[i];
            const produto = produtos.find(p => Number(p.id) === Number(id));

            if (!produto) {
                resultados.push({ id, success: false, message: "Produto não encontrado na lista." });
                continue;
            }

            const sucesso = await publicarML(id, {}, {
                emFila: true,
                mostrarAlertas: false
            });

            resultados.push({
                id,
                success: Boolean(sucesso),
                title: produto.title
            });

            // Publica estritamente um por vez.
            // A próxima publicação só começa após a anterior terminar.
        }
    } finally {
        publicacaoMassaEmAndamento = false;
        filaPublicacaoMassa = [];
        indiceFilaPublicacaoMassa = 0;
        atualizarSelecaoUI();
    }

    const publicados = resultados.filter(r => r.success).length;
    const erros = resultados.length - publicados;

    if (resultados.length) {
        alert(
            `Publicação em massa concluída.\n\n` +
            `Publicados: ${publicados}\n` +
            `Com erro: ${erros}`
        );
    }

    await carregarProdutos();
}

async function iniciarPublicacaoSelecionados() {
    if (publicacaoMassaEmAndamento) return;

    const ids = obterProdutosSelecionados();

    if (!ids.length) {
        alert("Selecione pelo menos um produto para publicar.");
        return;
    }

    const confirmar = confirm(
        `Você está prestes a publicar ${ids.length} anúncio${ids.length === 1 ? "" : "s"} no Mercado Livre.\n\n` +
        `As publicações serão feitas uma por vez.\n\nContinuar?`
    );

    if (!confirmar) return;

    await processarFilaPublicacaoML(ids);
}

selecionarTodos.addEventListener("change", () => {
    const marcar = selecionarTodos.checked;

    document.querySelectorAll(".produto-selecao:not(:disabled)")
        .forEach(input => {
            input.checked = marcar;
        });

    atualizarSelecaoUI();
});

tbody.addEventListener("change", event => {
    if (event.target.classList.contains("produto-selecao")) {
        atualizarSelecaoUI();
    }
});

btnPublicarSelecionados.addEventListener("click", iniciarPublicacaoSelecionados);

// =========================================
// PESQUISA
// =========================================

pesquisa.addEventListener("input", () => {

    const texto = pesquisa.value.toLowerCase();

    const filtrados = produtos.filter(p =>

        p.title.toLowerCase().includes(texto) ||

        (p.sku || "").toLowerCase().includes(texto)

    );

    renderizarTabela(filtrados);

});

// =========================================
// EDITAR
// =========================================

function editar(id) {

    const produto = produtos.find(p => p.id == id);

    if (!produto)
        return;

    editId.value = produto.id;
    editSku.value = produto.sku || "";
    editTitulo.value = produto.title;
    editPreco.value = produto.sale_price;
    editQuantidade.value = produto.quantity;
    editStatus.value = produto.status;

    modal.style.display = "flex";

}

// =========================================
// SALVAR
// =========================================

btnSalvar.onclick = async () => {

    try {

        const id = editId.value;

        const dados = {

            sku: editSku.value.trim(),

            title: editTitulo.value.trim(),

            sale_price: Number(editPreco.value),

            quantity: Number(editQuantidade.value),

            status: editStatus.value

        };

        if (!dados.title) {

            alert("Informe o tÃƒÂ­tulo.");

            return;

        }

        const response = await fetch(`/api/products/${id}`, {

            method: "PUT",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(dados)

        });

        const retorno = await response.json();

        if (!response.ok) {

            alert(retorno.error || "Erro ao salvar.");

            return;

        }

        modal.style.display = "none";

        await carregarProdutos();

    }

    catch (err) {

        console.error(err);

        alert("Erro ao salvar produto.");

    }

};

// =========================================
// FECHAR MODAL
// =========================================

btnCancelar.onclick = () => {

    modal.style.display = "none";

};

window.onclick = (e) => {

    if (e.target === modal)
        modal.style.display = "none";

};

// =========================================
// EXCLUIR
// =========================================

async function excluirProduto(id) {

    if (!confirm("Deseja excluir este produto?"))
        return;

    try {

        const response = await fetch(`/api/products/${id}`, {

            method: "DELETE"

        });

        if (!response.ok)
            throw new Error("Erro ao excluir.");

        await carregarProdutos();

    }

    catch (err) {

        console.error(err);

        alert("Erro ao excluir.");

    }

}

// =========================================
// PUBLICAR MERCADO LIVRE
// =========================================

const modalPublicacaoML = document.getElementById("modalPublicacaoML");
const publicacaoMLMensagem = document.getElementById("publicacaoMLMensagem");
const publicacaoMLCampos = document.getElementById("publicacaoMLCampos");
const btnContinuarPublicacaoML = document.getElementById("btnContinuarPublicacaoML");
const btnCancelarPublicacaoML = document.getElementById("btnCancelarPublicacaoML");

let publicacaoMLId = null;
let publicacaoMLPendencias = [];

function isVoltageAttribute(attribute) {
    const text = `${attribute?.id || ""} ${attribute?.name || ""}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    return /voltagem|tensao|voltage|voltaje/.test(text);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function abrirPendenciasPublicacaoML(id, missing, message) {
    publicacaoMLId = id;
    publicacaoMLPendencias = Array.isArray(missing) ? missing : [];

    publicacaoMLMensagem.textContent = message ||
        "O TratoCore resolveu o restante automaticamente. SÃ³ falta esta informaÃ§Ã£o para o Mercado Livre.";

    publicacaoMLCampos.innerHTML = publicacaoMLPendencias.map((attribute, index) => {
        const values = Array.isArray(attribute.values) ? attribute.values : [];
        const bivolt = isVoltageAttribute(attribute)
            ? values.find(value => /bivolt/i.test(String(value?.name || "")))
            : null;

        if (values.length) {
            const options = values.map(value => {
                const selected = bivolt && String(value.id) === String(bivolt.id) ? " selected" : "";
                return `<option value="${escapeHtml(value.id)}" data-value-name="${escapeHtml(value.name)}"${selected}>${escapeHtml(value.name)}</option>`;
            }).join("");

            return `
                <div class="ml-atributo-pendente">
                    <label for="ml-pendente-${index}">${escapeHtml(attribute.name || attribute.id)}</label>
                    <select id="ml-pendente-${index}" data-attribute-id="${escapeHtml(attribute.id)}" data-value-type="list">
                        <option value="">Selecione</option>
                        ${options}
                    </select>
                    ${bivolt ? '<div class="ml-atributo-ajuda">Bivolt foi selecionado automaticamente porque Ã© aceito pelo Mercado Livre nesta categoria.</div>' : ''}
                </div>`;
        }

        const inputType = String(attribute.value_type || "string").toLowerCase() === "number" ? "number" : "text";
        return `
            <div class="ml-atributo-pendente">
                <label for="ml-pendente-${index}">${escapeHtml(attribute.name || attribute.id)}</label>
                <input id="ml-pendente-${index}" data-attribute-id="${escapeHtml(attribute.id)}" data-value-type="${escapeHtml(attribute.value_type || "string")}" type="${inputType}" maxlength="${Number(attribute.value_max_length || 255)}" placeholder="Informe ${escapeHtml((attribute.name || attribute.id).toLowerCase())}">
            </div>`;
    }).join("");

    modalPublicacaoML.style.display = "flex";
}

function fecharPendenciasPublicacaoML() {
    modalPublicacaoML.style.display = "none";
    publicacaoMLId = null;
    publicacaoMLPendencias = [];
    publicacaoMLCampos.innerHTML = "";
}

function cancelarPendenciaPublicacaoML() {
    const resolverMassa = window.__resolverPublicacaoMassa;

    if (resolverMassa) {
        window.__resolverPublicacaoMassa = null;
        window.__produtoPublicacaoMassaPendente = null;
        resolverMassa(false);
    }

    fecharPendenciasPublicacaoML();
}

function coletarAtributosPendentes() {
    const overrides = {};
    const campos = publicacaoMLCampos.querySelectorAll("[data-attribute-id]");

    for (const campo of campos) {
        const id = campo.getAttribute("data-attribute-id");
        const value = String(campo.value || "").trim();

        if (!value) {
            campo.focus();
            throw new Error(`Informe: ${campo.closest(".ml-atributo-pendente")?.querySelector("label")?.textContent || id}`);
        }

        if (campo.tagName === "SELECT") {
            const option = campo.options[campo.selectedIndex];
            overrides[id] = {
                value_id: value,
                value_name: option?.dataset?.valueName || option?.textContent || value
            };
        } else {
            overrides[id] = { value_name: value };
        }
    }

    return overrides;
}

async function corrigirComIA(id) {
    const botao = [...document.querySelectorAll("button.corrigir-ia")]
        .find(button => button.getAttribute("onclick") === `corrigirComIA(${id})`);

    if (botao) {
        botao.disabled = true;
        botao.dataset.originalText = botao.textContent;
        botao.textContent = "Corrigindo...";
    }

    try {
        const response = await fetch(`/api/products/${id}/improve-ai`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });

        const retorno = await response.json();

        if (!response.ok) {
            throw new Error(retorno?.message || retorno?.error || "Erro ao corrigir com IA.");
        }

        alert("TÃ­tulo e descriÃ§Ã£o corrigidos com IA.");
        await carregarProdutos();
    } catch (err) {
        console.error(err);
        alert(err.message || "Erro ao corrigir com IA.");
    } finally {
        if (botao) {
            botao.disabled = false;
            botao.textContent = botao.dataset.originalText || "Corrigir com IA";
        }
    }
}

async function publicarML(id, attributeOverrides = {}, options = {}) {
    const emFila = Boolean(options.emFila);
    const mostrarAlertas = options.mostrarAlertas !== false;

    const botao = [...document.querySelectorAll(`button.publicar`)]
        .find(button => button.getAttribute("onclick") === `publicarML(${id})`);

    if (botao) {
        botao.disabled = true;
        botao.dataset.originalText = botao.textContent;
        botao.textContent = emFila ? "Publicando..." : "Publicando...";
    }

    try {
        const response = await fetch(`/api/ml/publish/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attributeOverrides })
        });

        const retorno = await response.json();

        if (!response.ok) {
            if (retorno?.needs_input && Array.isArray(retorno.missing)) {
                abrirPendenciasPublicacaoML(id, retorno.missing, retorno.message);

                // Em publicação individual, o modal continua funcionando como antes.
                if (!emFila) {
                    return false;
                }

                // Em publicação em massa, aguarda o usuário preencher as
                // informações obrigatórias e continuar pelo modal.
                return await aguardarContinuacaoPublicacaoMassa(id);
            }

            const error = retorno?.error;
            const message = typeof error === "string"
                ? error
                : error?.message || retorno?.message || "Erro ao publicar.";

            if (mostrarAlertas) {
                throw new Error(message);
            }

            console.error(`Erro ao publicar produto ${id}:`, message);
            return false;
        }

        fecharPendenciasPublicacaoML();

        if (mostrarAlertas) {
            const link = retorno.ml?.permalink
                ? `\n\n${retorno.ml.permalink}`
                : "";

            alert(
                `Produto publicado com sucesso!\n\n` +
                `MLB: ${retorno.ml?.id || "-"}${link}`
            );
        }

        console.log(retorno);
        await carregarProdutos();

        return true;

    } catch (err) {
        console.error(err);

        if (mostrarAlertas) {
            alert(err.message || "Erro ao publicar no Mercado Livre.");
        }

        return false;

    } finally {
        if (botao) {
            botao.disabled = false;
            botao.textContent = botao.dataset.originalText || "Publicar ML";
        }
    }
}

function aguardarContinuacaoPublicacaoMassa(id) {
    return new Promise(resolve => {
        window.__resolverPublicacaoMassa = resolve;
        window.__produtoPublicacaoMassaPendente = id;
    });
}


btnContinuarPublicacaoML.onclick = async () => {
    try {
        const id = publicacaoMLId;
        const overrides = coletarAtributosPendentes();
        const resolverMassa = window.__resolverPublicacaoMassa;

        if (resolverMassa && Number(window.__produtoPublicacaoMassaPendente) === Number(id)) {
            window.__resolverPublicacaoMassa = null;
            window.__produtoPublicacaoMassaPendente = null;

            const sucesso = await publicarML(id, overrides, {
                emFila: true,
                mostrarAlertas: false
            });

            resolverMassa(Boolean(sucesso));
            return;
        }

        await publicarML(id, overrides);
    } catch (err) {
        alert(err.message || "Preencha os campos obrigatÃ³rios.");
    }
};

btnCancelarPublicacaoML.onclick = cancelarPendenciaPublicacaoML;

modalPublicacaoML.addEventListener("click", event => {
    if (event.target === modalPublicacaoML) cancelarPendenciaPublicacaoML();
});

// =========================================
// DISPONIBILIZA FUNÃƒâ€¡Ãƒâ€¢ES
// =========================================

window.editar = editar;
window.excluirProduto = excluirProduto;
window.publicarML = publicarML;
window.iniciarPublicacaoSelecionados = iniciarPublicacaoSelecionados;
window.corrigirComIA = corrigirComIA;

// =========================================

carregarProdutos();

tbody.addEventListener("click", function(event) {

    if (event.target.closest("button, a, input, select, textarea")) {
        return;
    }

    const tr = event.target.closest("tr");
    if (!tr) return;

    const id = tr.dataset.productId;

    if (!id) {
        console.error("Produto sem ID.");
        return;
    }

    window.location.href = `produto.html?id=${encodeURIComponent(id)}`;

});


