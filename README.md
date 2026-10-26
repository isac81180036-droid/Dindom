# Dindom — app interno da pizzaria

Protótipo navegável (PWA) das telas principais, feito para validar navegação, visual e usabilidade antes de conectar o banco de dados.

## Como abrir

- **No computador:** dê dois cliques em `index.html` (abre no navegador). Use o modo celular das ferramentas de desenvolvedor (F12 → ícone de celular) para ver no tamanho certo.
- **No celular, como app instalável:** o PWA (instalação na tela inicial, funcionamento offline) só ativa quando servido por `https` ou `localhost`. Qualquer hospedagem estática serve (Netlify, Vercel, GitHub Pages, Firebase Hosting): basta enviar a pasta inteira.

O sistema começa **vazio**. Na primeira abertura em cada aparelho aparece a **primeira configuração**: unidades, dias de reposição e a conta do administrador. Depois o administrador cadastra produtos (Gestão › Produtos), checklists (Gestão › Modelos de checklist) e a equipe (Gestão › Colaboradores).

**Importante:** enquanto o servidor não é ligado, os dados ficam salvos **só no aparelho** onde foram feitos. Use um aparelho compartilhado na loja (tablet ou computador), onde cada pessoa entra com o próprio e-mail e senha e bate o ponto por código. Para cada um usar o próprio celular, é preciso ligar o banco de dados.

## Telas

| Tela | Rota | Arquivo |
|---|---|---|
| Início (colaborador / gerente) | `#inicio` | `js/screens/home.js` |
| Fechamento de estoque | `#estoque/fechamento` | `js/screens/fechamento.js` |
| Estoque e lista de compras | `#estoque`, `#estoque/compras` | `js/screens/estoque.js` |
| Checklists e execução | `#checklists`, `#checklists/<id>` | `js/screens/checklists.js` |
| Registro e acompanhamento de manutenção | `#manutencao`, `#manutencao/nova`, `#manutencao/<nº>` | `js/screens/manutencao.js` |
| Perfil e notificações | `#perfil`, `#notificacoes` | `js/screens/perfil.js` |
| Agenda (dia, semana/3 dias, mês, programação) | `#agenda` | `js/screens/agenda.js` + `js/agenda/` |
| Admin › Colaboradores (cadastrar, editar, desativar) | `#equipe`, `#equipe/novo`, `#equipe/<id>` | `js/screens/equipe.js` |
| Escanear nota fiscal (QR Code da NFC-e) e dar entrada no estoque | `#estoque/nota` | `js/screens/nota-scan.js`, `js/screens/nota.js`, `js/nfce.js`, `js/scanner.js` |
| Onde comprar (comparativo de preços e recomendação) | `#estoque/precos` | `js/screens/precos.js` |
| Ponto (registro, espelho, ajustes, ponto por código) e Ponto da equipe | `#ponto`, `#ponto/equipe` | `js/ponto-core.js`, `js/screens/ponto.js`, `js/screens/ponto-equipe.js` |

**Perfis de acesso:** Colaborador, Gerente e Administrador. Gerente e Administrador veem a área Gestão (menu lateral no computador; Perfil › Administração no celular). Só o Administrador cadastra colaboradores.

## Marca

Arquivos em `icons/`, gerados a partir da logo oficial:

- `logo-dindom-preta.png` — logo preta oficial sem o laço rosa (2000×2000), para usar fora do app.
- `logo-black.png` / `logo-white.png` — logo completa com "DESDE 2009", fundo transparente.
- `wordmark-black.png` / `wordmark-white.png` — só o letreiro "Dindom", fundo transparente.
- `icon-*.png` — ícones do app (fundo preto, letreiro branco).

A identidade fica em `css/tokens.css` (preto e branco da marca, Montserrat espaçada nos rótulos) e `css/brand.css` (logo e animação de abertura).

**Celular x computador:** abaixo de 900 px de largura o app usa a barra inferior (5 destinos; a Agenda abre pelo ícone de calendário no Início). A partir de 900 px vira layout de computador: menu lateral com a Agenda, telas mais largas com grade de cards e painéis em janela centralizada. O limite está em `css/desktop.css` e em `isDesktop()` no `js/app.js`.

## Estrutura

