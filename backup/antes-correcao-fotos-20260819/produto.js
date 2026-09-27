const params = new URLSearchParams(window.location.search);
const id = params.get("id");

const imagemPrincipal = document.getElementById("imagemPrincipal");
const miniaturas = document.getElementById("miniaturas");
const produtoTitulo = document.getElementById("produtoTitulo");
const produtoSku = document.getElementById("produtoSku");
const produtoPreco = document.getElementById("produtoPreco");
const produtoStatus = document.getElementById("produtoStatus");
const produtoDescricao = document.getElementById("produtoDescricao");

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

        // Carrega todas as fotos vinculadas ao produto.
        // O produto pode ter sido salvo antes da foto principal estar marcada;
        // por isso não dependemos apenas de produto.original_url.
        const imagens = [];

        try {
            const imagensResponse = await fetch(
                `/api/product-images/product/${encodeURIComponent(id)}`
            );

            if (imagensResponse.ok) {
                const imagensJson = await imagensResponse.json();

                if (Array.isArray(imagensJson)) {
                    imagensJson.forEach(img => {
                        const original = img?.original_url ||
                            (img?.file_name ? `/storage/originals/${encodeURIComponent(img.file_name)}` : "");
                        const thumb = img?.thumb_url ||
                            (img?.file_name ? `/storage/thumbs/${encodeURIComponent(img.file_name.replace(/\.[^.]+$/, ".webp"))}` : "");

                        const url = original || thumb;
                        if (url && !imagens.some(item => item.original === url)) {
                            imagens.push({ original: url, thumb: thumb || url });
                        }
                    });
                }
            }
        } catch (erroImagens) {
            console.warn("Não foi possível carregar a galeria de imagens:", erroImagens);
        }

        // Compatibilidade com produtos antigos que ainda só possuem a URL
        // retornada diretamente em /api/products/:id.
        if (produto.original_url && !imagens.some(item => item.original === produto.original_url)) {
            imagens.unshift({
                original: produto.original_url,
                thumb: produto.thumb_url || produto.original_url
            });
        }

        if (produto.thumb_url && !imagens.length) {
            imagens.push({
                original: produto.thumb_url,
                thumb: produto.thumb_url
            });
        }

        if (imagens.length > 0) {

            imagemPrincipal.src = imagens[0].original;

            miniaturas.innerHTML = "";

            imagens.forEach((imagem, index) => {

                const img = document.createElement("img");

                img.className = "miniatura";
                img.src = imagem.thumb || imagem.original;
                img.alt = `Imagem ${index + 1}`;

                img.addEventListener("click", () => {
                    imagemPrincipal.src = imagem.original;
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

carregarProduto();
