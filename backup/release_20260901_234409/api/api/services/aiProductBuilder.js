class AIProductBuilder {

    static build(aiResult = {}) {

        return {

            product: {

                type: aiResult.product_type || "",
                brand: aiResult.brand || "",
                model: aiResult.model || "",
                color: aiResult.color || "",
                condition: aiResult.condition || "",
                category: aiResult.category || ""

            },

            listing: {

                title: aiResult.title || "",
                description: aiResult.description || "",
                suggested_price: Number(aiResult.suggested_price || 0)

            },

            analysis: {

                confidence: Number(aiResult.confidence || 0),
                generated_at: new Date().toISOString()

            }

        };

    }

}

module.exports = AIProductBuilder;
