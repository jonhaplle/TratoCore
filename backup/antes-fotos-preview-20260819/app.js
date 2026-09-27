// ======================================================
// TRATO CORE 0.6
// public/app.js
// ======================================================

const API_UPLOAD = "/api/upload";
const API_AI = "/api/ai/analyze";
const API_PRODUCTS = "/api/products";
const API_PRODUCT_IMAGES = "/api/product-images";

let uploadedPhoto = null;
let uploadedPhotos = [];

let aiProductType = "";
let aiBrand = "";
let aiLine = "";
let aiGeneration = "";
let aiVersion = "";
let aiColor = "";
let aiCondition = "used";
let aiConfidence = 0;

// ======================================================
// ELEMENTOS
// ======================================================

const photoInput = document.getElementById("photo");
const preview = document.getElementById("preview");

const btnAnalyze = document.getElementById("btnAnalyze");
const btnSave = document.getElementById("btnSave");
const btnNew = document.getElementById("btnNew");
const btnImproveAI = document.getElementById("btnImproveAI");

const sku = document.getElementById("sku");
const barcode = document.getElementById("barcode");
const title = document.getElementById("title");
const brand = document.getElementById("brand");
const model = document.getElementById("model");
const category = document.getElementById("category");
const salePrice = document.getElementById("sale_price");
const quantity = document.getElementById("quantity");
const description = document.getElementById("description");


// ======================================================
// ANIMAÃ‡ÃƒO PROFISSIONAL DA IA
// ======================================================

let aiLoadingOverlay = null;
let aiLoadingTimer = null;

