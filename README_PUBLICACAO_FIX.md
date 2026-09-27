# Diagnóstico de publicação ML

Nesta versão foi acrescentado `diagnostico_publicacao_ml.js` e `DIAGNOSTICAR_PUBLICACAO_ML.bat`.

O diagnóstico verifica:
- conexão PostgreSQL;
- existência do token ML e usuário;
- /users/me;
- domain discovery;
- users/{user_id}/items/search.

Não imprime o token completo.

Uso: copie/instale esta versão em `C:\TratoCore` e execute `DIAGNOSTICAR_PUBLICACAO_ML.bat`.
