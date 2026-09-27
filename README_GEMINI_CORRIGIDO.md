# TratoCore — Gemini corrigido

Esta versão corrige dois problemas observados no Windows:

1. O `TESTAR_GEMINI.bat` anterior tinha uma linha PowerShell com aspas conflitantes, causando `TerminatorExpectedAtEndOfString`.
2. O `.env` ainda podia permanecer com `GEMINI_MODEL=gemini-2.5-flash-lite`.

Agora a verificação é feita por Node.js, sem o comando PowerShell problemático, e o utilitário `CORRIGIR_E_TESTAR_GEMINI.bat` ajusta o modelo para `gemini-3.5-flash-lite` antes de testar a chave.

A chave nunca é exibida inteira.
