class ImageService {

    async list(productId) {
        return await api.get(`/product-images/${productId}`);
    }

}

window.imageService = new ImageService();