- `css/tokens.css` — cores (tema claro e escuro), tipografia, espaçamentos, raios.
- `css/app.css` — componentes reutilizáveis: cards, botões, chips, campos, barra inferior, painéis, toasts, estados vazios, skeletons.
- `css/screens.css` — estilos específicos de cada tela.
- `css/agenda.css` — agenda (grade de horários, mês, programação, minicalendário).
- `css/desktop.css` — layout de computador e efeitos de mouse.
- `js/agenda/core.js` (datas, repetições, eventos sobrepostos), `views.js` (HTML de cada visão), `form.js` (detalhes e criar/editar).
- `js/data.js` — estrutura dos dados, configurações padrão e armazenamento local (sem dados de exemplo). **É o único arquivo a trocar na fase do banco de dados**: as telas só usam `DB.get()`, `DB.update()` e `DB.product()`.
- `js/ui.js`, `js/media.js` — utilitários (toast, painel inferior, confirmação, câmera).
- `js/app.js` — roteador, barra de navegação, tema, aviso de conexão.
- `sw.js`, `manifest.webmanifest`, `icons/` — instalação como app e uso offline.

## Próxima etapa

1. Validar as telas no celular com a equipe e ajustar.
2. Escolher o backend (ex.: Supabase ou Firebase) e trocar `js/data.js` por chamadas reais, com login e permissões por perfil.
3. Implementar as regras de negócio do prompt principal (estoque ideal por data de reposição, aprovação de compras, notificações).

## Nota fiscal e preços

**O que já funciona no app:** leitura do QR pela câmera (leitor nativo do Android ou jsQR em `js/vendor/`), por foto ou digitando a chave; validação da chave de acesso (dígito verificador, modelo 55/65, estado); bloqueio de nota repetida; reconhecimento dos itens da nota no cadastro, com aprendizado quando alguém corrige; entrada no estoque da unidade escolhida; baixa na lista de compras; registro do preço pago em cada loja.

**O que depende do servidor (próxima etapa):**
- `NFCe.fetchItems` em `js/nfce.js` hoje abre a nota em modo manual: loja, número e data vêm da chave e os itens são lançados à mão. No servidor, ele recebe o texto do QR, consulta a página pública da SEFAZ do estado e devolve loja, data e itens. O navegador não pode fazer isso direto (bloqueio de CORS e formato diferente por estado). Também existem serviços pagos de consulta de NFC-e que entregam os itens já estruturados.
- **Preços das lojas:** os apps de atacados e supermercados não têm acesso aberto, e automatizar a leitura deles costuma violar os termos de uso. A comparação usa a base de preços das notas escaneadas (cada compra alimenta a base) e pode somar fontes públicas de preços de NFC-e onde o estado oferece, encartes publicados e cotações dos fornecedores.
- **IA:** a recomendação hoje é calculada por regra (menor total, divisão entre duas lojas só quando economiza pelo menos R$ 25 e 5%). No servidor, um modelo de IA pode receber essa mesma tabela e explicar a escolha considerando distância, horário e pedido mínimo.
## Ponto

Registros com número sequencial (NSR) e comprovante; nunca são apagados nem editados — correções entram como marcações do tipo "ajuste", pedidas pelo colaborador e aprovadas pelo gerente. A jornada pertence ao dia da entrada (turno da noite que passa da meia-noite conta no dia em que começou). Turnos e horas previstas ficam em `shifts` (`js/data.js`); tolerância de atraso em `js/ponto-core.js`.

**Antes de usar oficialmente:** pela Portaria MTP 671/2021, ponto por programa (REP-P) precisa de registro no INPI, atestado técnico e entrega dos arquivos AFD/AEJ à fiscalização. Este protótipo segue as regras de funcionamento (marcações imutáveis, NSR, comprovante), mas ainda não é certificado; a alternativa é integrar com um sistema de ponto já homologado.
## Supabase (dados compartilhados entre aparelhos)

O app está ligado ao projeto Supabase configurado em `js/config.js` (endereço e chave **publishable**, que é pública; nunca coloque a chave secreta no app). Com ele:

- Login, troca de senha e "Esqueci minha senha" (link por e-mail) pelo Supabase Auth.
- Os dados ficam na tabela `records` (um item por linha) e chegam em tempo real aos outros aparelhos; cada aparelho guarda uma cópia para abrir sem internet e reenvia o que ficou pendente.
- Permissões no banco (`supabase/schema.sql`): só membros da equipe leem e gravam; só o admin mexe no cadastro de colaboradores; colaborador desativado perde o acesso.
- Só existe uma pizzaria por banco: a primeira configuração cria a pizzaria e a conta do administrador.
- O NSR do ponto é gerado pelo servidor.

Configurações necessárias no painel do Supabase: rodar `supabase/schema.sql`, desligar "Confirm email" e definir o Site URL do app. Para usar sem servidor (só no aparelho), deixe `js/config.js` vazio.