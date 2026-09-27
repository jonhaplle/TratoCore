# TratoCore — modelo Gemini

O modelo padrão do TratoCore foi atualizado para:

`gemini-3.5-flash-lite`

Motivo: o endpoint `gemini-2.5-flash-lite` está retornando erro para novas contas/chaves em alguns ambientes, conforme a mensagem exibida pelo próprio Gemini API. O Google atualmente lista `gemini-3.5-flash-lite` como modelo estável e disponível na API.

## Configuração

No arquivo `C:\TratoCore\.env`:

```env
GEMINI_API_KEY=SUA_CHAVE
GEMINI_MODEL=gemini-3.5-flash-lite
```

Não envie a chave pelo chat.
