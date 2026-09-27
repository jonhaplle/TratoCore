// ======================================================
// TRATOCORE - CATALOG MATCHER
// Compara o produto identificado com produtos do catalogo ML
// Regra principal: melhor candidato != correspondencia segura.
// ======================================================

function clean(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function normalizeText(value) {
    return clean(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function tokenize(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter(Boolean);
}

function getAttribute(product, id) {
    const attribute = (product?.attributes || []).find(
        item => normalizeText(item.id) === normalizeText(id)
    );

    return attribute ? clean(attribute.value_name) : "";
}

function getAttributeValues(product, ids) {
    const wanted = new Set(ids.map(normalizeText));
    const values = [];

    for (const attribute of product?.attributes || []) {
        if (!wanted.has(normalizeText(attribute.id))) continue;

        if (clean(attribute.value_name)) {
            values.push(clean(attribute.value_name));
        }

        for (const value of attribute.values || []) {
            if (clean(value?.name)) values.push(clean(value.name));
        }
    }

    return [...new Set(values)];
}

function containsAny(text, words) {
    const normalized = normalizeText(text);

    return words.some(word =>
        normalized.includes(normalizeText(word))
    );
}

function candidateText(candidate) {
    return normalizeText([
        candidate?.name,
        ...(candidate?.attributes || []).map(a => a.value_name),
        ...getAttributeValues(candidate, [
            "BRAND", "LINE", "MODEL", "SUBMODEL", "GENERATION",
            "PLATFORM", "VIDEO_GAME_PLATFORM"
        ])
    ].join(" "));
}

function isXboxClassic(identified) {
    return (
        normalizeText(identified?.product_type) === "console" &&
        normalizeText(identified?.brand) === "microsoft" &&
        normalizeText(identified?.line) === "xbox" &&
        normalizeText(identified?.generation).includes("classic")
    );
}

function hasXboxLaterGeneration(candidate) {
    const text = candidateText(candidate);
    const submodel = normalizeText(getAttribute(candidate, "SUBMODEL"));
    const model = normalizeText(getAttribute(candidate, "MODEL"));
    const line = normalizeText(getAttribute(candidate, "LINE"));

    if (containsAny(text, [
        "xbox 360",
        "xbox one",
        "one s",
        "one x",
        "series s",
        "series x",
        "xbox series"
    ])) {
        return true;
    }

    // O catalogo do ML pode registrar Xbox Series S/X somente em SUBMODEL,
    // sem escrever "Series" no nome do produto. Nunca tratar isso como Xbox Classic.
    if (line === "xbox" && ["s", "x"].includes(submodel)) {
        return true;
    }

    // Alguns registros usam MODEL/SUBMODEL de forma inconsistente.
    if (
        model === "xbox one" ||
        model === "xbox series" ||
        containsAny(submodel, ["series s", "series x", "one s", "one x"])
    ) {
        return true;
    }

    return false;
}

function hasLaterXboxGeneration(candidate) {
    const text = candidateText(candidate);
    return containsAny(text, [
        "xbox 360",
        "xbox one",
        "one s",
        "one x",
        "series s",
        "series x",
        "xbox series"
    ]);
}

// ======================================================
// FILTRO DE INCOMPATIBILIDADE FORTE
// ======================================================

function isHardIncompatible(candidate, identified) {
    const text = candidateText(candidate);
    const productType = normalizeText(identified?.product_type);

    if (productType === "console") {
        if (containsAny(text, [
            "jogo",
            "game",
            "midia fisica",
            "dvd",
            "controle",
            "joystick",
            "gamepad",
            "controller",
            "cabo",
            "adaptador",
            "case",
            "capa",
            "fonte",
            "carregador"
        ])) {
            return true;
        }
    }

    if (isXboxClassic(identified) && hasXboxLaterGeneration(candidate)) {
        return true;
    }

    return false;
}

function scoreCandidate(candidate, identified) {
    const text = candidateText(candidate);
    const productType = normalizeText(identified?.product_type);
    const brand = normalizeText(identified?.brand);
    const line = normalizeText(identified?.line);
    const model = normalizeText(identified?.model);
    const generation = normalizeText(identified?.generation);
    const color = normalizeText(identified?.color);

    let score = 0;
    const reasons = [];
    const penalties = [];
    let generationCompatible = !generation;
    let generationEvidence = false;

    if (productType === "console") {
        if (candidate.domain_id === "MLB-GAME_CONSOLES") {
            score += 30;
            reasons.push("dominio de console");
        } else {
            score -= 40;
            penalties.push("nao pertence ao dominio de consoles");
        }
    }

    if (brand) {
        const candidateBrand = normalizeText(getAttribute(candidate, "BRAND"));

        if (candidateBrand === brand) {
            score += 20;
            reasons.push("marca compativel");
        } else if (candidateBrand) {
            score -= 25;
            penalties.push(`marca incompativel: ${candidateBrand}`);
        }
    }

    if (line) {
        const candidateLine = normalizeText(getAttribute(candidate, "LINE"));

        if (candidateLine === line) {
            score += 20;
            reasons.push("linha compativel");
        } else if (text.includes(line)) {
            score += 10;
            reasons.push("linha encontrada no catalogo");
        }
    }

    if (model) {
        const candidateModel = normalizeText(getAttribute(candidate, "MODEL"));

        if (candidateModel === model) {
            score += 25;
            reasons.push("modelo compativel");
        } else if (text.includes(model)) {
            score += 12;
            reasons.push("modelo encontrado no catalogo");
        }
    }

    if (generation) {
        if (isXboxClassic(identified)) {
            if (hasXboxLaterGeneration(candidate)) {
                generationCompatible = false;
                penalties.push("geracao posterior ao Xbox Classic");
            } else {
                // Para Xbox Classic, ausencia de marcador posterior já é
                // suficiente para participar; marcador explícito de Classic
                // recebe bônus adicional.
                generationCompatible = true;

                if (containsAny(text, [
                    "xbox classic",
                    "xbox classico",
                    "xbox original",
                    "primeira geracao",
                    "1a geracao",
                    "primeira geração"
                ])) {
                    generationEvidence = true;
                    score += 30;
                    reasons.push("geracao Xbox Classic confirmada");
                } else {
                    reasons.push("geracao nao contradiz Xbox Classic");
                }
            }
        } else {
            if (containsAny(text, [generation])) {
                generationCompatible = true;
                generationEvidence = true;
                score += 25;
                reasons.push("geracao compativel");
            } else {
                generationCompatible = false;
                penalties.push("geracao nao confirmada no catalogo");
            }
        }
    }

    if (color) {
        const candidateColor = normalizeText(getAttribute(candidate, "COLOR"));

        if (candidateColor === color) {
            score += 5;
            reasons.push("cor compativel");
        }
    }

    const identifiedTokens = tokenize([
        identified.brand,
        identified.line,
        identified.model,
        identified.generation
    ].join(" "));

    const matchedTokens = identifiedTokens.filter(token =>
        token.length >= 3 && text.includes(token)
    );

    if (matchedTokens.length) {
        const titleBonus = Math.min(matchedTokens.length * 2, 10);
        score += titleBonus;
        reasons.push(`${matchedTokens.length} termos identificadores encontrados`);
    }

    const hardIncompatible = isHardIncompatible(candidate, identified);
    const exactDomain = candidate.domain_id === "MLB-GAME_CONSOLES";

    // Critério de segurança: geração informada é determinante.
    // Sem compatibilidade de geração, o candidato não pode ser aceito.
    const safeMatch = !hardIncompatible &&
        (!productType || exactDomain || productType !== "console") &&
        (!generation || generationCompatible) &&
        (!isXboxClassic(identified) || !hasXboxLaterGeneration(candidate));

    return {
        score: Math.max(0, score),
        candidate,
        reasons,
        penalties,
        safe_match: safeMatch,
        generation_compatible: generationCompatible,
        generation_evidence: generationEvidence,
        hard_incompatible: hardIncompatible
    };
}

exports.findBestCatalogProduct = ({ candidates, identified }) => {
    if (!Array.isArray(candidates)) {
        throw new Error("Lista de candidatos invalida.");
    }

    if (!identified || typeof identified !== "object") {
        throw new Error("Produto identificado nao informado.");
    }

    const compatibleCandidates = candidates.filter(candidate =>
        !isHardIncompatible(candidate, identified)
    );

    const ranked = compatibleCandidates
        .map(candidate => scoreCandidate(candidate, identified))
        .sort((a, b) => b.score - a.score);

    const safeRanked = ranked.filter(item => item.safe_match);
    const best = safeRanked[0] || null;

    let confidence = "LOW";

    if (best) {
        if (best.score >= 85 && (!identified.generation || best.generation_evidence || isXboxClassic(identified))) {
            confidence = "HIGH";
        } else if (best.score >= 65) {
            confidence = "MEDIUM";
        }
    }

    return {
        best,
        confidence,
        ranked,
        candidates_received: candidates.length,
        candidates_removed_as_incompatible:
            candidates.length - compatibleCandidates.length,
        safe_candidates: safeRanked.length
    };
};

exports.scoreCandidate = scoreCandidate;
exports.normalizeText = normalizeText;
exports.isHardIncompatible = isHardIncompatible;
exports.getAttribute = getAttribute;
exports.hasXboxLaterGeneration = hasXboxLaterGeneration;