function criarAnimacaoIA() {

    if (document.getElementById("tratoAiOverlay")) {
        return document.getElementById("tratoAiOverlay");
    }

    const style = document.createElement("style");

    style.textContent = `
        #tratoAiOverlay {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(15, 23, 42, 0.58);
            backdrop-filter: blur(7px);
            -webkit-backdrop-filter: blur(7px);
            opacity: 0;
            transition: opacity .25s ease;
        }

        #tratoAiOverlay.ativo {
            display: flex;
            opacity: 1;
        }

        #tratoAiCard {
            width: min(430px, calc(100vw - 40px));
            padding: 34px 30px 30px;
            border-radius: 22px;
            background: rgba(255,255,255,.97);
            box-shadow: 0 25px 70px rgba(0,0,0,.28);
            text-align: center;
            transform: translateY(12px) scale(.97);
            transition: transform .3s ease;
            font-family: Arial, sans-serif;
        }

        #tratoAiOverlay.ativo #tratoAiCard {
            transform: translateY(0) scale(1);
        }

        .trato-ai-spinner {
            width: 64px;
            height: 64px;
            margin: 0 auto 22px;
            border: 5px solid #e5e7eb;
            border-top-color: #2563eb;
            border-right-color: #4f46e5;
            border-radius: 50%;
            animation: tratoAiSpin .85s linear infinite;
        }

        @keyframes tratoAiSpin {
            to { transform: rotate(360deg); }
        }

        .trato-ai-title {
            margin: 0;
            font-size: 22px;
            font-weight: 700;
            color: #111827;
        }

        .trato-ai-status {
            margin-top: 9px;
            min-height: 24px;
            font-size: 14px;
            color: #64748b;
        }

        .trato-ai-dots span {
            display: inline-block;
            width: 6px;
            height: 6px;
            margin: 0 3px;
            border-radius: 50%;
            background: #2563eb;
            animation: tratoAiDot 1.1s infinite ease-in-out;
        }

        .trato-ai-dots span:nth-child(2) { animation-delay: .15s; }
        .trato-ai-dots span:nth-child(3) { animation-delay: .30s; }

        @keyframes tratoAiDot {
            0%, 60%, 100% { transform: translateY(0); opacity: .35; }
            30% { transform: translateY(-5px); opacity: 1; }
        }

        .trato-ai-progress {
            height: 5px;
            margin-top: 22px;
            overflow: hidden;
            border-radius: 999px;
            background: #e5e7eb;
        }

        .trato-ai-progress-bar {
            width: 35%;
            height: 100%;
            border-radius: 999px;
            background: linear-gradient(90deg, #2563eb, #4f46e5);
            animation: tratoAiProgress 1.5s ease-in-out infinite;
        }

        @keyframes tratoAiProgress {
            0% { transform: translateX(-130%); }
            100% { transform: translateX(380%); }
        }

        .trato-ai-check {
            width: 78px;
            height: 78px;
            margin: 0 auto 20px;
            border-radius: 50%;
            background: #16a34a;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 30px rgba(22,163,74,.28);
            animation: tratoAiPop .45s cubic-bezier(.2,.8,.2,1);
        }

        .trato-ai-check svg {
            width: 42px;
            height: 42px;
            fill: none;
            stroke: white;
            stroke-width: 4;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        .trato-ai-finished .trato-ai-title {
            color: #166534;
        }

        @keyframes tratoAiPop {
            0% { transform: scale(.45); opacity: 0; }
            70% { transform: scale(1.08); opacity: 1; }
            100% { transform: scale(1); }
        }
    `;

    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "tratoAiOverlay";

    overlay.innerHTML = `
        <div id="tratoAiCard">
            <div id="tratoAiVisual" class="trato-ai-spinner"></div>
            <h2 id="tratoAiTitle" class="trato-ai-title">Analisando produto</h2>
            <div id="tratoAiStatus" class="trato-ai-status">
                A IA estÃ¡ analisando suas fotos
                <span class="trato-ai-dots">
                    <span></span><span></span><span></span>
                </span>
            </div>
            <div id="tratoAiProgress" class="trato-ai-progress">
                <div class="trato-ai-progress-bar"></div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    return overlay;
}

function mostrarAnimacaoIA() {

    aiLoadingOverlay = criarAnimacaoIA();

    const titleEl = document.getElementById("tratoAiTitle");
    const statusEl = document.getElementById("tratoAiStatus");
    const visualEl = document.getElementById("tratoAiVisual");
    const progressEl = document.getElementById("tratoAiProgress");

    aiLoadingOverlay.classList.remove("trato-ai-finished");
    visualEl.className = "trato-ai-spinner";
    visualEl.innerHTML = "";
    titleEl.textContent = "Analisando produto";
    statusEl.innerHTML = `
        A IA estÃ¡ analisando suas fotos
        <span class="trato-ai-dots">
            <span></span><span></span><span></span>
        </span>
    `;
    progressEl.style.display = "block";

    aiLoadingOverlay.style.display = "flex";

    requestAnimationFrame(() => {
        aiLoadingOverlay.classList.add("ativo");
    });

    const mensagens = [
        "Identificando marca e modelo...",
        "Conferindo caracterÃ­sticas visuais...",
        "Usando as informaÃ§Ãµes do vendedor...",
        "Preparando o anÃºncio..."
    ];

    let indice = 0;

    clearInterval(aiLoadingTimer);

    aiLoadingTimer = setInterval(() => {
        if (!statusEl) return;

        indice = (indice + 1) % mensagens.length;

        statusEl.innerHTML = `
            ${mensagens[indice]}
            <span class="trato-ai-dots">
                <span></span><span></span><span></span>
            </span>
        `;
    }, 1800);

    if (btnAnalyze) {
        btnAnalyze.disabled = true;
        btnAnalyze.dataset.aiOriginalText = btnAnalyze.textContent;
        btnAnalyze.textContent = "Analisando...";
        btnAnalyze.style.opacity = "0.75";
        btnAnalyze.style.cursor = "wait";
    }
}

async function finalizarAnimacaoIA(sucesso = true) {

    clearInterval(aiLoadingTimer);

    if (!aiLoadingOverlay) return;

    const titleEl = document.getElementById("tratoAiTitle");
    const statusEl = document.getElementById("tratoAiStatus");
    const visualEl = document.getElementById("tratoAiVisual");
    const progressEl = document.getElementById("tratoAiProgress");

    if (sucesso) {

        visualEl.className = "trato-ai-check";
        visualEl.innerHTML = `
            <svg viewBox="0 0 52 52" aria-hidden="true">
                <path d="M14 27 L23 36 L39 17"></path>
            </svg>
        `;

        aiLoadingOverlay.classList.add("trato-ai-finished");

        titleEl.textContent = "AnÃ¡lise concluÃ­da";
        statusEl.textContent = "Produto identificado e campos preenchidos.";
        progressEl.style.display = "none";

        await new Promise(resolve => setTimeout(resolve, 1200));

    } else {

        visualEl.className = "trato-ai-check";
        visualEl.style.background = "#dc2626";
        visualEl.innerHTML = `
            <svg viewBox="0 0 52 52" aria-hidden="true">
                <path d="M16 16 L36 36 M36 16 L16 36"></path>
            </svg>
        `;

        titleEl.textContent = "NÃ£o foi possÃ­vel concluir";
        titleEl.style.color = "#991b1b";
        statusEl.textContent = "Verifique a mensagem de erro e tente novamente.";
        progressEl.style.display = "none";

        await new Promise(resolve => setTimeout(resolve, 1300));
    }

    aiLoadingOverlay.classList.remove("ativo");

    setTimeout(() => {
        if (aiLoadingOverlay) {
            aiLoadingOverlay.style.display = "none";
        }

        if (btnAnalyze) {
            btnAnalyze.disabled = false;
            btnAnalyze.textContent =
                btnAnalyze.dataset.aiOriginalText || "Analisar com IA";
            btnAnalyze.style.opacity = "";
            btnAnalyze.style.cursor = "";
        }
    }, 260);
}

// ======================================================
// OBSERVAÃ‡ÃƒO DO VENDEDOR
// ======================================================

function criarCampoObservacaoVendedor() {

    let campo = document.getElementById("observacao_vendedor");

    if (campo) {
        return campo;
    }

    campo = document.createElement("textarea");
    campo.id = "observacao_vendedor";
    campo.name = "observacao_vendedor";
    campo.rows = 4;
    campo.placeholder =
        "Informe o que vocÃª sabe sobre o produto: se liga, funciona, foi testado, apresenta defeito, estÃ¡ incompleto, Ã© vendido no estado, Ã© destinado a tÃ©cnico para reparo, etc.";

    campo.style.width = "100%";
    campo.style.minHeight = "100px";
    campo.style.boxSizing = "border-box";
    campo.style.padding = "12px";
    campo.style.border = "1px solid #ccc";
    campo.style.borderRadius = "6px";
    campo.style.fontSize = "14px";
    campo.style.resize = "vertical";

    const label = document.createElement("label");
    label.htmlFor = "observacao_vendedor";
    label.textContent = "ObservaÃ§Ã£o do vendedor";
    label.style.display = "block";
    label.style.fontWeight = "600";
    label.style.marginBottom = "6px";

    const box = document.createElement("div");
    box.id = "observacaoVendedorBox";
    box.style.marginTop = "16px";
    box.style.marginBottom = "16px";

    const ajuda = document.createElement("div");
    ajuda.textContent =
        "A IA usarÃ¡ esta informaÃ§Ã£o junto com as fotos. Ela nÃ£o deve inventar funcionamento ou defeitos.";
    ajuda.style.fontSize = "12px";
    ajuda.style.color = "#666";
    ajuda.style.marginTop = "5px";

    box.appendChild(label);
    box.appendChild(campo);
    box.appendChild(ajuda);

    if (description && description.parentElement) {
        description.parentElement.parentElement
            ? description.parentElement.parentElement.insertBefore(box, description.parentElement)
            : description.parentElement.insertBefore(box, description);
    } else if (btnAnalyze && btnAnalyze.parentElement) {
        btnAnalyze.parentElement.insertBefore(box, btnAnalyze);
    } else {
        document.body.appendChild(box);
    }

    return campo;
}

const observacaoVendedor = criarCampoObservacaoVendedor();

// ======================================================
// PREVIEW
// ======================================================

if (photoInput) {

    photoInput.addEventListener("change", () => {

        const files = Array.from(photoInput.files || []);

        uploadedPhoto = null;
        uploadedPhotos = [];

        if (!files.length) {
            if (preview) preview.innerHTML = "Sem imagem";
            return;
        }

        if (files.length > 10) {
            alert("Você pode selecionar no máximo 10 fotos.");
            photoInput.value = "";
            if (preview) preview.innerHTML = "Sem imagem";
            return;
        }

        if (!preview) return;

        preview.innerHTML = "";
        preview.style.display = "grid";
        preview.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
        preview.style.gap = "8px";
        preview.style.alignContent = "start";

        files.forEach((file, index) => {
            const wrapper = document.createElement("div");
            wrapper.style.position = "relative";
            wrapper.style.textAlign = "center";

            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            img.alt = `Foto ${index + 1}`;
            img.style.width = "100%";
            img.style.maxHeight = "150px";
            img.style.objectFit = "contain";
            img.style.borderRadius = "6px";
            img.style.border = "1px solid #ccc";
            img.onload = () => URL.revokeObjectURL(img.src);

            const label = document.createElement("div");
            label.textContent = index === 0 ? "Principal" : `Foto ${index + 1}`;
            label.style.fontSize = "12px";
            label.style.marginTop = "3px";

            wrapper.appendChild(img);
            wrapper.appendChild(label);
            preview.appendChild(wrapper);
        });
    });

}

// ======================================================
// UPLOAD DE UMA FOTO
// ======================================================

async function uploadOnePhoto(file) {

    if (!file) {
        throw new Error("Arquivo de imagem nÃ£o informado.");
    }

    const formData = new FormData();

    formData.append("imagem", file);

    const response = await fetch(API_UPLOAD, {
        method: "POST",
        body: formData
    });

    const json = await response.json();

    if (!response.ok || !json.sucesso) {
        throw new Error(
            json.mensagem ||
            json.erro ||
            "Erro no upload da imagem."
        );
    }

    return json.arquivo;

}

// ======================================================
// UPLOAD DAS FOTOS
// ======================================================

async function uploadPhotos() {

    const files = Array.from(photoInput?.files || []);

    if (!files.length) {
        alert("Selecione pelo menos uma imagem.");
        return false;
    }

    if (files.length > 10) {
        alert("VocÃª pode selecionar no mÃ¡ximo 10 fotos.");
        return false;
    }

    uploadedPhotos = [];

    // Upload sequencial para preservar a ordem.
    for (const file of files) {

        const arquivo = await uploadOnePhoto(file);

        uploadedPhotos.push(arquivo);
    }

    uploadedPhoto = uploadedPhotos[0] || null;

    return uploadedPhotos.length > 0;

}

// ======================================================
// IA
// ======================================================

async function corrigirRascunhoComIA() {
    if (!title?.value?.trim()) {
        alert("Primeiro analise o produto com a IA.");
        return;
    }

    if (btnImproveAI) {
        btnImproveAI.disabled = true;
        btnImproveAI.textContent = "Corrigindo...";
    }

    try {
        const response = await fetch("/api/ai/improve-draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: title.value,
                description: description?.value || "",
                product_type: aiProductType,
                brand: brand?.value || aiBrand,
                line: aiLine,
                model: model?.value || "",
                generation: aiGeneration,
                version: aiVersion,
                color: aiColor,
                condition: aiCondition,
                seller_observation: observacaoVendedor?.value || ""
            })
        });

        const json = await response.json();
        if (!response.ok || !json.sucesso) {
            throw new Error(json.erro || json.message || "Erro ao corrigir o rascunho.");
        }

        const r = json.resultado || {};
        if (title) title.value = r.title || title.value;
        if (description) description.value = r.description || description.value;
        if (salePrice && Number(r.suggested_price) > 0) salePrice.value = Number(r.suggested_price).toFixed(2);

        alert("Anúncio corrigido com IA e preço estimado.");
    } catch (err) {
        console.error(err);
        alert(err.message || "Erro ao corrigir com IA.");
    } finally {
        if (btnImproveAI) {
            btnImproveAI.disabled = false;
            btnImproveAI.textContent = "Corrigir com IA";
        }
    }
}

async function analyzePhoto() {

    mostrarAnimacaoIA();

    try {

        const ok = await uploadPhotos();

        if (!ok) {
            await finalizarAnimacaoIA(false);
            return;
        }

        if (!uploadedPhoto || !uploadedPhoto.originalUrl) {
            throw new Error("Imagem principal nÃ£o retornada pelo upload.");
        }

        const observacao =
            String(observacaoVendedor?.value || "").trim();

        const response = await fetch(API_AI, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                imageUrl:
                    window.location.origin +
                    uploadedPhoto.originalUrl,

                observacaoVendedor:
                    observacao

            })

        });

        const json = await response.json();

        if (!response.ok || !json.sucesso) {

            await finalizarAnimacaoIA(false);

            alert(
                json.erro ||
                json.mensagem ||
                "Erro na IA."
            );

            return;
        }

        const p = json.resultado || {};
        const listing = json.listing || p.listing_draft || {};
        const identification = p.identification || {};
        const catalogInput = p.catalog_input || {};
        const draft = p.listing_draft || listing || {};

        // Compatibilidade defensiva: aceita tanto a resposta nova quanto
        // a estrutura de identificaÃ§Ã£o retornada pelo ML007 anterior.
        const fallbackTitle = [
            identification.brand,
            identification.line,
            identification.model,
            identification.generation,
            identification.product_type,
            identification.color
        ].map(v => String(v || "").trim()).filter(Boolean).join(" ");

        aiProductType = p.product_type || identification.product_type || catalogInput.product_type || "";

        aiBrand = p.brand || identification.brand || catalogInput.brand || "";
        aiLine = p.line || identification.line || catalogInput.line || "";
        aiGeneration = p.generation || identification.generation || catalogInput.generation || "";
        aiVersion = p.version || identification.version || catalogInput.version || "";
        aiColor = p.color || identification.color || catalogInput.color || "";
        aiCondition = p.condition || identification.condition || catalogInput.condition || "used";
        aiConfidence = Number(p.confidence || 0);

        if (title) {
            title.value = listing.title || p.title || draft.title || fallbackTitle || "";
        }

        if (brand) {
            brand.value = p.brand || identification.brand || catalogInput.brand || "";
        }

        if (model) {
            model.value = p.model || identification.model || catalogInput.model || "";
        }

        if (category) {
            category.value = listing.category || p.category || "";
        }

        if (description) {
            description.value = listing.description || p.description || draft.description || "";
        }

        const precoSugerido = Number(listing.suggested_price || p.suggested_price || draft.suggested_price || 0);

        if (salePrice) {
            salePrice.value = precoSugerido > 0 ? precoSugerido.toFixed(2) : "";
        }

        if (btnImproveAI) {
            btnImproveAI.style.display = "block";
        }

        await finalizarAnimacaoIA(true);

    }
    catch (err) {

        console.error(err);

        await finalizarAnimacaoIA(false);

        alert(
            err.message ||
            "Erro ao comunicar com o servidor."
        );

    }

}

// ======================================================
// SALVAR PRODUTO
// ======================================================

async function saveProduct() {

    try {

        if (!title || !title.value.trim()) {
            alert("O tÃ­tulo do produto Ã© obrigatÃ³rio.");
            return;
        }

        const response = await fetch(API_PRODUCTS, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                sku:
                    sku?.value ||
                    "",

                barcode:
                    barcode?.value ||
                    "",

                title:
                    title.value,

                description:
                    description?.value ||
                    "",

                sale_price:
                    Number(
                        salePrice?.value ||
                        0
                    ),

                quantity:
                    Math.max(
                        1,
                        Number(
                            quantity?.value ||
                            1
                        )
                    ),

                product_type:
                    aiProductType,

                brand:
                    aiBrand ||
                    brand?.value ||
                    "",

                line:
                    aiLine,

                model:
                    model?.value ||
                    "",

                generation:
                    aiGeneration,

                version:
                    aiVersion,

                color:
                    aiColor,

                condition:
                    aiCondition,

                ai_confidence:
                    aiConfidence

            })

        });

        const json = await response.json();

        if (!response.ok || !json.sucesso) {

            alert(
                json.message ||
                json.mensagem ||
                json.erro ||
                "Erro ao salvar produto."
            );

            return;
        }

        const product = json.data || json.produto;

        if (!product || !product.id) {

            alert(
                "Produto salvo, mas o servidor nÃ£o retornou o ID."
            );

            return;
        }

        const productId = product.id;

        // ==================================================
        // SALVAR IMAGENS DO PRODUTO
        // ==================================================

        if (uploadedPhotos.length) {

            for (
                let index = 0;
                index < uploadedPhotos.length;
                index++
            ) {

                const uploaded = uploadedPhotos[index];

                const imgResponse = await fetch(
                    API_PRODUCT_IMAGES,
                    {

                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            product_id:
                                productId,

                            file_name:
                                uploaded.fileName,

                            original_url:
                                uploaded.originalUrl,

                            thumb_url:
                                uploaded.thumbUrl,

                            mime_type:
                                uploaded.mimeType,

                            width:
                                uploaded.width,

                            height:
                                uploaded.height,

                            file_size:
                                uploaded.fileSize,

                            is_main:
                                index === 0,

                            sort_order:
                                index + 1

                        })

                    }
                );

                const imgJson =
                    await imgResponse.json();

                if (
                    !imgResponse.ok ||
                    !imgJson.sucesso
                ) {

                    console.error(
                        "Erro ao vincular imagem:",
                        imgJson
                    );

                    alert(
                        "Produto salvo, porÃ©m ocorreu um erro ao vincular uma das imagens."
                    );

                    return;
                }

            }

        }

        alert(
            "Produto salvo com sucesso."
        );

        newProduct();

    }
    catch (err) {

        console.error(err);

        alert(
            err.message ||
            "Erro ao salvar produto."
        );

    }

}

// ======================================================
// NOVO PRODUTO
// ======================================================

function newProduct() {

    uploadedPhoto = null;
    uploadedPhotos = [];

    aiProductType = "";
    aiLine = "";
    aiGeneration = "";
    aiVersion = "";
    aiColor = "";
    aiCondition = "used";
    aiConfidence = 0;

    if (photoInput) {
        photoInput.value = "";
    }

    if (preview) {
        preview.innerHTML = "Sem imagem";
    }

    if (sku) {
        sku.value = "";
    }

    if (barcode) {
        barcode.value = "";
    }

    if (title) {
        title.value = "";
    }

    if (brand) {
        brand.value = "";
    }

    if (model) {
        model.value = "";
    }

    if (category) {
        category.value = "";
    }

    if (salePrice) {
        salePrice.value = "";
    }

    if (quantity) {
        quantity.value = 1;
    }

    if (description) {
        description.value = "";
    }

    if (btnImproveAI) {
        btnImproveAI.style.display = "none";
    }

    if (observacaoVendedor) {
        observacaoVendedor.value = "";
    }

}

// ======================================================
// EVENTOS
// ======================================================

if (btnAnalyze) {
    btnAnalyze.addEventListener(
        "click",
        analyzePhoto
    );
}

if (btnSave) {
    btnSave.addEventListener(
        "click",
        saveProduct
    );
}

if (btnNew) {
    btnNew.addEventListener(
        "click",
        newProduct
    );
}

if (btnImproveAI) {
    btnImproveAI.addEventListener("click", corrigirRascunhoComIA);
}





