# VOID PRO — Agente

Componente público do executor da VOID PRO para GitHub Actions.

Recebe somente um identificador de tarefa. O GitHub comprova a identidade da
execução por OIDC. A cada chamada, o backend verifica a tarefa, o repositório,
a execução autorizada e a licença. Chaves, modelo de IA, comandos e checkpoints
permanecem no backend privado.

O runner acompanha operações pequenas e persistidas, em vez de esperar uma
única Edge Function executar a tarefa inteira. Um fluxo pode ultrapassar o
limite de uma chamada, mas cada chamada continua sujeita aos limites do serviço.

O código não recebe chave de IA, token administrativo, service-role ou senha.
Não instala dependências, executa código do repositório ou imprime respostas
brutas. Logs usam apenas etapas fixas com a marca VOID PRO.

O uso de produção exige o workflow reutilizável fixado por SHA e sua validação
correspondente no backend. Executar manualmente o Action não concede acesso.
