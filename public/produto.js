const params = new URLSearchParams(window.location.search);
const id = params.get("id");

const imagemPrincipal = document.getElementById("imagemPrincipal");
const miniaturas = document.getElementById("miniaturas");
const produtoTitulo = document.getElementById("produtoTitulo");
const produtoSku = document.getElementById("produtoSku");
const produtoPreco = document.getElementById("produtoPreco");
const produtoStatus = document.getElementById("produtoStatus");
const produtoDescricao = document.getElementById("produtoDescricao");


function renderImageManager(produto) {
    const manager = document.getElementById("imageSelectionManager");
    const records = (Array.isArray(produto.images) ? produto.images : [])
        .filter(image => image && typeof image === "object" && image.id)
        .map(image => ({
            ...image,
            selected_for_ml: image.selected_for_ml !== false,
            sort_order: Number(image.sort_order || 0)
        }))
        .sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.sort_order - b.sort_order);

    const imageUrl = image => image.drive_file_id
        ? `/api/product-images/drive/${encodeURIComponent(image.drive_file_id)}`
        : (image.original_url || image.thumb_url || "");

    if (!records.length) {
        manager.innerHTML = "";
        const fallback = [produto.original_url, produto.thumb_url, ...(produto.image_urls || [])].filter(Boolean);
        if (fallback.length) {
            imagemPrincipal.src = fallback[0];
            miniaturas.innerHTML = "";
            fallback.forEach((url, index) => {
                const thumb = document.createElement("img");
                thumb.className = "miniatura";
                thumb.src = url;
                thumb.alt = `Imagem ${index + 1}`;
                thumb.addEventListener("click", () => { imagemPrincipal.src = url; });
                miniaturas.appendChild(thumb);
            });
        } else {
            imagemPrincipal.removeAttribute("src");
            manager.textContent = "Nenhuma imagem disponível.";
        }
        return;
    }

    let mainImageId = Number((records.find(image => image.is_main) || records[0]).id);
    const message = document.createElement("p");
    message.className = "image-selection-message";
    const cards = document.createElement("div");
    cards.className = "image-selection-grid";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "image-selection-save";
    saveButton.textContent = "Salvar seleção para Mercado Livre";

    function selectedRecords() {
        return records.filter(image => image.selected_for_ml);
    }

    function render() {
        const main = records.find(image => Number(image.id) === mainImageId);
        if (main && !main.selected_for_ml) main.selected_for_ml = true;
        const selected = selectedRecords();
        if (!selected.some(image => Number(image.id) === mainImageId) && selected.length) {
            mainImageId = Number(selected[0].id);
        }
        const ordered = [
            ...records.filter(image => Number(image.id) === mainImageId),
            ...records.filter(image => Number(image.id) !== mainImageId)
        ];
        records.splice(0, records.length, ...ordered);

        const mainImage = records.find(image => Number(image.id) === mainImageId) || records[0];
        imagemPrincipal.onerror = function () { this.removeAttribute("src"); };
        imagemPrincipal.src = imageUrl(mainImage);

        miniaturas.innerHTML = "";
        records.forEach((image, index) => {
            const thumb = document.createElement("img");
            thumb.className = "miniatura";
            thumb.src = imageUrl(image);
            thumb.alt = `Imagem ${index + 1}`;
            thumb.addEventListener("click", () => {
                imagemPrincipal.src = imageUrl(image);
            });
            miniaturas.appendChild(thumb);
        });

        message.textContent = `${selected.length} de ${records.length} imagens selecionadas para o Mercado Livre (máximo 10). A principal será enviada primeiro.`;
        saveButton.disabled = selected.length === 0 || selected.length > 10;
        cards.innerHTML = "";

        records.forEach((image, index) => {
            const card = document.createElement("article");
            card.className = "image-selection-card";

            const preview = document.createElement("img");
            preview.src = imageUrl(image);
            preview.alt = image.file_name || `Imagem ${index + 1}`;

            const checkboxLabel = document.createElement("label");
            checkboxLabel.className = "image-selection-check";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = image.selected_for_ml;
            checkbox.addEventListener("change", () => {
                if (checkbox.checked && selectedRecords().length > 10) {
                    checkbox.checked = false;
                    message.textContent = "O Mercado Livre permite no máximo 10 imagens por anúncio.";
                    return;
                }
                image.selected_for_ml = checkbox.checked;
                render();
            });
            checkboxLabel.append(checkbox, document.createTextNode(" Usar no ML"));

            const actions = document.createElement("div");
            actions.className = "image-selection-actions";

            const mainButton = document.createElement("button");
            mainButton.type = "button";
            mainButton.textContent = Number(image.id) === mainImageId ? "Principal" : "Definir principal";
            mainButton.disabled = Number(image.id) === mainImageId;
            mainButton.addEventListener("click", () => {
                image.selected_for_ml = true;
                mainImageId = Number(image.id);
                render();
            });

            const up = document.createElement("button");
            up.type = "button";
            up.textContent = "↑";
            up.title = "Mover para cima";
            up.disabled = index === 0;
            up.addEventListener("click", () => {
                const previous = records[index - 1];
                records[index - 1] = image;
                records[index] = previous;
                render();
            });

            const down = document.createElement("button");
            down.type = "button";
            down.textContent = "↓";
            down.title = "Mover para baixo";
            down.disabled = index === records.length - 1 || Number(image.id) === mainImageId;
            down.addEventListener("click", () => {
                const next = records[index + 1];
                records[index + 1] = image;
                records[index] = next;
                render();
            });

            actions.append(mainButton, up, down);
            card.append(preview, checkboxLabel, actions);
            cards.appendChild(card);
        });
    }

    saveButton.addEventListener("click", async () => {
        const selected = selectedRecords();
        if (!selected.length || selected.length > 10) return;
        const main = selected.find(image => Number(image.id) === mainImageId) || selected[0];
        const selectedIds = [Number(main.id), ...selected.filter(image => Number(image.id) !== Number(main.id)).map(image => Number(image.id))];
        saveButton.disabled = true;
        saveButton.textContent = "Salvando…";
        message.textContent = "Atualizando seleção no banco de dados…";
        try {
            const response = await fetch(`/api/product-images/product/${encodeURIComponent(id)}/selection`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ selected_image_ids: selectedIds, main_image_id: Number(main.id) })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
            records.forEach(image => {
                image.selected_for_ml = selectedIds.includes(Number(image.id));
                image.sort_order = selectedIds.indexOf(Number(image.id)) + 1 || image.sort_order;
                image.is_main = Number(image.id) === Number(main.id);
            });
            mainImageId = Number(main.id);
            message.textContent = "Seleção e ordem salvas. O publicador usará somente estas imagens.";
            render();
        } catch (error) {
            message.textContent = "Falha ao salvar: " + error.message;
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = "Salvar seleção para Mercado Livre";
        }
    });

    manager.innerHTML = "";
    const heading = document.createElement("h3");
    heading.textContent = "Fotos do anúncio";
    manager.append(heading, message, cards, saveButton);
    render();
}

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

        renderImageManager(produto);

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
