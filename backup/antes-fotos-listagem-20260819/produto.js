const params = new URLSearchParams(window.location.search);
const id = params.get("id");

const imagemPrincipal = document.getElementById("imagemPrincipal");
const miniaturas = document.getElementById("miniaturas");
const produtoTitulo = document.getElementById("produtoTitulo");
const produtoSku = document.getElementById("produtoSku");
const produtoPreco = document.getElementById("produtoPreco");
const produtoStatus = document.getElementById("produtoStatus");
const produtoDescricao = document.getElementById("produtoDescricao");
const btnCorrigirIA = document.getElementById("btnCorrigirIA");
const btnPublicarML = document.getElementById("btnPublicarML");
const btnEditarProduto = document.getElementById("btnEditarProduto");

async function carregarProduto() {

    if (!id) {
        produtoTitulo.textContent = "Produto não informado";
        return;
    }

    try {

        const response = await fetch(`/api/products/${encodeURIComponent(id)}`);

        if (!response.ok) {
            throw new Error("Produto não encontrado.");
        }

        const produto = await response.json();

        console.log("PRODUTO:", produto);

        produtoTitulo.textContent = produto.title || "Produto sem título";
        produtoSku.textContent = produto.sku || "-";

        const preco = Number(produto.sale_price || 0);

        produtoPreco.textContent = preco.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL"
        });

        produtoStatus.textContent =
            produto.status || "DISPONÍVEL";

        produtoDescricao.textContent =
            produto.description ||
            produto.descricao ||
            "Este produto ainda não possui uma descrição.";

        const imagens = [];

        const adicionarImagem = (url) => {
            if (!url) return;
            const valor = String(url).trim();
            if (valor && !imagens.includes(valor)) imagens.push(valor);
        };

        adicionarImagem(produto.original_url);
        adicionarImagem(produto.thumb_url);

        if (Array.isArray(produto.images)) {
            produto.images.forEach(img => {
                if (typeof img === "string") {
                    adicionarImagem(img);
                    return;
                }
                adicionarImagem(img.original_url);
                adicionarImagem(img.thumb_url);
            });
        }

        if (
            Array.isArray(produto.image_urls)
        ) {
            produto.image_urls.forEach(url => {

                if (url && !imagens.includes(url)) {
                    imagens.push(url);
                }

            });
        }

        if (produto.thumb_url && !imagens.includes(produto.thumb_url)) {
            imagens.push(produto.thumb_url);
        }

        if (imagens.length > 0) {

            imagemPrincipal.src = imagens[0];

            miniaturas.innerHTML = "";

            imagens.forEach((url, index) => {

                const img = document.createElement("img");

                img.className = "miniatura";
                img.src = url;
                img.alt = `Imagem ${index + 1}`;

                img.addEventListener("click", () => {
                    imagemPrincipal.src = url;
                });

                miniaturas.appendChild(img);

            });

        } else {

            imagemPrincipal.removeAttribute("src");
            produtoDescricao.textContent +=
                "\n\nNenhuma imagem disponível.";

        }

        document.title =
            `${produto.title || "Produto"} | Trato Core`;

    }
    catch (erro) {

        console.error("Erro ao carregar produto:", erro);

        produtoTitulo.textContent =
            "Não foi possível carregar o produto.";

        produtoDescricao.textContent =
            erro.message;

    }

}

if (btnCorrigirIA) {
    btnCorrigirIA.addEventListener("click", async () => {
        btnCorrigirIA.disabled = true;
        btnCorrigirIA.textContent = "Corrigindo...";
        try {
            const response = await fetch(`/api/products/${encodeURIComponent(id)}/improve-ai`, { method: "POST" });
            const json = await response.json();
            if (!response.ok || !json.success) throw new Error(json.message || "Erro ao corrigir com IA.");
            alert("Anúncio corrigido com IA." + (json.data?.sale_price ? ` Preço estimado: R$ ${Number(json.data.sale_price).toFixed(2)}` : ""));
            await carregarProduto();
        } catch (err) { alert(err.message); }
        finally { btnCorrigirIA.disabled = false; btnCorrigirIA.textContent = "Corrigir com IA"; }
    });
}

if (btnPublicarML) {
    btnPublicarML.addEventListener("click", () => {
        window.location.href = `/produtos.html`;
    });
}

if (btnEditarProduto) {
    btnEditarProduto.addEventListener("click", () => {
        window.location.href = `/index.html?id=${encodeURIComponent(id)}`;
    });
}

carregarProduto();
