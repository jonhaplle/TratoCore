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
// ANIMAÇÃO PROFISSIONAL DA IA
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
                A IA está analisando suas fotos
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
        A IA está analisando suas fotos
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
        "Conferindo características visuais...",
        "Usando as informações do vendedor...",
        "Preparando o anúncio..."
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

        titleEl.textContent = "Análise concluída";
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

        titleEl.textContent = "Não foi possível concluir";
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
// OBSERVAÇÃO DO VENDEDOR
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
        "Informe o que você sabe sobre o produto: se liga, funciona, foi testado, apresenta defeito, está incompleto, é vendido no estado, é destinado a técnico para reparo, etc.";

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
    label.textContent = "Observação do vendedor";
    label.style.display = "block";
    label.style.fontWeight = "600";
    label.style.marginBottom = "6px";

    const box = document.createElement("div");
    box.id = "observacaoVendedorBox";
    box.style.marginTop = "16px";
    box.style.marginBottom = "16px";

    const ajuda = document.createElement("div");
    ajuda.textContent =
        "A IA usará esta informação junto com as fotos. Ela não deve inventar funcionamento ou defeitos.";
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

    photoInput.addEventListener("change", async () => {

        const files = Array.from(photoInput.files || []);

        uploadedPhoto = null;
        uploadedPhotos = [];

        if (!files.length) {
            if (preview) {
                preview.innerHTML = "Sem imagem";
            }
            return;
        }

        if (files.length > 10) {
            alert("Você pode selecionar no máximo 10 fotos.");
            photoInput.value = "";
            if (preview) {
                preview.innerHTML = "Sem imagem";
            }
            return;
        }

        if (!preview) {
            return;
        }

        preview.innerHTML = "";

        // Leitura sequencial para preservar a ordem selecionada.
        for (let index = 0; index < files.length; index++) {

            const file = files[index];

            const reader = new FileReader();

            await new Promise((resolve, reject) => {

                reader.onload = function (e) {

                    const wrapper = document.createElement("div");

                    wrapper.className = "photo-preview-item";

                    wrapper.style.display = "inline-block";
                    wrapper.style.verticalAlign = "top";
                    wrapper.style.margin = "5px";
                    wrapper.style.textAlign = "center";

                    wrapper.innerHTML = `
                        <div style="position:relative;">
                            <img
                                src="${e.target.result}"
                                alt="Foto ${index + 1}"
                                style="width:120px;height:120px;object-fit:cover;border-radius:6px;border:1px solid #ccc;">
                        </div>
                        <span style="display:block;margin-top:4px;">
                            ${
                                index === 0
                                    ? "Principal"
                                    : String(index + 1)
                            }
                        </span>
                    `;

                    preview.appendChild(wrapper);

                    resolve();
                };

                reader.onerror = reject;

                reader.readAsDataURL(file);
            });
        }

    });

}

// ======================================================
// UPLOAD DE UMA FOTO
// ======================================================

async function uploadOnePhoto(file) {

    if (!file) {
        throw new Error("Arquivo de imagem não informado.");
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
        alert("Você pode selecionar no máximo 10 fotos.");
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

async function analyzePhoto() {

    mostrarAnimacaoIA();

    try {

        const ok = await uploadPhotos();

        if (!ok) {
            await finalizarAnimacaoIA(false);
            return;
        }

        if (!uploadedPhoto || !uploadedPhoto.originalUrl) {
            throw new Error("Imagem principal não retornada pelo upload.");
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

        aiProductType = p.product_type || "";
        aiLine = p.line || "";
        aiGeneration = p.generation || "";
        aiVersion = p.version || "";
        aiColor = p.color || "";
        aiCondition = p.condition || "used";
        aiConfidence = Number(p.confidence || 0);

        if (title) {
            title.value = p.title || "";
        }

        if (brand) {
            brand.value = p.brand || "";
        }

        if (model) {
            model.value = p.model || "";
        }

        if (category) {
            category.value = p.category || "";
        }

        if (description) {
            description.value = p.description || "";
        }

        if (salePrice) {
            salePrice.value = p.suggested_price || "";
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
            alert("O título do produto é obrigatório.");
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
                "Produto salvo, mas o servidor não retornou o ID."
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
                        "Produto salvo, porém ocorreu um erro ao vincular uma das imagens."
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
