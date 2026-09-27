# TratoCore — Gemini V2

Esta versão corrige o instalador que estava falhando na etapa de cópia.

Use `ATUALIZAR_TRATOCORE_GEMINI_V2.bat` como Administrador.

O instalador:
- copia os arquivos para `C:\TratoCore` usando PowerShell, sem `robocopy` ocultando o erro;
- preserva `.env`, `node_modules`, `storage`, `backups` e `.git`;
- instala dependências antes de executar `corrigir_gemini_config.js`;
- valida `teste_gemini.js` antes de iniciar o servidor;
- não inicia o TratoCore se o Gemini falhar.
