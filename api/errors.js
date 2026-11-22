/**
 * Erros de validação de entrada.
 *
 * Diferente de uma falha interna, um dado inválido enviado pelo cliente
 * deve resultar em HTTP 400 — não 500. O 500 faz o chamador acreditar
 * que o servidor quebrou quando, na verdade, a requisição estava errada.
 */
class ValidationError extends Error {
    constructor(message, code = "VALIDATION_ERROR") {
        super(message);
        this.name = "ValidationError";
        this.status = 400;
        this.code = code;
    }
}

/** O produto não existe: 404, também não é falha interna. */
class NotFoundError extends Error {
    constructor(message = "Produto não encontrado.") {
        super(message);
        this.name = "NotFoundError";
        this.status = 404;
        this.code = "NOT_FOUND";
    }
}

/**
 * Responde ao cliente com o status correto para o tipo de erro.
 *
 * 400 — dado de entrada inválido
 * 404 — recurso inexistente
 * 500 — falha interna (só estes são registrados no log do servidor)
 */
function responderErro(res, err) {
    const status = Number(err?.status) || 500;

    if (status >= 500) {
        console.error(err);
    }

    return res.status(status).json({
        success: false,
        message: err?.message || "Erro interno.",
        ...(err?.code ? { code: err.code } : {})
    });
}

module.exports = { ValidationError, NotFoundError, responderErro };
