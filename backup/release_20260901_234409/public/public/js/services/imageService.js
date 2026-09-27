class ImageService {

    async list(productId) {
        return await api.get(`/product-images/product/${productId}`);
    }

}

window.imageService = new ImageService();
