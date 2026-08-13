const fs = require("fs");
const path = require("path");

exports.exists = () => {
    return fs.existsSync(path.join(process.cwd(), ".env"));
};

exports.path = () => {
    return path.join(process.cwd(), ".env");
};