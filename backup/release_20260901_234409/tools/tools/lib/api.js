const http = require("http");

exports.check = () => {
    return new Promise((resolve) => {

        http.get("http://localhost:3000/api", (res) => {

            if (res.statusCode === 200)
                resolve(true);
            else
                resolve(false);

        }).on("error", () => {
            resolve(false);
        });

    });
};