const test = require("node:test");
const assert = require("node:assert/strict");
const { createPublicationDiagnostic } = require("./publicationDiagnostic.service");

function fixtures(listingTypes = [
    { id: "gold_pro", name: "Premium" },
    { id: "gold_special", name: "Clássico" }
], validationError = null) {
    const calls = { conditional: [], searches: 0, bulk: [], publications: 0 };
    const productService = {
        async getById(id) {
            assert.equal(id, "10");
            return {
                id: "10",
                title: "Saca-rolhas Manual Prateado Cabo T",
                description: "Saca-rolhas usado.",
                sale_price: 25,
                quantity: 1,
                condition: "used",
                ml_listing_type: "gold_pro"
            };
        }
    };
    const apiService = {
        async getMe() { return { id: 123456, nickname: "must-not-be-returned" }; },
        async getCategoryAttributes() {
            return [
                { id: "BRAND", name: "Marca", value_type: "string", tags: { required: true } },
                { id: "MODEL", name: "Modelo", value_type: "string", tags: { required: true } },
                { id: "MATERIAL", name: "Material", value_type: "string", tags: {} },
                { id: "GTIN", name: "GTIN", value_type: "string", tags: { conditional_required: true } }
            ];
        },
        async getCategory() { return { id: "MLB193633", settings: { max_title_length: 60 } }; },
        async predictCategory() {
            return [{ category_id: "MLB193633", attributes: [{ id: "MATERIAL", value_name: "Prata" }] }];
        },
        async getAvailableListingTypes() { return { available: listingTypes }; },
        async getConditionalAttributes(categoryId, payload) {
            calls.conditional.push({ categoryId, payload });
            return { required_attributes: [{ id: "EMPTY_GTIN_REASON", name: "Motivo de GTIN vazio" }] };
        },
        async validateItem(payload) {
            calls.validation = payload;
            if (validationError) throw validationError;
            return {};
        },
        async searchUserItems(userId, params) {
            calls.searches += 1;
            assert.equal(userId, 123456);
            assert.equal(params.limit, 100);
            return { paging: { total: 2 }, results: ["MLB111", "MLB222"] };
        },
        async getItemsBulk(ids) {
            calls.bulk.push(ids);
            return [
                { id: "MLB111", status_code: 200, body: { id: "MLB111", title: "Saca-rolhas manual antigo", category_id: "MLB193633", status: "active" } },
                { id: "MLB222", status_code: 200, body: { id: "MLB222", title: "Abridor de latas", category_id: "MLB193633", status: "active" } }
            ];
        },
        async publishItem() { calls.publications += 1; throw new Error("must not publish"); }
    };
    return { productService, apiService, calls };
}

test("diagnostic returns listing, conditional attributes and possible active matches without publication", async () => {
    const f = fixtures();
    const run = createPublicationDiagnostic(f);
    const result = await run();

    assert.equal(result.listing_types.preferred_available, true);
    assert.deepEqual(result.listing_types.available.map(item => item.id), ["gold_pro", "gold_special"]);
    assert.equal(result.conditional_validation.listing_type_tested, "gold_pro");
    assert.deepEqual(result.conditional_validation.result.required_attributes.map(item => item.id), ["EMPTY_GTIN_REASON"]);
    assert.deepEqual(result.duplicate_check.possible_matches.map(item => item.id), ["MLB111"]);
    assert.equal(f.calls.conditional.length, 1);
    assert.equal(f.calls.conditional[0].categoryId, "MLB193633");
    assert.equal(f.calls.conditional[0].payload.attributes.some(item => item.id === "MATERIAL"), false);
    assert.equal(f.calls.conditional[0].payload.attributes.some(item => item.id === "BRAND" || item.id === "MODEL"), false);
    assert.equal(f.calls.validation.attributes.some(item => item.id === "MATERIAL"), false);
    assert.equal(f.calls.validation.attributes.some(item => item.id === "EMPTY_GTIN_REASON"), false);
    assert.equal(f.calls.validation.attributes.some(item => /prata|aço/i.test(item.value_name || "")), false);
    assert.equal(result.missing_attributes.some(item => item.id === "BRAND"), true);
    assert.equal(result.missing_attributes.some(item => item.id === "MODEL"), true);
    assert.equal(JSON.stringify(result).includes("must-not-be-returned"), false);
    assert.equal(f.calls.publications, 0);
});

test("diagnostic reports MATERIAL required by official validation and does not infer its value", async () => {
    const validationError = Object.assign(new Error("validation failed"), {
        response: {
            status: 400,
            data: {
                cause: [{
                    code: "item.attribute.missing_required",
                    message: "The attributes [MATERIAL] are required for this category"
                }]
            }
        }
    });
    const f = fixtures(undefined, validationError);
    const result = await createPublicationDiagnostic(f)();

    assert.equal(result.official_validation.passed, false);
    assert.deepEqual(result.official_validation.missing_attributes.map(item => item.id), ["MATERIAL"]);
    assert.equal(result.required_attributes.some(item => item.id === "MATERIAL"), true);
    assert.equal(result.missing_attributes.some(item => item.id === "MATERIAL"), true);
    assert.equal(f.calls.validation.attributes.some(item => item.id === "MATERIAL"), false);
    assert.equal(f.calls.validation.attributes.some(item => item.id === "EMPTY_GTIN_REASON"), false);
    assert.equal(f.calls.validation.attributes.some(item => /prata|aço/i.test(item.value_name || "")), false);
    assert.equal(f.calls.publications, 0);
});

test("diagnostic uses an available alternative only for conditional checking when preferred type is unavailable", async () => {
    const f = fixtures([{ id: "gold_special", name: "Clássico" }]);
    const run = createPublicationDiagnostic(f);
    const result = await run();

    assert.equal(result.listing_types.preferred_available, false);
    assert.equal(result.conditional_validation.listing_type_tested, "gold_special");
    assert.equal(result.conditional_validation.preferred_type_tested, false);
});
