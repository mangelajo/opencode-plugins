/**
 * Fixtures de raciocínio (thinking) para testes do thinking-guard.
 *
 * O loop é realista: o modelo re-deriva os mesmos passos ciclicamente,
 * com variação superficial de wording (como acontece de verdade) — não
 * é texto idêntico copiado, para exercitar a similaridade Jaccard.
 */

const LOOP_CORE =
  "Vou analisar o problema novamente. Primeiro, preciso verificar onde o erro está acontecendo. " +
  "Vou olhar o arquivo src/index.ts e procurar a função que processa os dados. Encontrei a função, " +
  "agora vou ler a implementação linha por linha. A lógica parece correta à primeira vista, mas o " +
  "erro persiste quando rodo os testes. Talvez o problema esteja em outro lugar do código. Vou " +
  "voltar ao início e verificar o fluxo completo mais uma vez para ter certeza de que não perdi nada."

const LOOP_PREFIXES = [
  "Ok, deixa eu revisar isso.",
  "Certo, pensando de novo.",
  "Hmm, vou repetir a análise.",
  "Beleza, mais uma passada.",
  "Então, voltando ao começo.",
  "Agora, checando outra vez.",
  "Certo, revisando o raciocínio.",
  "Ok, mais uma verificação.",
  "Então deixa eu conferir.",
  "Pensando novamente aqui.",
]

const LOOP_SUFFIXES = [
  "Isso deve resolver.",
  "Vou tentar de novo.",
  "Preciso confirmar isso.",
  "Vamos verificar mais uma vez.",
  "Acho que ficou claro.",
  "Só para garantir.",
  "Vou repetir o processo.",
  "Deixa eu validar.",
  "Mais um ciclo então.",
  "Recomeçando a análise.",
]

/**
 * Chunks de raciocínio em loop: mesmo conteúdo central, variação superficial.
 * Chunks adjacentes devem ter Jaccard similarity >= 0.6.
 */
export const LOOPING_REASONING_CHUNKS: string[] = LOOP_PREFIXES.map(
  (prefix, i) => `${prefix} ${LOOP_CORE} ${LOOP_SUFFIXES[i]}`,
)

/** Stream completo de um thinking em loop (concatenação dos chunks). */
export const LOOPING_REASONING: string = LOOPING_REASONING_CHUNKS.join(" ")

/**
 * Raciocínio longo e produtivo: cada trecho avança para um assunto
 * distinto — nunca deve disparar o guard, por mais que cresça.
 */
export const PRODUCTIVE_REASONING: string = [
  "O usuário pediu para corrigir a rota de autenticação. Vou começar mapeando onde as rotas são registradas no servidor. O framework usa um arquivo de rotas central, então procuro por auth no diretório de rotas e encontro três handlers: login, logout e refresh.",
  "Analisando o handler de login, vejo que ele valida o corpo da requisição com um schema zod, consulta o usuário no banco e compara a senha com bcrypt. A comparação parece correta, mas o handler de refresh não valida se o token foi revogado — isso pode ser a causa da sessão fantasma relatada no issue 412.",
  "Para o refresh, preciso adicionar uma verificação de revogação. Existe uma tabela de tokens revogados no schema do Postgres, criada pela migration 0042. Vou consultar o Prisma schema para confirmar os campos: id, jti, revokedAt, expiresAt. A consulta deve filtrar por jti e checar revokedAt is null.",
  "Sobre os testes: o arquivo de specs do auth tem cobertura para login e logout, mas nada para refresh. Vou escrever três casos: token válido renova, token revogado retorna 401, e token expirado retorna 401 com mensagem distinta. Os factories de teste já existem no diretório de support.",
  "Considerando a migração de dados: tokens já emitidos antes do deploy não têm registro de revogação. A migration precisa ser aditiva e o handler deve tratar ausência de registro como não revogado, para não invalidar todas as sessões ativas no lançamento.",
  "Documentação: o README do módulo auth lista os endpoints com exemplos de curl. Vou atualizar a seção de refresh para mencionar o comportamento de revogação e adicionar o novo código de erro 4013 na tabela de erros do appendix.",
  "Revisão de performance: a consulta de revogação adiciona um roundtrip ao Redis por request de refresh. Como refresh acontece a cada 15 minutos por sessão ativa, o impacto é desprezível — mas vou adicionar um índice composto por jti mesmo assim, barato e evita table scan no pior caso.",
  "Por fim, o plano de rollout: feature flag authRefreshRevocation desligada, deploy em staging, rodar a suíte e2e de auth, ligar a flag para 10% das sessões, monitorar a taxa de 401 por uma hora e só então liberar para todos. Se a taxa de 401 disparar, rollback da flag é imediato e sem migration reversa.",
].join(" ")

/** Thinking curto e normal — fluxo comum, não deve sequer encher um chunk. */
export const SHORT_NORMAL_REASONING: string =
  "O usuário quer listar arquivos. Vou usar o comando ls no diretório solicitado e resumir o resultado."
