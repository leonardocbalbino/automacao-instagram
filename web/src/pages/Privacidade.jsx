export default function Privacidade() {
  return (
    <div className="center">
      <article className="card prose">
        <h1>Política de privacidade</h1>
        <p>
          Este aplicativo automatiza respostas a comentários e mensagens em contas profissionais do Instagram, usando
          exclusivamente a API oficial da Meta.
        </p>
        <h2>Dados que coletamos</h2>
        <ul>
          <li>Identificador da pessoa no Instagram (IGSID) e nome de usuário de quem comenta ou envia mensagem para a conta.</li>
          <li>O texto do comentário ou da mensagem, para identificar palavras-chave e registrar o histórico de envios.</li>
          <li>Cliques nos links enviados, contados de forma agregada.</li>
        </ul>
        <h2>Como usamos</h2>
        <p>
          Os dados servem apenas para responder a quem interagiu com a conta e medir o resultado das automações. Não
          vendemos nem compartilhamos dados com terceiros e não enviamos mensagens para quem não iniciou contato.
        </p>
        <h2>Retenção e exclusão</h2>
        <p>
          Você pode pedir a exclusão dos seus dados removendo o app nas configurações do Instagram ou pelo canal de
          contato do titular da conta. Pedidos recebidos pela Meta são processados automaticamente e geram um código
          de confirmação consultável em /exclusao/&lt;código&gt;.
        </p>
        <h2>Base legal</h2>
        <p>Tratamento conforme a LGPD (Lei 13.709/2018), com base no legítimo interesse de responder a quem interagiu com a conta.</p>
      </article>
    </div>
  );
}
