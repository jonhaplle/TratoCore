class ProductService {

    async list() {
        return await api.get("/products");
    }

    async get(id) {
        return await api.get(`/products/${id}`);
    }

    async create(data) {
        return await api.post("/products", data);
    }

    async update(id, data) {
        return await api.put(`/products/${id}`, data);
    }

    async delete(id) {
        return await api.delete(`/products/${id}`);
    }

}

window.productService = new ProductService();