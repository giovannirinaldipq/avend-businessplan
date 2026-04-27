# Setup de domínio personalizado — `simulador.grupoavend.com.br`

Guia passo-a-passo pra apontar o subdomínio pro GitHub Pages.
Tempo estimado: 10 minutos + 1-24h de propagação DNS.

---

## 1. Configurar DNS no painel do `grupoavend.com.br`

Acesse o painel do seu provedor de domínio (Registro.br, GoDaddy, Hostgator, Locaweb, etc.) e adicione **um único registro CNAME**:

| Tipo  | Nome / Host | Valor / Aponta para         | TTL    |
|-------|-------------|------------------------------|--------|
| CNAME | `simulador` | `giovannirinaldipq.github.io` | `3600` (ou Auto) |

⚠ **Atenção ao "Nome":** alguns painéis pedem só `simulador`, outros pedem `simulador.grupoavend.com.br`. Os 2 funcionam. Se houver dúvida, use o nome curto.

⚠ **Não inclua o ponto final** (`giovannirinaldipq.github.io.` com ponto) a menos que o painel exija — alguns auto-completam.

### Provedores comuns
- **Registro.br**: Painel → Editar Zona → Adicionar registro CNAME
- **GoDaddy**: My Products → DNS → Add → CNAME
- **Hostgator**: Painel → Zone Editor → Add Record → CNAME
- **Cloudflare**: DNS → Add record → Type CNAME → Proxy status: DNS only (cinza, não laranja)

---

## 2. Configurar GitHub Pages

1. Acesse <https://github.com/giovannirinaldipq/avend-businessplan/settings/pages>
2. Em **Custom domain**, digite: `simulador.grupoavend.com.br`
3. Clique **Save**
4. Aguarde 1-2 minutos. O GitHub vai validar o DNS.
5. Quando aparecer um ✓ verde, marque a opção **Enforce HTTPS** (espera ~10min até o cert gerar)

⚠ O arquivo `CNAME` na raiz do repo já contém `simulador.grupoavend.com.br`, então o GitHub também aceita via auto-detect.

---

## 3. Validar

Espere a propagação DNS (geralmente 5-30 min, raramente até 24h).

### Como testar
```bash
# Linux/Mac/Git Bash
nslookup simulador.grupoavend.com.br

# Resultado esperado:
# simulador.grupoavend.com.br
# canonical name = giovannirinaldipq.github.io.
```

Ou abra <https://dnschecker.org/?q=simulador.grupoavend.com.br&t=cname> — mostra status global.

Quando o DNS propagar, abra <https://simulador.grupoavend.com.br/> e o site deve carregar com HTTPS.

---

## 4. Atualizar os links do Apps Script (já está ajustado)

O `Code.gs` continua o mesmo — não precisa mexer. Mas verifique se você ainda envia o link antigo (`giovannirinaldipq.github.io/avend-businessplan/`) em algum WhatsApp, e-mail ou material — substitua pelo novo.

---

## Troubleshooting

**"DNS_PROBE_FINISHED_NXDOMAIN"** — DNS ainda não propagou. Aguarde mais.

**"Não é seguro" / "Certificate not valid"** — GitHub Pages está gerando o certificado HTTPS. Pode levar até 24h. Use `http://` temporariamente se urgente.

**GitHub mostra "Domain's DNS record could not be retrieved"** — confira o registro CNAME no painel. Pode ter erro de digitação ou estar apontando para outro lugar.

**Cloudflare proxy ativado (laranja)** — DESATIVE. GitHub Pages não funciona bem com Cloudflare proxy. Use só DNS (cinza).

---

## Bonus: redirecionamento `www → simulador`

Se quiser que `www.grupoavend.com.br/simulador` também aponte aqui, é mais complicado (precisa de path rewrite). O caminho mais simples é manter `simulador.grupoavend.com.br` como URL canônica e usá-lo em todos os materiais.
