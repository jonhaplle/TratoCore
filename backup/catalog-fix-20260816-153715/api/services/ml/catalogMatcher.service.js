// ======================================================
// TRATOCORE - CATALOG MATCHER
// Compara o produto identificado com produtos do catalogo ML
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

function containsAny(text, words) {
    const normalized = normalizeText(text);

    return words.some(word =>
        normalized.includes(normalizeText(word))
    );
}

// ======================================================
// FILTRO DE INCOMPATIBILIDADE FORTE
// Remove candidatos que nao devem participar do ranking.
// ======================================================

function isHardIncompatible(candidate, identified) {
    const candidateText = normalizeText(
        [
            candidate?.name,
            ...(candidate?.attributes || []).map(a => a.value_name)
        ].join(" ")
    );

    const productType = normalizeText(identified?.product_type);
    const generation = normalizeText(identified?.generation);

    if (productType === "console") {
        if (containsAny(candidateText, [
            "jogo",
            "game",
            "midia fisica",
            "dvd"
        ])) {
            return true;
        }

        if (containsAny(candidateText, [
            "controle",
            "joystick",
            "gamepad",
            "controller"
        ])) {
            return true;
        }

        if (containsAny(candidateText, [
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

    // Xbox Classic nunca deve casar com geracoes posteriores.
    if (
        productType === "console" &&
        generation.includes("classic")
    ) {
        if (containsAny(candidateText, [
            "series x",
            "series s",
            "xbox one",
            "one s",
            "one x"
        ])) {
            return true;
        }
    }

    return false;
}

function scoreCandidate(candidate, identified) {
    const candidateName = clean(candidate.name);

    const candidateText = normalizeText(
        [
            candidateName,
            ...(candidate.attributes || []).map(a => a.value_name)
        ].join(" ")
    );

    let score = 0;
    const reasons = [];
    const penalties = [];

    // ==================================================
    // TIPO DO PRODUTO
    // ==================================================

    const productType = normalizeText(identified.product_type);

    if (productType === "console") {
        if (candidate.domain_id === "MLB-GAME_CONSOLES") {
            score += 30;
            reasons.push("dominio de console");
        } else {
            score -= 40;
            penalties.push("nao pertence ao dominio de consoles");
        }

        if (containsAny(candidateText, [
            "jogo",
            "game",
            "midia fisica",
            "dvd"
        ])) {
            score -= 80;
            penalties.push("parece ser jogo");
        }

        if (containsAny(candidateText, [
            "controle",
            "joystick",
            "gamepad",
            "controller"
        ])) {
            score -= 80;
            penalties.push("parece ser controle");
        }

        if (containsAny(candidateText, [
            "cabo",
            "adaptador",
            "case",
            "capa",
            "fonte",
            "carregador"
        ])) {
            score -= 70;
            penalties.push("parece ser acessorio");
        }
    }

    // ==================================================
    // MARCA
    // ==================================================

    const brand = normalizeText(identified.brand);

    if (brand) {
        const candidateBrand = normalizeText(
            getAttribute(candidate, "BRAND")
        );

        if (candidateBrand === brand) {
            score += 20;
            reasons.push("marca compativel");
        } else if (candidateBrand) {
            score -= 25;
            penalties.push(
                `marca incompativel: ${candidateBrand}`
            );
        }
    }

    // ==================================================
    // LINHA
    // ==================================================

    const line = normalizeText(identified.line);

    if (line) {
        const candidateLine = normalizeText(
            getAttribute(candidate, "LINE")
        );

        if (
            candidateLine === line ||
            candidateText.includes(line)
        ) {
            score += 20;
            reasons.push("linha compativel");
        }
    }

    // ==================================================
    // MODELO
    // ==================================================

    const model = normalizeText(identified.model);

    if (model) {
        const candidateModel = normalizeText(
            getAttribute(candidate, "MODEL")
        );

        if (
            candidateModel === model ||
            candidateText.includes(model)
        ) {
            score += 25;
            reasons.push("modelo compativel");
        }
    }

    // ==================================================
    // GERACAO
    // ==================================================

    const generation = normalizeText(identified.generation);

    if (generation) {
        const incompatibleGenerations = [
            "series x",
            "series s",
            "xbox one",
            "one s",
            "one x"
        ];

        if (
            generation.includes("classic") &&
            containsAny(candidateText, incompatibleGenerations)
        ) {
            score -= 100;
            penalties.push(
                "geracao incompativel com Xbox Classic"
            );
        }

        if (
            generation.includes("classic") &&
            containsAny(candidateText, [
                "xbox classic",
                "xbox classico",
                "primeira geracao"
            ])
        ) {
            score += 25;
            reasons.push("geracao compativel");
        }
    }

    // ==================================================
    // COR
    // ==================================================

    const color = normalizeText(identified.color);

    if (color) {
        const candidateColor = normalizeText(
            getAttribute(candidate, "COLOR")
        );

        if (candidateColor === color) {
            score += 5;
            reasons.push("cor compativel");
        }
    }

    // ==================================================
    // TITULO
    // ==================================================

    const identifiedTokens = tokenize(
        [
            identified.brand,
            identified.line,
            identified.model,
            identified.generation
        ].join(" ")
    );

    const matchedTokens = identifiedTokens.filter(
        token =>
            token.length >= 3 &&
            candidateText.includes(token)
    );

    if (matchedTokens.length) {
        const titleBonus = Math.min(
            matchedTokens.length * 2,
            10
        );

        score += titleBonus;

        reasons.push(
            `${matchedTokens.length} termos identificadores encontrados`
        );
    }

    return {
        score: Math.max(0, score),
        candidate,
        reasons,
        penalties
    };
}

// ======================================================
// ENCONTRA O MELHOR PRODUTO
// ======================================================

exports.findBestCatalogProduct = ({
    candidates,
    identified
}) => {
    if (!Array.isArray(candidates)) {
        throw new Error("Lista de candidatos invalida.");
    }

    if (!identified || typeof identified !== "object") {
        throw new Error("Produto identificado nao informado.");
    }

    // Primeiro elimina incompatibilidades fortes.
    // Somente depois faz o ranking.
    const compatibleCandidates = candidates.filter(
        candidate =>
            !isHardIncompatible(candidate, identified)
    );

    const ranked = compatibleCandidates
        .map(candidate =>
            scoreCandidate(candidate, identified)
        )
        .sort((a, b) => b.score - a.score);

    const best = ranked[0] || null;

    let confidence = "LOW";

    if (best) {
        if (best.score >= 80) {
            confidence = "HIGH";
        } else if (best.score >= 60) {
            confidence = "MEDIUM";
        }
    }

    return {
        best,
        confidence,
        ranked,
        candidates_received: candidates.length,
        candidates_removed_as_incompatible:
            candidates.length - compatibleCandidates.length
    };
};

exports.scoreCandidate = scoreCandidate;
exports.normalizeText = normalizeText;
exports.isHardIncompatible = isHardIncompatible;
