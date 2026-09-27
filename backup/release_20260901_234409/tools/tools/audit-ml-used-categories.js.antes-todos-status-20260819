const fs = require("fs");
const path = require("path");
const api = require("../api/services/ml/api.service");

const args = new Set(process.argv.slice(2));
const shouldValidate = args.has("--validate");
const limit = Number(
    process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] || 1000
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function uniq(arr) {
    return [...new Set(arr.filter(Boolean))];
}

function attrById(attributes, id) {
    return (attributes || []).find(a => a && a.id === id) || null;
}

function compactCauses(data) {
    return (data?.cause || []).map(c => ({
        code: c.code,
        type: c.type,
        cause_id: c.cause_id,
        message: c.message
    }));
}

async function getAllItemIds(userId) {
    const ids = [];
    let offset = 0;
    const pageSize = 50;

    while (ids.length < limit) {
        const page = await api.searchUserItems(userId, {
            offset,
            limit: Math.min(pageSize, limit - ids.length),
            status: "active"
        });

        const results = Array.isArray(page?.results) ? page.results : [];
        ids.push(...results);

        if (results.length < pageSize) break;
        offset += pageSize;
        await sleep(150);
    }

    return uniq(ids).slice(0, limit);
}

async function main() {
    console.log("==============================================");
    console.log("TRATOCORE — AUDITORIA DE CATEGORIAS / USADOS");
    console.log("==============================================");
    console.log("Modo:", shouldValidate ? "AUDITORIA + VALIDATE" : "AUDITORIA");
    console.log("Limite:", limit);

    const me = await api.getMe();
    const shipping = await api.getShippingPreferences(me.id);

    console.log("");
    console.log("Conta:", me.nickname);
    console.log("User ID:", me.id);
    console.log("Shipping modes:", JSON.stringify(shipping?.modes || []));
    console.log("ME2 ativo:", (shipping?.modes || []).includes("me2"));

    const itemIds = await getAllItemIds(me.id);

    console.log("");
    console.log("Anúncios ativos encontrados:", itemIds.length);

    const items = [];
    for (const itemId of itemIds) {
        try {
            const item = await api.getItem(itemId);
            items.push(item);
            process.stdout.write(".");
            await sleep(120);
        } catch (err) {
            console.log("");
            console.log("ERRO item", itemId, err.response?.data || err.message);
        }
    }

    console.log("");
    console.log("");

    const categoryMap = new Map();

    for (const item of items) {
        const categoryId = item.category_id || "SEM_CATEGORIA";

        if (!categoryMap.has(categoryId)) {
            categoryMap.set(categoryId, {
                category_id: categoryId,
                item_ids: [],
                used_count: 0,
                new_count: 0,
                with_gtin: 0,
                without_gtin: 0,
                with_empty_gtin_reason: 0,
                with_item_condition: 0,
                title_samples: []
            });
        }

        const row = categoryMap.get(categoryId);
        row.item_ids.push(item.id);

        if (item.condition === "used") row.used_count++;
        else if (item.condition === "new") row.new_count++;

        const gtin = attrById(item.attributes, "GTIN");
        const emptyReason = attrById(item.attributes, "EMPTY_GTIN_REASON");
        const itemCondition = attrById(item.attributes, "ITEM_CONDITION");

        if (gtin?.value_name || gtin?.value_id) row.with_gtin++;
        else row.without_gtin++;

        if (emptyReason) row.with_empty_gtin_reason++;
        if (itemCondition) row.with_item_condition++;

        if (row.title_samples.length < 3 && item.title) {
            row.title_samples.push(item.title);
        }
    }

    const report = {
        generated_at: new Date().toISOString(),
        account: {
            id: me.id,
            nickname: me.nickname
        },
        shipping: {
            modes: shipping?.modes || [],
            me2_active: (shipping?.modes || []).includes("me2")
        },
        total_active_items: items.length,
        categories: []
    };

    for (const row of categoryMap.values()) {
        let category = null;
        let definitions = [];
        let conditional = null;
        let representative = null;

        try {
            category = await api.getCategory(row.category_id);
            definitions = await api.getCategoryAttributes(row.category_id);

            representative = items.find(
                item => item.category_id === row.category_id && item.condition === "used"
            ) || items.find(item => item.category_id === row.category_id);

            if (representative) {
                const payload = {
                    title: representative.title,
                    category_id: representative.category_id,
                    price: Number(representative.price),
                    currency_id: representative.currency_id || "BRL",
                    available_quantity: Math.max(1, Number(representative.available_quantity || 1)),
                    buying_mode: representative.buying_mode || "buy_it_now",
                    condition: representative.condition || "used",
                    listing_type_id: representative.listing_type_id,
                    attributes: representative.attributes || []
                };

                conditional = await api.getConditionalAttributes(
                    row.category_id,
                    payload
                );
            }
        } catch (err) {
            row.category_error = err.response?.data || err.message;
        }

        const required = definitions
            .filter(d => d?.tags?.required === true && !d?.tags?.hidden && !d?.tags?.read_only)
            .map(d => ({
                id: d.id,
                name: d.name,
                value_type: d.value_type
            }));

        const conditionalRequired =
            conditional?.required_attributes ||
            conditional?.required ||
            [];

        report.categories.push({
            ...row,
            category_name: category?.name || null,
            required_attributes: required,
            conditional_required_attributes: conditionalRequired,
            conditional_status: conditional?.status ?? null,
            representative_item_id: representative?.id || null
        });

        await sleep(150);
    }

    if (shouldValidate) {
        console.log("Executando validate em 1 anúncio representativo por categoria...");
        for (const row of report.categories) {
            if (!row.representative_item_id) continue;

            const item = items.find(i => i.id === row.representative_item_id);
            if (!item) continue;

            try {
                await api.validateItem(item);
                row.validation = {
                    status: "accepted",
                    causes: []
                };
            } catch (err) {
                const data = err.response?.data || err.data || {};
                row.validation = {
                    status: "rejected",
                    causes: compactCauses(data)
                };
            }

            await sleep(200);
        }
    }

    const outDir = path.join("logs", "ml-audit");
    fs.mkdirSync(outDir, { recursive: true });

    const file = path.join(
        outDir,
        `used-categories-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );

    fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");

    console.log("");
    console.log("==============================================");
    console.log("AUDITORIA CONCLUÍDA");
    console.log("==============================================");
    console.log("Categorias:", report.categories.length);
    console.log("Arquivo:", file);
    console.log("");

    for (const c of report.categories.sort((a, b) =>
        String(a.category_id).localeCompare(String(b.category_id))
    )) {
        console.log(
            `${c.category_id} | ${c.category_name || "N/A"} | ` +
            `ativos=${c.item_ids.length} | usados=${c.used_count} | ` +
            `semGTIN=${c.without_gtin} | ITEM_CONDITION=${c.with_item_condition}`
        );

        if (c.required_attributes.length) {
            console.log(
                "  required:",
                c.required_attributes.map(a => a.id).join(", ")
            );
        }

        if (Array.isArray(c.conditional_required_attributes) &&
            c.conditional_required_attributes.length) {
            console.log(
                "  conditional:",
                c.conditional_required_attributes.map(a =>
                    typeof a === "string" ? a : a.id || a.name || JSON.stringify(a)
                ).join(", ")
            );
        }

        if (c.validation) {
            console.log("  validate:", c.validation.status);
            for (const cause of c.validation.causes || []) {
                console.log(`    - ${cause.code}: ${cause.message}`);
            }
        }
    }
}

main().catch(err => {
    console.error("");
    console.error("==============================================");
    console.error("ERRO NA AUDITORIA");
    console.error("==============================================");
    console.error(err.response?.data || err.message || err);
    process.exit(1);
});
