function getConditionalRequired(value) {
    const conditional = value?.conditionalAttributes || value;
    return Array.isArray(conditional?.required_attributes)
        ? conditional.required_attributes
        : [];
}

function extractValidationCauses(error) {
    const data = error?.response?.data || error?.data || error;
    return Array.isArray(data?.cause) ? data.cause : [];
}

function extractMissingIdsFromValidation(error) {
    const ids = [];
    const packageIds = [
        "SELLER_PACKAGE_HEIGHT",
        "SELLER_PACKAGE_WIDTH",
        "SELLER_PACKAGE_LENGTH",
        "SELLER_PACKAGE_WEIGHT"
    ];

    for (const cause of extractValidationCauses(error)) {
        const code = String(cause?.code || "").trim().toLowerCase();
        const message = String(cause?.message || "").trim();

        // O Mercado Livre exige estes quatro atributos para ME2 mesmo quando
        // eles não aparecem como required na resposta da categoria.
        if (code.includes("seller.package.dimensions")) {
            for (const id of packageIds) {
                if (!ids.includes(id)) ids.push(id);
            }
            continue;
        }

        if (!code.includes("missing_required") && !code.includes("missing_conditional_required")) continue;

        const matches = message.match(/attributes?\s*\[([^\]]+)\]/i);
        if (!matches) continue;
        for (const id of matches[1].split(",")) {
            const cleanId = id.trim();
            if (cleanId && !ids.includes(cleanId)) ids.push(cleanId);
        }
    }
    return ids;
}

function buildMissing(publicationSpec, ids) {
    const definitions = Array.isArray(publicationSpec)
        ? publicationSpec
        : publicationSpec?.attributes || [];
    const unique = [];

    for (const id of ids || []) {
        if (!id || unique.some(item => item.id === id)) continue;
        const packageUnits = {
            SELLER_PACKAGE_HEIGHT: "cm",
            SELLER_PACKAGE_WIDTH: "cm",
            SELLER_PACKAGE_LENGTH: "cm",
            SELLER_PACKAGE_WEIGHT: "g"
        };
        const packageLabels = {
            SELLER_PACKAGE_HEIGHT: "Altura da embalagem",
            SELLER_PACKAGE_WIDTH: "Largura da embalagem",
            SELLER_PACKAGE_LENGTH: "Comprimento da embalagem",
            SELLER_PACKAGE_WEIGHT: "Peso da embalagem"
        };
        const unit = packageUnits[id];
        const definition = definitions.find(item => item.id === id) || {
            id,
            name: packageLabels[id] || id,
            value_type: unit ? "number" : "string",
            values: []
        };
        unique.push({
            id: definition.id,
            name: definition.name || packageLabels[id] || definition.id,
            value_type: unit ? "number" : (definition.value_type || "string"),
            value_max_length: unit ? 10 : definition.value_max_length,
            unit: unit || undefined,
            values: Array.isArray(definition.values) ? definition.values : []
        });
    }
    return unique;
}

function mergeRequiredDefinitions(categoryAttributes, conditionalAttributes, extraIds = []) {
    const definitions = Array.isArray(categoryAttributes) ? categoryAttributes : [];
    const required = new Map();

    for (const definition of definitions) {
        if (definition?.id && definition.tags?.required === true) required.set(definition.id, definition);
    }
    for (const definition of getConditionalRequired(conditionalAttributes)) {
        const id = typeof definition === "string" ? definition : definition?.id;
        if (!id) continue;
        const categoryDefinition = definitions.find(item => item.id === id);
        required.set(id, {
            ...(categoryDefinition || {}),
            ...(typeof definition === "object" ? definition : {}),
            id,
            tags: { ...(categoryDefinition?.tags || {}), ...(definition?.tags || {}), required: true }
        });
    }
    for (const id of extraIds || []) {
        if (!id || required.has(id)) continue;
        required.set(id, definitions.find(item => item.id === id) || { id, name: id, value_type: "string" });
    }
    return [...required.values()];
}

/**
 * Traduz os metadados oficiais da categoria do Mercado Livre para uma
 * classificação comercial usada na tela de revisão do Vendedor Automático.
 *
 * Uma exigência só existe quando o próprio Mercado Livre a declara:
 * - required: tags.required === true
 * - conditional_required: apareceu em attributes/conditional.required_attributes
 * - optional: existe na categoria, mas não é exigida pela API
 *
 * Função ADITIVA: não altera as demais funções deste módulo.
 */
function classifyDefinitions(categoryAttributes, conditionalAttributes) {
    const definitions = Array.isArray(categoryAttributes) ? categoryAttributes : [];
    const conditionalIds = new Set(
        getConditionalRequired(conditionalAttributes)
            .map(item => (typeof item === "string" ? item : item?.id))
            .filter(Boolean)
    );

    return definitions
        .filter(definition => definition?.id)
        .map(definition => {
            const tags = definition.tags || {};
            let requirement = "optional";

            if (tags.required === true) {
                requirement = "required";
            } else if (conditionalIds.has(definition.id)) {
                requirement = "conditional_required";
            }

            return {
                id: definition.id,
                name: definition.name || definition.id,
                value_type: definition.value_type || "string",
                value_max_length: definition.value_max_length,
                allowed_units: Array.isArray(definition.allowed_units)
                    ? definition.allowed_units
                    : [],
                default_unit: definition.default_unit,
                requirement,
                tags: {
                    required: tags.required === true,
                    catalog_required: tags.catalog_required === true,
                    allow_variations: tags.allow_variations === true,
                    hidden: tags.hidden === true,
                    read_only: tags.read_only === true,
                    fixed: tags.fixed === true
                },
                values: Array.isArray(definition.values)
                    ? definition.values.map(value => ({
                        id: String(value.id),
                        name: value.name || String(value.id)
                    }))
                    : []
            };
        });
}

/** Literal do que o Mercado Livre já exige antes de qualquer validação. */
function declaredRequirements(categoryAttributes, conditionalAttributes) {
    const classified = classifyDefinitions(categoryAttributes, conditionalAttributes);

    return {
        required: classified.filter(item => item.requirement === "required"),
        conditional_required: classified.filter(item => item.requirement === "conditional_required"),
        optional: classified.filter(item => item.requirement === "optional")
    };
}

module.exports = {
    getConditionalRequired,
    classifyDefinitions,
    declaredRequirements,
    extractValidationCauses,
    extractMissingIdsFromValidation,
    buildMissing,
    mergeRequiredDefinitions
};
