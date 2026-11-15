function chooseShippingMode(userPreferences, categoryPreferences) {
    const userModes = Array.isArray(userPreferences?.modes)
        ? userPreferences.modes.map(String)
        : [];

    const categoryModes = Array.isArray(categoryPreferences?.logistics)
        ? categoryPreferences.logistics
            .map(item => String(item?.mode || "").trim())
            .filter(Boolean)
        : [];

    const allowed = new Set(categoryModes);
    const candidates = ["me2", "me1", "not_specified", "custom"];

    for (const mode of candidates) {
        if (userModes.includes(mode) && allowed.has(mode)) return mode;
    }

    if (!categoryModes.length) {
        for (const mode of candidates) {
            if (userModes.includes(mode)) return mode;
        }
    }

    return null;
}

async function resolveShipping(apiService, categoryId) {
    try {
        const me = await apiService.getMe();
        const userId = me?.id;
        if (!userId) return null;

        const [userPreferences, categoryPreferences] = await Promise.all([
            apiService.getShippingPreferences(userId),
            apiService.getCategoryShippingPreferences(categoryId)
        ]);

        const mode = chooseShippingMode(userPreferences, categoryPreferences);
        if (!mode) return null;

        return { mode, local_pick_up: false, free_shipping: false };
    } catch (error) {
        console.warn("[Shipping] Não foi possível resolver a modalidade:", error.message);
        return null;
    }
}

module.exports = { chooseShippingMode, resolveShipping };
