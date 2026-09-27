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

async function publicarML(id) {

    if (!confirm("Deseja publicar este produto no Mercado Livre?"))
        return;

    try {

        const response = await fetch(`/api/ml/publish/${id}`, {

            method: "POST"

        });

        const retorno = await response.json();

        if (!response.ok) {

            console.error(retorno);

            alert(retorno.error || "Erro ao publicar.");

            return;

        }

        alert("Produto publicado com sucesso!");

        console.log(retorno);

        await carregarProdutos();

    }

    catch (err) {

        console.error(err);

        alert("Erro ao publicar no Mercado Livre.");

    }

}

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

