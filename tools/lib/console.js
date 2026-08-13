exports.title = (text) => {
    console.clear();

    console.log("=================================");
    console.log(` ${text}`);
    console.log("=================================");
};

exports.ok = (text) => {
    console.log(`[OK] ${text}`);
};

exports.error = (text) => {
    console.log(`[ERRO] ${text}`);
};

exports.warn = (text) => {
    console.log(`[AVISO] ${text}`);
};

exports.info = (text) => {
    console.log(`[INFO] ${text}`);
};