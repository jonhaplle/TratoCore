/**
 * Painel de pareamento do TratoCap.
 *
 * SEGURANÇA DA CHAVE
 * ------------------
 * A chave administrativa vive SOMENTE na variável `chaveAdministrativa`,
 * em memória, enquanto a página está aberta.
 *
 *  - nunca vai para localStorage, sessionStorage ou cookie;
 *  - nunca é escrita em console ou mensagem de erro;
 *  - é apagada do campo e da memória assim que o código é exibido;
 *  - não existe no código-fonte nem é servida pelo backend.
 *
 * A autenticação continua sendo feita exclusivamente por `requireAdmin`
 * no servidor, com `TRATO_VENDEDOR_ADMIN_KEY`.
 */
(function () {
    "use strict";

    // Chave em memória. Nunca persistida.
    let chaveAdministrativa = "";

    // ------------------------------------------------------------------
    // Elementos
    // ------------------------------------------------------------------
    const campoChave = document.getElementById("adminKey");
    const campoApelido = document.getElementById("apelido");
    const btnGerar = document.getElementById("btnGerar");
    const resultadoCodigo = document.getElementById("resultadoCodigo");
    const mensagemGerar = document.getElementById("mensagemGerar");
    const btnListar = document.getElementById("btnListar");
    const mensagemLista = document.getElementById("mensagemLista");
    const tabela = document.getElementById("tabelaDispositivos");
    const corpoTabela = tabela ? tabela.querySelector("tbody") : null;
    const listaVazia = document.getElementById("listaVazia");
    const avisoInseguro = document.getElementById("avisoInseguro");

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------

    /** Mostra uma mensagem padronizada. */
    function mostrar(alvo, tipo, texto) {
        if (!alvo) return;

        alvo.className = "mensagem " + tipo;
        alvo.textContent = texto;
        alvo.hidden = false;
    }

    function esconder(alvo) {
        if (!alvo) return;

        alvo.hidden = true;
        alvo.textContent = "";
    }

    /** Lê a chave digitada para a memória da página. */
    function capturarChave() {
        const digitada = campoChave ? campoChave.value.trim() : "";

        if (digitada) chaveAdministrativa = digitada;

        return chaveAdministrativa;
    }

    /** Apaga a chave da tela e da memória. */
    function esquecerChave() {
        chaveAdministrativa = "";

        if (campoChave) {
            campoChave.value = "";
        }
    }

    /** Data legível, sem depender do formato do navegador. */
    function formatarData(valor) {
        if (!valor) return "—";

        const data = new Date(valor);

        if (Number.isNaN(data.getTime())) return String(valor);

        return data.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    /** Requisição autenticada à API administrativa. */
    async function chamarApi(metodo, caminho, corpo) {
        const chave = chaveAdministrativa;

        if (!chave) {
            const erro = new Error("Informe a chave administrativa.");
            erro.semChave = true;
            throw erro;
        }

        const opcoes = {
            method: metodo,
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + chave
            }
        };

        if (corpo !== undefined) {
            opcoes.body = JSON.stringify(corpo);
        }

        const resposta = await fetch(caminho, opcoes);

        let dados = {};
        try {
            dados = await resposta.json();
        } catch (_) {
            // Resposta sem JSON: segue com objeto vazio.
        }

        if (!resposta.ok) {
            const erro = new Error(mensagemDoErro(resposta.status, dados));
            erro.status = resposta.status;
            throw erro;
        }

        return dados;
    }

    /** Traduz o status HTTP em mensagem útil (sem expor a chave). */
    function mensagemDoErro(status, dados) {
        if (status === 401) {
            return "Chave administrativa inválida. Confira e tente novamente.";
        }

        if (status === 404) {
            return dados && dados.error ? dados.error : "Aparelho não encontrado ou já revogado.";
        }

        if (status === 503) {
            return "O servidor não tem a chave administrativa configurada (TRATO_VENDEDOR_ADMIN_KEY).";
        }

        if (status === 429) {
            return "Muitas tentativas. Aguarde um minuto e tente novamente.";
        }

        return (dados && (dados.error || dados.erro)) || ("Falha na operação (HTTP " + status + ").");
    }

    /** Verifica se a página está em contexto seguro. */
    function verificarHTTPS() {
        const protocolo = location.protocol;
        const host = location.hostname;

        const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
        const seguro = protocolo === "https:";

        if (avisoInseguro) {
            avisoInseguro.hidden = seguro || local;
        }

        return seguro || local;
    }

    // ------------------------------------------------------------------
    // GERAR CÓDIGO
    // ------------------------------------------------------------------

    async function gerarCodigo() {
        esconder(mensagemGerar);
        resultadoCodigo.hidden = true;
        resultadoCodigo.innerHTML = "";

        if (!capturarChave()) {
            mostrar(mensagemGerar, "erro", "Informe a chave administrativa para gerar o código.");
            if (campoChave) campoChave.focus();
            return;
        }

        if (!chaveAdministrativa) {
            mostrar(mensagemGerar, "erro", "Informe a chave administrativa para gerar o código.");
            if (campoChave) campoChave.focus();
            return;
        }

        btnGerar.disabled = true;
        btnGerar.textContent = "GERANDO…";

        try {
            const dados = await chamarApi(
                "POST",
                "/api/tratocap/devices/pairing-code",
                { apelido: campoApelido ? campoApelido.value.trim() : "" }
            );

            const codigo = String(dados.codigo || "");

            if (!/^\d{8}$/.test(codigo)) {
                throw new Error("O servidor devolveu um código inesperado.");
            }

            exibirCodigo(codigo, dados);

            // A chave sai da tela assim que o código é exibido.
            esquecerChave();

            mostrar(mensagemGerar, "sucesso", "Código gerado. Digite-o no TratoCap dentro de 10 minutos.");
        } catch (erro) {
            mostrar(mensagemGerar, "erro", erro.message);
        } finally {
            btnGerar.disabled = false;
            btnGerar.textContent = "GERAR CÓDIGO";
        }
    }

    /** Renderiza o código em destaque, com a validade. */
    function exibirCodigo(codigo, dados) {
        resultadoCodigo.innerHTML = "";

        const numero = document.createElement("div");
        numero.className = "codigo-valor";
        numero.textContent = codigo;

        const validade = document.createElement("p");
        validade.className = "codigo-validade";

        const minutos = Number(dados.validade_minutos) || 10;
        const expira = dados.expira_em ? formatarData(dados.expira_em) : "em " + minutos + " minutos";

        validade.textContent = "Válido por " + minutos + " minutos (até " + expira + ").";

        resultadoCodigo.appendChild(numero);
        resultadoCodigo.appendChild(validade);
        resultadoCodigo.hidden = false;
    }

    // ------------------------------------------------------------------
    // LISTAR APARELHOS
    // ------------------------------------------------------------------

    async function listarDispositivos() {
        esconder(mensagemLista);

        if (!capturarChave()) {
            mostrar(mensagemLista, "erro", "Informe a chave administrativa para listar os aparelhos.");
            if (campoChave) campoChave.focus();
            return;
        }

        btnListar.disabled = true;
        btnListar.textContent = "CARREGANDO…";

        try {
            const dados = await chamarApi("GET", "/api/tratocap/devices");

            renderizarDispositivos(Array.isArray(dados.dispositivos) ? dados.dispositivos : []);

            mostrar(mensagemLista, "sucesso", "Lista atualizada.");
        } catch (erro) {
            mostrar(mensagemLista, "erro", erro.message);

            tabela.hidden = true;
            listaVazia.hidden = true;
        } finally {
            btnListar.disabled = false;
            btnListar.textContent = "ATUALIZAR LISTA";
        }
    }

    function renderizarDispositivos(lista) {
        corpoTabela.innerHTML = "";

        if (!lista.length) {
            tabela.hidden = true;
            listaVazia.hidden = false;
            return;
        }

        listaVazia.hidden = true;
        tabela.hidden = false;

        for (const dispositivo of lista) {
            corpoTabela.appendChild(linhaDispositivo(dispositivo));
        }
    }

    function linhaDispositivo(dispositivo) {
        const linha = document.createElement("tr");

        const id = document.createElement("td");
        id.textContent = dispositivo.id ?? "—";

        const apelido = document.createElement("td");
        apelido.textContent = dispositivo.apelido || "(sem nome)";

        const criado = document.createElement("td");
        criado.textContent = formatarData(dispositivo.criado_em);

        const ultimoUso = document.createElement("td");
        ultimoUso.textContent = formatarData(dispositivo.ultimo_uso);

        const situacao = document.createElement("td");
        const rotulo = document.createElement("span");
        const revogado = Boolean(dispositivo.revogado);

        rotulo.className = "rotulo-situacao " + (revogado ? "situacao-revogado" : "situacao-ativo");
        rotulo.textContent = revogado ? "Revogado" : "Ativo";
        situacao.appendChild(rotulo);

        const acao = document.createElement("td");
        const botao = document.createElement("button");

        botao.type = "button";
        botao.className = "botao-revogar";
        botao.textContent = revogado ? "—" : "Revogar";
        botao.disabled = revogado;

        if (!revogado) {
            botao.addEventListener("click", function () {
                revogarDispositivo(dispositivo, botao);
            });
        }

        acao.appendChild(botao);

        linha.appendChild(id);
        linha.appendChild(apelido);
        linha.appendChild(criado);
        linha.appendChild(ultimoUso);
        linha.appendChild(situacao);
        linha.appendChild(acao);

        return linha;
    }

    // ------------------------------------------------------------------
    // REVOGAR
    // ------------------------------------------------------------------

    async function revogarDispositivo(dispositivo, botao) {
        const nome = dispositivo.apelido || ("ID " + dispositivo.id);

        const confirmado = window.confirm(
            "Revogar o aparelho \"" + nome + "\"?\n\n" +
            "Ele deixará de acessar as rotas protegidas e precisará de um novo código para voltar."
        );

        if (!confirmado) return;

        esconder(mensagemLista);

        // A chave pode já ter sido esquecida após gerar um código.
        if (!capturarChave()) {
            mostrar(mensagemLista, "erro", "Informe a chave administrativa para revogar o aparelho.");
            if (campoChave) campoChave.focus();
            return;
        }

        botao.disabled = true;
        botao.textContent = "Revogando…";

        try {
            await chamarApi("DELETE", "/api/tratocap/devices/" + encodeURIComponent(dispositivo.id));

            mostrar(mensagemLista, "sucesso", "Aparelho \"" + nome + "\" revogado.");

            await listarDispositivos();
        } catch (erro) {
            mostrar(mensagemLista, "erro", erro.message);

            botao.disabled = false;
            botao.textContent = "Revogar";
        }
    }

    // ------------------------------------------------------------------
    // Inicialização
    // ------------------------------------------------------------------

    btnGerar.addEventListener("click", gerarCodigo);
    btnListar.addEventListener("click", listarDispositivos);

    // Enter no campo da chave ou no apelido dispara a geração.
    [campoChave, campoApelido].forEach(function (campo) {
        if (!campo) return;

        campo.addEventListener("keydown", function (evento) {
            if (evento.key === "Enter") {
                evento.preventDefault();
                gerarCodigo();
            }
        });
    });

    // Sair da página descarta a chave da memória.
    window.addEventListener("pagehide", esquecerChave);

    if (!verificarHTTPS()) {
        mostrar(mensagemGerar, "erro",
            "Esta página precisa de HTTPS para enviar a chave administrativa com segurança.");
    }
})();
