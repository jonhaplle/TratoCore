# TratoCore — correções da página Produtos

## O que foi corrigido

1. `public/produtos.js`: a abertura do produto usava `cells[1]`, que é a célula da foto. O ID correto está na célula seguinte. Agora cada `<tr>` guarda `data-product-id` e a navegação usa esse valor.
2. `public/produtos.html`: removido `\\n` literal no cabeçalho da tabela.
3. `public/produtos.css`: estabilidade mínima do formulário/descrição e indicação visual da linha clicável.
4. `api/server.js`: adicionado `GET /api/health` para verificar PostgreSQL e configuração do Gemini.

## Banco / ngrok

O TratoCore local usa PostgreSQL diretamente em `DB_HOST`/`DB_PORT` definidos no `.env` (normalmente `localhost:5432`). Ngrok não é necessário para abrir `produtos.html` nem para consultar o PostgreSQL local. Ele só deve entrar quando houver necessidade de expor o servidor para fora da máquina, por exemplo callbacks/integrações específicas.

## Diagnóstico

Depois de iniciar o sistema, abra:

`http://localhost:3000/api/health`

Deve aparecer `"postgres":"connected"` e `"gemini":"configured"`.
