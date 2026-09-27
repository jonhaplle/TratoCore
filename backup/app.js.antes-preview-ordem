// ======================================================
// TRATO CORE 0.6
// public/app.js
// ======================================================

const API_UPLOAD = "/api/upload";
const API_AI = "/api/ai/analyze";
const API_PRODUCTS = "/api/products";
const API_PRODUCT_IMAGES = "/api/product-images";

let uploadedPhoto = null;

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
// PREVIEW
// ======================================================

photoInput.addEventListener("change", () => {

    const file = photoInput.files[0];

    if (!file) {

        preview.innerHTML = "Sem imagem";
        return;

    }

    const reader = new FileReader();

    reader.onload = function (e) {

        preview.innerHTML = `
            <img src="${e.target.result}">
        `;

    };

    reader.readAsDataURL(file);

});

// ======================================================
// UPLOAD
// ======================================================

async function uploadPhoto() {

    const file = photoInput.files[0];

    if (!file) {

        alert("Selecione uma imagem.");
        return false;

    }

    const formData = new FormData();

    formData.append("imagem", file);

    const response = await fetch(API_UPLOAD, {

        method: "POST",
        body: formData

    });

    const json = await response.json();

    if (!json.sucesso) {

        alert(json.mensagem || "Erro no upload.");
        return false;

    }

    uploadedPhoto = json.arquivo;

    return true;

}

// ======================================================
// IA
// ======================================================

async function analyzePhoto() {

    try {

        const ok = await uploadPhoto();

        if (!ok) return;

        const response = await fetch(API_AI, {

            method: "POST",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify({

                imageUrl: window.location.origin + uploadedPhoto.originalUrl

            })

        });

        const json = await response.json();

        if (!json.sucesso) {

            alert(json.erro || "Erro na IA.");
            return;

        }

        const p = json.resultado;

        title.value = p.title || "";
        brand.value = p.brand || "";
        model.value = p.model || "";
        category.value = p.category || "";
        description.value = p.description || "";
        salePrice.value = p.suggested_price || "";

        alert("Produto analisado.");

    }

    catch (err) {

        console.error(err);

        alert("Erro ao comunicar com o servidor.");

    }

}

// ======================================================
// SALVAR PRODUTO
// ======================================================

async function saveProduct() {

    try {

        const response = await fetch(API_PRODUCTS, {

            method: "POST",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify({

                sku: sku.value,
                barcode: barcode.value,
                title: title.value,
                description: description.value,
                sale_price: Number(salePrice.value || 0),
                quantity: Number(quantity.value || 1),
                status: "NEW"

            })

        });

        const json = await response.json();

        if (!json.success) {

            alert(json.message || "Erro ao salvar produto.");
            return;

        }

        const product = json.data;
        const productId = product.id;

        // contin        // ======================================================
        // SALVAR IMAGEM DO PRODUTO
        // ======================================================

        if (uploadedPhoto) {

            const imgResponse = await fetch(API_PRODUCT_IMAGES, {

                method: "POST",

                headers: {

                    "Content-Type": "application/json"

                },

                body: JSON.stringify({

                    product_id: productId,

                    file_name: uploadedPhoto.fileName,

                    original_url: uploadedPhoto.originalUrl,

                    thumb_url: uploadedPhoto.thumbUrl,

                    mime_type: uploadedPhoto.mimeType,

                    width: uploadedPhoto.width,

                    height: uploadedPhoto.height,

                    file_size: uploadedPhoto.fileSize,

                    is_main: true,

                    sort_order: 1

                })

            });

            const imgJson = await imgResponse.json();

            if (!imgJson.success) {

                console.warn("Imagem não vinculada:", imgJson);

                alert(
                    "Produto salvo, porém ocorreu um erro ao vincular a imagem."
                );

                return;

            }

        }

        console.log(json);

        alert("Produto salvo com sucesso.");

        newProduct();

    }

    catch (err) {

        console.error(err);

        alert("Erro ao salvar.");

    }

}

// ======================================================
// LIMPAR
// ======================================================

function newProduct() {

    uploadedPhoto = null;

    photoInput.value = "";

    preview.innerHTML = "Sem imagem";

    sku.value = "";
    barcode.value = "";
    title.value = "";
    brand.value = "";
    model.value = "";
    category.value = "";
    salePrice.value = "";
    quantity.value = 1;
    description.value = "";

}

// ======================================================
// EVENTOS
// ======================================================

btnAnalyze.addEventListener("click", analyzePhoto);

btnSave.addEventListener("click", saveProduct);

btnNew.addEventListener("click", newProduct);

console.log("Trato Core 0.6 carregado.")