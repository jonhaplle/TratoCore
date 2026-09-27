class Api {

    constructor(baseUrl = "/api") {
        this.baseUrl = baseUrl;
    }

    async request(endpoint, options = {}) {

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            ...options
        });

        let data = {};

        try {
            data = await response.json();
        } catch (_) {}

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.erro ||
                "Erro na comunicação com o servidor."
            );
        }

        return data;
    }

    get(endpoint) {
        return this.request(endpoint);
    }

    post(endpoint, body) {
        return this.request(endpoint, {
            method: "POST",
            body: JSON.stringify(body)
        });
    }

    put(endpoint, body) {
        return this.request(endpoint, {
            method: "PUT",
            body: JSON.stringify(body)
        });
    }

    delete(endpoint) {
        return this.request(endpoint, {
            method: "DELETE"
        });
    }

}

window.api = new Api();