const ProductService = require("../services/productService");

// ======================================================
// LISTAR TODOS
// ======================================================

async function getAll(req, res) {

    try {

        const products = await ProductService.getAll();

        return res.status(200).json(products);

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================
// BUSCAR POR ID
// ======================================================

async function getById(req, res) {

    try {

        const product = await ProductService.getById(req.params.id);

        if (!product) {

            return res.status(404).json({

                success: false,
                message: "Produto não encontrado."

            });

        }

        return res.status(200).json(product);

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================
// CADASTRAR
// ======================================================

async function create(req, res) {

    try {

        const product = await ProductService.create(req.body);

        return res.status(201).json({

            success: true,
            message: "Produto cadastrado com sucesso.",

            data: product

        });

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================
// ATUALIZAR
// ======================================================

async function update(req, res) {

    try {

        const product = await ProductService.update(

            req.params.id,
            req.body

        );

        if (!product) {

            return res.status(404).json({

                success: false,
                message: "Produto não encontrado."

            });

        }

        return res.status(200).json({

            success: true,
            message: "Produto atualizado.",

            data: product

        });

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================
// REMOVER
// ======================================================

async function remove(req, res) {

    try {

        await ProductService.remove(req.params.id);

        return res.status(200).json({

            success: true,
            message: "Produto removido."

        });

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

module.exports = {

    getAll,
    getById,
    create,
    update,
    remove

};