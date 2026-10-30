/*
 * Desafio: da recepção ao faturamento — 2 horas
 *
 * 1. Preencha a chave do sandbox em CONFIG.
 * 2. Implemente as duas funções usando fetch e os manuais dos serviços.
 * 3. Teste suas funções usando os dados do objeto testes.
 *
 * Você pode usar JavaScript puro em uma página HTML.
 * Também pode executar o código com Node.js, se preferir.
 *
 * As funções simulam operações de uma API e fazem chamadas reais ao sandbox.
 *
 * Sucesso: { status: 204 }
 * Erro:    { status: 400, error: "Mensagem compreensível em português." }
 *
 * Escolha o status adequado para cada situação; 400 é somente um exemplo.
 *
 * Os dados de teste abaixo usam 27/10/2026 como referência.
 * Ajuste as datas e os períodos conforme a data da entrevista.
 */

const CONFIG = {
  chaveSandbox: "1b51008970d0024fd3369566fc77cd4a0806",
  guiasUrl: "https://guias.2-25-248-218.sslip.io",
  clinicaUrl: "https://clinica.2-25-248-218.sslip.io",
  faturamentoUrl: "https://faturamento.2-25-248-218.sslip.io",
};

const REGEX_CARTEIRINHA = /^VP-\d{4}$/

const ESPECIALIDADES_COBERTAS = new Set([
  "cardiologia",
  "dermatologia",
  "ortopedia",
]);

let tokenGuias;
let credenciaisFaturamento;

// Identifique o paciente, verifique a elegibilidade, emita a guia
// e armazene os dados necessários na Clínica.
// Consulte os manuais dos serviços.
async function recepcionarPaciente({ carteirinha, especialidade, data }) {
  especialidade = especialidade
    .trim()
    .toLowerCase();
  carteirinha = carteirinha
    .trim()
    .toUpperCase();

  if (!REGEX_CARTEIRINHA.test(carteirinha)) {
    return {
      error: "Paciente de outro convênio",
      status: 400, // Bad request
    }
  }
  
  const paciente = await consultarPaciente(carteirinha);
  if ('error' in paciente) {
    return {
      error: paciente.error,
      status: 404, // Not found
    };
  }

  if (!ESPECIALIDADES_COBERTAS.has(especialidade)) {
    return {
      error: `A especialidade solicitada "${especialidade}" não é coberta ou é desconhecida`,
      status: 400, // Bad request
    };
  }

  async function gerarToken() {
    const credenciaisGuia = await obterCredenciaisGuias();
    return obterTokenGuias(credenciaisGuia.login, credenciaisGuia.senha);
  }
  const token = tokenGuias ??= await gerarToken();

  const { elegivel } = await pacienteEhElegivel(token, {
    nome: paciente.nome,
    carteirinha,
  });

  if (!elegivel) {
    return {
      status: 403, // Forbidden (não autorizado)
      error: "O paciente não está elegível",
    };
  }

  const { numero_guia, senha_guia } = await emitirGuia({
    token,
    nome: paciente.nome,
    carteirinha,
    especialidade,
    data,
  });
  const sucessoAoArmazernarGuia = await armazenarGuia({
    carteirinha,
    codigo_guia: numero_guia,
    senha_guia,
    data_guia: data,
  });
  
  return sucessoAoArmazernarGuia
    ? { status: 204 } // Sucesso (no content)
    : { status: 500, error: "Um erro interno ocorreu" };
}

async function faturar({ mes, ano }) {
  const agora = new Date();

  if (agora.getFullYear() !== ano || agora.getMonth() + 1 !== mes) {
    const mesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1);

    if (mesPassado.getFullYear() !== ano || mesPassado.getMonth() + 1 !== mes) {
      return {
        status: 400,
        error: "Um faturamento só pode ser realizado sobre registros deste mês ou do mês anterior",
      };
    }
  }

  async function consultarLoteEGerarRelatorio() {
    const registros = await consultarLote({ mes, ano });
    return construirRelatorio({ registros, mes, ano });
  }
  const [ relatorioXml, credenciais ] = await Promise.all([
    consultarLoteEGerarRelatorio(),
    credenciaisFaturamento ??= obterCredenciaisFaturamento(),
  ]);
  if ('error' in credenciais || typeof relatorioXml !== 'string')
    return { status: 500, error: "Um erro interno ocorreu ao gerar o relatório" };

  const sucessoAoArmazernarRelatorio = await enviarRelatorio({
    documentoXml: relatorioXml,
    login: credenciais.login,
    senha: credenciais.senha,
  });

  return sucessoAoArmazernarRelatorio
    ? { status: 204 }
    : { status: 500, error: "Erro interno ao enviar o relatório" };
}

// --------------------- TESTES

const testes = {
  recepcao: {
    // Esperado: sucesso.
    pacienteValido1: {
      carteirinha: "VP-1001",
      especialidade: "cardiologia",
      data: "2026-10-27",
    },

    // Esperado: sucesso.
    pacienteValido2: {
      carteirinha: "VP-1002",
      especialidade: "dermatologia",
      data: "2026-10-27",
    },

    // Esperado: erro explicando que o paciente não está elegível.
    pacienteNaoElegivel: {
      carteirinha: "VP-1003",
      especialidade: "cardiologia",
      data: "2026-10-27",
    },

    // Esperado: erro explicando o problema com o convênio.
    outroConvenio: {
      carteirinha: "OUT-2001",
      especialidade: "cardiologia",
      data: "2026-10-27",
    },

    // Esperado: erro explicando que a especialidade não é coberta.
    especialidadeNaoCoberta: {
      carteirinha: "VP-1004",
      especialidade: "oncologia",
      data: "2026-10-27",
    },
  },

  faturamento: {
    // Esperado: sucesso.
    mesAtual: {
      mes: 10,
      ano: 2026,
    },

    // Esperado: sucesso.
    mesAnterior: {
      mes: 9,
      ano: 2026,
    },

    // Esperado: erro explicando que o período não pode ser faturado.
    doisMesesAtras: {
      mes: 8,
      ano: 2026,
    },
  },
};

