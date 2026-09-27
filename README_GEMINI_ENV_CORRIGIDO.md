# TratoCore - Gemini ENV Corrigido

Esta versao carrega explicitamente `C:\TratoCore\.env`, independentemente do diretorio atual do processo. O serviço Gemini tambem le a chave no momento da chamada.

## Passos
1. Execute `CONFIGURAR_GEMINI.bat` e informe a chave.
2. Reinicie o TratoCore com `INICIAR_TRATOCORE.bat` ou `ATUALIZAR_TRATOCORE_GEMINI.bat`.
3. Verifique no CMD do servidor a linha `Gemini: ✅ Chave carregada`.
