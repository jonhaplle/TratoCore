const ui = require("./lib/console");
const node = require("./lib/node");
const git = require("./lib/git");
const env = require("./lib/env");

ui.title("TRATOCORE DOCTOR");

if (node.exists())
    ui.ok(`Node.js: ${node.version()}`);
else
    ui.error("Node.js não encontrado.");

if (git.exists())
    ui.ok(`Git: ${git.version()}`);
else
    ui.error("Git não encontrado.");

if (env.exists())
    ui.ok(`.env encontrado (${env.path()})`);
else
    ui.error(".env não encontrado.");

ui.info("Doctor finalizado.");