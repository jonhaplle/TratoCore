const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const STORAGE = path.join(ROOT, "storage", "browser");
const PROFILE = path.join(STORAGE, "profile");
const SCREENSHOTS = path.join(STORAGE, "screenshots");

for (const dir of [STORAGE, PROFILE, SCREENSHOTS]) {
    fs.mkdirSync(dir, { recursive: true });
}

function findBrowserExecutable() {
    const candidates = [
        process.env.TRATOCORE_BROWSER_EXECUTABLE,
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe")
    ].filter(Boolean);

    return candidates.find(p => fs.existsSync(p)) || null;
}

let context = null;
let page = null;
let starting = null;

async function ensureBrowser() {
    if (context && page && !page.isClosed()) return { context, page };
    if (starting) return starting;

    starting = (async () => {
        const executablePath = findBrowserExecutable();
        if (!executablePath) {
            throw new Error(
                "Google Chrome ou Microsoft Edge não encontrado. " +
                "Instale um deles ou defina TRATOCORE_BROWSER_EXECUTABLE no .env."
            );
        }

        context = await chromium.launchPersistentContext(PROFILE, {
            executablePath,
            headless: false,
            viewport: { width: 1440, height: 900 },
            locale: "pt-BR",
            timezoneId: "America/Sao_Paulo",
            acceptDownloads: true,
            args: ["--start-maximized"]
        });

        page = context.pages()[0] || await context.newPage();

        context.on("close", () => {
            context = null;
            page = null;
        });

        return { context, page };
    })();

    try {
        return await starting;
    } finally {
        starting = null;
    }
}

async function open(url) {
    if (!/^https?:\/\//i.test(String(url || ""))) {
        throw new Error("URL inválida. Use http:// ou https://.");
    }

    const { page } = await ensureBrowser();
    await page.goto(String(url), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    return getPageState();
}

async function screenshot() {
    const { page } = await ensureBrowser();
    const name = `screen-${Date.now()}.png`;
    const filePath = path.join(SCREENSHOTS, name);
    await page.screenshot({ path: filePath, fullPage: false });
    return {
        fileName: name,
        path: filePath,
        url: page.url(),
        title: await page.title()
    };
}

async function inspect() {
    const { page } = await ensureBrowser();
    return page.evaluate(() => {
        const visible = el => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
        };

        const fields = [...document.querySelectorAll("input, textarea, select, button")]
            .filter(visible)
            .slice(0, 500)
            .map((el, index) => ({
                index,
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute("type") || null,
                name: el.getAttribute("name") || null,
                id: el.id || null,
                placeholder: el.getAttribute("placeholder") || null,
                ariaLabel: el.getAttribute("aria-label") || null,
                text: (el.innerText || el.value || "").trim().slice(0, 300),
                required: !!el.required,
                disabled: !!el.disabled
            }));

        const headings = [...document.querySelectorAll("h1,h2,h3")]
            .filter(visible)
            .map(el => (el.innerText || "").trim())
            .filter(Boolean)
            .slice(0, 100);

        const bodyText = (document.body?.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 20000);

        return {
            url: location.href,
            title: document.title,
            headings,
            fields,
            bodyText
        };
    });
}

async function fill(selector, value) {
    const { page } = await ensureBrowser();
    if (!selector) throw new Error("Informe o seletor do campo.");
    await page.locator(selector).first().fill(String(value ?? ""));
    return { selector, value: String(value ?? ""), ...await getPageState() };
}

async function click(selector) {
    const { page } = await ensureBrowser();
    if (!selector) throw new Error("Informe o seletor do elemento.");
    await page.locator(selector).first().click();
    return { selector, clicked: true, ...await getPageState() };
}

async function getPageState() {
    const { page } = await ensureBrowser();
    return {
        url: page.url(),
        title: await page.title()
    };
}

async function close() {
    if (context) await context.close();
    context = null;
    page = null;
    return { closed: true };
}

async function status() {
    return {
        running: !!context,
        browser: findBrowserExecutable(),
        profile: PROFILE,
        screenshots: SCREENSHOTS,
        page: context && page && !page.isClosed() ? await getPageState() : null
    };
}

module.exports = {
    ensureBrowser,
    open,
    screenshot,
    inspect,
    fill,
    click,
    getPageState,
    close,
    status,
    paths: { STORAGE, PROFILE, SCREENSHOTS }
};
