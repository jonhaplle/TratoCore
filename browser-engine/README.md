# TratoCore Browser Engine

Módulo local para controlar um navegador já instalado no computador e devolver ao TratoCore:

- URL e título da página;
- estrutura dos campos visíveis (input, textarea, select e button);
- textos e títulos visíveis;
- screenshots da tela.

## Filosofia

A API oficial do Mercado Livre continua sendo a via preferencial para publicação.
O Browser Engine existe para consulta, validação e tarefas de interface quando a API não entrega o que precisamos.

Não tenta burlar CAPTCHA, login, mecanismos anti-bot ou controles de acesso.

## Dependência

Na pasta `TratoCore`, execute:

```bat
npm install
```

O pacote usa `playwright-core` e o Chrome/Edge já instalado no Windows. Não baixa outro navegador.

## Variável opcional

Se o executável não for encontrado automaticamente, defina no `.env`:

```env
TRATOCORE_BROWSER_EXECUTABLE=C:\\caminho\\para\\chrome.exe
```

## Endpoints

- `GET /api/browser/status`
- `POST /api/browser/open` com `{ "url": "https://..." }`
- `GET /api/browser/inspect`
- `POST /api/browser/fill` com `{ "selector": "input[name=title]", "value": "..." }`
- `POST /api/browser/click` com `{ "selector": "button[type=submit]" }`
- `POST /api/browser/screenshot`
- `POST /api/browser/close`

As screenshots ficam em `storage/browser/screenshots`.
