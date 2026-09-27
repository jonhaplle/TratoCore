# TratoCore Release — Gemini + Mercado Livre + Browser Engine

Pacote de produção/local para o TratoCore, preparado para atualização segura da instalação existente em `C:\TratoCore`.

Princípios desta release:
- Gemini via Interactions API para análise multimodal e geração de anúncio.
- Mercado Livre via API oficial para publicação.
- PostgreSQL local como banco.
- Browser Engine separado para leitura/interação com páginas quando necessário.
- `.env` existente nunca é sobrescrito pelo instalador.
- Sem segredos incluídos no pacote.

## Instalação
Execute `INSTALAR_ATUALIZAR_TRATOCORE.bat` como Administrador.

## Inicialização
Execute `ABRIR_TRATOCORE.bat`.

## Configuração
Use o `.env` existente em `C:\TratoCore\.env`. Para uma instalação nova, copie `.env.example` para `.env` e preencha as variáveis necessárias.
