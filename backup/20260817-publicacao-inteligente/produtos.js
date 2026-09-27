const tbody = document.querySelector("#tabelaProdutos tbody");
const pesquisa = document.querySelector("#pesquisa");

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

    lista.forEach(produto => {

        const tr = document.createElement("tr");

        const foto = produto.thumb_url
            ? `
                <img
                    class="thumb"
                    src="${produto.thumb_url}"
                    alt="Foto"
                    style="width:60px;height:60px;object-fit:cover;cursor:pointer;border-radius:6px"
                    data-original-url="${produto.original_url}" data-product-id="${produto.id}">
              `
            : `<div class="sem-foto">ðŸ“¦</div>`;

        tr.innerHTML = `

            <td>${foto}</td>

            <td>${produto.id}</td>

            <td>${produto.sku || "-"}</td>

            <td>${produto.title}</td>

            <td>R$ ${Number(produto.sale_price).toFixed(2)}</td>

            <td>${produto.quantity}</td>

            <td>${produto.status}</td>

            <td>

                <button
                    class="publicar"
                    onclick="publicarML(${produto.id})">
                    Publicar ML
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

            alert("Informe o tÃ­tulo.");

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
        "O TratoCore resolveu o restante automaticamente. Só falta esta informação para o Mercado Livre.";

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
                    ${bivolt ? '<div class="ml-atributo-ajuda">Bivolt foi selecionado automaticamente porque é aceito pelo Mercado Livre nesta categoria.</div>' : ''}
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

async function publicarML(id, attributeOverrides = {}) {
    const botao = [...document.querySelectorAll(`button.publicar`)]
        .find(button => button.getAttribute("onclick") === `publicarML(${id})`);

    if (botao) {
        botao.disabled = true;
        botao.dataset.originalText = botao.textContent;
        botao.textContent = "Publicando...";
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
                return;
            }

            const error = retorno?.error;
            const message = typeof error === "string"
                ? error
                : error?.message || retorno?.message || "Erro ao publicar.";
            throw new Error(message);
        }

        fecharPendenciasPublicacaoML();
        alert(`Produto publicado com sucesso!\n\nMLB: ${retorno.ml?.id || "-"}`);
        console.log(retorno);
        await carregarProdutos();

    } catch (err) {
        console.error(err);
        alert(err.message || "Erro ao publicar no Mercado Livre.");
    } finally {
        if (botao) {
            botao.disabled = false;
            botao.textContent = botao.dataset.originalText || "Publicar ML";
        }
    }
}

btnContinuarPublicacaoML.onclick = async () => {
    try {
        const overrides = coletarAtributosPendentes();
        await publicarML(publicacaoMLId, overrides);
    } catch (err) {
        alert(err.message || "Preencha os campos obrigatórios.");
    }
};

btnCancelarPublicacaoML.onclick = fecharPendenciasPublicacaoML;

modalPublicacaoML.addEventListener("click", event => {
    if (event.target === modalPublicacaoML) fecharPendenciasPublicacaoML();
});

// =========================================
// DISPONIBILIZA FUNÃ‡Ã•ES
// =========================================

window.editar = editar;
window.excluirProduto = excluirProduto;
window.publicarML = publicarML;

// =========================================

carregarProdutos();

tbody.addEventListener("click", function(event) {

    const imagem = event.target.closest("img.thumb");

    if (!imagem) {
        return;
    }

    const id = imagem.getAttribute("data-product-id");

    if (!id) {
        console.error("Produto sem ID.");
        return;
    }

    window.location.href = `produto.html?id=${encodeURIComponent(id)}`;

});