// --------------------- FUNÇÕES AUXILIARES

async function consultarPaciente(carteirinha) {
  const headers = new Headers();
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);
  headers.append("mode", "cors");

  const paciente = await fetch(`${CONFIG.clinicaUrl}/api/pacientes/${carteirinha}`, {
    headers,
  });
  return paciente.json();
}

async function obterCredenciaisGuias() {
  const headers = new Headers();
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);

  const response = await fetch(`${CONFIG.clinicaUrl}/api/credenciais?servico=guias`, {
    headers,
  });
  return await response.json();
}

async function obterCredenciaisFaturamento() {
  const headers = new Headers()
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);

  const response = await fetch(`${CONFIG.clinicaUrl}/api/credenciais?servico=faturamento`, {
    headers,
  })
  return await response.json();
}

async function obterTokenGuias(login, senha) {
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);

  const response = await fetch(`${CONFIG.guiasUrl}/v2/auth`, {
    headers,
    method: "POST",
    body: JSON.stringify({
      usuario: login,
      senha,
    }),
  })
  const responseContent = await response.json();
  return responseContent.access_token;
}

async function pacienteEhElegivel(token, { nome, carteirinha }) {
  const headers = new Headers();
  headers.append("Authorization", `Bearer ${token}`);
  headers.append("Content-Type", "application/json");
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);

  const response = await fetch(`${CONFIG.guiasUrl}/v3/elegibilidade`, {
    headers,
    method: "POST",
    body: JSON.stringify({ nome, carteirinha }),
  });
  return await response.json();
}

async function emitirGuia({ token, nome, carteirinha, especialidade, data }) {
  const headers = new Headers();
  headers.append("Authorization", `Bearer ${token}`);
  headers.append("Content-Type", "application/json");
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);

  const response = await fetch(`${CONFIG.guiasUrl}/v3/guias`, {
    headers,
    method: "POST",
    body: JSON.stringify({ nome, carteirinha, especialidade, data }),
  });
  return await response.json();
}

async function armazenarGuia({ carteirinha, codigo_guia, senha_guia, data_guia }) {
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);

  const response = await fetch(`${CONFIG.clinicaUrl}/api/armazenamentos`, {
    headers,
    method: "POST",
    body: JSON.stringify({ carteirinha, codigo_guia, senha_guia, data_guia }),
  });
  return response.status === 204;
}

async function consultarLote({ mes, ano }) {
  const headers = new Headers();
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);

  const url = new URL(`${CONFIG.clinicaUrl}/api/lotes`);
  url.searchParams.append("mes", mes);
  url.searchParams.append("ano", ano);

  const response = await fetch(url, { headers });
  return await response.json();
}

function construirRelatorio({ registros, mes, ano }) {
  const guiasXml = [];

  for (const registro of registros) {
    const propsXml = [];

    for (const prop in registro)
      propsXml.push(`<${prop}>${registro[prop]}</${prop}>`);

    guiasXml.push(`<guia>${propsXml.join('')}</guia>`);
  }
  return `<lote ano="${ano}" mes="${mes}">${guiasXml.join('')}</lote>`;
}

async function enviarRelatorio({ documentoXml, login, senha }) {
  const headers = new Headers();
  headers.append("Content-Type", "application/xml");
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);
  headers.append("Authorization", "Basic " + btoa(`${login}:${senha}`));

  const response = await fetch(`${CONFIG.faturamentoUrl}/api/envios`, {
    method: 'POST',
    headers,
    body: documentoXml,
  });
  return response.status === 204;
}

async function obterCredenciaisFaturamento() {
  const headers = new Headers();
  headers.append("X-Sandbox-Key", CONFIG.chaveSandbox);

  const resultado = await fetch(`${CONFIG.clinicaUrl}/api/credenciais?servico=faturamento`, {
    headers,
  });

  return resultado.json();
}

// --------------------- TESTES

async function testarRecepcao() {
  const campos = Object.keys(testes.recepcao.pacienteValido1);
  const resultados = {};

  for (const teste in testes.recepcao) {
    const args = {};

    for (const campo of campos)
      args[campo] = testes.recepcao[teste][campo];

    resultados[teste] = await recepcionarPaciente(args);
  }
  return resultados;
}

async function testarFaturamento() {
  const campos = Object.keys(testes.faturamento.mesAtual);
  const resultados = {};

  for (const teste in testes.faturamento) {
    const args = {};

    for (const campo of campos)
      args[campo] = testes.faturamento[teste][campo];

    resultados[teste] = await faturar(args);
  }
  return resultados;
}

(async () => {
  const [ recepcao, faturamento ] = await Promise.all([
    testarRecepcao(),
    testarFaturamento(),
  ]);

  console.log("TESTES Recepção");
  console.table(recepcao);

  console.log("\nTESTES Faturamento");
  console.table(faturamento);
})();
