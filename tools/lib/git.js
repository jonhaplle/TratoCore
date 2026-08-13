const { execSync } = require("child_process");

exports.exists = () => {
    try {
        execSync("git --version");
        return true;
    } catch {
        return false;
    }
};

exports.version = () => {
    try {
        return execSync("git --version").toString().trim();
    } catch {
        return null;
    }
};

exports.branch = () => {
    try {
        return execSync("git branch --show-current").toString().trim();
    } catch {
        return null;
    }
};