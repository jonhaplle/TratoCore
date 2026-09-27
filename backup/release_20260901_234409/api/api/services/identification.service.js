// ======================================================
// TRATOCORE — IDENTIFICATION SERVICE
// ML-007 — Identificação Inteligente
// ======================================================

function clean(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value).trim();
}

function normalizeConfidence(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return 0;
    }

    if (number > 1) {
        return Math.min(number / 100, 1);
    }

    return Math.max(0, Math.min(number, 1));
}

function confidenceLevel(value) {
    const confidence = normalizeConfidence(value);

    if (confidence >= 0.90) {
        return "HIGH";
    }

    if (confidence >= 0.70) {
        return "MEDIUM";
    }

    return "LOW";
}

function createIdentificationResult(data = {}) {

    const input = data.input || {};
    const observations = data.observations || {};
    const facts = Array.isArray(data.facts)
        ? data.facts
        : [];
    const hypotheses = Array.isArray(data.hypotheses)
        ? data.hypotheses
        : [];
    const evidence = Array.isArray(data.evidence)
        ? data.evidence
        : [];

    const research = data.research || {
        queries: [],
        visual_results: [],
        web_results: []
    };

    const crossCheck = data.cross_check || {
        confirmed: [],
        contradictions: [],
        unresolved: []
    };

    const identification = data.identification || {};

    const rawConfidence =
        data.confidence?.score !== undefined
            ? data.confidence.score
            : observations.confidence;

    const score = Math.round(
        normalizeConfidence(rawConfidence) * 100
    );

    const confidence = {
        score,
        level: confidenceLevel(score),
        reasons: Array.isArray(data.confidence?.reasons)
            ? data.confidence.reasons
            : []
    };

    const catalogInput = data.catalog_input || {
        search_terms: [
            identification.brand,
            identification.line,
            identification.model,
            identification.product_type
        ].filter(Boolean),

        product_type: clean(identification.product_type),
        brand: clean(identification.brand),
        line: clean(identification.line),
        model: clean(identification.model),
        generation: clean(identification.generation)
    };

    const decision = data.decision || {
        status: "PROVISIONAL",
        reason:
            "Identificação inicial aguardando pesquisa e cruzamento de evidências."
    };

    return {

        schema_version: "1.0",

        input: {
            product_id: input.product_id || null,

            image_ids: Array.isArray(input.image_ids)
                ? input.image_ids
                : [],

            image_count:
                Number(input.image_count) ||
                (Array.isArray(input.image_ids)
                    ? input.image_ids.length
                    : 0)
        },

        observations,

        facts,

        hypotheses,

        evidence,

        research,

        cross_check: crossCheck,

        identification: {

            product_type:
                clean(identification.product_type),

            brand:
                clean(identification.brand),

            line:
                clean(identification.line),

            model:
                clean(identification.model),

            generation:
                clean(identification.generation),

            version:
                clean(identification.version),

            color:
                clean(identification.color),

            condition:
                clean(identification.condition)
        },

        confidence,

        catalog_input: catalogInput,

        decision
    };
}


// ======================================================
// CONVERTE A IDENTIFICAÇÃO PARA O CATALOG MATCHER
// ======================================================

function toCatalogMatcherInput(result) {

    const identification =
        result?.identification || {};

    return {

        product_type:
            clean(identification.product_type),

        brand:
            clean(identification.brand),

        line:
            clean(identification.line),

        model:
            clean(identification.model),

        generation:
            clean(identification.generation),

        version:
            clean(identification.version),

        color:
            clean(identification.color),

        condition:
            clean(identification.condition)
    };
}


// ======================================================
// FATOS DO VENDEDOR
// ======================================================

function createSellerFact(observacaoVendedor) {

    const observation =
        clean(observacaoVendedor);

    if (!observation) {
        return null;
    }

    return {

        field: "seller_observation",

        value: observation,

        source: "seller",

        confidence: 1.0
    };
}


module.exports = {

    createIdentificationResult,

    toCatalogMatcherInput,

    createSellerFact
};