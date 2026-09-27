const { execSync } = require("child_process");

exports.version = () => {
    try {
        return execSync("node -v").toString().trim();
    } catch {
        return null;
    }
};

exports.exists = () => {
    return exports.version() !== null;
};