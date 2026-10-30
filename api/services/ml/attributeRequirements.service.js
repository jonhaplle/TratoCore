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
    for (const cause of extractValidationCauses(error)) {
        const code = String(cause?.code || "").trim();
        const message = String(cause?.message || "").trim();
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
        const definition = definitions.find(item => item.id === id) || {
            id,
            name: id,
            value_type: "string",
            values: []
        };
        unique.push({
            id: definition.id,
            name: definition.name || definition.id,
            value_type: definition.value_type || "string",
            value_max_length: definition.value_max_length,
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

module.exports = {
    getConditionalRequired,
    extractValidationCauses,
    extractMissingIdsFromValidation,
    buildMissing,
    mergeRequiredDefinitions
};
